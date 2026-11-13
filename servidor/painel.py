"""A visão geral da área do vendedor: os indicadores do período e os recortes que detalham ao clicar
(produto → quantidade → afiliado), com os pedidos do recorte embaixo.

Conta como venda o pedido pago ou enviado. As datas são as do Brasil (UTC−3, sem horário de verão).
A receita líquida desconta o frete que a loja paga à Loggi (inclusive o dos fretes grátis) e as comissões dos afiliados;
as taxas da InfinitePay entram no financeiro (próxima etapa).
"""

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from servidor import afiliados, banco, catalogo, cupons, pedidos as regras, produtos

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


def comissao(p: dict) -> int:
    return int(p.get("comissao_centavos") or 0)


def liquido(p: dict) -> int:
    return cobrado(p) - frete_da_loja(p) - comissao(p)


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


_afiliados: dict[str, str] = {}


def nome_afiliado(codigo: str | None) -> str:
    if not codigo:
        return "Venda direta"
    if codigo not in _afiliados:
        a = afiliados.buscar_codigo(codigo)
        _afiliados[codigo] = a["nome"] if a else codigo
    return _afiliados[codigo]


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
    comissoes = sum(comissao(p) for p in vendidos)
    aguardando = [p for p in lista if p["situacao"] == "aguardando_pagamento"]
    reembolsos = [p for p in lista if p["situacao"] in ("reembolso_pendente", "reembolsado")]
    devolvido = sum(int(p.get("reembolso_centavos") or 0) for p in reembolsos)
    retido = sum(max(cobrado(p) - int(p.get("reembolso_centavos") or 0), 0) for p in reembolsos)  # reembolso parcial
    frete_perdido = sum(frete_da_loja(p) for p in reembolsos if p.get("loggi_key"))  # o envio não foi cancelado
    return {
        "vendas_centavos": vendas,
        "produtos_centavos": sum(int(p["preco_centavos"]) for p in vendidos),
        "frete_cobrado_centavos": sum(int(p["frete_centavos"]) for p in vendidos),
        "frete_loja_centavos": frete,
        "fretes_gratis": len(gratis),
        "fretes_gratis_centavos": sum(frete_da_loja(p) for p in gratis),
        "comissoes_centavos": comissoes,
        "descontos_centavos": sum(int(p.get("desconto_cupom_centavos") or 0) for p in vendidos),
        "vendas_com_cupom": sum(1 for p in vendidos if p.get("cupom_codigo")),
        "vendas_afiliados": sum(1 for p in vendidos if p.get("afiliado_id")),
        "liquida_centavos": vendas - frete - comissoes + retido - frete_perdido,
        "reembolsos": len(reembolsos),
        "reembolsos_pendentes": sum(1 for p in reembolsos if p["situacao"] == "reembolso_pendente"),
        "reembolsos_centavos": devolvido,
        "frete_perdido_centavos": frete_perdido,
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
        "afiliado": nome_afiliado(p.get("afiliado_codigo")) if p.get("afiliado_codigo") else None,
        "valor_centavos": cobrado(p), "comissao_centavos": comissao(p), "cupom": p.get("cupom_codigo"), "frete_gratis": p["frete_centavos"] == 0,
        "forma_pagamento": p.get("forma_pagamento"), "situacao": p["situacao"],
        "tem_envio": bool(p.get("loggi_key")) or bool(p.get("codigo_rastreio")),
    }


def visao_geral(de: str | None = None, ate: str | None = None, visao: str = "vendas", produto: str | None = None,
                quantidade: int | None = None, afiliado: str | None = None) -> dict:
    if visao not in VISOES:
        raise ErroPainel("Visão inválida.")
    _nomes.clear()
    _afiliados.clear()
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
    por_afiliado = _agrupar(recorte, lambda p: p.get("afiliado_codigo") or "", nome_afiliado, visao)

    tabela = recorte if produto else lista  # sem recorte: todos os pedidos do período (inclusive aguardando)
    if afiliado is not None:  # coluna 3: as vendas de um afiliado ("" = venda direta)
        tabela = [p for p in recorte if (p.get("afiliado_codigo") or "") == afiliado]
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
        "afiliado": afiliado,
        "afiliado_nome": nome_afiliado(afiliado) if afiliado is not None else None,
        "pedidos": [_linha(p) for p in ordenada[:LINHAS]],
        "pedidos_total": len(ordenada),
        "pedidos_valor_centavos": sum(cobrado(p) for p in ordenada),
    }


