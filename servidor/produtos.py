"""Os produtos do catálogo, além do kit de lâminas.

O kit de lâminas continua com a landing page própria (/), os ajustes em `catalogo.py` e o id KIT. Os outros produtos
ficam na tabela `produtos`, cada um com a página /p/<slug>, o checkout (/checkout?produto=<slug>) e o mesmo jeito de
vender do kit: ofertas por quantidade (1, 2, 3...), o "monte o seu" (da maior oferta + 1 até o máximo, pelo preço por
unidade) e o frete grátis a partir de N unidades. O id de cada oferta é "q<quantidade>" (q1, q2, q5...).

Um produto pode ficar inativo (some da loja) ou ser excluído. Excluir não mexe nos pedidos antigos (eles guardam a
descrição e o SKU), mas é recusado enquanto houver pedido dele pago e ainda não enviado (o envio usa as medidas dele).
"""

import re
import unicodedata

from sqlalchemy import delete, func, insert, select, update

from servidor import banco, catalogo

KIT = "kit-laminas"  # o kit de lâminas da landing page (não está na tabela)
MAXIMO_UNIDADES = 30
MAXIMO_OFERTAS = 4
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FOTO_PADRAO = "/assets/img/produto.svg"


class ErroProduto(Exception):
    pass


def _foto_nome(slug: str) -> str:
    return f"produto:{slug}"


def gerar_slug(nome: str) -> str:
    texto = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", texto).strip("-")[:30].strip("-")


# ───────── Leitura ─────────

def listar(so_ativos: bool = True) -> list[dict]:
    consulta = select(banco.produtos).order_by(banco.produtos.c.ordem, banco.produtos.c.nome)
    if so_ativos:
        consulta = consulta.where(banco.produtos.c.ativo.is_(True))
    with banco.engine.connect() as c:
        return [dict(l) for l in c.execute(consulta).mappings().all()]


def buscar(slug: str, so_ativo: bool = False) -> dict | None:
    if not slug or len(slug) > 30:
        return None
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.produtos).where(banco.produtos.c.slug == slug)).mappings().first()
    if not linha or (so_ativo and not linha["ativo"]):
        return None
    return dict(linha)


def titulo(produto: dict, quantidade: int) -> str:
    nome = produto["unidade"] if quantidade == 1 else produto["unidade_plural"]
    return f"{quantidade} {nome[:1].upper()}{nome[1:]}"


def frete_gratis(produto: dict, quantidade: int) -> bool:
    limite = int(produto.get("frete_gratis_a_partir") or 0)
    return bool(limite) and quantidade >= limite


def ofertas(produto: dict) -> list[dict]:
    """As ofertas fixas (por quantidade), da menor para a maior."""
    saida = []
    for o in sorted(produto["ofertas"] or [], key=lambda x: x["quantidade"]):
        q = int(o["quantidade"])
        saida.append({"id": f"q{q}", "titulo": titulo(produto, q), "kits": q, "preco_centavos": int(o["preco_centavos"]),
                      "selo": o.get("selo") or "", "ativa": True, "frete_gratis": frete_gratis(produto, q)})
    return saida


def montar(produto: dict) -> dict:
    """O "monte o seu": da maior oferta + 1 até o máximo, cada unidade por preco_kit_centavos (mesmo formato do kit)."""
    m = produto["montar"] or {}
    minimo = max((int(o["quantidade"]) for o in produto["ofertas"] or []), default=0) + 1
    maximo = int(m.get("maximo") or 0)
    return {"ativo": bool(m.get("ativo")) and maximo >= minimo, "minimo": minimo, "maximo": maximo,
            "preco_kit_centavos": int(m.get("preco_unidade_centavos") or 0)}


def oferta(produto: dict, oferta_id: str) -> dict | None:
    """A oferta "q<n>": uma fixa, ou a do "monte o seu" se n estiver dentro dos limites."""
    fixa = next((o for o in ofertas(produto) if o["id"] == oferta_id), None)
    if fixa:
        return fixa
    if not re.fullmatch(r"q\d{1,2}", oferta_id or ""):
        return None
    n, m = int(oferta_id[1:]), montar(produto)
    if not m["ativo"] or not m["minimo"] <= n <= m["maximo"]:
        return None
    return {"id": f"q{n}", "titulo": titulo(produto, n), "kits": n, "preco_centavos": n * m["preco_kit_centavos"],
            "selo": "", "ativa": True, "montada": True, "frete_gratis": frete_gratis(produto, n)}


def descricao_pedido(produto: dict, o: dict) -> str:
    conteudo = f" ({produto['conteudo']} cada)" if produto.get("conteudo") else ""
    return f"{produto['nome']} - {o['titulo']}{conteudo}"


