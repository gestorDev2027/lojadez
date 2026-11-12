"""As regras dos pedidos: criar (com o frete cotado de novo no servidor), conferir o pagamento e despachar.

O preço e o frete nunca vêm do navegador: o servidor recalcula tudo na hora de criar o pedido.
"""

import logging
import re
import uuid

from servidor import banco, config, infinitepay, loggi

log = logging.getLogger("loja.pedidos")


class ErroPedido(Exception):
    def __init__(self, mensagem: str, status: int = 422):
        super().__init__(mensagem)
        self.mensagem, self.status = mensagem, status


EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)


def _quantidade(valor) -> int:
    try:
        quantidade = int(valor)
    except (TypeError, ValueError):
        quantidade = 0
    if not 1 <= quantidade <= config.QUANTIDADE_MAXIMA:
        raise ErroPedido(f"Escolha de 1 a {config.QUANTIDADE_MAXIMA} unidades.")
    return quantidade


def _texto(dados: dict, campo: str, rotulo: str, minimo: int = 1, maximo: int = 120, obrigatorio: bool = True) -> str:
    valor = " ".join(str(dados.get(campo) or "").split())
    if obrigatorio and len(valor) < minimo:
        raise ErroPedido(f"Preencha {rotulo}.")
    if len(valor) > maximo:
        raise ErroPedido(f"{rotulo.capitalize()} tem até {maximo} caracteres.")
    return valor


def cotar_frete(cep: str, quantidade) -> dict:
    quantidade = _quantidade(quantidade)
    try:
        cotacao = loggi.cotar(cep, quantidade)
    except loggi.ErroFrete as erro:
        raise ErroPedido(str(erro))
    produto = config.PRODUTO["preco_centavos"] * quantidade
    return {**cotacao, "produto_centavos": produto,
            "opcoes": [{**o, "total_centavos": produto + o["centavos"]} for o in cotacao["opcoes"]]}


def criar(dados: dict) -> dict:
    quantidade = _quantidade(dados.get("quantidade"))
    nome = _texto(dados, "nome", "o nome completo", minimo=5)
    if len(nome.split()) < 2:
        raise ErroPedido("Informe nome e sobrenome.")
    email = _texto(dados, "email", "o e-mail", maximo=200).lower()
    if not EMAIL.match(email):
        raise ErroPedido("E-mail inválido.")
    telefone = re.sub(r"\D", "", str(dados.get("telefone") or ""))
    if len(telefone) not in (10, 11):
        raise ErroPedido("Telefone com DDD: 10 ou 11 números.")
    numero = _texto(dados, "numero", "o número", maximo=20)
    complemento = _texto(dados, "complemento", "o complemento", maximo=80, obrigatorio=False)

    try:
        cotacao = loggi.cotar(dados.get("cep") or "", quantidade)
    except loggi.ErroFrete as erro:
        raise ErroPedido(str(erro))
    opcao = next((o for o in cotacao["opcoes"] if o["tipo"] == dados.get("frete_tipo")), None)
    if not opcao:
        raise ErroPedido("Esta opção de frete não está mais disponível. Calcule o frete de novo.", 409)
    endereco = cotacao["endereco"]  # cidade e UF vêm do CEP, não da tela
    rua = _texto(dados, "rua", "a rua", maximo=160, obrigatorio=False) or endereco["rua"]
    bairro = _texto(dados, "bairro", "o bairro", maximo=100, obrigatorio=False) or endereco["bairro"]
    if not rua or not bairro:
        raise ErroPedido("Preencha a rua e o bairro.")

    produto = config.PRODUTO
    pedido = {
        "order_nsu": str(uuid.uuid4()), "criado_em": banco.agora(), "situacao": "aguardando_pagamento",
        "sku": produto["sku"], "produto": produto["nome"], "quantidade": quantidade,
        "preco_unitario_centavos": produto["preco_centavos"], "frete_tipo": opcao["tipo"],
        "frete_descricao": f"Frete Loggi {opcao['nome']} (até {opcao['prazo_dias']} dias úteis)",
        "frete_prazo_dias": opcao["prazo_dias"], "frete_centavos": opcao["centavos"],
        "total_centavos": produto["preco_centavos"] * quantidade + opcao["centavos"],
        "nome": nome, "email": email, "telefone": telefone, "cep": endereco["cep"], "rua": rua, "numero": numero,
        "complemento": complemento or None, "bairro": bairro, "cidade": endereco["cidade"], "uf": endereco["uf"],
    }
    banco.inserir(pedido)
    try:
        link = infinitepay.criar_link(pedido)
    except infinitepay.ErroPagamento as erro:
        banco.alterar(pedido["order_nsu"], {"situacao": "cancelado"})
        log.warning("Link de pagamento não criado para %s: %s", pedido["order_nsu"], erro)
        raise ErroPedido(str(erro), 502)
    banco.alterar(pedido["order_nsu"], {"link_pagamento": link})
    return {"order_nsu": pedido["order_nsu"], "link_pagamento": link}


