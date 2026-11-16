// Cancela um pedido não pago: a reserva do estoque volta para a vitrine.
import { registrar } from "../../../../../servidor/banco";
import { rota, vendedor } from "../../../../../servidor/http";
import { cancelar, nsu, paraTela } from "../../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  const pedido = await cancelar(nsu(ctx.params.nsu));
  await registrar(email, "pedido", `Cancelado: ${pedido.order_nsu.slice(0, 8)}`);
  return paraTela(pedido);
});
