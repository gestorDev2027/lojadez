"""Cupons de desconto: percentual, valor fixo ou frete grátis, com validade, limite de usos, valor mínimo e produtos.

- O desconto vale sobre os produtos (não sobre o frete) e nunca deixa o produto abaixo de R$ 1,00 (a InfinitePay
  não aceita item de valor zero). O cupom de frete grátis zera a entrega mais barata (a loja paga a Loggi).
- O cupom pode ser de um afiliado: quem usa gera a venda (e a comissão) para ele, mesmo sem ter vindo pelo link.
- O limite de usos conta os pedidos pagos e os aguardando pagamento das últimas 2 horas (para não estourar o limite
  com vários checkouts abertos).
- O servidor confere o cupom de novo na hora de criar o pedido: o navegador só mostra a prévia.
"""

import re
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, insert, select, update

from servidor import banco, produtos

TIPOS = {"percentual": "Percentual (%)", "valor": "Valor fixo (R$)", "frete": "Frete grátis"}
CODIGO = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,29}$")
FUSO = timezone(timedelta(hours=-3))
PRECO_MINIMO = 100  # o produto com desconto não fica abaixo de R$ 1,00


class ErroCupom(Exception):
    pass


def _codigo(texto) -> str:
    return re.sub(r"[^A-Z0-9-]", "", str(texto or "").strip().upper())[:30]


def buscar_codigo(codigo: str) -> dict | None:
    codigo = _codigo(codigo)
    if not codigo:
        return None
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.cupons).where(banco.cupons.c.codigo == codigo)).mappings().first()
    return dict(linha) if linha else None


def buscar(cupom_id: int) -> dict | None:
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.cupons).where(banco.cupons.c.id == cupom_id)).mappings().first()
    return dict(linha) if linha else None


def listar() -> list[dict]:
    with banco.engine.connect() as c:
        return [dict(l) for l in c.execute(select(banco.cupons).order_by(banco.cupons.c.criado_em.desc())).mappings().all()]


def usos(codigo: str) -> int:
    p = banco.pedidos.c
    recente = banco.agora() - timedelta(hours=2)
    with banco.engine.connect() as c:
        return c.execute(select(func.count()).select_from(banco.pedidos).where(
            p.cupom_codigo == codigo,
            (p.situacao.in_(("pago", "enviado"))) | ((p.situacao == "aguardando_pagamento") & (p.criado_em >= recente)),
        )).scalar_one()


def aplicar(codigo: str, produto_id: str | None, preco_centavos: int) -> dict:
    """Confere o cupom para este produto e preço. Devolve {cupom, desconto_centavos, frete_gratis, descricao}."""
    cupom = buscar_codigo(codigo)
    if not cupom or not cupom["ativo"]:
        raise ErroCupom("Cupom inválido.")
    hoje = datetime.now(FUSO).date().isoformat()
    if cupom.get("inicio") and hoje < cupom["inicio"]:
        raise ErroCupom("Este cupom ainda não começou a valer.")
    if cupom.get("fim") and hoje > cupom["fim"]:
        raise ErroCupom("Este cupom já venceu.")
    produto_id = produto_id or produtos.KIT
    if not cupom["todos_produtos"] and produto_id not in (cupom["produtos"] or []):
        raise ErroCupom("Este cupom não vale para este produto.")
    if cupom.get("minimo_centavos") and preco_centavos < cupom["minimo_centavos"]:
        raise ErroCupom(f"Este cupom vale a partir de R$ {cupom['minimo_centavos'] / 100:.2f}.".replace(".", ","))
    if cupom.get("limite_usos") and usos(cupom["codigo"]) >= cupom["limite_usos"]:
        raise ErroCupom("Este cupom já atingiu o limite de usos.")
    desconto, frete = 0, False
    if cupom["tipo"] == "percentual":
        desconto = round(preco_centavos * float(cupom["valor"]) / 100)
    elif cupom["tipo"] == "valor":
        desconto = int(round(float(cupom["valor"])))
    else:
        frete = True
    desconto = max(0, min(desconto, preco_centavos - PRECO_MINIMO))
    return {"cupom": cupom, "desconto_centavos": desconto, "frete_gratis": frete, "descricao": descricao(cupom)}


def descricao(cupom: dict) -> str:
    if cupom["tipo"] == "percentual":
        return f"{float(cupom['valor']):g}% de desconto".replace(".", ",")
    if cupom["tipo"] == "valor":
        return f"R$ {int(cupom['valor']) / 100:.2f} de desconto".replace(".", ",")
    return "Frete grátis"


# ───────── Área do vendedor ─────────

def gerar_codigo(prefixo: str = "") -> str:
    base = _codigo(prefixo)[:16].strip("-")
    while True:
        codigo = f"{base + '-' if base else ''}{secrets.token_hex(3).upper()}"
        if not buscar_codigo(codigo):
            return codigo