def conferir(order_nsu: str, transaction_nsu: str, slug: str, recibo_url: str | None = None) -> dict:
    """Confere na InfinitePay e, se pago com o valor certo, marca o pedido como pago. Pode ser chamado várias vezes."""
    pedido = banco.buscar(order_nsu)
    if not pedido:
        raise ErroPedido("Pedido não encontrado.", 404)
    if pedido["situacao"] != "aguardando_pagamento" or not transaction_nsu or not slug:
        return pedido
    try:
        resposta = infinitepay.conferir_pagamento(order_nsu, transaction_nsu, slug)
    except infinitepay.ErroPagamento as erro:
        raise ErroPedido(str(erro), 502)
    if not resposta.get("paid"):
        return pedido
    valor = int(resposta.get("amount") or 0)
    if valor != pedido["total_centavos"]:
        log.warning("Pagamento de %s com valor diferente: %s em vez de %s.", order_nsu, valor, pedido["total_centavos"])
        banco.alterar(order_nsu, {"situacao": "pagamento_divergente", "transaction_nsu": transaction_nsu, "slug": slug},
                      so_se_situacao=("aguardando_pagamento",))
        return banco.buscar(order_nsu)
    seguro = recibo_url if (recibo_url or "").startswith("https://") or config.INFINITEPAY_AMBIENTE == "simulado" else None
    banco.alterar(order_nsu, {
        "situacao": "pago", "transaction_nsu": transaction_nsu, "slug": slug,
        "forma_pagamento": resposta.get("capture_method"), "valor_pago_centavos": int(resposta.get("paid_amount") or valor),
        "parcelas": int(resposta.get("installments") or 1), "recibo_url": seguro, "pago_em": banco.agora(),
    }, so_se_situacao=("aguardando_pagamento",))
    return banco.buscar(order_nsu)


def processar_webhook(aviso: dict) -> None:
    """O aviso da InfinitePay não é assinado: só serve de gatilho para conferir."""
    order_nsu = str(aviso.get("order_nsu") or "")
    if not order_nsu:
        raise ErroPedido("Aviso sem order_nsu.", 400)
    conferir(order_nsu, str(aviso.get("transaction_nsu") or ""), str(aviso.get("invoice_slug") or ""),
             aviso.get("receipt_url"))


def publico(pedido: dict) -> dict:
    """O que o comprador vê do pedido (sem e-mail, telefone ou endereço completo)."""
    return {
        "order_nsu": pedido["order_nsu"], "situacao": pedido["situacao"], "primeiro_nome": pedido["nome"].split()[0],
        "produto": pedido["produto"], "quantidade": pedido["quantidade"],
        "preco_unitario_centavos": pedido["preco_unitario_centavos"], "frete_descricao": pedido["frete_descricao"],
        "frete_centavos": pedido["frete_centavos"], "total_centavos": pedido["total_centavos"],
        "cidade": pedido["cidade"], "uf": pedido["uf"], "forma_pagamento": pedido["forma_pagamento"],
        "recibo_url": pedido["recibo_url"], "codigo_rastreio": pedido["codigo_rastreio"],
        "link_pagamento": pedido["link_pagamento"] if pedido["situacao"] == "aguardando_pagamento" else None,
    }


def marcar_enviado(order_nsu: str, codigo_rastreio: str) -> dict:
    codigo = " ".join((codigo_rastreio or "").split())[:60]
    if not codigo:
        raise ErroPedido("Informe o código de rastreio.")
    if not banco.alterar(order_nsu, {"situacao": "enviado", "codigo_rastreio": codigo, "enviado_em": banco.agora()},
                         so_se_situacao=("pago",)):
        raise ErroPedido("Só pedidos pagos podem ser marcados como enviados.", 409)
    return banco.buscar(order_nsu)


def cancelar(order_nsu: str) -> dict:
    if not banco.alterar(order_nsu, {"situacao": "cancelado"}, so_se_situacao=("aguardando_pagamento", "pagamento_divergente")):
        raise ErroPedido("Só pedidos não pagos podem ser cancelados aqui (pago: estorne na InfinitePay).", 409)
    return banco.buscar(order_nsu)
