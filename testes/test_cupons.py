"""Cupons: cadastro, regras (validade, limite, mínimo, produtos), desconto no pedido, frete grátis e cupom de afiliado."""

from testes.test_afiliados import JOAO, _limpar
from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)


def _cupom(cliente, **campos):
    r = cliente.post("/api/vendedor/cupons", json={"tipo": "percentual", "valor": 10, **campos}, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    return r.json()


def _pedido(cliente, oferta="kit2", cupom=None, ref=None, email="maria@exemplo.com"):
    frete = cliente.post("/api/frete", json={"cep": "20040-002", "oferta": oferta, "cupom": cupom}).json()
    dados = {"oferta": oferta, "cep": "20040002", "frete_tipo": frete["opcoes"][0]["tipo"], "nome": "Maria Souza",
             "cpf": "529.982.247-25", "email": email, "telefone": "(21) 99999-8888", "numero": "10", "cupom": cupom,
             "ref": ref}
    return frete, cliente.post("/api/pedidos", json=dados)


def _limpar_cupons():
    _limpar()
    with banco.engine.begin() as c:
        c.execute(banco.cupons.delete())


def test_cupom_percentual_no_pedido(cliente):
    _limpar_cupons()
    assert cliente.post("/api/vendedor/cupons", json={"tipo": "percentual", "valor": 10}).status_code == 401
    c = _cupom(cliente, codigo="bem-vindo10")
    assert c["codigo"] == "BEM-VINDO10" and c["descricao"] == "10% de desconto"

    r = cliente.post("/api/cupons/validar", json={"cupom": "bem-vindo10", "oferta": "kit2"})
    assert r.status_code == 200 and r.json()["desconto_centavos"] == round(4490 * 0.10)
    frete, r = _pedido(cliente, cupom="BEM-VINDO10")
    assert r.status_code == 200, r.text
    p = banco.buscar(r.json()["order_nsu"])
    assert p["cupom_codigo"] == "BEM-VINDO10" and p["desconto_cupom_centavos"] == 449
    assert p["total_centavos"] == p["preco_centavos"] - 449 + p["frete_centavos"]
    from servidor import infinitepay

    item = infinitepay.montar_corpo(p)["items"][0]
    assert item["price"] == p["preco_centavos"] - 449 and "cupom BEM-VINDO10" in item["description"]

    # Cupom errado não deixa criar o pedido
    _, r = _pedido(cliente, cupom="NAOEXISTE")
    assert r.status_code == 422 and r.json()["erro"] == "Cupom inválido."


def test_regras_do_cupom(cliente):
    _limpar_cupons()
    _cupom(cliente, codigo="VENCIDO", fim="2020-01-31")
    _cupom(cliente, codigo="FUTURO", inicio="2099-01-01")
    _cupom(cliente, codigo="MINIMO", minimo_centavos=5000)
    _cupom(cliente, codigo="SOPOMADA", todos_produtos=False, produtos=["kit-laminas"])
    _cupom(cliente, codigo="DESLIGADO", ativo=False)
    _cupom(cliente, codigo="UMAVEZ", limite_usos=1)
    _cupom(cliente, codigo="GRANDE", tipo="valor", valor=999900)  # R$ 9.999: o produto não passa de R$ 1,00
    validar = lambda codigo, oferta="kit2": cliente.post("/api/cupons/validar", json={"cupom": codigo, "oferta": oferta})
    assert validar("VENCIDO").json()["erro"] == "Este cupom já venceu."
    assert "ainda não começou" in validar("FUTURO").json()["erro"]
    assert "a partir de R$ 50,00" in validar("MINIMO").json()["erro"]
    assert validar("MINIMO", "kit3").status_code == 200  # 60,90 passa do mínimo
    assert validar("SOPOMADA").status_code == 200
    assert validar("DESLIGADO").json()["erro"] == "Cupom inválido."
    assert validar("GRANDE").json()["desconto_centavos"] == 4490 - 100
    _pedido(cliente, cupom="UMAVEZ")
    assert "limite de usos" in validar("UMAVEZ").json()["erro"]

    # Cadastro: valores errados e código repetido
    for errado in ({"tipo": "x"}, {"valor": 95}, {"tipo": "valor", "valor": 10}, {"inicio": "2026-02-01", "fim": "2026-01-01"},
                   {"todos_produtos": False, "produtos": []}, {"codigo": "a!"}, {"afiliado_id": 999}):
        r = cliente.post("/api/vendedor/cupons", json={"tipo": "percentual", "valor": 10, **errado}, headers=VENDEDOR)
        assert r.status_code == 422, errado
    assert cliente.post("/api/vendedor/cupons", json={"codigo": "VENCIDO", "tipo": "frete"}, headers=VENDEDOR).status_code == 422
    gerado = cliente.get("/api/vendedor/cupons/codigo?prefixo=joao", headers=VENDEDOR).json()["codigo"]
    assert gerado.startswith("JOAO-") and len(gerado) == 11


def test_cupom_de_frete_e_de_afiliado(cliente):
    _limpar_cupons()
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    _cupom(cliente, codigo="FRETEGRATIS", tipo="frete")
    _cupom(cliente, codigo="JOAO15", valor=15, afiliado_id=joao["id"])

    frete, r = _pedido(cliente, "kit1", cupom="FRETEGRATIS")
    assert frete["opcoes"][0]["gratis"] and r.status_code == 200
    p = banco.buscar(r.json()["order_nsu"])
    assert p["frete_centavos"] == 0 and p["frete_custo_centavos"] > 0 and p["desconto_cupom_centavos"] is None
    assert p["total_centavos"] == p["preco_centavos"]

    # Cupom do afiliado: a venda é dele (mesmo sem o link) e a comissão é sobre o preço com desconto
    _, r = _pedido(cliente, "kit2", cupom="JOAO15")
    p = banco.buscar(r.json()["order_nsu"])
    assert p["afiliado_codigo"] == "joao" and p["desconto_cupom_centavos"] == round(4490 * 0.15)
    assert p["comissao_centavos"] == round((4490 - p["desconto_cupom_centavos"]) * 0.125)
    cliente.post(f"/simulador/pagar/{p['order_nsu']}", content="forma=pix",
                 headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)

    lista = cliente.get("/api/vendedor/cupons", headers=VENDEDOR).json()["cupons"]
    joao15 = next(c for c in lista if c["codigo"] == "JOAO15")
    assert joao15["afiliado_nome"] == "João Silva" and joao15["pedidos"] == 1 and joao15["desconto_dado_centavos"] == 674
    ficha = cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()
    assert ficha["cupons"] == [{"codigo": "JOAO15", "descricao": "15% de desconto", "ativo": True}]
    d = cliente.get("/api/vendedor/painel", headers=VENDEDOR).json()["indicadores"]
    assert d["descontos_centavos"] == 674 and d["vendas_com_cupom"] == 1


def test_email_opcional(cliente):
    _limpar_cupons()
    _, r = _pedido(cliente, "kit1", email="")
    assert r.status_code == 200, r.text
    p = banco.buscar(r.json()["order_nsu"])
    assert p["email"] == ""
    from servidor import infinitepay, loggi

    assert "email" not in infinitepay.montar_corpo(p)["customer"]
    assert loggi.corpo_envio(p)["shipTo"]["email"] == ""
    _, r = _pedido(cliente, "kit1", email="sem-arroba")
    assert r.status_code == 422


def test_envio_ja_cancelado_na_loggi(cliente, monkeypatch):
    from servidor import loggi

    _limpar_cupons()
    _, r = _pedido(cliente, "kit1")
    nsu = r.json()["order_nsu"]
    cliente.post(f"/simulador/pagar/{nsu}", content="forma=pix",
                 headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    primeiro = cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/envio", headers=VENDEDOR).json()

    def recusa(_):
        raise loggi.ErroFrete("A Loggi recusou o cancelamento (erro 400).")

    monkeypatch.setattr(loggi, "cancelar_envio", recusa)
    monkeypatch.setattr(loggi, "ja_cancelado", lambda codigo: True)  # o rastreio diz "cancelado"
    r = cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/cancelar", headers=VENDEDOR)
    assert r.status_code == 200 and "já estava cancelado" in r.json()["aviso_loggi"] and r.json()["loggi_key"] is None
    monkeypatch.setattr(loggi, "ja_cancelado", lambda codigo: False)  # em rota: o erro aparece
    cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/envio", headers=VENDEDOR)
    assert cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/cancelar", headers=VENDEDOR).status_code == 502
    corpo = loggi.corpo_envio(banco.buscar(nsu))
    assert corpo["packages"][0]["sequence"].startswith(nsu[:29] + "-") and primeiro["loggi_key"]
