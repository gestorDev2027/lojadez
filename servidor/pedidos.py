"""As regras dos pedidos: criar (com o frete cotado de novo no servidor), conferir o pagamento e despachar.

O preço e o frete nunca vêm do navegador: o servidor recalcula tudo na hora de criar o pedido.
"""

import logging
import re
import threading
import uuid

from servidor import banco, catalogo, config, infinitepay, loggi

log = logging.getLogger("loja.pedidos")


class ErroPedido(Exception):
    def __init__(self, mensagem: str, status: int = 422):
        super().__init__(mensagem)
        self.mensagem, self.status = mensagem, status


EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)


def _oferta(oferta_id) -> dict:
    oferta = catalogo.oferta(str(oferta_id or ""))
    if not oferta:
        raise ErroPedido("Escolha um dos kits.")
    return oferta


def descricao_oferta(oferta: dict) -> str:
    p = catalogo.produto()
    aparelhos, refis = p["aparelhos"] * oferta["kits"], p["refis"] * oferta["kits"]
    return f"{p['nome']} - {oferta['titulo']} ({aparelhos} {'aparelhos' if aparelhos > 1 else 'aparelho'} + {refis} refis)"


def cpf_valido(cpf: str) -> bool:
    """Os dois dígitos verificadores do CPF."""
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for tamanho in (9, 10):
        soma = sum(int(cpf[i]) * (tamanho + 1 - i) for i in range(tamanho))
        if (soma * 10 % 11) % 10 != int(cpf[tamanho]):
            return False
    return True


def _texto(dados: dict, campo: str, rotulo: str, minimo: int = 1, maximo: int = 120, obrigatorio: bool = True) -> str:
    valor = " ".join(str(dados.get(campo) or "").split())
    if obrigatorio and len(valor) < minimo:
        raise ErroPedido(f"Preencha {rotulo}.")
    if len(valor) > maximo:
        raise ErroPedido(f"{rotulo.capitalize()} tem até {maximo} caracteres.")
    return valor


def _cotar(cep: str, oferta: dict) -> dict:
    try:
        return loggi.cotar(cep, oferta["kits"], oferta["preco_centavos"])
    except loggi.ErroFrete as erro:
        raise ErroPedido(str(erro))


def cotar_frete(cep: str, oferta_id) -> dict:
    oferta = _oferta(oferta_id)
    cotacao = _cotar(cep, oferta)
    produto = oferta["preco_centavos"]
    return {**cotacao, "produto_centavos": produto,
            "opcoes": [{**o, "total_centavos": produto + o["centavos"]} for o in cotacao["opcoes"]]}


