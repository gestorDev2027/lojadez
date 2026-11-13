"""Os afiliados: quem divulga a loja por um link (?ref=<código>) e ganha comissão nas vendas que trouxe.

- O visitante que chega por um link fica marcado por DIAS_ATRIBUICAO dias (no navegador dele); se comprar nesse tempo,
  a venda é do afiliado. Vale o último link clicado.
- A venda só conta para o afiliado ativo e liberado para aquele produto.
- A comissão é fixada quando o pedido é criado: comissao_pct do afiliado sobre o preço dos produtos, sem o frete.
  Só conta como comissão gerada quando o pedido é pago. O pagamento ao afiliado é feito fora da loja (Pix).
- Os cliques são só contados por dia: nada do visitante é guardado.
"""

import re
from datetime import datetime

from sqlalchemy import insert, select, update

from servidor import banco, config, produtos

DIAS_ATRIBUICAO = 30
CODIGO = re.compile(r"^[a-z0-9][a-z0-9-]{1,29}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)


class ErroAfiliado(Exception):
    pass


def _limpo(codigo: str | None) -> str:
    return re.sub(r"[^a-z0-9-]", "", str(codigo or "").strip().lower())[:30]


# ───────── Leitura ─────────

def listar(so_ativos: bool = False) -> list[dict]:
    consulta = select(banco.afiliados).order_by(banco.afiliados.c.nome)
    if so_ativos:
        consulta = consulta.where(banco.afiliados.c.ativo.is_(True))
    with banco.engine.connect() as c:
        return [dict(l) for l in c.execute(consulta).mappings().all()]


def buscar(afiliado_id: int) -> dict | None:
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.afiliados).where(banco.afiliados.c.id == afiliado_id)).mappings().first()
    return dict(linha) if linha else None


def buscar_codigo(codigo: str) -> dict | None:
    codigo = _limpo(codigo)
    if not codigo:
        return None
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.afiliados).where(banco.afiliados.c.codigo == codigo)).mappings().first()
    return dict(linha) if linha else None


def pode_vender(afiliado: dict, produto_id: str | None) -> bool:
    produto_id = produto_id or produtos.KIT
    return bool(afiliado["ativo"]) and (afiliado["todos_produtos"] or produto_id in (afiliado["produtos"] or []))


def atribuir(codigo: str | None, produto_id: str | None) -> dict | None:
    """O afiliado do código, se estiver ativo e liberado para o produto; senão None (a venda fica direta)."""
    afiliado = buscar_codigo(codigo) if codigo else None
    return afiliado if afiliado and pode_vender(afiliado, produto_id) else None


def comissao(afiliado: dict, preco_centavos: int) -> int:
    return round(preco_centavos * float(afiliado["comissao_pct"]) / 100)


def links(afiliado: dict) -> list[dict]:
    """Os links prontos do afiliado: um por produto que ele pode divulgar (o kit e os produtos à venda)."""
    base = config.SITE_URL.rstrip("/")
    itens = [{"produto": produtos.KIT, "nome": "Kit de lâminas (página principal)", "url": f"{base}/?ref={afiliado['codigo']}"}]
    itens += [{"produto": p["slug"], "nome": p["nome"], "url": f"{base}/p/{p['slug']}?ref={afiliado['codigo']}"}
              for p in produtos.listar()]
    return [i for i in itens if afiliado["todos_produtos"] or i["produto"] in (afiliado["produtos"] or [])]


# ───────── Cliques ─────────

def registrar_clique(codigo: str, dia: str) -> bool:
    afiliado = buscar_codigo(codigo)
    if not afiliado or not afiliado["ativo"]:
        return False
    t = banco.afiliado_cliques
    chave = (t.c.afiliado_id == afiliado["id"]) & (t.c.dia == dia)
    with banco.engine.begin() as c:
        if c.execute(update(t).where(chave).values(cliques=t.c.cliques + 1)).rowcount == 0:
            c.execute(insert(t).values(afiliado_id=afiliado["id"], dia=dia, cliques=1))
    return True


def cliques(de: str, ate: str) -> dict[int, int]:
    """{afiliado_id: cliques} entre as datas (AAAA-MM-DD, inclusive)."""
    t = banco.afiliado_cliques
    with banco.engine.connect() as c:
        linhas = c.execute(select(t.c.afiliado_id, t.c.cliques).where(t.c.dia >= de, t.c.dia <= ate)).all()
    saida: dict[int, int] = {}
    for afiliado_id, n in linhas:
        saida[afiliado_id] = saida.get(afiliado_id, 0) + n
    return saida


