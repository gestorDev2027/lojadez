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


def test_cancelar_e_reembolsar(cliente, monkeypatch):
    from servidor import loggi

    _limpar()
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    nsu = _comprar(cliente, "kit2", ref="joao")
    envio = cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/envio", headers=VENDEDOR)
    assert envio.status_code == 200 and envio.json()["loggi_key"]
    pago = banco.buscar(nsu)

    # Só o vendedor; motivo e valor conferidos
    assert cliente.post(f"/api/vendedor/pedidos/{nsu}/reembolso", json={"motivo": "outro"}).status_code == 401
    for errado in ({"motivo": "x"}, {"motivo": "outro", "valor_centavos": 0},
                   {"motivo": "outro", "valor_centavos": pago["total_centavos"] + 1}):
        assert cliente.post(f"/api/vendedor/pedidos/{nsu}/reembolso", json=errado, headers=VENDEDOR).status_code == 422
    assert cliente.post(f"/api/vendedor/pedidos/{nsu}/reembolsado", json={}, headers=VENDEDOR).status_code == 409

    r = cliente.post(f"/api/vendedor/pedidos/{nsu}/reembolso", json={"motivo": "arrependimento", "detalhe": "trocou de ideia"},
                     headers=VENDEDOR)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["situacao"] == "reembolso_pendente" and p["reembolso_centavos"] == pago["total_centavos"]  # sem valor: tudo
    assert p["reembolso_motivo"] == "Cliente desistiu da compra: trocou de ideia"
    assert p["loggi_key"] is None and "cancelado" in p["aviso_loggi"]  # o envio na Loggi foi cancelado
    assert cliente.get(f"/api/pedidos/{nsu}").json()["situacao"] == "reembolso_pendente"

    # Não conta mais como venda nem gera comissão; aparece nos reembolsos
    d = cliente.get("/api/vendedor/painel", headers=VENDEDOR).json()
    assert d["indicadores"]["pedidos"] == 0 and d["indicadores"]["comissoes_centavos"] == 0
    assert d["indicadores"]["reembolsos"] == 1 and d["indicadores"]["reembolsos_pendentes"] == 1
    assert cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()["numeros"]["comissao_centavos"] == 0

    # Depois do estorno na InfinitePay: reembolsado (com o valor que de fato voltou)
    r = cliente.post(f"/api/vendedor/pedidos/{nsu}/reembolsado", json={"valor_centavos": 3000}, headers=VENDEDOR)
    assert r.status_code == 200 and r.json()["situacao"] == "reembolsado" and r.json()["reembolso_centavos"] == 3000
    d = cliente.get("/api/vendedor/painel", headers=VENDEDOR).json()["indicadores"]
    assert d["reembolsos_centavos"] == 3000 and d["reembolsos_pendentes"] == 0
    assert d["liquida_centavos"] == pago["total_centavos"] - 3000  # reembolso parcial: o que ficou é receita (envio cancelado)

    # Pedido não pago não é reembolsado (usa o "cancelar" simples); a Loggi recusando o cancelamento não trava
    aguardando = _comprar(cliente, "kit1", pagar=False)
    assert cliente.post(f"/api/vendedor/pedidos/{aguardando}/reembolso", json={"motivo": "outro"}, headers=VENDEDOR).status_code == 409
    outro = _comprar(cliente, "kit1")
    cliente.post(f"/api/vendedor/pedidos/{outro}/loggi/envio", headers=VENDEDOR)

    def recusa(_):
        raise loggi.ErroFrete("O pacote já está em rota.")

    monkeypatch.setattr(loggi, "cancelar_envio", recusa)
    r = cliente.post(f"/api/vendedor/pedidos/{outro}/reembolso", json={"motivo": "defeito"}, headers=VENDEDOR).json()
    assert r["situacao"] == "reembolso_pendente" and r["loggi_key"] and "não foi cancelado" in r["aviso_loggi"]
    assert cliente.get("/api/vendedor/painel", headers=VENDEDOR).json()["indicadores"]["frete_perdido_centavos"] > 0


def test_kit_no_editor_completo(cliente):
    from servidor import loggi

    corpo = {"nome": "Kit Wolf 3 Lâminas", "chamada": "Barbear liso por meses", "descricao": "Um aparelho e 19 refis.",
             "peso_g": 160, "comprimento_cm": 26, "largura_cm": 19, "altura_cm": 2}
    r = cliente.put("/api/vendedor/catalogo", json=corpo, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    prod = r.json()["produto"]
    assert prod["nome"] == "Kit Wolf 3 Lâminas" and prod["chamada"] == "Barbear liso por meses" and prod["peso_g"] == 160
    assert cliente.get("/api/produtos").json()[0]["chamada"] == "Barbear liso por meses"
    assert loggi.pacote(3, 6000)["peso_g"] == 160 * 3 + 100 and loggi.pacote(3, 6000)["altura_cm"] == 6
    nsu = _comprar(cliente, "kit1")
    assert banco.buscar(nsu)["produto"].startswith("Kit Wolf 3 Lâminas - 1 Kit")
    for errado in ({"nome": "x"}, {"peso_g": 0}, {"altura_cm": 500}):
        assert cliente.put("/api/vendedor/catalogo", json=errado, headers=VENDEDOR).status_code == 422
    r = cliente.put("/api/vendedor/catalogo", json={"nome": "", "chamada": "", "descricao": ""}, headers=VENDEDOR)
    assert r.json()["produto"]["nome"] == "Kit Barbeador 3 Lâminas"  # vazio volta ao padrão
