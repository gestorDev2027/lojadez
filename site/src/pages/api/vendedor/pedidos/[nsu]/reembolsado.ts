// O estorno foi feito na InfinitePay: o pedido vira "reembolsado" (e, se o produto voltou, entra no estoque).
import { corpo, rota, vendedor } from "../../../../../servidor/http";
import { confirmarReembolso, nsu, paraTela } from "../../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  return paraTela(await confirmarReembolso(nsu(ctx.params.nsu), await corpo(ctx.request), email));
});
