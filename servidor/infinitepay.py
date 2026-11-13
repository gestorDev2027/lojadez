"""Pagamento pela InfinitePay (Checkout Integrado).

- POST /links: cria o link de pagamento do pedido (items em centavos, order_nsu, redirect_url, webhook_url, cliente).
- POST /payment_check: confere se o pedido foi pago. O webhook da InfinitePay não é assinado: o servidor SEMPRE
  confere aqui antes de dar o pedido como pago.

No ambiente "simulado" o link abre uma página de pagamento falsa da própria loja (servidor/simulador.py).
"""

import logging
from datetime import timedelta

import httpx

from servidor import banco, config, simulador


log = logging.getLogger("loja.infinitepay")


def _motivo(r: httpx.Response) -> str:
    """A mensagem de erro da InfinitePay (para o terminal e a área do vendedor; nunca leva a chave)."""
    try:
        dados = r.json()
        texto = str(dados.get("message") or dados.get("error") or dados) if isinstance(dados, dict) else str(dados)
    except ValueError:
        texto = r.text
    return texto.replace(config.INFINITEPAY_API_KEY or chr(0), "***")[:300]


class ErroPagamento(Exception):
    """Erro com mensagem que pode ir para o cliente."""


def _cabecalhos() -> dict:
    cabecalhos = {"Content-Type": "application/json"}
    if config.INFINITEPAY_API_KEY:
        cabecalhos["X-Api-Key"] = config.INFINITEPAY_API_KEY
    return cabecalhos


def _somente_digitos(texto: str) -> str:
    return "".join(c for c in texto or "" if c.isdigit())


def _telefone(telefone: str) -> str:
    digitos = _somente_digitos(telefone)
    return "+" + (digitos if digitos.startswith("55") and len(digitos) >= 12 else "55" + digitos)


def montar_corpo(pedido: dict) -> dict:
    corpo = {
        "items": [{"quantity": 1, "price": pedido["preco_centavos"], "description": pedido["produto"]}]
        + ([{"quantity": 1, "price": pedido["frete_centavos"], "description": pedido["frete_descricao"]}]
           if pedido["frete_centavos"] > 0 else []),  # frete grátis: a loja paga a Loggi, o comprador não vê a linha
        "order_nsu": pedido["order_nsu"],
        "redirect_url": f"{config.SITE_URL}/obrigado",
        "customer": {"name": pedido["nome"], "email": pedido["email"], "phone_number": _telefone(pedido["telefone"])},
        "address": {"cep": pedido["cep"], "street": pedido["rua"], "neighborhood": pedido["bairro"],
                    "number": pedido["numero"], "complement": pedido.get("complemento") or ""},
    }
    if config.INFINITEPAY_HANDLE:
        corpo["handle"] = config.INFINITEPAY_HANDLE
    # A InfinitePay só aceita webhook num endereço público com https.
    if config.SITE_URL.startswith("https://"):
        corpo["webhook_url"] = f"{config.SITE_URL}/api/webhooks/infinitepay"
    if config.INFINITEPAY_API_KEY:
        validade = banco.agora() + timedelta(hours=config.INFINITEPAY_VALIDADE_HORAS)
        corpo["options"] = {"single_payment": True, "payment_methods_enabled": ["credit_card", "pix"],
                            "valid_until": validade.strftime("%Y-%m-%dT%H:%M:%S.000Z")}
        if pedido.get("desconto_pix"):  # a InfinitePay mostra e aplica o desconto quando o cliente escolhe Pix
            corpo["options"]["discounts"] = {"pix": pedido["desconto_pix"]}
    return corpo


def criar_link(pedido: dict) -> str:
    if config.INFINITEPAY_AMBIENTE == "simulado":
        return simulador.criar_link(pedido)
    try:
        r = httpx.post(f"{config.INFINITEPAY_URL}/links", json=montar_corpo(pedido), headers=_cabecalhos(), timeout=20)
    except httpx.HTTPError:
        raise ErroPagamento("A InfinitePay não respondeu. Tente de novo em instantes.")
    if r.status_code >= 400:
        log.warning("InfinitePay recusou o link (erro %s): %s", r.status_code, _motivo(r))
        raise ErroPagamento(f"A InfinitePay recusou o pedido (erro {r.status_code}).")
    dados = r.json()
    link = next((dados[k] for k in ("url", "link", "checkout_url", "payment_url") if isinstance(dados.get(k), str)), None)
    if not link:
        raise ErroPagamento(f"A InfinitePay respondeu sem o link (campos: {', '.join(sorted(dados))[:200]}).")
    return link


def conferir_pagamento(order_nsu: str, transaction_nsu: str, slug: str) -> dict:
    """{"paid": bool, "amount": centavos, "paid_amount": centavos, "installments": n, "capture_method": "pix"|...}"""
    if config.INFINITEPAY_AMBIENTE == "simulado":
        return simulador.conferir(order_nsu, transaction_nsu, slug)
    corpo = {"handle": config.INFINITEPAY_HANDLE, "order_nsu": order_nsu, "transaction_nsu": transaction_nsu, "slug": slug}
    try:
        r = httpx.post(f"{config.INFINITEPAY_URL}/payment_check", json=corpo, headers=_cabecalhos(), timeout=15)
    except httpx.HTTPError:
        raise ErroPagamento("A InfinitePay não respondeu.")
    if r.status_code >= 400:
        log.warning("InfinitePay não confirmou o pagamento (erro %s): %s", r.status_code, _motivo(r))
        raise ErroPagamento(f"A InfinitePay não confirmou o pagamento (erro {r.status_code}).")
    return r.json()
