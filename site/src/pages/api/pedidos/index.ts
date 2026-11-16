// Cria o pedido (preço e frete recalculados aqui, estoque reservado) e devolve o link de pagamento da InfinitePay.
import { corpo, limitar, rota } from "../../../servidor/http";
import { criar } from "../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  limitar(ctx, "pedido", 6);
  return criar(await corpo(ctx.request));
});
