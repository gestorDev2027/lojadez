"""Repasses: o pagamento das comissões aos afiliados.

Todo pagamento entra na conta da loja (InfinitePay); depois a loja repassa a comissão ao afiliado por Pix, fora daqui.
A loja só calcula, organiza e registra. Cada comissão passa por:

- a_liberar: o pedido foi pago, mas ainda está no prazo de devolução (AFILIADOS_DIAS_LIBERACAO dias, padrão 7);
- disponivel: o prazo passou sem reembolso: já pode ser paga;
- paga: entrou num repasse marcado como feito;
- cancelada: o pedido foi cancelado ou reembolsado antes de ser paga.

Se um pedido for reembolsado depois que a comissão foi paga, ela continua "paga" e fica marcada para o vendedor
combinar o acerto com o afiliado.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import insert, select, update

from servidor import afiliados, banco, config

FUSO = timezone(timedelta(hours=-3))
SITUACOES = {"a_liberar": "A liberar", "disponivel": "Disponível", "paga": "Paga", "cancelada": "Cancelada"}


class ErroRepasse(Exception):
    pass


def _com_comissao(afiliado_id: int | None = None) -> list[dict]:
    p = banco.pedidos.c
    consulta = select(banco.pedidos).where(p.afiliado_id.is_not(None), p.comissao_centavos > 0,
                                           p.situacao.not_in(("aguardando_pagamento", "pagamento_divergente")))
    if afiliado_id is not None:
        consulta = consulta.where(p.afiliado_id == afiliado_id)
    with banco.engine.connect() as c:
        return [dict(l) for l in c.execute(consulta.order_by(p.criado_em)).mappings().all()]


def _quando_pago(p: dict) -> datetime:
    momento = p.get("pago_em") or p["criado_em"]
    return momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)


def liberada_em(p: dict) -> datetime:
    return _quando_pago(p) + timedelta(days=config.AFILIADOS_DIAS_LIBERACAO)


def situacao(p: dict, agora: datetime | None = None) -> str:
    if p.get("repasse_id"):
        return "paga"
    if p["situacao"] in ("cancelado", "reembolso_pendente", "reembolsado"):
        return "cancelada"
    if p["situacao"] in ("pago", "enviado"):
        return "disponivel" if liberada_em(p) <= (agora or banco.agora()) else "a_liberar"
    return "cancelada"


def linha(p: dict, agora: datetime | None = None) -> dict:
    """A comissão de um pedido (sem dados pessoais do cliente além do primeiro nome)."""
    s = situacao(p, agora)
    return {"order_nsu": p["order_nsu"], "criado_em": p["criado_em"].isoformat(), "cliente": (p["nome"] or "").split(" ")[0],
            "produto": p["produto"], "valor_centavos": int(p["total_centavos"]), "comissao_centavos": int(p["comissao_centavos"]),
            "comissao_pct": p.get("comissao_pct"), "situacao": s, "situacao_rotulo": SITUACOES[s],
            "liberada_em": liberada_em(p).isoformat(), "repasse_id": p.get("repasse_id"),
            "reembolsado_depois": bool(p.get("repasse_id")) and p["situacao"] in ("reembolso_pendente", "reembolsado")}


def _somas(linhas: list[dict]) -> dict:
    soma = {k: 0 for k in SITUACOES}
    for l in linhas:
        soma[l["situacao"]] += l["comissao_centavos"]
    return soma


def saldo_afiliado(afiliado_id: int) -> dict:
    agora = banco.agora()
    linhas = [linha(p, agora) for p in _com_comissao(afiliado_id)]
    return {"somas": _somas(linhas), "comissoes": linhas[::-1], "repasses": historico(afiliado_id),
            "dias_liberacao": config.AFILIADOS_DIAS_LIBERACAO}


def resumo() -> dict:
    """A tela Repasses: os totais, o saldo de cada afiliado e o histórico."""
    agora = banco.agora()
    pedidos = _com_comissao()
    por_afiliado: dict[int, list[dict]] = {}
    for p in pedidos:
        por_afiliado.setdefault(p["afiliado_id"], []).append(linha(p, agora))
    hist = historico()
    mes = agora.astimezone(FUSO).strftime("%Y-%m")
    lista = []
    for a in afiliados.listar():
        linhas = por_afiliado.get(a["id"], [])
        somas = _somas(linhas)
        ultimos = [r for r in hist if r["afiliado_id"] == a["id"]]
        proxima = min((l["liberada_em"] for l in linhas if l["situacao"] == "a_liberar"), default=None)
        lista.append({"id": a["id"], "nome": a["nome"], "codigo": a["codigo"], "chave_pix": a.get("chave_pix"),
                      "ativo": a["ativo"], "somas": somas, "vendas": len([l for l in linhas if l["situacao"] != "cancelada"]),
                      "ultimo_repasse": ultimos[0]["pago_em"] if ultimos else None, "proxima_liberacao": proxima,
                      "disponiveis": [l for l in linhas if l["situacao"] == "disponivel"],
                      "reembolsados_depois": sum(1 for l in linhas if l["reembolsado_depois"])})
    lista.sort(key=lambda a: (-a["somas"]["disponivel"], -a["somas"]["a_liberar"], a["nome"]))
    todas = [l for ls in por_afiliado.values() for l in ls]
    return {
        "dias_liberacao": config.AFILIADOS_DIAS_LIBERACAO,
        "totais": {**_somas(todas), "pago_mes": sum(r["valor_centavos"] for r in hist if r["pago_em"].startswith(mes)),
                   "repasses": len(hist)},
        "afiliados": lista,
        "historico": hist,
    }


def historico(afiliado_id: int | None = None) -> list[dict]:
    consulta = select(banco.repasses).order_by(banco.repasses.c.pago_em.desc(), banco.repasses.c.id.desc())
    if afiliado_id is not None:
        consulta = consulta.where(banco.repasses.c.afiliado_id == afiliado_id)
    with banco.engine.connect() as c:
        linhas = [dict(l) for l in c.execute(consulta).mappings().all()]
    nomes = {a["id"]: a for a in afiliados.listar()}
    return [{**{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in r.items()},
             "afiliado_nome": nomes.get(r["afiliado_id"], {}).get("nome", "—"),
             "afiliado_codigo": nomes.get(r["afiliado_id"], {}).get("codigo", ""), "vendas": len(r["pedidos"] or [])}
            for r in linhas]


def buscar(repasse_id: int) -> dict | None:
    return next((r for r in historico() if r["id"] == repasse_id), None)


def pagar(afiliado_id: int, pedidos: list[str] | None, pago_em: str, observacao: str = "", email: str | None = None) -> dict:
    """Registra o repasse (o Pix já foi feito fora da loja): as comissões disponíveis escolhidas viram "pagas"."""
    afiliado = afiliados.buscar(afiliado_id)
    if not afiliado:
        raise ErroRepasse("Afiliado não encontrado.")
    try:
        dia = date.fromisoformat(str(pago_em or "")) if pago_em else datetime.now(FUSO).date()
    except ValueError:
        raise ErroRepasse("Data inválida: use AAAA-MM-DD.")
    if dia > datetime.now(FUSO).date():
        raise ErroRepasse("A data do repasse não pode ser no futuro.")
    agora = banco.agora()
    disponiveis = {p["order_nsu"]: p for p in _com_comissao(afiliado_id) if situacao(p, agora) == "disponivel"}
    escolhidos = list(disponiveis) if not pedidos else [n for n in pedidos if n in disponiveis]
    if pedidos and len(escolhidos) != len(set(pedidos)):
        raise ErroRepasse("Alguma comissão escolhida não está mais disponível. Atualize a tela.")
    if not escolhidos:
        raise ErroRepasse("Não há comissão disponível para pagar a este afiliado.")
    valor = sum(int(disponiveis[n]["comissao_centavos"]) for n in escolhidos)
    with banco.engine.begin() as c:
        novo = c.execute(insert(banco.repasses).values(
            afiliado_id=afiliado_id, valor_centavos=valor, pedidos=escolhidos, pago_em=dia.isoformat(),
            chave_pix=afiliado.get("chave_pix"), observacao=" ".join(str(observacao or "").split())[:300] or None,
            criado_em=agora, criado_por=email)).inserted_primary_key[0]
        marcados = c.execute(update(banco.pedidos).where(banco.pedidos.c.order_nsu.in_(escolhidos),
                                                         banco.pedidos.c.repasse_id.is_(None))
                             .values(repasse_id=novo)).rowcount
        if marcados != len(escolhidos):
            raise ErroRepasse("Algumas comissões já tinham sido pagas. Atualize a tela.")  # desfaz tudo (rollback)
    banco.registrar(email, "repasse", f"Repasse {novo}: {afiliado['codigo']} · {valor / 100:.2f} · {len(escolhidos)} venda(s)")
    return buscar(novo)


def desfazer(repasse_id: int, email: str | None = None) -> None:
    """Marcou por engano: as comissões voltam a ficar disponíveis."""
    repasse = buscar(repasse_id)
    if not repasse:
        raise ErroRepasse("Repasse não encontrado.")
    with banco.engine.begin() as c:
        c.execute(update(banco.pedidos).where(banco.pedidos.c.repasse_id == repasse_id).values(repasse_id=None))
        c.execute(banco.repasses.delete().where(banco.repasses.c.id == repasse_id))
    banco.registrar(email, "repasse", f"Repasse {repasse_id} desfeito ({repasse['afiliado_codigo']} · {repasse['valor_centavos'] / 100:.2f})")


def comprovante(repasse_id: int) -> dict | None:
    """O que vai no comprovante: o repasse e as vendas incluídas (primeiro nome, produto, valores)."""
    repasse = buscar(repasse_id)
    if not repasse:
        return None
    p = banco.pedidos.c
    with banco.engine.connect() as c:
        pedidos = [dict(l) for l in c.execute(select(banco.pedidos).where(p.repasse_id == repasse_id)
                                              .order_by(p.criado_em)).mappings().all()]
    return {"repasse": repasse, "loja": config.LOJA_NOME, "empresa": config.EMPRESA,
            "vendas": [linha(x) for x in pedidos]}