# ───────── Afiliados: o resumo da lista e a ficha de cada um ─────────

def _do_afiliado(lista: list[dict], afiliado_id: int) -> list[dict]:
    return [p for p in lista if p.get("afiliado_id") == afiliado_id]


def _numeros_afiliado(vendidos: list[dict], cliques: int) -> dict:
    vendas = sum(cobrado(p) for p in vendidos)
    return {"vendas_centavos": vendas, "produtos_centavos": sum(int(p["preco_centavos"]) for p in vendidos),
            "pedidos": len(vendidos), "comissao_centavos": sum(comissao(p) for p in vendidos), "cliques": cliques,
            "conversao_pct": round(len(vendidos) / cliques * 100, 1) if cliques else None,
            "ticket_medio_centavos": round(vendas / len(vendidos)) if vendidos else 0}


def resumo_afiliados(de: str | None = None, ate: str | None = None) -> dict:
    """A lista de afiliados com os números do período (vendas pagas, comissão, cliques)."""
    inicio, fim = periodo(de, ate)
    vendidos = [p for p in _pedidos(inicio, fim) if p["situacao"] in VENDIDOS]
    contagem = afiliados.cliques(inicio.isoformat(), fim.isoformat())
    lista = []
    for a in afiliados.listar():
        lista.append({**afiliados.para_vendedor(a), **_numeros_afiliado(_do_afiliado(vendidos, a["id"]), contagem.get(a["id"], 0))})
    lista.sort(key=lambda a: (not a["ativo"], -a["vendas_centavos"], a["nome"]))
    com_afiliado = [p for p in vendidos if p.get("afiliado_id")]
    return {
        "periodo": {"de": inicio.isoformat(), "ate": fim.isoformat()},
        "afiliados": lista,
        "totais": {**_numeros_afiliado(com_afiliado, sum(contagem.values())),
                   "vendas_loja_centavos": sum(cobrado(p) for p in vendidos), "ativos": sum(1 for a in lista if a["ativo"])},
    }


def _vendidos_do(afiliado_id: int) -> list[dict]:
    """Todas as vendas pagas do afiliado (sem filtro de período): os links de campanha mostram o total."""
    p = banco.pedidos.c
    with banco.engine.connect() as c:
        return [dict(l) for l in c.execute(select(banco.pedidos).where(p.afiliado_id == afiliado_id,
                                                                       p.situacao.in_(VENDIDOS))).mappings().all()]


def ficha_afiliado(afiliado_id: int, de: str | None = None, ate: str | None = None) -> dict | None:
    """Um afiliado: os links, os números do período, as vendas por produto e a tabela das vendas."""
    a = afiliados.buscar(afiliado_id)
    if not a:
        return None
    _nomes.clear()
    inicio, fim = periodo(de, ate)
    lista = _do_afiliado(_pedidos(inicio, fim), afiliado_id)
    vendidos = [p for p in lista if p["situacao"] in VENDIDOS]
    cliques = afiliados.cliques(inicio.isoformat(), fim.isoformat()).get(afiliado_id, 0)
    ordenada = sorted(lista, key=lambda p: p["criado_em"], reverse=True)
    return {
        "periodo": {"de": inicio.isoformat(), "ate": fim.isoformat()},
        "afiliado": afiliados.para_vendedor(a),
        "numeros": _numeros_afiliado(vendidos, cliques),
        "por_produto": _agrupar(vendidos, _chave_produto, nome_produto, "vendas"),
        "vendas": [_linha(p) for p in ordenada[:100]],
        "vendas_total": len(ordenada),
        "cupons": [{"codigo": c["codigo"], "descricao": cupons.descricao(c), "ativo": c["ativo"]}
                   for c in cupons.listar() if c.get("afiliado_id") == afiliado_id],
        "campanhas": [afiliados.campanha_para_vendedor(c, _vendidos_do(afiliado_id)) for c in afiliados.campanhas(afiliado_id)],
        "destinos": afiliados.DESTINOS,
    }