def criar(dados: dict) -> dict:
    oferta = _oferta(dados.get("oferta"))
    nome = _texto(dados, "nome", "o nome completo", minimo=5)
    if len(nome.split()) < 2:
        raise ErroPedido("Informe nome e sobrenome.")
    cpf = re.sub(r"\D", "", str(dados.get("cpf") or ""))
    if not cpf_valido(cpf):
        raise ErroPedido("CPF inválido.")
    email = _texto(dados, "email", "o e-mail", maximo=200).lower()
    if not EMAIL.match(email):
        raise ErroPedido("E-mail inválido.")
    telefone = re.sub(r"\D", "", str(dados.get("telefone") or ""))
    if len(telefone) not in (10, 11):
        raise ErroPedido("Telefone com DDD: 10 ou 11 números.")
    numero = _texto(dados, "numero", "o número", maximo=20)
    complemento = _texto(dados, "complemento", "o complemento", maximo=80, obrigatorio=False)

    cotacao = _cotar(str(dados.get("cep") or ""), oferta)
    opcao = next((o for o in cotacao["opcoes"] if o["tipo"] == dados.get("frete_tipo")), None)
    if not opcao:
        raise ErroPedido("Esta opção de frete não está mais disponível. Calcule o frete de novo.", 409)
    endereco = cotacao["endereco"]  # cidade e UF vêm do CEP, não da tela
    rua = _texto(dados, "rua", "a rua", maximo=160, obrigatorio=False) or endereco["rua"]
    bairro = _texto(dados, "bairro", "o bairro", maximo=100, obrigatorio=False) or endereco["bairro"]
    if not rua or not bairro:
        raise ErroPedido("Preencha a rua e o bairro.")

    pedido = {
        "order_nsu": str(uuid.uuid4()), "criado_em": banco.agora(), "situacao": "aguardando_pagamento",
        "sku": config.PRODUTO["sku"], "oferta": oferta["id"], "produto": descricao_oferta(oferta), "kits": oferta["kits"],
        "preco_centavos": oferta["preco_centavos"], "frete_tipo": opcao["tipo"],
        "frete_descricao": f"Frete Loggi {opcao['nome']} (até {opcao['prazo_dias']} dias úteis)",
        "frete_prazo_dias": opcao["prazo_dias"], "frete_centavos": opcao["centavos"],
        "total_centavos": oferta["preco_centavos"] + opcao["centavos"], "desconto_pix": config.desconto_pix() or None,
        "nome": nome, "cpf": cpf, "email": email, "telefone": telefone, "cep": endereco["cep"], "rua": rua, "numero": numero,
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
    if not valor_confere(pedido, resposta):
        log.warning("Pagamento de %s com valor diferente: %s em vez de %s.", order_nsu, valor, pedido["total_centavos"])
        banco.alterar(order_nsu, {"situacao": "pagamento_divergente", "transaction_nsu": transaction_nsu, "slug": slug},
                      so_se_situacao=("aguardando_pagamento",))
        return banco.buscar(order_nsu)
    seguro = recibo_url if (recibo_url or "").startswith("https://") or config.INFINITEPAY_AMBIENTE == "simulado" else None
    marcou = banco.alterar(order_nsu, {
        "situacao": "pago", "transaction_nsu": transaction_nsu, "slug": slug,
        "forma_pagamento": resposta.get("capture_method"), "valor_pago_centavos": int(resposta.get("paid_amount") or valor),
        "parcelas": int(resposta.get("installments") or 1), "recibo_url": seguro, "pago_em": banco.agora(),
    }, so_se_situacao=("aguardando_pagamento",))
    # Só quem marcou o pedido como pago dispara o envio: o webhook e a página do cliente conferem ao mesmo tempo.
    if marcou and config.LOGGI_ENVIO_AUTOMATICO:
        disparar_envio_automatico(order_nsu)
    return banco.buscar(order_nsu)


def total_com_pix(pedido: dict) -> int:
    """O total com o desconto do Pix que valia quando o pedido foi criado (a InfinitePay arredonda ao centavo)."""
    return round(pedido["total_centavos"] * (1 - (pedido.get("desconto_pix") or 0) / 100))


def valor_confere(pedido: dict, resposta: dict) -> bool:
    """O valor da InfinitePay bate com o do pedido: o total, ou, pago no Pix com desconto, o total com o desconto."""
    valor = int(resposta.get("amount") or 0)
    if valor == pedido["total_centavos"]:
        return True
    if pedido.get("desconto_pix") and resposta.get("capture_method") == "pix":
        return abs(valor - total_com_pix(pedido)) <= 1
    return False


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
        "produto": pedido["produto"], "kits": pedido["kits"], "preco_centavos": pedido["preco_centavos"],
        "frete_descricao": pedido["frete_descricao"],
        "frete_centavos": pedido["frete_centavos"], "total_centavos": pedido["total_centavos"],
        "cidade": pedido["cidade"], "uf": pedido["uf"], "forma_pagamento": pedido["forma_pagamento"],
        "recibo_url": pedido["recibo_url"], "codigo_rastreio": pedido["codigo_rastreio"],
        "link_pagamento": pedido["link_pagamento"] if pedido["situacao"] == "aguardando_pagamento" else None,
        "valor_pago_centavos": pedido.get("valor_pago_centavos"), "desconto_pix": pedido.get("desconto_pix"),
        "tem_envio_loggi": bool(pedido.get("loggi_key")),
    }


def marcar_enviado(order_nsu: str, codigo_rastreio: str) -> dict:
    codigo = " ".join((codigo_rastreio or "").split())[:60] or (banco.buscar(order_nsu) or {}).get("codigo_rastreio")
    if not codigo:
        raise ErroPedido("Informe o código de rastreio (ou crie o envio na Loggi).")
    if not banco.alterar(order_nsu, {"situacao": "enviado", "codigo_rastreio": codigo, "enviado_em": banco.agora()},
                         so_se_situacao=("pago",)):
        raise ErroPedido("Só pedidos pagos podem ser marcados como enviados.", 409)
    return banco.buscar(order_nsu)


def cancelar(order_nsu: str) -> dict:
    if not banco.alterar(order_nsu, {"situacao": "cancelado"}, so_se_situacao=("aguardando_pagamento", "pagamento_divergente")):
        raise ErroPedido("Só pedidos não pagos podem ser cancelados aqui (pago: estorne na InfinitePay).", 409)
    return banco.buscar(order_nsu)


