"""A visão geral da área do vendedor: os indicadores do período e os recortes que detalham ao clicar
(produto → quantidade → afiliado), com os pedidos do recorte embaixo.

Conta como venda o pedido pago ou enviado. As datas são as do Brasil (UTC−3, sem horário de verão).
Taxas da InfinitePay e comissões entram no financeiro (próximas etapas); aqui a receita líquida desconta o frete que a
loja paga à Loggi (inclusive o dos fretes grátis).
"""

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from servidor import banco, catalogo, pedidos as regras, produtos

FUSO = timezone(timedelta(hours=-3))
VENDIDOS = ("pago", "enviado")
VISOES = ("vendas", "liquida", "pedidos")
MAXIMO_DIAS = 400
LINHAS = 25


class ErroPainel(Exception):
    pass


def _data(texto: str | None, padrao: date) -> date:
    if not texto:
        return padrao
    try:
        return date.fromisoformat(texto)
    except ValueError:
        raise ErroPainel("Data inválida: use AAAA-MM-DD.")


def periodo(de: str | None, ate: str | None) -> tuple[date, date]:
    """O período pedido; sem datas, do dia 1 do mês até hoje."""
    hoje = datetime.now(FUSO).date()
    inicio, fim = _data(de, hoje.replace(day=1)), _data(ate, hoje)
    if fim < inicio:
        raise ErroPainel("A data final vem antes da inicial.")
    if (fim - inicio).days > MAXIMO_DIAS:
        raise ErroPainel(f"Escolha até {MAXIMO_DIAS} dias.")
    return inicio, fim


def _limites(inicio: date, fim: date) -> tuple[datetime, datetime]:
    return (datetime.combine(inicio, time.min, FUSO).astimezone(timezone.utc),
            datetime.combine(fim + timedelta(days=1), time.min, FUSO).astimezone(timezone.utc))


def _pedidos(inicio: date, fim: date) -> list[dict]:
    de, ate = _limites(inicio, fim)
    consulta = (select(banco.pedidos).where(banco.pedidos.c.criado_em >= de, banco.pedidos.c.criado_em < ate)
                .order_by(banco.pedidos.c.criado_em.desc()))
    with banco.engine.connect() as c:
        return [dict(l) for l in c.execute(consulta).mappings().all()]


# ───────── O valor de cada pedido ─────────

def cobrado(p: dict) -> int:
    """O que o cliente pagou (produto + frete), com o desconto do Pix quando pagou no Pix."""
    if p.get("desconto_pix") and p.get("forma_pagamento") == "pix":
        return regras.total_com_pix(p)
    return int(p["total_centavos"])


def frete_da_loja(p: dict) -> int:
    """O que a Loggi cobra da loja por este pedido (pedidos antigos, sem o custo guardado: o frete cobrado)."""
    custo = p.get("frete_custo_centavos")
    return int(custo if custo is not None else p["frete_centavos"])


def liquido(p: dict) -> int:
    return cobrado(p) - frete_da_loja(p)


def _valor(p: dict, visao: str) -> int:
    return 1 if visao == "pedidos" else liquido(p) if visao == "liquida" else cobrado(p)


def _chave_produto(p: dict) -> str:
    return p.get("produto_id") or produtos.KIT


_nomes: dict[str, dict] = {}


def _produto(chave: str) -> dict | None:
    if chave == produtos.KIT:
        return None
    if chave not in _nomes:
        _nomes[chave] = produtos.buscar(chave) or {}
    return _nomes[chave] or None


def nome_produto(chave: str) -> str:
    if chave == produtos.KIT:
        return catalogo.produto()["nome"]
    prod = _produto(chave)
    return prod["nome"] if prod else chave


def titulo_quantidade(chave: str, n: int) -> str:
    prod = _produto(chave)
    if prod:
        return produtos.titulo(prod, n)
    return f"{n} Kit{'s' if n > 1 else ''}"


# ───────── Indicadores e recortes ─────────

def _indicadores(lista: list[dict]) -> dict:
    vendidos = [p for p in lista if p["situacao"] in VENDIDOS]
    gratis = [p for p in vendidos if p["frete_centavos"] == 0 and frete_da_loja(p) > 0]
    vendas = sum(cobrado(p) for p in vendidos)
    frete = sum(frete_da_loja(p) for p in vendidos)
    aguardando = [p for p in lista if p["situacao"] == "aguardando_pagamento"]
    return {
        "vendas_centavos": vendas,
        "produtos_centavos": sum(int(p["preco_centavos"]) for p in vendidos),
        "frete_cobrado_centavos": sum(int(p["frete_centavos"]) for p in vendidos),
        "frete_loja_centavos": frete,
        "fretes_gratis": len(gratis),
        "fretes_gratis_centavos": sum(frete_da_loja(p) for p in gratis),
        "liquida_centavos": vendas - frete,
        "pedidos": len(vendidos),
        "ticket_medio_centavos": round(vendas / len(vendidos)) if vendidos else 0,
        "aguardando": len(aguardando),
        "aguardando_centavos": sum(int(p["total_centavos"]) for p in aguardando),
        "unidades": sum(int(p["kits"]) for p in vendidos),
    }


