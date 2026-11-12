"""Uma InfinitePay de mentira, só para o desenvolvimento (INFINITEPAY_AMBIENTE=simulado).

O link do pedido abre uma página da própria loja com "Pagar com Pix", "Pagar com cartão" e "Desistir". Pagar faz o
mesmo que a InfinitePay faria: registra o pagamento, avisa o webhook e manda o cliente para o redirect_url com os
parâmetros. Os pagamentos ficam só na memória (somem ao reiniciar o servidor).
"""

import html
import uuid
from urllib.parse import urlencode

from servidor import banco, config

_pagamentos: dict[str, dict] = {}


def criar_link(pedido: dict) -> str:
    return f"{config.SITE_URL}/simulador/pagamento/{pedido['order_nsu']}"


def pagar(order_nsu: str, forma: str) -> dict:
    pedido = banco.buscar(order_nsu)
    if not pedido:
        raise KeyError(order_nsu)
    juros = 0 if forma == "pix" else round(pedido["total_centavos"] * 0.0099)
    # No Pix com desconto, a InfinitePay cobra o total com o desconto.
    pago = round(pedido["total_centavos"] * (1 - (pedido.get("desconto_pix") or 0) / 100)) if forma == "pix" else None
    pagamento = {"order_nsu": order_nsu, "transaction_nsu": str(uuid.uuid4()), "slug": uuid.uuid4().hex[:10],
                 "amount": pago or pedido["total_centavos"], "paid_amount": pago or pedido["total_centavos"] + juros,
                 "installments": 1,
                 "capture_method": "pix" if forma == "pix" else "credit_card",
                 "receipt_url": f"{config.SITE_URL}/simulador/comprovante/{order_nsu}"}
    _pagamentos[order_nsu] = pagamento
    return pagamento


def conferir(order_nsu: str, transaction_nsu: str, slug: str) -> dict:
    p = _pagamentos.get(order_nsu)
    if not p or p["transaction_nsu"] != transaction_nsu or p["slug"] != slug:
        return {"success": True, "paid": False}
    return {"success": True, "paid": True, **{k: p[k] for k in ("amount", "paid_amount", "installments", "capture_method")}}


def aviso_webhook(pagamento: dict) -> dict:
    """O corpo que a InfinitePay manda no webhook."""
    return {"invoice_slug": pagamento["slug"], "amount": pagamento["amount"], "paid_amount": pagamento["paid_amount"],
            "installments": pagamento["installments"], "capture_method": pagamento["capture_method"],
            "transaction_nsu": pagamento["transaction_nsu"], "order_nsu": pagamento["order_nsu"],
            "receipt_url": pagamento["receipt_url"], "items": []}


def url_de_volta(pagamento: dict) -> str:
    parametros = {"receipt_url": pagamento["receipt_url"], "order_nsu": pagamento["order_nsu"], "slug": pagamento["slug"],
                  "capture_method": pagamento["capture_method"], "transaction_nsu": pagamento["transaction_nsu"]}
    return f"{config.SITE_URL}/obrigado?{urlencode(parametros)}"


def _reais(centavos: int) -> str:
    return f"R$ {centavos / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pagina(order_nsu: str) -> str:
    pedido = banco.buscar(order_nsu)
    if not pedido:
        return "<p>Pedido não encontrado.</p>"
    e = html.escape
    pago = pedido["situacao"] != "aguardando_pagamento"
    desconto = pedido.get("desconto_pix") or 0
    pix = f" · {_reais(round(pedido['total_centavos'] * (1 - desconto / 100)))} ({desconto:g}% off)" if desconto else ""
    botoes = "<p class='aviso'>Este pedido já foi pago ou cancelado.</p>" if pago else f"""
      <form method="post" action="/simulador/pagar/{e(order_nsu)}"><input type="hidden" name="forma" value="pix">
        <button class="pix">Pagar com Pix{pix}</button></form>
      <form method="post" action="/simulador/pagar/{e(order_nsu)}"><input type="hidden" name="forma" value="cartao">
        <button>Pagar com cartão</button></form>
      <a href="/">Desistir e voltar à loja</a>"""
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Pagamento simulado</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #f4f4f5; color: #18181b; margin: 0; padding: 24px 16px; }}
  main {{ max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px #0002; }}
  .faixa {{ background: #fef3c7; color: #92400e; border-radius: 8px; padding: 8px 12px; font-size: 14px; margin-bottom: 16px; }}
  .total {{ font-size: 28px; font-weight: 700; margin: 4px 0 20px; }}
  button {{ width: 100%; padding: 14px; border-radius: 10px; border: 1px solid #d4d4d8; background: #fff; font-size: 16px;
           margin-bottom: 10px; cursor: pointer; }}
  button.pix {{ background: #16a34a; color: #fff; border: 0; }}
  a {{ display: block; text-align: center; color: #52525b; margin-top: 8px; }}
  .aviso {{ color: #52525b; }}
</style></head><body><main>
  <div class="faixa">Ambiente de testes: nenhum dinheiro é cobrado.</div>
  <div>Pedido de {e(pedido['nome'].split()[0])} na {e(config.LOJA_NOME)}</div>
  <div class="total">{_reais(pedido['total_centavos'])}</div>
  {botoes}
</main></body></html>"""
