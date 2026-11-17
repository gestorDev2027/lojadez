"""Desativar e excluir afiliados e links: sem histórico apaga de vez; com vendas arquiva e o passado não muda."""

from testes.test_afiliados import JOAO, _comprar, _limpar
from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)

ANA = {**JOAO, "nome": "Ana Lima", "codigo": "ana", "email": "ana@exemplo.com"}


def _zerar():
    _limpar()
    with banco.engine.begin() as c:
        c.execute(banco.campanhas.delete())
        c.execute(banco.cupons.delete())
        c.execute(banco.repasses.delete())


def test_desativar_num_clique(cliente):
    _zerar()
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    url = f"/api/vendedor/afiliados/{joao['id']}/ativo"
    assert cliente.post(url, json={"ativo": False}).status_code == 401
    assert cliente.post(url, json={"ativo": False}, headers=VENDEDOR).json()["ativo"] is False
    nsu = _comprar(cliente, ref="joao")
    assert banco.buscar(nsu)["afiliado_id"] is None  # desligado: a venda fica direta
    assert cliente.post(url, json={"ativo": True}, headers=VENDEDOR).json()["ativo"] is True


def test_sem_vendas_apaga_de_vez(cliente):
    _zerar()
    ana = cliente.post("/api/vendedor/afiliados", json=ANA, headers=VENDEDOR).json()
    link = cliente.post(f"/api/vendedor/afiliados/{ana['id']}/campanhas", json={"nome": "Instagram"}, headers=VENDEDOR).json()
    cupom = cliente.post("/api/vendedor/cupons", json={"codigo": "ANA10", "tipo": "percentual", "valor": "10",
                                                       "afiliado_id": ana["id"]}, headers=VENDEDOR)
    assert cupom.status_code == 200, cupom.text
    cliente.get(f"/l/{link['codigo']}", follow_redirects=False)  # um clique contado

    previa = cliente.get(f"/api/vendedor/afiliados/{ana['id']}/excluir", headers=VENDEDOR).json()
    assert previa == {"modo": "apagar", "pedidos": 0, "repasses": 0, "a_repassar_centavos": 0}
    assert cliente.delete(f"/api/vendedor/afiliados/{ana['id']}").status_code == 401
    assert cliente.delete(f"/api/vendedor/afiliados/{ana['id']}", headers=VENDEDOR).json()["modo"] == "apagar"

    assert banco.afiliados is not None and _conta(banco.afiliados) == 0
    assert _conta(banco.campanhas) == 0 and _conta(banco.afiliado_cliques) == 0
    with banco.engine.connect() as c:
        resto = c.execute(banco.cupons.select()).mappings().first()
    assert resto["afiliado_id"] is None and resto["ativo"] is False  # o cupom fica, sem dono e desligado
    # o código fica livre de novo
    assert cliente.post("/api/vendedor/afiliados", json=ANA, headers=VENDEDOR).status_code == 200


def test_com_vendas_arquiva_e_mantem_o_historico(cliente):
    _zerar()
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    link = cliente.post(f"/api/vendedor/afiliados/{joao['id']}/campanhas", json={"nome": "Instagram"}, headers=VENDEDOR).json()
    nsu = _comprar(cliente, ref="joao")
    comissao = banco.buscar(nsu)["comissao_centavos"]
    assert comissao > 0

    previa = cliente.get(f"/api/vendedor/afiliados/{joao['id']}/excluir", headers=VENDEDOR).json()
    assert previa["modo"] == "arquivar" and previa["pedidos"] == 1 and previa["a_repassar_centavos"] == comissao
    assert cliente.delete(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()["modo"] == "arquivar"

    # some das listas e da ficha; o pedido e a comissão ficam como estavam
    lista = cliente.get("/api/vendedor/afiliados", headers=VENDEDOR).json()["afiliados"]
    assert all(a["id"] != joao["id"] for a in lista)
    assert cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).status_code == 404
    pedido = banco.buscar(nsu)
    assert pedido["afiliado_id"] == joao["id"] and pedido["comissao_centavos"] == comissao
    # o código e o link param de funcionar
    assert banco.buscar(_comprar(cliente, ref="joao"))["afiliado_id"] is None
    assert cliente.get(f"/l/{link['codigo']}", follow_redirects=False).headers["location"] == "/"
    # a comissão que falta pagar continua em Repasses
    repasses = cliente.get("/api/vendedor/repasses", headers=VENDEDOR).json()["afiliados"]
    arquivado = next(a for a in repasses if a["id"] == joao["id"])
    assert arquivado["excluido"] is True and arquivado["somas"]["a_liberar"] + arquivado["somas"]["disponivel"] == comissao
    # e não dá para mexer nele nem excluir de novo
    assert cliente.put(f"/api/vendedor/afiliados/{joao['id']}", json=JOAO, headers=VENDEDOR).status_code == 422
    assert cliente.delete(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).status_code == 422


def test_excluir_link(cliente):
    _zerar()
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    base = f"/api/vendedor/afiliados/{joao['id']}/campanhas"
    sem_venda = cliente.post(base, json={"nome": "Story"}, headers=VENDEDOR).json()
    com_venda = cliente.post(base, json={"nome": "Instagram"}, headers=VENDEDOR).json()
    nsu = _comprar(cliente, ref="joao")
    banco.alterar(nsu, {"campanha_codigo": com_venda["codigo"]})

    assert cliente.delete(f"/api/vendedor/campanhas/{sem_venda['id']}").status_code == 401
    assert cliente.delete(f"/api/vendedor/campanhas/{sem_venda['id']}", headers=VENDEDOR).json() == {"modo": "apagar", "pedidos": 0}
    assert cliente.delete(f"/api/vendedor/campanhas/{com_venda['id']}", headers=VENDEDOR).json() == {"modo": "arquivar", "pedidos": 1}
    assert cliente.delete(f"/api/vendedor/campanhas/{com_venda['id']}", headers=VENDEDOR).status_code == 422

    ficha = cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()
    assert ficha["campanhas"] == []  # os dois somem da lista
    assert banco.buscar(nsu)["campanha_codigo"] == com_venda["codigo"]  # a venda continua com o código do link
    assert cliente.get(f"/l/{com_venda['codigo']}", follow_redirects=False).headers["location"] == "/"
    assert cliente.put(f"/api/vendedor/campanhas/{com_venda['id']}", json={"ativo": True}, headers=VENDEDOR).status_code == 422


def _conta(tabela) -> int:
    with banco.engine.connect() as c:
        return len(c.execute(tabela.select()).all())
