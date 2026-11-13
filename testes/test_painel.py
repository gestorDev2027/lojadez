"""A visão geral da área do vendedor: indicadores do período e os recortes (produto → quantidade → afiliado)."""

from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)


def _pagar(cliente, oferta: str, forma: str = "pix") -> str:
    frete = cliente.post("/api/frete", json={"cep": "20040-002", "oferta": oferta}).json()
    dados = {"oferta": oferta, "cep": "20040002", "frete_tipo": frete["opcoes"][0]["tipo"], "nome": "Maria Souza",
             "cpf": "529.982.247-25", "email": "maria@exemplo.com", "telefone": "(21) 99999-8888", "numero": "10"}
    nsu = cliente.post("/api/pedidos", json=dados).json()["order_nsu"]
    if forma:
        cliente.post(f"/simulador/pagar/{nsu}", content=f"forma={forma}",
                     headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    return nsu


def test_visao_geral(cliente):
    with banco.engine.begin() as c:
        c.execute(banco.pedidos.delete())
    assert cliente.get("/api/vendedor/painel").status_code == 401

    kit2 = _pagar(cliente, "kit2")
    kit5 = _pagar(cliente, "kit5")  # monte o seu: frete grátis, a loja paga a Loggi
    _pagar(cliente, "kit1", forma="")  # aguardando pagamento: não conta como venda
    p2, p5 = banco.buscar(kit2), banco.buscar(kit5)

    r = cliente.get("/api/vendedor/painel", headers=VENDEDOR)
    assert r.status_code == 200, r.text
    d = r.json()
    i = d["indicadores"]
    assert i["pedidos"] == 2 and i["aguardando"] == 1 and i["unidades"] == 7
    assert i["vendas_centavos"] == p2["total_centavos"] + p5["total_centavos"]
    assert i["fretes_gratis"] == 1 and i["fretes_gratis_centavos"] == p5["frete_custo_centavos"] > 0
    assert i["frete_loja_centavos"] == p2["frete_custo_centavos"] + p5["frete_custo_centavos"]
    assert i["liquida_centavos"] == i["vendas_centavos"] - i["frete_loja_centavos"]
    assert d["variacao"]["pedidos"] is None  # sem pedidos no período anterior

    assert [g["id"] for g in d["por_produto"]] == ["kit-laminas"] and d["por_produto"][0]["pct"] == 100
    assert {g["nome"] for g in d["por_quantidade"]} == {"2 Kits", "5 Kits"}
    assert d["por_afiliado"][0]["nome"] == "Venda direta"
    assert d["pedidos_total"] == 3  # sem recorte, a tabela mostra também o aguardando
    linha = next(l for l in d["pedidos"] if l["order_nsu"] == kit5)
    assert linha == {**linha, "cliente": "Maria", "quantidade": "5 Kits", "frete_gratis": True, "situacao": "pago"}
    assert "cpf" not in linha and "email" not in linha and "rua" not in linha  # sem dados pessoais na tabela

    # Recorte: kit de lâminas › 5 kits; e a visão "pedidos"
    d = cliente.get("/api/vendedor/painel?produto=kit-laminas&quantidade=5&visao=pedidos", headers=VENDEDOR).json()
    assert [l["order_nsu"] for l in d["pedidos"]] == [kit5] and d["por_afiliado"][0]["valor"] == 1
    assert {g["valor"] for g in d["por_quantidade"]} == {1}

    # Período sem pedidos e datas inválidas
    vazio = cliente.get("/api/vendedor/painel?de=2020-01-01&ate=2020-01-31", headers=VENDEDOR).json()
    assert vazio["indicadores"]["pedidos"] == 0 and vazio["pedidos"] == []
    for ruim in ("de=ontem", "de=2026-02-01&ate=2026-01-01", "de=2020-01-01&ate=2026-01-01", "visao=lucro"):
        assert cliente.get(f"/api/vendedor/painel?{ruim}", headers=VENDEDOR).status_code == 422, ruim
