"""O fluxo da compra com a Loggi e a InfinitePay simuladas (sem rede: o CEP é falso).

Rodar: .venv\\Scripts\\python -m pytest testes -q
(com TESTE_DATABASE_URL, roda num Postgres de teste em vez do SQLite)
"""

import os
import tempfile
from urllib.parse import parse_qs, urlparse

os.environ.update(LOGGI_AMBIENTE="simulado", INFINITEPAY_AMBIENTE="simulado", INFINITEPAY_DESCONTO_PIX="0", PRODUTO_PESO_G="300",
                  PRODUTO_DIMENSOES_CM="32x17x5", LOGGI_ENVIO_AUTOMATICO="nao",
                  # as chaves do .env de verdade não entram nos testes (vazio no ambiente: o .env não sobrepõe)
                  LOGGI_CLIENT_ID="", LOGGI_CLIENT_SECRET="", LOGGI_COMPANY_ID="", INFINITEPAY_API_KEY="", INFINITEPAY_HANDLE="",
                  LOJA_ADMIN_EMAIL="", LOJA_ADMIN_SENHA="",
                  DATABASE_URL=os.environ.get("TESTE_DATABASE_URL", ""), SITE_URL="http://testserver", LOJA_ORIGEM_CEP="01310100")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from servidor import banco, loggi  # noqa: E402

if not os.environ["DATABASE_URL"]:
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

    from servidor import acesso, configuracoes

    modulo._chamadas.clear()  # o limite por IP vale entre testes também
    acesso._erros.clear()
    with TestClient(app) as c:  # ao subir, o servidor cria as tabelas
        banco.gravar_ajustes({"refis": None, "laminas_por_refil": None, "ofertas": None})  # volta aos padrões
        banco.gravar_foto("kit", None, None)
        with banco.engine.begin() as conexao:  # a configuração volta ao .env de teste
            conexao.execute(banco.configuracoes.delete())
            conexao.execute(banco.segredos_locais.delete())
        configuracoes.recarregar()
        acesso.definir_administrador(ADMIN, SENHA)
        token = c.post("/api/vendedor/entrar", json={"email": ADMIN, "senha": SENHA}).json()["token"]
        VENDEDOR.clear()
        VENDEDOR["Authorization"] = f"Bearer {token}"
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

    vendedor = VENDEDOR
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

ADMIN, SENHA = "dono@loja.test", "senha-de-teste-longa"
VENDEDOR: dict = {}


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
    assert all(isinstance(v, (bool, int, float, str)) for v in r["infinitepay"].values())
    teste = cliente.post("/api/vendedor/integracoes/loggi/testar", json={"cep": "20040002"}, headers=VENDEDOR).json()
    assert teste["ok"] and len(teste["opcoes"]) == 2

