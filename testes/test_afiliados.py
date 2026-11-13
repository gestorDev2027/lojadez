"""Afiliados: cadastro, links, cliques, a venda pelo ?ref= com a comissão, a visão geral e a ficha."""

from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)
from testes.test_produtos import POMADA

JOAO = {"nome": "João Silva", "codigo": "joao", "documento": "529.982.247-25", "email": "joao@exemplo.com",
        "telefone": "(11) 98888-7777", "chave_pix": "joao@exemplo.com", "comissao_pct": "12,5", "todos_produtos": True}


def _limpar():
    with banco.engine.begin() as c:
        for tabela in (banco.pedidos, banco.afiliados, banco.afiliado_cliques, banco.produtos):
            c.execute(tabela.delete())


def _comprar(cliente, oferta="kit2", ref=None, produto=None, pagar=True) -> str:
    base = {"cep": "20040-002", "oferta": oferta, "produto": produto}
    frete = cliente.post("/api/frete", json=base).json()
    dados = {**base, "cep": "20040002", "frete_tipo": frete["opcoes"][0]["tipo"], "nome": "Maria Souza",
             "cpf": "529.982.247-25", "email": "maria@exemplo.com", "telefone": "(21) 99999-8888", "numero": "10",
             "ref": ref}
    r = cliente.post("/api/pedidos", json=dados)
    assert r.status_code == 200, r.text
    nsu = r.json()["order_nsu"]
    if pagar:
        cliente.post(f"/simulador/pagar/{nsu}", content="forma=pix",
                     headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    return nsu


def test_cadastro_e_links(cliente):
    _limpar()
    assert cliente.post("/api/vendedor/afiliados", json=JOAO).status_code == 401  # só o vendedor
    r = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["codigo"] == "joao" and a["comissao_pct"] == 12.5 and a["documento"] == "52998224725"
    assert a["links"] == [{"produto": "kit-laminas", "nome": "Kit de lâminas (página principal)",
                           "url": "http://testserver/?ref=joao"}]

    # Código repetido e dados inválidos
    assert cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).status_code == 422
    for errado in ({"documento": "123"}, {"comissao_pct": "95"}, {"email": "x"}, {"todos_produtos": False, "produtos": []},
                   {"codigo": "a b"}):
        r = cliente.post("/api/vendedor/afiliados", json={**JOAO, "nome": "Outro Nome", "codigo": "", **errado}, headers=VENDEDOR)
        assert r.status_code == 422, errado

    # Só a pomada: o link do kit some e entra o da pomada
    cliente.post("/api/vendedor/produtos", json=POMADA, headers=VENDEDOR)
    r = cliente.put(f"/api/vendedor/afiliados/{a['id']}", json={**JOAO, "todos_produtos": False,
                                                                 "produtos": ["pomada-modeladora-matte"]}, headers=VENDEDOR)
    assert [l["url"] for l in r.json()["links"]] == ["http://testserver/p/pomada-modeladora-matte?ref=joao"]


