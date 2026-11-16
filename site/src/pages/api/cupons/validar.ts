// A prévia do cupom no checkout: o desconto ou o frete grátis (o pedido confere de novo).
import { corpo, limitar, rota } from "../../../servidor/http";
import { validarCupom } from "../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  limitar(ctx, "cupom", 20);
  const d = await corpo(ctx.request);
  return validarCupom(d.cupom, d.oferta, d.produto);
});