def medidas(produto: dict) -> dict:
    return {k: int(produto[k]) for k in ("peso_g", "comprimento_cm", "largura_cm", "altura_cm")}


def url_foto(produto: dict) -> str:
    f = banco.ler_foto(_foto_nome(produto["slug"]))
    return f"/produtos/{produto['slug']}/foto?v={int(f['atualizado_em'].timestamp())}" if f else FOTO_PADRAO


def foto(slug: str) -> dict | None:
    return banco.ler_foto(_foto_nome(slug))


def publico(produto: dict) -> dict:
    """O que a página do produto e o checkout recebem."""
    lista = ofertas(produto)
    return {
        "id": produto["slug"], "nome": produto["nome"], "chamada": produto.get("chamada") or "",
        "descricao": produto.get("descricao") or "", "foto": url_foto(produto), "unidade": produto["unidade"],
        "unidade_plural": produto["unidade_plural"], "conteudo": produto.get("conteudo") or "", "ofertas": lista,
        "montar": montar(produto), "frete_gratis_a_partir": int(produto.get("frete_gratis_a_partir") or 0),
        "oferta_padrao": lista[0]["id"] if lista else "",
    }


def vitrine() -> list[dict]:
    """A lista da página /produtos: o kit de lâminas primeiro, depois os produtos ativos."""
    kit = catalogo.ofertas()
    p = catalogo.produto()
    itens = [{"id": KIT, "nome": p["nome"], "chamada": f"{p['aparelhos']} aparelho + {p['refis']} refis por kit",
              "foto": catalogo.url_foto(), "url": "/",
              "a_partir_de_centavos": min((o["preco_centavos"] for o in kit), default=0)}]
    for prod in listar():
        lista = ofertas(prod)
        itens.append({"id": prod["slug"], "nome": prod["nome"], "chamada": prod.get("chamada") or "",
                      "foto": url_foto(prod), "url": f"/p/{prod['slug']}",
                      "a_partir_de_centavos": min((o["preco_centavos"] for o in lista), default=0)})
    return itens


# ───────── Gravação (área do vendedor) ─────────

def _texto(dados: dict, chave: str, rotulo: str, minimo: int = 0, maximo: int = 200) -> str:
    valor = " ".join(str(dados.get(chave) or "").split()) if chave != "descricao" else str(dados.get(chave) or "").strip()
    if len(valor) < minimo:
        raise ErroProduto(f"Preencha {rotulo}." if minimo <= 1 else f"{rotulo}: pelo menos {minimo} letras.")
    if len(valor) > maximo:
        raise ErroProduto(f"{rotulo}: até {maximo} caracteres.")
    return valor


def _inteiro(valor, rotulo: str, minimo: int, maximo: int) -> int:
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        raise ErroProduto(f"{rotulo}: use um número inteiro.")
    if not minimo <= numero <= maximo:
        raise ErroProduto(f"{rotulo}: de {minimo} a {maximo}.")
    return numero


def _conferir(dados: dict) -> dict:
    valores = {
        "nome": _texto(dados, "nome", "o nome", 3, 80),
        "chamada": _texto(dados, "chamada", "A chamada", 0, 140) or None,
        "descricao": _texto(dados, "descricao", "A descrição", 0, 4000) or None,
        "sku": _texto(dados, "sku", "O SKU", 0, 60) or None,
        "ativo": bool(dados.get("ativo", True)),
        "ordem": _inteiro(dados.get("ordem", 0), "A ordem", 0, 999),
        "unidade": _texto(dados, "unidade", "a unidade (ex.: frasco)", 2, 30).lower(),
        "unidade_plural": _texto(dados, "unidade_plural", "o plural da unidade (ex.: frascos)", 2, 30).lower(),
        "conteudo": _texto(dados, "conteudo", "O conteúdo", 0, 120) or None,
        "peso_g": _inteiro(dados.get("peso_g"), "Peso de 1 unidade embalada (g)", 1, 30000),
        "comprimento_cm": _inteiro(dados.get("comprimento_cm"), "Comprimento (cm)", 1, 100),
        "largura_cm": _inteiro(dados.get("largura_cm"), "Largura (cm)", 1, 100),
        "altura_cm": _inteiro(dados.get("altura_cm"), "Altura (cm)", 1, 100),
        "frete_gratis_a_partir": _inteiro(dados.get("frete_gratis_a_partir", 0), "Frete grátis a partir de", 0, 100),
    }
    lista = dados.get("ofertas")
    if not isinstance(lista, list) or not 1 <= len(lista) <= MAXIMO_OFERTAS:
        raise ErroProduto(f"Cadastre de 1 a {MAXIMO_OFERTAS} ofertas (1 unidade, 2 unidades...).")
    ofertas_novas, vistas = [], set()
    for o in lista:
        if not isinstance(o, dict):
            raise ErroProduto("Oferta inválida.")
        q = _inteiro(o.get("quantidade"), "Quantidade da oferta", 1, MAXIMO_UNIDADES)
        if q in vistas:
            raise ErroProduto(f"Duas ofertas com {q} unidades.")
        vistas.add(q)
        ofertas_novas.append({"quantidade": q, "preco_centavos": _inteiro(o.get("preco_centavos"), f"Preço da oferta de {q}",
                                                                          100, 10_000_000),
                              "selo": " ".join(str(o.get("selo") or "").split())[:40]})
    valores["ofertas"] = sorted(ofertas_novas, key=lambda x: x["quantidade"])
    m = dados.get("montar") if isinstance(dados.get("montar"), dict) else {}
    ativo = bool(m.get("ativo"))
    minimo = valores["ofertas"][-1]["quantidade"] + 1
    valores["montar"] = {
        "ativo": ativo,
        "maximo": _inteiro(m.get("maximo"), "Máximo do “monte o seu”", minimo, MAXIMO_UNIDADES) if ativo
        else int(m.get("maximo") or 0),
        "preco_unidade_centavos": _inteiro(m.get("preco_unidade_centavos"), "Preço por unidade do “monte o seu”", 100,
                                           1_000_000) if ativo else int(m.get("preco_unidade_centavos") or 0),
    }
    return valores