# ───────── Envio pela Loggi ─────────

_trava_envio = threading.Lock()


def _pedido(order_nsu: str) -> dict:
    pedido = banco.buscar(order_nsu)
    if not pedido:
        raise ErroPedido("Pedido não encontrado.", 404)
    return pedido


def criar_envio_loggi(order_nsu: str) -> dict:
    """Cria o pacote na Loggi (uma vez por pedido pago). O código de rastreio passa a aparecer para o cliente."""
    with _trava_envio:  # dois cliques rápidos não criam dois pacotes
        pedido = _pedido(order_nsu)
        if pedido["situacao"] not in ("pago", "enviado"):
            raise ErroPedido("Só pedidos pagos podem ir para a Loggi.", 409)
        if pedido.get("loggi_key"):
            raise ErroPedido("Este pedido já tem envio na Loggi.", 409)
        if not pedido.get("cpf"):
            raise ErroPedido("O pedido não tem CPF: a Loggi exige o CPF de quem recebe.", 409)
        try:
            envio = loggi.criar_envio(pedido)
        except loggi.ErroFrete as erro:
            raise ErroPedido(str(erro), 502)
        banco.alterar(order_nsu, {"loggi_key": envio["loggi_key"], "envio_criado_em": banco.agora(), "envio_erro": None,
                                  "codigo_rastreio": envio["tracking_code"] or pedido.get("codigo_rastreio")})
        log.info("Envio criado na Loggi para o pedido %s.", order_nsu)
        return banco.buscar(order_nsu)


def envio_automatico(order_nsu: str) -> None:
    """Cria o envio logo depois do pagamento. Se a Loggi recusar, guarda o motivo no pedido (o vendedor cria à mão)."""
    try:
        criar_envio_loggi(order_nsu)
    except ErroPedido as erro:
        if erro.status != 409 or "já tem envio" not in erro.mensagem:
            log.warning("Envio automático na Loggi falhou para %s: %s", order_nsu, erro.mensagem)
            banco.alterar(order_nsu, {"envio_erro": erro.mensagem[:500]})
    except Exception:  # noqa: BLE001 - nunca derruba a confirmação do pagamento
        log.exception("Envio automático na Loggi falhou para %s.", order_nsu)
        banco.alterar(order_nsu, {"envio_erro": "Erro inesperado ao falar com a Loggi. Crie o envio à mão."})


def disparar_envio_automatico(order_nsu: str) -> None:
    """Em segundo plano: o webhook e a página do cliente não esperam a Loggi responder."""
    threading.Thread(target=envio_automatico, args=(order_nsu,), daemon=True, name=f"envio-{order_nsu[:8]}").start()


def etiqueta_loggi(order_nsu: str) -> bytes:
    pedido = _pedido(order_nsu)
    if not pedido.get("loggi_key"):
        raise ErroPedido("Crie o envio na Loggi antes de gerar a etiqueta.", 409)
    try:
        return loggi.etiqueta(pedido["loggi_key"])
    except loggi.ErroFrete as erro:
        raise ErroPedido(str(erro), 502)


def cancelar_envio_loggi(order_nsu: str) -> dict:
    pedido = _pedido(order_nsu)
    if not pedido.get("loggi_key"):
        raise ErroPedido("Este pedido não tem envio na Loggi.", 409)
    try:
        aviso = loggi.cancelar_envio(pedido["loggi_key"])
    except loggi.ErroFrete as erro:
        raise ErroPedido(str(erro), 502)
    banco.alterar(order_nsu, {"loggi_key": None, "envio_criado_em": None, "codigo_rastreio": None,
                              "situacao": "pago" if pedido["situacao"] == "enviado" else pedido["situacao"]})
    return {**banco.buscar(order_nsu), "aviso_loggi": aviso}


def rastreio(order_nsu: str) -> dict:
    """O rastreio público do pedido (o order_nsu é o segredo do link do cliente)."""
    pedido = _pedido(order_nsu)
    if not pedido.get("codigo_rastreio") or not pedido.get("loggi_key"):
        return {"codigo": pedido.get("codigo_rastreio"), "rastreio": None}
    try:
        return {"codigo": pedido["codigo_rastreio"], "rastreio": loggi.rastrear(pedido["codigo_rastreio"])}
    except loggi.ErroFrete:
        return {"codigo": pedido["codigo_rastreio"], "rastreio": None}
