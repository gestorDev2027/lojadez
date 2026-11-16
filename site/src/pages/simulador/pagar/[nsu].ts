// "Pagar" no simulador: faz o que a InfinitePay faria (avisa o webhook) e volta para /obrigado com os parâmetros.
import type { APIRoute } from "astro";
import { cfg } from "../../../servidor/config";
import { depois } from "../../../servidor/http";
import { buscar, ErroPedido, nsu, processarWebhook } from "../../../servidor/pedidos";
import { avisoWebhook, pagar, urlDeVolta } from "../../../servidor/simulador";

const ir = (destino: string) => new Response(null, { status: 303, headers: { Location: destino, "Cache-Control": "no-store" } });

export const POST: APIRoute = async (ctx) => {
  const c = await cfg();
  if (c.INFINITEPAY_AMBIENTE !== "simulado") return new Response("Não encontrado.", { status: 404 });
  let orderNsu: string;
  try {
    orderNsu = nsu(ctx.params.nsu);
  } catch (erro) {
    if (erro instanceof ErroPedido) return new Response("Não encontrado.", { status: 404 });
    throw erro;
  }
  const forma = (await ctx.request.formData().catch(() => null))?.get("forma") === "cartao" ? "cartao" : "pix";
  const pedido = await buscar(orderNsu);
  if (!pedido || pedido.situacao !== "aguardando_pagamento") return ir(`/simulador/pagamento/${orderNsu}`);
  const pagamento = await pagar(c, orderNsu, forma);
  if (!pagamento) return ir(`/simulador/pagamento/${orderNsu}`);
  const r = await processarWebhook(avisoWebhook(pagamento)); // o que o webhook faria
  await depois(ctx, r.envio);
  return ir(urlDeVolta(c, pagamento));
};
