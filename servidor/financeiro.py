"""O financeiro da loja: o demonstrativo do período (do que o cliente pagou até o resultado), por dia ou mês, por produto
e por forma de pagamento, e as comissões geradas × repassadas.

Entram os pedidos pagos do período (pago, enviado e os reembolsados, pela data do pedido, no horário do Brasil). As taxas
da InfinitePay são as que o vendedor informa em Configurações → Financeiro; o custo de cada produto (opcional) fica nos
ajustes da loja ("custos_produtos": centavos por unidade, o kit inteiro no caso do kit de lâminas). Os números batem com a
"receita líquida" da visão geral antes das taxas e do custo dos produtos.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from servidor import banco, config, painel, produtos

PAGOS = ("pago", "enviado", "reembolso_pendente", "reembolsado")
REEMBOLSADOS = ("reembolso_pendente", "reembolsado")
CHAVE_CUSTOS = "custos_produtos"
FORMAS = {"pix": "Pix", "credit_card": "Cartão à vista", "parcelado": "Cartão parcelado", "outra": "Outra"}


class ErroFinanceiro(Exception):
    pass


# ───────── Custos dos produtos ─────────

def custos() -> dict[str, int]:
    valor = banco.ler_ajustes().get(CHAVE_CUSTOS) or {}
    return {str(k): int(v) for k, v in valor.items() if isinstance(v, (int, float)) and v >= 0}


def lista_custos() -> list[dict]:
    """O kit e os produtos cadastrados, com o custo de cada unidade (None: não informado)."""
    atuais = custos()
    itens = [{"id": produtos.KIT, "nome": painel.nome_produto(produtos.KIT), "unidade": "kit"}]
    itens += [{"id": p["slug"], "nome": p["nome"], "unidade": p.get("unidade") or "unidade"} for p in produtos.listar(so_ativos=False)]
    return [{**i, "custo_centavos": atuais.get(i["id"])} for i in itens]


def salvar_custos(valores: dict, email: str) -> list[dict]:
    """Grava o custo por unidade (centavos). Vazio ou None tira o custo do produto."""
    if not isinstance(valores, dict):
        raise ErroFinanceiro("Envie os custos por produto.")
    validos = {i["id"] for i in lista_custos()}
    novos = custos()
    for chave, valor in valores.items():
        if chave not in validos:
            raise ErroFinanceiro("Produto não encontrado.")
        if valor in (None, ""):
            novos.pop(chave, None)
            continue
        try:
            centavos = int(valor)
        except (TypeError, ValueError):
            raise ErroFinanceiro("O custo precisa ser um valor em reais.")
        if not 0 <= centavos <= 10_000_000:
            raise ErroFinanceiro("Custo fora do limite.")
        novos[chave] = centavos
    banco.gravar_ajustes({CHAVE_CUSTOS: novos})
    banco.registrar(email, "financeiro.custos", f"{len(novos)} produto(s) com custo")
    return lista_custos()


# ───────── Cada pedido ─────────

def dia_do_pedido(p: dict) -> date:
    """O dia do pedido no horário do Brasil (o SQLite devolve a hora sem fuso: é UTC)."""
    quando: datetime = p["criado_em"]
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    return quando.astimezone(painel.FUSO).date()


def forma(p: dict) -> str:
    f = p.get("forma_pagamento") or ""
    if f == "pix":
        return "pix"
    if f == "credit_card":
        return "parcelado" if int(p.get("parcelas") or 1) > 1 else "credit_card"
    return "outra"


def taxa_pct(f: str) -> float:
    return {"pix": config.FINANCEIRO_TAXA_PIX, "credit_card": config.FINANCEIRO_TAXA_CARTAO,
            "parcelado": config.FINANCEIRO_TAXA_PARCELADO, "outra": config.FINANCEIRO_TAXA_CARTAO}[f]


def numeros(p: dict, tabela_custos: dict[str, int]) -> dict:
    """Do que o cliente pagou até o resultado de um pedido. A taxa da InfinitePay fica mesmo com o reembolso (o dinheiro
    volta por fora); comissão e custo do produto saem quando o pedido foi reembolsado."""
    reembolsado = p["situacao"] in REEMBOLSADOS
    pago = painel.cobrado(p)
    devolvido = min(int(p.get("reembolso_centavos") or 0), pago) if reembolsado else 0
    frete = painel.frete_da_loja(p) if (not reembolsado or p.get("loggi_key")) else 0
    f = forma(p)
    taxa = round(pago * taxa_pct(f) / 100)
    comissao = 0 if reembolsado else painel.comissao(p)
    unitario = tabela_custos.get(painel._chave_produto(p))
    custo = 0 if reembolsado or unitario is None else unitario * int(p["kits"])
    return {
        "produtos": int(p["preco_centavos"]),
        "cupom": int(p.get("desconto_cupom_centavos") or 0),
        "pix": int(p["total_centavos"]) - pago,  # o desconto do Pix (0 no cartão)
        "frete_cobrado": int(p["frete_centavos"]),
        "faturamento": pago,
        "reembolsos": devolvido,
        "frete_loja": frete,
        "frete_gratis": frete if int(p["frete_centavos"]) == 0 else 0,
        "taxas": taxa,
        "comissoes": comissao,
        "custo_produtos": custo,
        "sem_custo": not reembolsado and unitario is None,
        "resultado": pago - devolvido - frete - taxa - comissao - custo,
        "forma": f,
    }


def _somar(lista: list[dict]) -> dict:
    chaves = ("produtos", "cupom", "pix", "frete_cobrado", "faturamento", "reembolsos", "frete_loja", "frete_gratis",
              "taxas", "comissoes", "custo_produtos", "resultado")
    total = {k: sum(n[k] for n in lista) for k in chaves}
    total["custos"] = total["frete_loja"] + total["taxas"] + total["comissoes"] + total["custo_produtos"]
    total["receita"] = total["faturamento"] - total["reembolsos"]
    total["margem_pct"] = round(total["resultado"] / total["receita"] * 100, 1) if total["receita"] > 0 else None
    total["pedidos"] = len(lista)
    return total


def _variacao(agora: dict, antes: dict) -> dict:
    saida = {}
    for chave in ("receita", "custos", "resultado", "margem_pct", "pedidos"):
        base, valor = antes.get(chave), agora.get(chave)
        if chave == "margem_pct":  # em pontos percentuais
            saida[chave] = round(valor - base, 1) if valor is not None and base is not None else None
        else:
            saida[chave] = round((valor - base) / abs(base) * 100, 1) if base else None
    return saida


# ───────── O demonstrativo ─────────

def demonstrativo(de: str | None = None, ate: str | None = None) -> dict:
    painel._nomes.clear()
    inicio, fim = painel.periodo(de, ate)
    dias = (fim - inicio).days + 1
    tabela_custos = custos()

    def pagos(i, f):
        return [p for p in painel._pedidos(i, f) if p["situacao"] in PAGOS]

    lista = pagos(inicio, fim)
    anteriores = pagos(inicio - timedelta(days=dias), inicio - timedelta(days=1))
    com_numeros = [(p, numeros(p, tabela_custos)) for p in lista]
    total = _somar([n for _, n in com_numeros])
    total_antes = _somar([numeros(p, tabela_custos) for p in anteriores])

    # Por dia (até 62 dias) ou por mês
    por_mes = dias > 62
    grupos: dict[str, list] = defaultdict(list)
    for p, n in com_numeros:
        dia = dia_do_pedido(p)
        grupos[dia.strftime("%Y-%m") if por_mes else dia.isoformat()].append(n)
    serie = []
    atual = inicio
    vistos = set()
    while atual <= fim:
        chave = atual.strftime("%Y-%m") if por_mes else atual.isoformat()
        if chave not in vistos:
            vistos.add(chave)
            s = _somar(grupos.get(chave, []))
            serie.append({"chave": chave, "receita": s["receita"], "resultado": s["resultado"], "pedidos": s["pedidos"]})
        atual += timedelta(days=1)

    # Por produto
    por_produto: dict[str, list] = defaultdict(list)
    for p, n in com_numeros:
        por_produto[painel._chave_produto(p)].append(n)
    produtos_saida = []
    for chave, ns in por_produto.items():
        s = _somar(ns)
        produtos_saida.append({"id": chave, "nome": painel.nome_produto(chave), "pedidos": s["pedidos"], "receita": s["receita"],
                               "custos": s["custos"], "resultado": s["resultado"], "margem_pct": s["margem_pct"],
                               "tem_custo": chave in tabela_custos})
    produtos_saida.sort(key=lambda g: g["receita"], reverse=True)

    # Por forma de pagamento
    por_forma: dict[str, list] = defaultdict(list)
    for _, n in com_numeros:
        por_forma[n["forma"]].append(n)
    formas = [{"id": f, "nome": FORMAS[f], "taxa_pct": taxa_pct(f), "pedidos": len(ns),
               "valor": sum(n["faturamento"] for n in ns), "taxas": sum(n["taxas"] for n in ns)}
              for f, ns in por_forma.items()]
    formas.sort(key=lambda g: g["valor"], reverse=True)

    # Comissões do período: geradas × repassadas × a pagar
    vendidos = [p for p, _ in com_numeros if p["situacao"] not in REEMBOLSADOS and painel.comissao(p)]
    repassadas = sum(painel.comissao(p) for p in vendidos if p.get("repasse_id"))
    geradas = sum(painel.comissao(p) for p in vendidos)

    linhas = []
    for p, n in sorted(com_numeros, key=lambda x: x[0]["criado_em"], reverse=True):
        chave = painel._chave_produto(p)
        linhas.append({
            "order_nsu": p["order_nsu"], "data": dia_do_pedido(p).isoformat(),
            "produto": painel.nome_produto(chave), "quantidade": painel.titulo_quantidade(chave, int(p["kits"])),
            "forma": FORMAS[n["forma"]], "parcelas": int(p.get("parcelas") or 1), "situacao": p["situacao"],
            "afiliado": painel.nome_afiliado(p.get("afiliado_codigo")) if p.get("afiliado_codigo") else None,
            **{k: n[k] for k in ("faturamento", "reembolsos", "frete_loja", "taxas", "comissoes", "custo_produtos", "resultado")},
            "frete_gratis": int(p["frete_centavos"]) == 0, "sem_custo": n["sem_custo"],
        })

    taxas_configuradas = any((config.FINANCEIRO_TAXA_PIX, config.FINANCEIRO_TAXA_CARTAO, config.FINANCEIRO_TAXA_PARCELADO))
    return {
        "periodo": {"de": inicio.isoformat(), "ate": fim.isoformat(), "dias": dias},
        "total": total,
        "variacao": _variacao(total, total_antes),
        "agrupamento": "mes" if por_mes else "dia",
        "serie": serie,
        "por_produto": produtos_saida,
        "por_forma": formas,
        "comissoes": {"geradas": geradas, "repassadas": repassadas, "a_pagar": geradas - repassadas},
        "pedidos": linhas,
        "taxas": {"pix": config.FINANCEIRO_TAXA_PIX, "cartao": config.FINANCEIRO_TAXA_CARTAO,
                  "parcelado": config.FINANCEIRO_TAXA_PARCELADO, "configuradas": taxas_configuradas},
        "custos_configurados": bool(tabela_custos),
        "vendas_sem_custo": sum(1 for _, n in com_numeros if n["sem_custo"]),
    }
