// A roleta da página de obrigado: o cupom da próxima compra (um por pedido pago, preso ao CPF). O order_nsu é o segredo
// do link do cliente, como nas outras rotas do pedido.
import { limitar, rota } from "../../../../servidor/http";
import { nsu } from "../../../../servidor/pedidos";
import { girarDoPedido, premioDoPedido } from "../../../../servidor/roleta";

export const GET = rota(async (ctx) => premioDoPedido(nsu(ctx.params.nsu)));

export const POST = rota(async (ctx) => {
  limitar(ctx, "roleta-pedido", 10);
  return girarDoPedido(nsu(ctx.params.nsu));
});
