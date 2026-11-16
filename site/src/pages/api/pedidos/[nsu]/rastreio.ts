// O rastreio público do pedido na Loggi.
import { limitar, rota } from "../../../../servidor/http";
import { nsu, rastreio } from "../../../../servidor/pedidos";

export const GET = rota(async (ctx) => {
  limitar(ctx, "rastreio", 20);
  return rastreio(nsu(ctx.params.nsu));
});
