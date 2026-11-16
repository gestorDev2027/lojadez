// Cancela um pedido pago: o estorno é feito na InfinitePay; a loja guarda o motivo e cancela o envio na Loggi.
import { corpo, rota, vendedor } from "../../../../../servidor/http";
import { nsu, paraTela, pedirReembolso } from "../../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  const { aviso_loggi, voltou_ao_estoque, ...pedido } = await pedirReembolso(nsu(ctx.params.nsu), await corpo(ctx.request), email);
  return { ...paraTela(pedido as any), aviso_loggi, voltou_ao_estoque };
});
