"""O fluxo da compra com a Loggi e a InfinitePay simuladas (sem rede: o CEP é falso).

Rodar: .venv\\Scripts\\python -m pytest testes -q
"""

import os
import tempfile
from urllib.parse import parse_qs, urlparse

os.environ.update(LOGGI_AMBIENTE="simulado", INFINITEPAY_AMBIENTE="simulado", VENDEDOR_SENHA="senha-de-teste",
                  DATABASE_URL="", SITE_URL="http://testserver", LOJA_ORIGEM_CEP="01310100")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from servidor import banco, loggi  # noqa: E402

banco.engine = banco.create_engine(f"sqlite:///{tempfile.mkdtemp()}/teste.db")

from servidor.app import app  # noqa: E402

ENDERECOS = {
    "01310100": {"cep": "01310100", "rua": "Avenida Paulista", "bairro": "Bela Vista", "cidade": "São Paulo", "uf": "SP"},
    "20040002": {"cep": "20040002", "rua": "Rua da Assembleia", "bairro": "Centro", "cidade": "Rio de Janeiro", "uf": "RJ"},
}


@pytest.fixture(autouse=True)
def cep_falso(monkeypatch):
    def achar(cep):
        cep = loggi.limpar_cep(cep)
        if cep not in ENDERECOS:
            raise loggi.ErroFrete("CEP não encontrado.")
        return ENDERECOS[cep]
    monkeypatch.setattr(loggi, "endereco_do_cep", achar)


@pytest.fixture
def cliente():
    from servidor import app as modulo
    from servidor import catalogo

    modulo._chamadas.clear()  # o limite por IP vale entre testes também
    with TestClient(app) as c:  # ao subir, o servidor cria as tabelas
        banco.gravar_ajustes({"refis": None, "laminas_por_refil": None, "ofertas": None})  # volta aos padrões
        banco.gravar_foto("kit", None, None)
        catalogo.limpar_cache()
        yield c


def _pedido(cliente, **mudar):
    frete = cliente.post("/api/frete", json={"cep": "20040-002", "oferta": "kit2"}).json()
    dados = {"oferta": "kit2", "cep": "20040002", "frete_tipo": frete["opcoes"][0]["tipo"], "nome": "Maria Souza", "cpf": "529.982.247-25",
             "email": "maria@exemplo.com", "telefone": "(21) 99999-8888", "numero": "10", "rua": "", "bairro": "", **mudar}
    return frete, cliente.post("/api/pedidos", json=dados)


def test_frete_tem_duas_opcoes_com_total(cliente):
    r = cliente.post("/api/frete", json={"cep": "20040-002", "oferta": "kit2"})
    assert r.status_code == 200
    corpo = r.json()
    assert [o["nome"] for o in corpo["opcoes"]] == ["Econômico", "Expresso"]
    assert corpo["opcoes"][0]["total_centavos"] == corpo["produto_centavos"] + corpo["opcoes"][0]["centavos"]


def test_frete_recusa_cep_e_oferta_invalidos(cliente):
    assert cliente.post("/api/frete", json={"cep": "123", "oferta": "kit1"}).status_code == 422
    assert cliente.post("/api/frete", json={"cep": "20040002", "oferta": "kit99"}).status_code == 422