def _data(texto) -> str | None:
    texto = str(texto or "").strip()
    if not texto:
        return None
    try:
        return datetime.strptime(texto, "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise ErroCupom("Data inválida: use AAAA-MM-DD.")


def _conferir(dados: dict) -> dict:
    tipo = str(dados.get("tipo") or "")
    if tipo not in TIPOS:
        raise ErroCupom("Escolha o tipo do cupom.")
    try:
        bruto = float(str(dados.get("valor", 0) or 0).replace(",", "."))
    except ValueError:
        raise ErroCupom("Valor do desconto inválido.")
    if tipo == "percentual" and not 1 <= bruto <= 90:
        raise ErroCupom("Desconto em %: de 1 a 90.")
    if tipo == "valor" and not 100 <= bruto <= 1_000_000:
        raise ErroCupom("Desconto em R$: de 1,00 até 10.000,00.")
    inicio, fim = _data(dados.get("inicio")), _data(dados.get("fim"))
    if inicio and fim and fim < inicio:
        raise ErroCupom("A data final vem antes da inicial.")
    limite = dados.get("limite_usos")
    limite = int(limite) if str(limite or "").strip() else None
    if limite is not None and not 1 <= limite <= 1_000_000:
        raise ErroCupom("Limite de usos: de 1 em diante (vazio: sem limite).")
    minimo = int(dados.get("minimo_centavos") or 0)
    if not 0 <= minimo <= 10_000_000:
        raise ErroCupom("Valor mínimo inválido.")
    todos = bool(dados.get("todos_produtos", True))
    validos = {produtos.KIT} | {p["slug"] for p in produtos.listar(so_ativos=False)}
    lista = sorted({str(x) for x in (dados.get("produtos") or []) if str(x) in validos})
    if not todos and not lista:
        raise ErroCupom("Escolha pelo menos um produto (ou marque “todos os produtos”).")
    afiliado_id = dados.get("afiliado_id")
    afiliado_id = int(afiliado_id) if str(afiliado_id or "").strip() else None
    if afiliado_id is not None:
        from servidor import afiliados  # aqui, para não importar em ciclo

        if not afiliados.buscar(afiliado_id):
            raise ErroCupom("Afiliado não encontrado.")
    return {"tipo": tipo, "valor": round(bruto, 2) if tipo == "percentual" else (int(bruto) if tipo == "valor" else 0),
            "inicio": inicio, "fim": fim, "limite_usos": limite, "minimo_centavos": minimo or None,
            "todos_produtos": todos, "produtos": [] if todos else lista, "afiliado_id": afiliado_id,
            "ativo": bool(dados.get("ativo", True)),
            "descricao_interna": " ".join(str(dados.get("descricao_interna") or "").split())[:200] or None}


def salvar(dados: dict, cupom_id: int | None = None, email: str | None = None) -> dict:
    valores = _conferir(dados)
    agora = banco.agora()
    if cupom_id is None:
        codigo = _codigo(dados.get("codigo")) or gerar_codigo()
        if not CODIGO.match(codigo):
            raise ErroCupom("Código: de 3 a 30 letras, números ou hífens.")
        if buscar_codigo(codigo):
            raise ErroCupom(f"Já existe o cupom {codigo}.")
        with banco.engine.begin() as c:
            novo = c.execute(insert(banco.cupons).values(codigo=codigo, criado_em=agora, atualizado_em=agora,
                                                         **valores)).inserted_primary_key[0]
        banco.registrar(email, "cupom", f"Cupom criado: {codigo}")
        return buscar(novo)
    atual = buscar(cupom_id)
    if not atual:
        raise ErroCupom("Cupom não encontrado.")
    with banco.engine.begin() as c:
        c.execute(update(banco.cupons).where(banco.cupons.c.id == cupom_id).values(atualizado_em=agora, **valores))
    banco.registrar(email, "cupom", f"Cupom alterado: {atual['codigo']}")
    return buscar(cupom_id)


def para_vendedor(cupom: dict, vendidos: list[dict] | None = None) -> dict:
    """O cupom com os números: usos, vendas pagas e o desconto dado."""
    dele = [p for p in (vendidos or []) if p.get("cupom_codigo") == cupom["codigo"]]
    saida = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in cupom.items()}
    afiliado = None
    if cupom.get("afiliado_id"):
        from servidor import afiliados  # aqui, para não importar em ciclo

        afiliado = afiliados.buscar(cupom["afiliado_id"])
    return {**saida, "descricao": descricao(cupom), "afiliado_nome": afiliado["nome"] if afiliado else None, "usos": usos(cupom["codigo"]), "pedidos": len(dele),
            "vendas_centavos": sum(int(p["total_centavos"]) for p in dele),
            "desconto_dado_centavos": sum(int(p.get("desconto_cupom_centavos") or 0) for p in dele)}
