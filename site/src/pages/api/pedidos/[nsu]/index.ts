// O pedido para o comprador (o order_nsu é o segredo do link dele).
import { rota } from "../../../../servidor/http";
import { buscar, ErroPedido, nsu, publico } from "../../../../servidor/pedidos";

export const GET = rota(async (ctx) => {
  const pedido = await buscar(nsu(ctx.params.nsu));
  if (!pedido) throw new ErroPedido("Pedido não encontrado.", 404);
  return publico(pedido);
});