def _variacao(agora: dict, antes: dict) -> dict:
    """A variação (%) de cada indicador em relação ao período anterior do mesmo tamanho (None: sem base)."""
    saida = {}
    for chave, valor in agora.items():
        base = antes.get(chave) or 0
        saida[chave] = round((valor - base) / base * 100, 1) if base else None
    return saida


def _agrupar(lista: list[dict], chave, nome, visao: str) -> list[dict]:
    grupos: dict = {}
    for p in lista:
        k = chave(p)
        g = grupos.setdefault(k, {"id": k, "nome": nome(k), "valor": 0, "pedidos": 0, "unidades": 0})
        g["valor"] += _valor(p, visao)
        g["pedidos"] += 1
        g["unidades"] += int(p["kits"])
    total = sum(g["valor"] for g in grupos.values()) or 1
    saida = sorted(grupos.values(), key=lambda g: g["valor"], reverse=True)
    for g in saida:
        g["pct"] = round(g["valor"] / total * 100, 1)
    return saida


def _linha(p: dict) -> dict:
    """Uma linha da tabela: sem e-mail, telefone, CPF ou endereço (só o primeiro nome e a cidade)."""
    return {
        "order_nsu": p["order_nsu"], "criado_em": p["criado_em"].isoformat() if p["criado_em"] else None,
        "cliente": (p["nome"] or "").split(" ")[0], "cidade": f"{p['cidade']}/{p['uf']}",
        "produto": nome_produto(_chave_produto(p)), "quantidade": titulo_quantidade(_chave_produto(p), int(p["kits"])),
        "afiliado": None, "valor_centavos": cobrado(p), "frete_gratis": p["frete_centavos"] == 0,
        "forma_pagamento": p.get("forma_pagamento"), "situacao": p["situacao"],
        "tem_envio": bool(p.get("loggi_key")) or bool(p.get("codigo_rastreio")),
    }


def visao_geral(de: str | None = None, ate: str | None = None, visao: str = "vendas", produto: str | None = None,
                quantidade: int | None = None) -> dict:
    if visao not in VISOES:
        raise ErroPainel("Visão inválida.")
    _nomes.clear()
    inicio, fim = periodo(de, ate)
    dias = (fim - inicio).days + 1
    lista = _pedidos(inicio, fim)
    anterior = _pedidos(inicio - timedelta(days=dias), inicio - timedelta(days=1))
    indicadores = _indicadores(lista)

    vendidos = [p for p in lista if p["situacao"] in VENDIDOS]
    por_produto = _agrupar(vendidos, _chave_produto, nome_produto, visao)
    produto_escolhido = produto or (por_produto[0]["id"] if por_produto else None)
    do_produto = [p for p in vendidos if _chave_produto(p) == produto_escolhido]
    por_quantidade = _agrupar(do_produto, lambda p: int(p["kits"]),
                              lambda n: titulo_quantidade(produto_escolhido or produtos.KIT, n), visao)
    recorte = [p for p in do_produto if quantidade is None or int(p["kits"]) == quantidade] if produto else vendidos
    # Afiliados entram na próxima etapa: por enquanto toda venda é direta.
    por_afiliado = _agrupar(recorte, lambda p: "direta", lambda _: "Venda direta", visao)

    tabela = recorte if produto else lista  # sem recorte: todos os pedidos do período (inclusive aguardando)
    ordenada = sorted(tabela, key=lambda p: cobrado(p), reverse=True)
    return {
        "periodo": {"de": inicio.isoformat(), "ate": fim.isoformat(), "dias": dias},
        "visao": visao,
        "indicadores": indicadores,
        "variacao": _variacao(indicadores, _indicadores(anterior)),
        "por_produto": por_produto,
        "produto": produto_escolhido,
        "produto_nome": nome_produto(produto_escolhido) if produto_escolhido else None,
        "por_quantidade": por_quantidade,
        "quantidade": quantidade,
        "por_afiliado": por_afiliado,
        "pedidos": [_linha(p) for p in ordenada[:LINHAS]],
        "pedidos_total": len(ordenada),
        "pedidos_valor_centavos": sum(cobrado(p) for p in ordenada),
    }