def _pedido_pago(cliente) -> str:
    _, r = _pedido(cliente)
    nsu = r.json()["order_nsu"]
    cliente.post(f"/simulador/pagar/{nsu}", content="forma=pix",
                 headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert cliente.get(f"/api/pedidos/{nsu}").json()["situacao"] == "pago"
    return nsu


def test_envio_loggi_etiqueta_rastreio_e_cancelamento(cliente):
    nsu = _pedido_pago(cliente)
    assert cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/envio").status_code == 401
    r = cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/envio", headers=VENDEDOR)
    assert r.status_code == 200, r.text
    assert r.json()["loggi_key"] and r.json()["codigo_rastreio"]
    assert cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/envio", headers=VENDEDOR).status_code == 409  # sem pacote duplicado

    pdf = cliente.get(f"/api/vendedor/pedidos/{nsu}/loggi/etiqueta", headers=VENDEDOR)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")

    publico = cliente.get(f"/api/pedidos/{nsu}").json()
    assert publico["tem_envio_loggi"] and publico["codigo_rastreio"]
    rastreio = cliente.get(f"/api/pedidos/{nsu}/rastreio").json()
    assert rastreio["rastreio"]["descricao"]

    enviado = cliente.post(f"/api/vendedor/pedidos/{nsu}/enviado", json={"codigo_rastreio": ""}, headers=VENDEDOR)
    assert enviado.json()["situacao"] == "enviado"  # usa o código da Loggi

    cancelado = cliente.post(f"/api/vendedor/pedidos/{nsu}/loggi/cancelar", headers=VENDEDOR).json()
    assert cancelado["loggi_key"] is None and cancelado["situacao"] == "pago"


def test_envio_so_de_pedido_pago(cliente):
    _, r = _pedido(cliente)
    assert cliente.post(f"/api/vendedor/pedidos/{r.json()['order_nsu']}/loggi/envio", headers=VENDEDOR).status_code == 409


def _envio_automatico_na_hora(monkeypatch):
    from servidor import config, pedidos

    monkeypatch.setattr(config, "LOGGI_ENVIO_AUTOMATICO", True)
    monkeypatch.setattr(pedidos, "disparar_envio_automatico", pedidos.envio_automatico)  # sem thread no teste
    return pedidos


def test_envio_automatico_depois_do_pagamento(cliente, monkeypatch):
    _envio_automatico_na_hora(monkeypatch)
    nsu = _pedido_pago(cliente)
    pedido = next(p for p in cliente.get("/api/vendedor/pedidos", headers=VENDEDOR).json() if p["order_nsu"] == nsu)
    assert pedido["loggi_key"] and pedido["codigo_rastreio"] and not pedido["envio_erro"]
    # conferir de novo (a página do cliente) não cria outro pacote
    assert cliente.post(f"/api/pedidos/{nsu}/conferir", json={}).json()["situacao"] == "pago"


def test_envio_automatico_que_falha_fica_avisado(cliente, monkeypatch):
    pedidos = _envio_automatico_na_hora(monkeypatch)

    def recusar(_pedido):
        raise loggi.ErroFrete("A Loggi recusou o endereço.")

    monkeypatch.setattr(loggi, "criar_envio", recusar)
    nsu = _pedido_pago(cliente)  # o pagamento é confirmado mesmo assim
    pedido = next(p for p in cliente.get("/api/vendedor/pedidos", headers=VENDEDOR).json() if p["order_nsu"] == nsu)
    assert pedido["loggi_key"] is None and "recusou" in pedido["envio_erro"]

    monkeypatch.setattr(loggi, "criar_envio", lambda _p: {"loggi_key": "K1", "tracking_code": "T1"})
    assert pedidos.criar_envio_loggi(nsu)["envio_erro"] is None  # o envio à mão limpa o aviso


def test_corpo_do_envio_real(monkeypatch):
    """O pacote que vai para a Loggi de verdade: formato da documentação (async-shipments)."""
    from servidor import config, loggi

    monkeypatch.setattr(config, "LOGGI_AMBIENTE", "producao")
    monkeypatch.setattr(config, "LOGGI_SERVICOS", ["DLVR-SPOT-DOOR-STAN-01"])
    monkeypatch.setattr(config, "REMETENTE", {**config.REMETENTE, "nome": "Loja Teste", "documento": "52998224725",
                                               "numero": "100", "telefone": "11999998888"})
    monkeypatch.setattr(loggi, "endereco_do_cep", lambda cep: ENDERECOS[loggi.limpar_cep(cep)])
    pedido = {"order_nsu": "abc", "kits": 2, "preco_centavos": 4490, "frete_tipo": "FREIGHT_TYPE_ECONOMIC",
              "nome": "Maria Souza", "cpf": "52998224725", "email": "m@exemplo.com", "telefone": "21999998888",
              "rua": "Rua da Assembleia", "numero": "10", "complemento": "Sala 2", "bairro": "Centro", "cep": "20040002",
              "cidade": "Rio de Janeiro", "uf": "RJ"}
    corpo = loggi.corpo_envio(pedido)
    assert corpo["externalServiceId"] == "DLVR-SPOT-DOOR-STAN-01"
    assert corpo["shipFrom"]["federalTaxId"] == "52998224725"
    assert corpo["shipFrom"]["address"]["correiosAddress"]["cep"] == "01310100"
    destino = corpo["shipTo"]["address"]["correiosAddress"]
    assert destino == {"logradouro": "Rua da Assembleia", "numero": "10", "complemento": "Sala 2", "bairro": "Centro",
                       "cep": "20040002", "cidade": "Rio de Janeiro", "uf": "RJ"}
    pacote = corpo["packages"][0]
    assert pacote["documentTypes"][0]["contentDeclaration"]["totalValue"] == "44.90"
    assert pacote["weightG"] == 700 and pacote["lengthCm"] + pacote["widthCm"] + pacote["heightCm"] <= 200


# ───────── Acesso por e-mail e senha ─────────

def test_entrar_sair_e_senha_errada(cliente):
    assert cliente.get("/api/vendedor/pedidos").status_code == 401
    assert cliente.get("/api/vendedor/pedidos", headers={"Authorization": "Bearer inventado"}).status_code == 401
    assert cliente.post("/api/vendedor/entrar", json={"email": ADMIN, "senha": "errada-errada"}).status_code == 401
    assert cliente.post("/api/vendedor/entrar", json={"email": "outro@loja.test", "senha": SENHA}).status_code == 401
    assert cliente.get("/api/vendedor/eu", headers=VENDEDOR).json() == {"email": ADMIN}
    cliente.post("/api/vendedor/sair", headers=VENDEDOR)
    assert cliente.get("/api/vendedor/eu", headers=VENDEDOR).status_code == 401


def test_primeiro_acesso_pela_tela_com_o_codigo_do_terminal(cliente, caplog, monkeypatch):
    import re

    from servidor import acesso
    from servidor import banco as b

    assert cliente.get("/api/vendedor/primeiro-acesso").json() == {"disponivel": False}
    novo = {"email": "novo@loja.test", "senha": "senha-nova-bem-longa"}
    assert cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": "0000-0000", **novo}).status_code == 409

    with b.engine.begin() as c:  # sem administrador: a loja gera o código e mostra no terminal
        c.execute(b.sessoes.delete())
        c.execute(b.administradores.delete())
    monkeypatch.setattr(acesso, "_codigo_hash", None)
    with caplog.at_level("WARNING", logger="loja"):
        assert cliente.get("/api/vendedor/primeiro-acesso").json() == {"disponivel": True}
    codigo = re.search(r"código: (\d{4}-\d{4})", caplog.text).group(1)
    assert cliente.post("/api/vendedor/entrar", json=novo).status_code == 403

    errado = "0000-0000" if codigo != "0000-0000" else "1111-1111"
    assert cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": errado, **novo}).status_code == 401
    r = cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": codigo, **novo, "senha": "curta"})
    assert r.status_code == 422  # senha curta não gasta o código
    r = cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": codigo, **novo})
    assert r.status_code == 200
    assert cliente.get("/api/vendedor/eu", headers={"Authorization": f"Bearer {r.json()['token']}"}).json() == {
        "email": "novo@loja.test"}
    # Criado o primeiro, a tela some e o código não vale mais
    assert cliente.get("/api/vendedor/primeiro-acesso").json() == {"disponivel": False}
    outro = {"codigo": codigo, "email": "intruso@loja.test", "senha": "senha-do-intruso-longa"}
    assert cliente.post("/api/vendedor/primeiro-acesso", json=outro).status_code == 409


def test_codigo_do_primeiro_acesso_troca_depois_de_cinco_erros(cliente, caplog, monkeypatch):
    import re

    from servidor import acesso
    from servidor import banco as b

    with b.engine.begin() as c:
        c.execute(b.sessoes.delete())
        c.execute(b.administradores.delete())
    monkeypatch.setattr(acesso, "_codigo_hash", None)
    with caplog.at_level("WARNING", logger="loja"):
        cliente.get("/api/vendedor/primeiro-acesso")
    antigo = re.search(r"código: (\d{4}-\d{4})", caplog.text).group(1)
    novo = {"email": "novo@loja.test", "senha": "senha-nova-bem-longa"}
    errado = "0000-0000" if antigo != "0000-0000" else "1111-1111"
    for _ in range(4):
        assert cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": errado, **novo}).status_code == 401
    assert cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": errado, **novo}).status_code == 429
    acesso_antigo = cliente.post("/api/vendedor/primeiro-acesso", json={"codigo": antigo, **novo})
    assert acesso_antigo.status_code in (401, 429)  # o código antigo não vale mais (ou o limite por IP segurou)


def test_acesso_fixo_no_env(cliente, monkeypatch):
    from servidor import acesso, config

    monkeypatch.setattr(config, "ADMIN_SENHA", "curta")
    monkeypatch.setattr(config, "ADMIN_EMAIL", "env@loja.test")
    assert acesso.acesso_do_ambiente() is None  # senha curta: ignora e avisa no terminal
    monkeypatch.setattr(config, "ADMIN_SENHA", "senha-do-env-bem-longa")
    assert acesso.acesso_do_ambiente() == "env@loja.test"
    r = cliente.post("/api/vendedor/entrar", json={"email": "ENV@loja.test", "senha": "senha-do-env-bem-longa"})
    assert r.status_code == 200
    token = {"Authorization": f"Bearer {r.json()['token']}"}
    assert cliente.get("/api/vendedor/primeiro-acesso").json() == {"disponivel": False}
    # A senha desse acesso só muda no .env
    r = cliente.post("/api/vendedor/senha", json={"atual": "senha-do-env-bem-longa", "nova": "outra-senha-qualquer"},
                     headers=token)
    assert r.status_code == 409
    # Mudou no .env: ao ligar de novo, a senha é acertada e as sessões antigas caem
    assert acesso.acesso_do_ambiente() == "env@loja.test"  # mesma senha: nada muda
    assert cliente.get("/api/vendedor/eu", headers=token).status_code == 200
    monkeypatch.setattr(config, "ADMIN_SENHA", "senha-nova-do-env-longa")
    acesso.acesso_do_ambiente()
    assert cliente.get("/api/vendedor/eu", headers=token).status_code == 401
    assert cliente.post("/api/vendedor/entrar", json={"email": "env@loja.test", "senha": "senha-do-env-bem-longa"}).status_code == 401
    assert cliente.post("/api/vendedor/entrar", json={"email": "env@loja.test", "senha": "senha-nova-do-env-longa"}).status_code == 200


def test_bloqueia_depois_de_cinco_erros(cliente):
    for _ in range(5):
        assert cliente.post("/api/vendedor/entrar", json={"email": ADMIN, "senha": "chute-errado"}).status_code == 401
    assert cliente.post("/api/vendedor/entrar", json={"email": ADMIN, "senha": SENHA}).status_code == 429


def test_trocar_senha_fecha_as_sessoes(cliente):
    from servidor import banco as b

    r = cliente.post("/api/vendedor/senha", json={"atual": SENHA, "nova": "curta"}, headers=VENDEDOR)
    assert r.status_code == 422
    r = cliente.post("/api/vendedor/senha", json={"atual": SENHA, "nova": "outra-senha-bem-longa"}, headers=VENDEDOR)
    assert r.status_code == 200
    assert cliente.get("/api/vendedor/eu", headers=VENDEDOR).status_code == 401
    assert cliente.post("/api/vendedor/entrar", json={"email": ADMIN, "senha": "outra-senha-bem-longa"}).status_code == 200
    with b.engine.connect() as c:
        guardado = c.execute(b.administradores.select()).mappings().first()["senha_hash"]
    assert guardado.startswith("scrypt$") and "outra-senha" not in guardado


# ───────── Configurações (banco e cofre) ─────────

def _campo(estado, chave):
    return next(c for c in estado["campos"] if c["chave"] == chave)


def test_configuracoes_pedem_a_senha_e_valem_na_hora(cliente):
    from servidor import config

    estado = cliente.get("/api/vendedor/configuracoes", headers=VENDEDOR).json()
    assert estado["cofre"] == ("vault" if banco.eh_postgres() else "local") and "valor" not in _campo(estado, "LOGGI_CLIENT_SECRET")
    novos = {"LOJA_ORIGEM_CEP": "20040-002", "LOJA_REMETENTE_DOCUMENTO": "529.982.247-25",
             "LOGGI_CLIENT_SECRET": "segredo-de-teste"}
    assert cliente.put("/api/vendedor/configuracoes", json={"valores": novos}, headers=VENDEDOR).status_code == 401
    r = cliente.put("/api/vendedor/configuracoes", json={"valores": novos, "senha": SENHA}, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    assert "segredo-de-teste" not in r.text  # o segredo nunca volta
    assert _campo(r.json(), "LOGGI_CLIENT_SECRET") == {**_campo(r.json(), "LOGGI_CLIENT_SECRET"), "configurado": True}
    assert config.ORIGEM_CEP == "20040002" and config.LOGGI_CLIENT_SECRET == "segredo-de-teste"
    assert "LOGGI_CLIENT_SECRET" in r.json()["mudancas"][0]["detalhe"]

    r = cliente.put("/api/vendedor/configuracoes", headers=VENDEDOR,
                    json={"valores": {}, "apagar_segredos": ["LOGGI_CLIENT_SECRET"], "senha": SENHA})
    assert not _campo(r.json(), "LOGGI_CLIENT_SECRET")["configurado"]


def test_configuracao_ruim_nao_grava_nada(cliente):
    from servidor import config

    antes = config.ORIGEM_CEP
    r = cliente.put("/api/vendedor/configuracoes", headers=VENDEDOR,
                    json={"valores": {"LOJA_ORIGEM_CEP": "123", "LOGGI_AMBIENTE": "producao"}, "senha": SENHA})
    assert r.status_code == 422 and "CEP" in r.json()["erro"]
    assert config.ORIGEM_CEP == antes and config.LOGGI_AMBIENTE == "simulado"
    for valores in ({"PRODUTO_DIMENSOES_CM": "grande"}, {"SITE_URL": "javascript:alert(1)"}, {"CAMPO_X": "1"},
                    {"INFINITEPAY_DESCONTO_PIX": "80"}):
        assert cliente.put("/api/vendedor/configuracoes", headers=VENDEDOR,
                           json={"valores": valores, "senha": SENHA}).status_code == 422


def test_importa_o_env_para_o_banco(cliente):
    r = cliente.post("/api/vendedor/configuracoes/importar", json={"senha": SENHA}, headers=VENDEDOR)
    assert r.status_code == 200, r.text
    assert _campo(r.json(), "LOJA_ORIGEM_CEP")["origem"] == "banco" and not r.json()["no_env"]


# ───────── Desconto no Pix ─────────

def test_desconto_no_pix(cliente):
    from servidor import infinitepay

    r = cliente.put("/api/vendedor/configuracoes", headers=VENDEDOR,
                    json={"valores": {"INFINITEPAY_DESCONTO_PIX": "5"}, "senha": SENHA})
    assert r.status_code == 200, r.text
    assert cliente.get("/api/loja").json()["desconto_pix"] == 5
    nsu = _pedido_pago(cliente)  # o simulador paga no Pix com o desconto
    publico = cliente.get(f"/api/pedidos/{nsu}").json()
    assert publico["desconto_pix"] == 5
    assert publico["valor_pago_centavos"] == round(publico["total_centavos"] * 0.95)

    pedido = banco.buscar(nsu)
    corpo = infinitepay.montar_corpo(pedido)
    assert "options" not in corpo  # sem a API Key, a InfinitePay não aplica opções
    from servidor import config
    config.INFINITEPAY_API_KEY = "inchk_teste"
    try:
        assert infinitepay.montar_corpo(pedido)["options"]["discounts"] == {"pix": 5}
    finally:
        config.INFINITEPAY_API_KEY = ""


def test_cartao_nao_ganha_o_desconto_do_pix():
    from servidor import pedidos as p

    pedido = {"total_centavos": 10000, "desconto_pix": 5}
    assert p.valor_confere(pedido, {"amount": 10000, "capture_method": "credit_card"})
    assert p.valor_confere(pedido, {"amount": 9500, "capture_method": "pix"})
    assert not p.valor_confere(pedido, {"amount": 9500, "capture_method": "credit_card"})
    assert not p.valor_confere({"total_centavos": 10000, "desconto_pix": None}, {"amount": 9500, "capture_method": "pix"})