def salvar(dados: dict, slug: str | None = None, email: str | None = None) -> dict:
    """Cria (slug None) ou altera um produto. Devolve o produto gravado."""
    valores = _conferir(dados)
    agora = banco.agora()
    if slug is None:
        novo = gerar_slug(str(dados.get("slug") or "") or valores["nome"])
        if not novo or not SLUG.match(novo):
            raise ErroProduto("Endereço inválido: use letras, números e hífens.")
        if novo == KIT or buscar(novo):
            raise ErroProduto(f"Já existe um produto com o endereço /p/{novo}.")
        with banco.engine.begin() as c:
            c.execute(insert(banco.produtos).values(slug=novo, criado_em=agora, atualizado_em=agora, **valores))
        banco.registrar(email, "produto", f"Produto criado: {novo}")
        return buscar(novo)
    if not buscar(slug):
        raise ErroProduto("Produto não encontrado.")
    with banco.engine.begin() as c:
        c.execute(update(banco.produtos).where(banco.produtos.c.slug == slug).values(atualizado_em=agora, **valores))
    banco.registrar(email, "produto", f"Produto alterado: {slug}")
    return buscar(slug)


def excluir(slug: str, email: str | None = None) -> None:
    if not buscar(slug):
        raise ErroProduto("Produto não encontrado.")
    p = banco.pedidos.c
    with banco.engine.connect() as c:
        abertos = c.execute(select(func.count()).select_from(banco.pedidos)
                            .where(p.produto_id == slug, p.situacao == "pago")).scalar_one()
    if abertos:
        raise ErroProduto(f"Este produto tem {abertos} pedido(s) pago(s) esperando envio. Envie primeiro ou deixe o "
                          "produto fora de venda.")
    with banco.engine.begin() as c:
        c.execute(delete(banco.produtos).where(banco.produtos.c.slug == slug))
        c.execute(delete(banco.fotos).where(banco.fotos.c.nome == _foto_nome(slug)))
    banco.registrar(email, "produto", f"Produto excluído: {slug}")


def salvar_foto(slug: str, tipo: str, dados: bytes) -> None:
    if not buscar(slug):
        raise ErroProduto("Produto não encontrado.")
    tipo = (tipo or "").split(";")[0].strip().lower()
    if tipo not in catalogo.TIPOS_FOTO or not dados.startswith(catalogo.TIPOS_FOTO[tipo]):
        raise ErroProduto("Envie uma foto JPG, PNG ou WebP.")
    if len(dados) > catalogo.FOTO_MAXIMA:
        raise ErroProduto("A foto tem até 8 MB.")
    banco.gravar_foto(_foto_nome(slug), tipo, dados)


def apagar_foto(slug: str) -> None:
    banco.gravar_foto(_foto_nome(slug), None, None)


def para_vendedor(produto: dict) -> dict:
    """O produto como a área do vendedor edita (com a foto e o endereço da página)."""
    saida = {k: v for k, v in produto.items() if k not in ("criado_em", "atualizado_em")}
    return {**saida, "foto": url_foto(produto), "foto_enviada": foto(produto["slug"]) is not None,
            "url": f"/p/{produto['slug']}", "montar_limites": montar(produto)}
