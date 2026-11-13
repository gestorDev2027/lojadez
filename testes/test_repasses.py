"""Comissão por produto e repasses aos afiliados: a liberar → disponível → paga (ou cancelada no reembolso)."""

from datetime import timedelta

from testes.test_afiliados import JOAO, _comprar, _limpar
from testes.test_fluxo import VENDEDOR, banco, cliente, cep_falso  # noqa: F401  (fixtures e config)
from testes.test_produtos import POMADA


def _envelhecer(nsu: str, dias: int):
    """Faz de conta que o pedido foi pago há N dias (para passar do prazo de liberação)."""
    pedido = banco.buscar(nsu)
    banco.alterar(nsu, {"pago_em": pedido["pago_em"] - timedelta(days=dias)})


def test_comissao_por_produto(cliente):
    _limpar()
    cliente.post("/api/vendedor/produtos", json=POMADA, headers=VENDEDOR)
    corpo = {**JOAO, "comissoes_produto": {"pomada-modeladora-matte": "20", "kit-laminas": "", "nao-existe": 5}}
    joao = cliente.post("/api/vendedor/afiliados", json=corpo, headers=VENDEDOR).json()
    assert joao["comissoes_produto"] == {"pomada-modeladora-matte": 20.0}
    kit = banco.buscar(_comprar(cliente, "kit2", ref="joao"))
    pomada = banco.buscar(_comprar(cliente, "q1", ref="joao", produto="pomada-modeladora-matte"))
    assert kit["comissao_pct"] == 12.5 and pomada["comissao_pct"] == 20.0
    assert pomada["comissao_centavos"] == round(3990 * 0.20)
    r = cliente.post("/api/vendedor/afiliados", json={**JOAO, "codigo": "outro", "comissoes_produto": {"kit-laminas": 95}},
                     headers=VENDEDOR)
    assert r.status_code == 422


def test_repasse_do_comeco_ao_fim(cliente):
    _limpar()
    with banco.engine.begin() as c:
        c.execute(banco.repasses.delete())
    joao = cliente.post("/api/vendedor/afiliados", json=JOAO, headers=VENDEDOR).json()
    antiga = _comprar(cliente, "kit2", ref="joao")
    _envelhecer(antiga, 8)  # passou dos 7 dias: disponível
    recente = _comprar(cliente, "kit1", ref="joao")  # dentro do prazo: a liberar
    reembolsada = _comprar(cliente, "kit3", ref="joao")
    cliente.post(f"/api/vendedor/pedidos/{reembolsada}/reembolso", json={"motivo": "outro"}, headers=VENDEDOR)

    assert cliente.get("/api/vendedor/repasses").status_code == 401
    r = cliente.get("/api/vendedor/repasses", headers=VENDEDOR).json()
    j = next(a for a in r["afiliados"] if a["id"] == joao["id"])
    c_antiga, c_recente = banco.buscar(antiga)["comissao_centavos"], banco.buscar(recente)["comissao_centavos"]
    assert j["somas"]["disponivel"] == c_antiga and j["somas"]["a_liberar"] == c_recente
    assert j["somas"]["cancelada"] == banco.buscar(reembolsada)["comissao_centavos"] and j["somas"]["paga"] == 0
    assert [l["order_nsu"] for l in j["disponiveis"]] == [antiga] and j["proxima_liberacao"]
    assert r["dias_liberacao"] == 7 and r["totais"]["disponivel"] == c_antiga

    # Pagar: só o disponível; data no futuro e afiliado sem saldo são recusados
    assert cliente.post("/api/vendedor/repasses", json={"afiliado_id": joao["id"], "pago_em": "2099-01-01"},
                        headers=VENDEDOR).status_code == 422
    assert cliente.post("/api/vendedor/repasses", json={"afiliado_id": joao["id"], "pedidos": [recente]},
                        headers=VENDEDOR).status_code == 422  # a liberar ainda
    r = cliente.post("/api/vendedor/repasses", json={"afiliado_id": joao["id"], "observacao": "Pix feito pelo Itaú"},
                     headers=VENDEDOR)
    assert r.status_code == 200, r.text
    repasse = r.json()
    assert repasse["valor_centavos"] == c_antiga and repasse["vendas"] == 1 and repasse["chave_pix"] == JOAO["chave_pix"]
    assert banco.buscar(antiga)["repasse_id"] == repasse["id"]
    assert cliente.post("/api/vendedor/repasses", json={"afiliado_id": joao["id"]}, headers=VENDEDOR).status_code == 422  # nada mais

    resumo = cliente.get("/api/vendedor/repasses", headers=VENDEDOR).json()
    assert resumo["totais"]["paga"] == c_antiga and resumo["totais"]["pago_mes"] == c_antiga and len(resumo["historico"]) == 1
    comp = cliente.get(f"/api/vendedor/repasses/{repasse['id']}", headers=VENDEDOR).json()
    assert comp["repasse"]["afiliado_nome"] == "João Silva" and comp["vendas"][0]["cliente"] == "Maria"
    assert "cpf" not in comp["vendas"][0]
    ficha = cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()
    assert ficha["saldo"]["somas"]["paga"] == c_antiga and len(ficha["saldo"]["repasses"]) == 1

    # Reembolso depois de pago: continua paga, mas marcada para o acerto
    cliente.post(f"/api/vendedor/pedidos/{antiga}/reembolso", json={"motivo": "defeito"}, headers=VENDEDOR)
    linha = next(l for l in cliente.get(f"/api/vendedor/afiliados/{joao['id']}", headers=VENDEDOR).json()["saldo"]["comissoes"]
                 if l["order_nsu"] == antiga)
    assert linha["situacao"] == "paga" and linha["reembolsado_depois"] is True

    # Desfazer (marcado por engano): a comissão volta, e o repasse some do histórico
    assert cliente.delete(f"/api/vendedor/repasses/{repasse['id']}", headers=VENDEDOR).status_code == 200
    assert banco.buscar(antiga)["repasse_id"] is None
    assert cliente.get("/api/vendedor/repasses", headers=VENDEDOR).json()["historico"] == []
    assert cliente.get(f"/api/vendedor/repasses/{repasse['id']}", headers=VENDEDOR).status_code == 404
