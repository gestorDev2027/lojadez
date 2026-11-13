"""O financeiro: o demonstrativo bate com a visão geral, com as taxas da InfinitePay e o custo dos produtos."""

from servidor import config, financeiro
from testes.test_afiliados import JOAO, _comprar, _limpar
from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)


def _taxas(monkeypatch, pix=1.0, cartao=3.0, parcelado=5.0):
    monkeypatch.setattr(config, "FINANCEIRO_TAXA_PIX", pix)
    monkeypatch.setattr(config, "FINANCEIRO_TAXA_CARTAO", cartao)
    monkeypatch.setattr(config, "FINANCEIRO_TAXA_PARCELADO", parcelado)


def _sem_custos():
    banco.gravar_ajustes({financeiro.CHAVE_CUSTOS: None})


def test_demonstrativo_bate_com_a_visao_geral(cliente, monkeypatch):
    _limpar()
    _sem_custos()
    _taxas(monkeypatch)
    cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR)
    pix = _comprar(cliente, "kit2", ref="joao")
    parcelado = _comprar(cliente, "kit1")
    banco.alterar(parcelado, {"forma_pagamento": "credit_card", "parcelas": 3})
    reembolsado = _comprar(cliente, "kit3")
    cliente.post(f"/api/vendedor/pedidos/{reembolsado}/reembolso", json={"motivo": "outro"}, headers=VENDEDOR)
    _comprar(cliente, "kit1", pagar=False)  # aguardando: não entra

    assert cliente.get("/api/vendedor/financeiro").status_code == 401
    f = cliente.get("/api/vendedor/financeiro", headers=VENDEDOR).json()
    t = f["total"]
    assert t["pedidos"] == 3
    assert t["receita"] == t["faturamento"] - t["reembolsos"]
    assert t["resultado"] == t["receita"] - t["custos"]
    assert t["faturamento"] == t["produtos"] - t["cupom"] - t["pix"] + t["frete_cobrado"]
    # Antes das taxas e do custo dos produtos, é a receita líquida da visão geral
    visao = cliente.get("/api/vendedor/painel", headers=VENDEDOR).json()["indicadores"]
    assert t["resultado"] + t["taxas"] + t["custo_produtos"] == visao["liquida_centavos"]

    p_pix, p_parc = banco.buscar(pix), banco.buscar(parcelado)
    formas = {g["id"]: g for g in f["por_forma"]}
    assert formas["parcelado"]["taxas"] == round(p_parc["total_centavos"] * 0.05)
    assert formas["parcelado"]["taxa_pct"] == 5.0 and formas["pix"]["pedidos"] == 2  # o reembolsado também pagou a taxa
    assert f["comissoes"] == {"geradas": p_pix["comissao_centavos"], "repassadas": 0, "a_pagar": p_pix["comissao_centavos"]}
    assert f["taxas"]["configuradas"] and not f["custos_configurados"] and f["vendas_sem_custo"] == 2
    assert len(f["pedidos"]) == 3 and "nome" not in f["pedidos"][0] and "cpf" not in f["pedidos"][0]
    assert sum(d["receita"] for d in f["serie"]) == t["receita"] and f["agrupamento"] == "dia"


def test_custo_dos_produtos(cliente, monkeypatch):
    _limpar()
    _sem_custos()
    _taxas(monkeypatch, 0, 0, 0)
    assert cliente.put("/api/vendedor/financeiro/custos", json={"custos": {"kit-laminas": 500}}).status_code == 401
    r = cliente.put("/api/vendedor/financeiro/custos", json={"custos": {"nao-existe": 100}}, headers=VENDEDOR)
    assert r.status_code == 400
    r = cliente.put("/api/vendedor/financeiro/custos", json={"custos": {"kit-laminas": 500}}, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    assert next(c for c in r.json()["custos"] if c["id"] == "kit-laminas")["custo_centavos"] == 500

    _comprar(cliente, "kit3")
    f = cliente.get("/api/vendedor/financeiro", headers=VENDEDOR).json()
    t = f["total"]
    assert t["custo_produtos"] == 3 * 500 and f["custos_configurados"] and f["vendas_sem_custo"] == 0
    assert not f["taxas"]["configuradas"] and t["taxas"] == 0
    assert f["por_produto"][0]["tem_custo"] and f["por_produto"][0]["resultado"] == t["resultado"]

    cliente.put("/api/vendedor/financeiro/custos", json={"custos": {"kit-laminas": None}}, headers=VENDEDOR)
    assert financeiro.custos() == {}


def test_periodo_longo_agrupa_por_mes(cliente):
    f = cliente.get("/api/vendedor/financeiro?de=2026-01-01&ate=2026-06-30", headers=VENDEDOR).json()
    assert f["agrupamento"] == "mes" and [s["chave"] for s in f["serie"]][:2] == ["2026-01", "2026-02"] and len(f["serie"]) == 6
    assert cliente.get("/api/vendedor/financeiro?de=2026-06-30&ate=2026-01-01", headers=VENDEDOR).status_code == 422
