// Marca o pedido pago como enviado (com o código de rastreio digitado ou o da Loggi).
import { corpo, rota, vendedor } from "../../../../../servidor/http";
import { marcarEnviado, nsu, paraTela } from "../../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  const d = await corpo(ctx.request);
  return paraTela(await marcarEnviado(nsu(ctx.params.nsu), d.codigo_rastreio, email));
});