def test_compra_completa(cliente):
    frete, r = _pedido(cliente)
    assert r.status_code == 200, r.text
    nsu, link = r.json()["order_nsu"], r.json()["link_pagamento"]
    assert link.endswith(f"/simulador/pagamento/{nsu}")

    pedido = cliente.get(f"/api/pedidos/{nsu}").json()
    assert pedido["situacao"] == "aguardando_pagamento"
    assert pedido["total_centavos"] == frete["opcoes"][0]["total_centavos"]
    assert "email" not in pedido and "telefone" not in pedido

    volta = cliente.post(f"/simulador/pagar/{nsu}", content="forma=pix",
                         headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert volta.status_code == 303
    parametros = {k: v[0] for k, v in parse_qs(urlparse(volta.headers["location"]).query).items()}
    assert parametros["order_nsu"] == nsu
    assert cliente.get(f"/api/pedidos/{nsu}").json()["situacao"] == "pago"  # pelo webhook

    conferido = cliente.post(f"/api/pedidos/{nsu}/conferir", json=parametros).json()
    assert conferido["situacao"] == "pago" and conferido["forma_pagamento"] == "pix"

    vendedor = {"Authorization": "Bearer senha-de-teste"}
    assert cliente.get("/api/vendedor/pedidos", headers={"Authorization": "Bearer errada"}).status_code == 401
    lista = cliente.get("/api/vendedor/pedidos?situacao=pago", headers=vendedor).json()
    assert any(p["order_nsu"] == nsu and p["email"] == "maria@exemplo.com" for p in lista)
    enviado = cliente.post(f"/api/vendedor/pedidos/{nsu}/enviado", json={"codigo_rastreio": "LGI123"}, headers=vendedor)
    assert enviado.json()["situacao"] == "enviado"


def test_webhook_falso_nao_marca_pago(cliente):
    _, r = _pedido(cliente)
    nsu = r.json()["order_nsu"]
    falso = {"order_nsu": nsu, "transaction_nsu": "inventado", "invoice_slug": "inventado", "amount": 1}
    assert cliente.post("/api/webhooks/infinitepay", json=falso).status_code == 200
    assert cliente.get(f"/api/pedidos/{nsu}").json()["situacao"] == "aguardando_pagamento"


def test_preco_do_navegador_e_ignorado(cliente):
    frete, r = _pedido(cliente, preco_centavos=1, total_centavos=1, frete_centavos=0)
    assert r.status_code == 200
    pedido = cliente.get(f"/api/pedidos/{r.json()['order_nsu']}").json()
    assert pedido["total_centavos"] == frete["opcoes"][0]["total_centavos"]


def test_frete_inexistente_pede_nova_cotacao(cliente):
    _, r = _pedido(cliente, frete_tipo="FRETE_INVENTADO")
    assert r.status_code == 409


def test_dados_do_comprador_conferidos(cliente):
    assert _pedido(cliente, nome="Maria")[1].status_code == 422
    assert _pedido(cliente, email="sem-arroba")[1].status_code == 422
    assert _pedido(cliente, telefone="123")[1].status_code == 422
    assert _pedido(cliente, cpf="111.111.111-11")[1].status_code == 422
    assert _pedido(cliente, cpf="529.982.247-26")[1].status_code == 422


def test_preco_da_oferta_e_o_do_servidor(cliente):
    from servidor import config

    frete, r = _pedido(cliente)
    pedido = cliente.get(f"/api/pedidos/{r.json()['order_nsu']}").json()
    assert pedido["preco_centavos"] == config.OFERTAS[1]["preco_centavos"] == 4490
    assert pedido["kits"] == 2 and "38 refis" in pedido["produto"]


def test_config_da_landing_page(cliente):
    r = cliente.get("/lp-config.js")
    assert r.status_code == 200 and r.text.startswith("window.LP_CONFIG = ")
    assert '"checkoutUrl": "/checkout?oferta=kit2"' in r.text
    assert '"pagamentoNaEntrega": false' in r.text

VENDEDOR = {"Authorization": "Bearer senha-de-teste"}


def test_vendedor_muda_precos_e_refis_na_hora(cliente):
    ofertas = {"kit1": {"preco_centavos": 1990, "selo": "", "ativa": True},
               "kit2": {"preco_centavos": 3790, "selo": "Mais vendido", "ativa": True},
               "kit3": {"preco_centavos": 5290, "selo": "", "ativa": False}}
    assert cliente.put("/api/vendedor/catalogo", json={"refis": 19, "ofertas": ofertas}).status_code == 401
    r = cliente.put("/api/vendedor/catalogo", json={"refis": 20, "laminas_por_refil": 3, "ofertas": ofertas}, headers=VENDEDOR)
    assert r.status_code == 200, r.text

    loja = cliente.get("/api/loja").json()
    assert loja["produto"]["refis"] == 20
    assert [o["id"] for o in loja["ofertas"]] == ["kit1", "kit2"]  # o kit3 foi desligado
    assert loja["ofertas"][1]["preco_centavos"] == 3790 and loja["ofertas"][1]["selo"] == "Mais vendido"
    assert '"preco": 37.9' in cliente.get("/lp-config.js").text

    _, pedido = _pedido(cliente)
    assert cliente.get(f"/api/pedidos/{pedido.json()['order_nsu']}").json()["preco_centavos"] == 3790
    assert cliente.post("/api/frete", json={"cep": "20040002", "oferta": "kit3"}).status_code == 422


def test_vendedor_nao_salva_valores_ruins(cliente):
    sem_ativa = {k: {"preco_centavos": 2000, "ativa": False} for k in ("kit1", "kit2", "kit3")}
    assert cliente.put("/api/vendedor/catalogo", json={"ofertas": sem_ativa}, headers=VENDEDOR).status_code == 422
    assert cliente.put("/api/vendedor/catalogo", json={"refis": 0}, headers=VENDEDOR).status_code == 422
    barato = {"kit1": {"preco_centavos": 5, "ativa": True}}
    assert cliente.put("/api/vendedor/catalogo", json={"ofertas": barato}, headers=VENDEDOR).status_code == 422


def test_vendedor_troca_a_foto(cliente):
    assert cliente.get("/produto/foto", follow_redirects=False).status_code == 302  # sem foto: a padrão
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    falsa = cliente.put("/api/vendedor/foto", content=b"nao e imagem", headers={**VENDEDOR, "content-type": "image/png"})
    assert falsa.status_code == 422
    r = cliente.put("/api/vendedor/foto", content=png, headers={**VENDEDOR, "content-type": "image/png"})
    assert r.status_code == 200 and r.json()["foto"].startswith("/produto/foto?v=")
    foto = cliente.get("/produto/foto")
    assert foto.status_code == 200 and foto.content == png
    assert r.json()["foto"] in cliente.get("/lp-config.js").text
    assert cliente.delete("/api/vendedor/foto", headers=VENDEDOR).json()["foto"] == "/assets/img/kit-foto.jpg"


def test_status_das_integracoes_sem_chaves(cliente):
    r = cliente.get("/api/vendedor/integracoes", headers=VENDEDOR).json()
    assert r["infinitepay"]["ambiente"] == "simulado" and r["loggi"]["ambiente"] == "simulado"
    assert all(isinstance(v, (bool, int, str)) for v in r["infinitepay"].values())
    teste = cliente.post("/api/vendedor/integracoes/loggi/testar", json={"cep": "20040002"}, headers=VENDEDOR).json()
    assert teste["ok"] and len(teste["opcoes"]) == 2