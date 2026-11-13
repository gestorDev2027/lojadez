"""Links de campanha dos afiliados: link curto, contagem de cliques e a venda com a campanha."""

from testes.test_afiliados import JOAO, _comprar, _limpar
from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)
from testes.test_produtos import POMADA


def test_link_curto_conta_e_leva_ao_destino(cliente):
    _limpar()
    with banco.engine.begin() as c:
        c.execute(banco.campanhas.delete())
    cliente.post("/api/vendedor/produtos", json=POMADA, headers=VENDEDOR)
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    base = f"/api/vendedor/afiliados/{joao['id']}/campanhas"
    assert cliente.post(base, json={"nome": "Instagram"}).status_code == 401

    insta = cliente.post(base, json={"nome": "Instagram", "destino": "principal"}, headers=VENDEDOR).json()
    whats = cliente.post(base, json={"nome": "WhatsApp", "destino": "checkout", "produto_id": "kit-laminas", "oferta": "kit3"},
                         headers=VENDEDOR).json()
    pomada = cliente.post(base, json={"nome": "Story", "destino": "produto", "produto_id": "pomada-modeladora-matte"},
                          headers=VENDEDOR).json()
    assert insta["url"] == f"http://testserver/l/{insta['codigo']}" and len(insta["codigo"]) == 7
    for errado in ({"nome": "x"}, {"nome": "Ok", "destino": "lua"}, {"nome": "Ok", "destino": "produto"},
                   {"nome": "Ok", "destino": "produto", "produto_id": "nao-existe"}):
        assert cliente.post(base, json=errado, headers=VENDEDOR).status_code == 422, errado

    # O link curto conta o clique e leva ao destino com o ?ref= e a campanha
    r = cliente.get(f"/l/{whats['codigo']}", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == f"/checkout?oferta=kit3&ref=joao&cp={whats['codigo']}&rc=1"
    assert cliente.get(f"/l/{pomada['codigo']}", follow_redirects=False).headers["location"].startswith(
        "/p/pomada-modeladora-matte?ref=joao&cp=")
    assert cliente.get(f"/l/{insta['codigo']}", follow_redirects=False).headers["location"].startswith("/?ref=joao")
    assert cliente.get("/l/naoexiste", follow_redirects=False).headers["location"] == "/"

    # A venda guarda a campanha (só se for do mesmo afiliado)
    nsu = _comprar(cliente, "kit3", ref="joao")
    banco.alterar(nsu, {"campanha_codigo": None})
    frete = cliente.post("/api/frete", json={"cep": "20040-002", "oferta": "kit3"}).json()
    dados = {"oferta": "kit3", "cep": "20040002", "frete_tipo": frete["opcoes"][0]["tipo"], "nome": "Maria Souza",
             "cpf": "529.982.247-25", "telefone": "(21) 99999-8888", "numero": "10", "ref": "joao", "campanha": whats["codigo"]}
    novo = cliente.post("/api/pedidos", json=dados).json()["order_nsu"]
    assert banco.buscar(novo)["campanha_codigo"] == whats["codigo"]
    cliente.post(f"/simulador/pagar/{novo}", content="forma=pix",
                 headers={"content-type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    sem_dono = cliente.post("/api/pedidos", json={**dados, "ref": None}).json()["order_nsu"]
    assert banco.buscar(sem_dono)["campanha_codigo"] is None  # sem o afiliado, a campanha não vale

    ficha = cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()
    w = next(c for c in ficha["campanhas"] if c["codigo"] == whats["codigo"])
    assert w["cliques"] == 1 and w["pedidos"] == 1 and w["conversao_pct"] == 100.0 and w["produto_nome"]
    assert ficha["numeros"]["cliques"] == 3  # os cliques dos links curtos também contam no afiliado

    # Desligado: leva só à página principal, sem ref
    r = cliente.put(f"/api/vendedor/campanhas/{insta['id']}", json={"ativo": False}, headers=VENDEDOR)
    assert r.json()["ativo"] is False
    assert cliente.get(f"/l/{insta['codigo']}", follow_redirects=False).headers["location"] == "/"