def test_venda_pelo_link_gera_comissao(cliente):
    _limpar()
    cliente.post("/api/vendedor/produtos", json=POMADA, headers=VENDEDOR)
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    so_pomada = cliente.post("/api/vendedor/afiliados", json={**JOAO, "nome": "Ana Costa", "codigo": "ana",
                                                               "todos_produtos": False, "produtos": ["pomada-modeladora-matte"]},
                             headers=VENDEDOR).json()

    # Cliques: só contados, por dia; código desconhecido não conta
    assert cliente.post("/api/afiliados/clique", json={"ref": "joao"}).json()["ok"] is True
    cliente.post("/api/afiliados/clique", json={"ref": "JOAO"})
    assert cliente.post("/api/afiliados/clique", json={"ref": "ninguem"}).json()["ok"] is False

    com_joao = _comprar(cliente, "kit2", ref="joao")
    direta = _comprar(cliente, "kit1")
    nao_liberado = _comprar(cliente, "kit3", ref="ana")  # Ana só divulga a pomada: a venda fica direta
    p = banco.buscar(com_joao)
    assert p["afiliado_id"] == joao["id"] and p["afiliado_codigo"] == "joao" and p["comissao_pct"] == 12.5
    assert p["comissao_centavos"] == round(p["preco_centavos"] * 0.125)  # sobre o produto, sem o frete
    assert banco.buscar(direta)["afiliado_id"] is None and banco.buscar(nao_liberado)["afiliado_id"] is None

    # Afiliado inativo não ganha
    cliente.put(f"/api/vendedor/afiliados/{joao['id']}", json={**JOAO, "ativo": False}, headers=VENDEDOR)
    assert banco.buscar(_comprar(cliente, "kit1", ref="joao"))["afiliado_id"] is None
    cliente.put(f"/api/vendedor/afiliados/{joao['id']}", json={**JOAO, "ativo": True}, headers=VENDEDOR)
    _comprar(cliente, "kit1", ref="joao", pagar=False)  # aguardando pagamento: não entra na comissão gerada

    # Visão geral: coluna 3 por afiliado, filtro e a receita líquida sem a comissão
    d = cliente.get("/api/vendedor/painel", headers=VENDEDOR).json()
    nomes = {g["nome"]: g for g in d["por_afiliado"]}
    assert set(nomes) == {"João Silva", "Venda direta"} and nomes["João Silva"]["pedidos"] == 1
    i = d["indicadores"]
    assert i["comissoes_centavos"] == p["comissao_centavos"] and i["vendas_afiliados"] == 1
    assert i["liquida_centavos"] == i["vendas_centavos"] - i["frete_loja_centavos"] - i["comissoes_centavos"]
    d = cliente.get("/api/vendedor/painel?afiliado=joao", headers=VENDEDOR).json()
    assert [l["order_nsu"] for l in d["pedidos"]] == [com_joao] and d["pedidos"][0]["afiliado"] == "João Silva"
    assert d["afiliado_nome"] == "João Silva"

    # Lista e ficha
    r = cliente.get("/api/vendedor/afiliados", headers=VENDEDOR).json()
    linha = next(a for a in r["afiliados"] if a["codigo"] == "joao")
    assert linha["pedidos"] == 1 and linha["cliques"] == 2 and linha["conversao_pct"] == 50.0
    assert linha["comissao_centavos"] == p["comissao_centavos"] and r["totais"]["ativos"] == 2
    ficha = cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()
    assert ficha["numeros"]["pedidos"] == 1 and ficha["vendas_total"] == 2  # a paga e a aguardando
    assert ficha["por_produto"][0]["id"] == "kit-laminas"
    venda = ficha["vendas"][-1]
    assert "cpf" not in venda and "email" not in venda and venda["cliente"] == "Maria"
    assert cliente.get("/api/vendedor/afiliados/9999", headers=VENDEDOR).status_code == 404
    assert so_pomada["links"][0]["produto"] == "pomada-modeladora-matte"


def test_excluir_produto(cliente):
    _limpar()
    cliente.post("/api/vendedor/produtos", json=POMADA, headers=VENDEDOR)
    nsu = _comprar(cliente, "q1", produto="pomada-modeladora-matte")  # pago, esperando envio
    r = cliente.delete("/api/vendedor/produtos/pomada-modeladora-matte", headers=VENDEDOR)
    assert r.status_code == 422 and "esperando envio" in r.json()["erro"]

    banco.alterar(nsu, {"situacao": "enviado", "codigo_rastreio": "XYZ"})
    assert cliente.delete("/api/vendedor/produtos/pomada-modeladora-matte").status_code == 401
    assert cliente.delete("/api/vendedor/produtos/pomada-modeladora-matte", headers=VENDEDOR).status_code == 200
    assert cliente.get("/api/produtos/pomada-modeladora-matte").status_code == 404
    assert banco.buscar(nsu)["produto"].startswith("Pomada Modeladora Matte")  # o pedido antigo continua igual
    assert cliente.get("/api/vendedor/painel", headers=VENDEDOR).status_code == 200  # nome do produto sumido não quebra
    assert cliente.delete("/api/vendedor/produtos/pomada-modeladora-matte", headers=VENDEDOR).status_code == 422
