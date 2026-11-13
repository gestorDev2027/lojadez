"""Os produtos do catálogo (além do kit de lâminas): cadastro, página, frete e pedido.

Rodar: .venv\\Scripts\\python -m pytest testes -q
"""

from testes.test_fluxo import ADMIN, SENHA, VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)

POMADA = {
    "nome": "Pomada Modeladora Matte", "chamada": "Fixação forte e efeito seco", "descricao": "Para cabelo curto.\nSem brilho.",
    "sku": "POM-001", "unidade": "pote", "unidade_plural": "potes", "conteudo": "1 pote de 120 g",
    "peso_g": 180, "comprimento_cm": 9, "largura_cm": 9, "altura_cm": 6,
    "ofertas": [{"quantidade": 1, "preco_centavos": 3990, "selo": ""},
                {"quantidade": 2, "preco_centavos": 6990, "selo": "Mais vendido"}],
    "montar": {"ativo": True, "maximo": 6, "preco_unidade_centavos": 3200},
    "frete_gratis_a_partir": 3,
}


def _criar(cliente, **mudar):
    r = cliente.post("/api/vendedor/produtos", json={**POMADA, **mudar}, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    return r.json()


def _limpar():
    with banco.engine.begin() as c:
        c.execute(banco.produtos.delete())
        c.execute(banco.fotos.delete().where(banco.fotos.c.nome.like("produto:%")))


def test_cadastro_e_pagina_do_produto(cliente):
    _limpar()
    assert cliente.post("/api/vendedor/produtos", json=POMADA).status_code == 401  # só o vendedor
    p = _criar(cliente)
    assert p["slug"] == "pomada-modeladora-matte" and p["url"] == "/p/pomada-modeladora-matte"
    assert p["foto"] == "/assets/img/produto.svg" and not p["foto_enviada"]

    publico = cliente.get("/api/produtos/pomada-modeladora-matte").json()
    assert [o["id"] for o in publico["ofertas"]] == ["q1", "q2"]
    assert [o["titulo"] for o in publico["ofertas"]] == ["1 Pote", "2 Potes"]
    assert publico["montar"] == {"ativo": True, "minimo": 3, "maximo": 6, "preco_kit_centavos": 3200}
    assert publico["frete_gratis_a_partir"] == 3

    vitrine = cliente.get("/api/produtos").json()
    assert [v["id"] for v in vitrine] == ["kit-laminas", "pomada-modeladora-matte"]
    assert vitrine[1]["a_partir_de_centavos"] == 3990 and vitrine[0]["url"] == "/"

    # Endereço repetido, campos errados
    assert cliente.post("/api/vendedor/produtos", json=POMADA, headers=VENDEDOR).status_code == 422
    for errado in ({"nome": "x"}, {"ofertas": []}, {"peso_g": 0},
                   {"ofertas": [{"quantidade": 1, "preco_centavos": 10}]},
                   {"ofertas": [{"quantidade": 2, "preco_centavos": 500}, {"quantidade": 2, "preco_centavos": 900}]},
                   {"montar": {"ativo": True, "maximo": 2, "preco_unidade_centavos": 3000}}, {"slug": "kit-laminas"}):
        assert cliente.post("/api/vendedor/produtos", json={**POMADA, "nome": "Outro nome", **errado},
                            headers=VENDEDOR).status_code == 422, errado

    # Inativo some da loja, mas continua na área do vendedor
    r = cliente.put("/api/vendedor/produtos/pomada-modeladora-matte", json={**POMADA, "ativo": False}, headers=VENDEDOR)
    assert r.status_code == 200 and r.json()["ativo"] is False
    assert cliente.get("/api/produtos/pomada-modeladora-matte").status_code == 404
    assert [v["id"] for v in cliente.get("/api/produtos").json()] == ["kit-laminas"]
    assert len(cliente.get("/api/vendedor/produtos", headers=VENDEDOR).json()) == 1
    assert cliente.post("/api/frete", json={"cep": "20040-002", "produto": "pomada-modeladora-matte",
                                            "oferta": "q1"}).status_code == 422


def test_foto_do_produto(cliente):
    _limpar()
    _criar(cliente)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    r = cliente.put("/api/vendedor/produtos/pomada-modeladora-matte/foto", content=png,
                    headers={**VENDEDOR, "Content-Type": "image/png"})
    assert r.status_code == 200 and r.json()["foto_enviada"]
    assert cliente.get(r.json()["foto"]).content == png
    assert cliente.put("/api/vendedor/produtos/pomada-modeladora-matte/foto", content=b"nada",
                       headers={**VENDEDOR, "Content-Type": "image/png"}).status_code == 422
    r = cliente.delete("/api/vendedor/produtos/pomada-modeladora-matte/foto", headers=VENDEDOR)
    assert not r.json()["foto_enviada"]


def test_frete_e_pedido_do_produto(cliente):
    from servidor import infinitepay, loggi

    _limpar()
    _criar(cliente)
    base = {"cep": "20040-002", "produto": "pomada-modeladora-matte"}

    # 2 potes: o cliente paga o frete; a caixa usa as medidas do produto
    frete = cliente.post("/api/frete", json={**base, "oferta": "q2"}).json()
    assert frete["produto_centavos"] == 6990 and not any(o["gratis"] for o in frete["opcoes"])

    # 4 potes montados: preço por unidade e frete grátis (a partir de 3)
    frete = cliente.post("/api/frete", json={**base, "oferta": "q4"}).json()
    assert frete["produto_centavos"] == 4 * 3200 and frete["opcoes"][0]["gratis"]
    for fora in ("q7", "q0", "kit3", "x"):
        assert cliente.post("/api/frete", json={**base, "oferta": fora}).status_code == 422

    dados = {"produto": "pomada-modeladora-matte", "oferta": "q4", "cep": "20040002", "frete_tipo": frete["opcoes"][0]["tipo"],
             "nome": "Maria Souza", "cpf": "529.982.247-25", "email": "maria@exemplo.com", "telefone": "(21) 99999-8888",
             "numero": "10"}
    r = cliente.post("/api/pedidos", json=dados)
    assert r.status_code == 200, r.text
    pedido = banco.buscar(r.json()["order_nsu"])
    assert pedido["produto_id"] == "pomada-modeladora-matte" and pedido["sku"] == "POM-001"
    assert pedido["kits"] == 4 and pedido["preco_centavos"] == 12800 and pedido["frete_centavos"] == 0
    assert pedido["produto"] == "Pomada Modeladora Matte - 4 Potes (1 pote de 120 g cada)"
    assert infinitepay.montar_corpo(pedido)["items"][0]["description"] == pedido["produto"]

    envio = loggi.corpo_envio(pedido)["packages"][0]
    assert envio["weightG"] == 180 * 4 + 100 and envio["lengthCm"] == 9 and envio["heightCm"] == 24
    assert envio["documentTypes"][0]["contentDeclaration"]["description"] == "Pomada Modeladora Matte (4 potes)"
    assert cliente.get(f"/api/pedidos/{pedido['order_nsu']}").json()["produto_id"] == "pomada-modeladora-matte"

    # O kit de lâminas continua igual (sem produto, ou com o id dele)
    assert cliente.post("/api/frete", json={"cep": "20040-002", "oferta": "kit2"}).status_code == 200
    assert cliente.post("/api/frete", json={"cep": "20040-002", "oferta": "kit2", "produto": "kit-laminas"}).status_code == 200


def test_ia_textos_e_foto(cliente, monkeypatch):
    import base64

    from servidor import config, ia

    _limpar()
    _criar(cliente)
    # Sem a chave, a IA fica desligada e avisa
    assert cliente.get("/api/vendedor/ia", headers=VENDEDOR).json()["disponivel"] is False
    r = cliente.post("/api/vendedor/ia/textos", json={"nome": "Pomada"}, headers=VENDEDOR)
    assert r.status_code == 422 and "chave do Gemini" in r.json()["erro"]
    assert cliente.post("/api/vendedor/ia/textos", json={"nome": "Pomada"}).status_code == 401  # só o vendedor

    monkeypatch.setattr(config, "GEMINI_API_KEY", "chave-de-teste")
    pedidos_ao_gemini = []

    def gemini_falso(modelo, corpo, tempo):
        pedidos_ao_gemini.append((modelo, corpo))
        if "responseModalities" in corpo["generationConfig"]:
            return {"candidates": [{"content": {"parts": [
                {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(b"\x89PNGnova").decode()}}]}}]}
        return {"candidates": [{"content": {"parts": [
            {"text": '{"nome": "Pomada Matte", "chamada": "Fixação forte", "descricao": "Texto."}'}]}}]}

    monkeypatch.setattr(ia, "_chamar", gemini_falso)
    r = cliente.post("/api/vendedor/ia/textos", json={"produto": "pomada-modeladora-matte", "nome": "Pomada",
                                                      "observacoes": "efeito seco"}, headers=VENDEDOR)
    assert r.json() == {"nome": "Pomada Matte", "chamada": "Fixação forte", "descricao": "Texto."}
    assert "efeito seco" in pedidos_ao_gemini[-1][1]["contents"][0]["parts"][-1]["text"]

    # Foto: precisa de uma foto enviada; a editada volta para a tela e não é gravada sozinha
    r = cliente.post("/api/vendedor/ia/foto", json={"produto": "pomada-modeladora-matte", "estilo": "estudio"}, headers=VENDEDOR)
    assert r.status_code == 422
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    cliente.put("/api/vendedor/produtos/pomada-modeladora-matte/foto", content=png,
                headers={**VENDEDOR, "Content-Type": "image/png"})
    r = cliente.post("/api/vendedor/ia/foto", json={"produto": "pomada-modeladora-matte", "estilo": "wolf"}, headers=VENDEDOR)
    assert r.status_code == 200 and base64.b64decode(r.json()["dados"]) == b"\x89PNGnova"
    modelo, corpo = pedidos_ao_gemini[-1]
    assert modelo == config.GEMINI_MODELO_IMAGEM and corpo["contents"][0]["parts"][0]["inline_data"]["mime_type"] == "image/png"
    assert cliente.get("/produtos/pomada-modeladora-matte/foto").content == png  # a foto da loja não mudou
    assert cliente.post("/api/vendedor/ia/foto", json={"produto": "pomada-modeladora-matte", "estilo": "livre"},
                        headers=VENDEDOR).status_code == 422  # "do meu jeito" sem pedido

    # A landing page lista os produtos do catálogo
    assert "Pomada Modeladora Matte" in cliente.get("/lp-config.js").text