# ───────── Gravação (área do vendedor) ─────────

def _texto(dados: dict, chave: str, rotulo: str, maximo: int, minimo: int = 0) -> str | None:
    valor = " ".join(str(dados.get(chave) or "").split())
    if len(valor) < minimo:
        raise ErroAfiliado(f"Preencha {rotulo}.")
    if len(valor) > maximo:
        raise ErroAfiliado(f"{rotulo[:1].upper()}{rotulo[1:]}: até {maximo} caracteres.")
    return valor or None


def _conferir(dados: dict) -> dict:
    from servidor.pedidos import cpf_valido  # aqui, para não importar em ciclo

    documento = re.sub(r"\D", "", str(dados.get("documento") or ""))
    if documento and (len(documento) not in (11, 14) or (len(documento) == 11 and not cpf_valido(documento))):
        raise ErroAfiliado("CPF ou CNPJ inválido.")
    email = _texto(dados, "email", "o e-mail", 200)
    if email and not EMAIL.match(email):
        raise ErroAfiliado("E-mail inválido.")
    telefone = re.sub(r"\D", "", str(dados.get("telefone") or ""))
    if telefone and len(telefone) not in (10, 11):
        raise ErroAfiliado("Telefone com DDD: 10 ou 11 números.")
    try:
        pct = round(float(str(dados.get("comissao_pct", "")).replace(",", ".")), 2)
    except ValueError:
        raise ErroAfiliado("Comissão: use um número (ex.: 10 ou 12,5).")
    if not 0 <= pct <= 90:
        raise ErroAfiliado("Comissão: de 0% a 90%.")
    todos = bool(dados.get("todos_produtos", True))
    validos = {produtos.KIT} | {p["slug"] for p in produtos.listar(so_ativos=False)}
    lista = [str(x) for x in (dados.get("produtos") or []) if str(x) in validos]
    if not todos and not lista:
        raise ErroAfiliado("Escolha pelo menos um produto (ou marque “todos os produtos”).")
    return {
        "nome": _texto(dados, "nome", "o nome", 80, 3),
        "documento": documento or None, "email": email.lower() if email else None, "telefone": telefone or None,
        "chave_pix": _texto(dados, "chave_pix", "a chave Pix", 140),
        "comissao_pct": pct, "todos_produtos": todos, "produtos": sorted(set(lista)) if not todos else [],
        "ativo": bool(dados.get("ativo", True)), "observacoes": _texto(dados, "observacoes", "as observações", 500),
    }


def salvar(dados: dict, afiliado_id: int | None = None, email: str | None = None) -> dict:
    valores = _conferir(dados)
    agora = banco.agora()
    if afiliado_id is None:
        bruto = str(dados.get("codigo") or "").strip().lower()
        if bruto and bruto != _limpo(bruto):
            raise ErroAfiliado("Código inválido: use letras minúsculas, números e hífens (2 a 30).")
        codigo = bruto or produtos.gerar_slug(valores["nome"])[:20].strip("-")
        if not CODIGO.match(codigo):
            raise ErroAfiliado("Código inválido: use letras minúsculas, números e hífens (2 a 30).")
        if buscar_codigo(codigo):
            raise ErroAfiliado(f"Já existe um afiliado com o código {codigo}.")
        with banco.engine.begin() as c:
            novo = c.execute(insert(banco.afiliados).values(codigo=codigo, criado_em=agora, atualizado_em=agora,
                                                            **valores)).inserted_primary_key[0]
        banco.registrar(email, "afiliado", f"Afiliado criado: {codigo}")
        return buscar(novo)
    atual = buscar(afiliado_id)
    if not atual:
        raise ErroAfiliado("Afiliado não encontrado.")
    with banco.engine.begin() as c:
        c.execute(update(banco.afiliados).where(banco.afiliados.c.id == afiliado_id).values(atualizado_em=agora, **valores))
    banco.registrar(email, "afiliado", f"Afiliado alterado: {atual['codigo']}")
    return buscar(afiliado_id)


def para_vendedor(afiliado: dict) -> dict:
    saida = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in afiliado.items()}
    return {**saida, "links": links(afiliado)}
