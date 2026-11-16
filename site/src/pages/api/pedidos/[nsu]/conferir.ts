// A volta do cliente da InfinitePay (página /obrigado): confere o pagamento com os dados que vieram na URL.
import { corpo, depois, limitar, rota, texto } from "../../../../servidor/http";
import { conferir, nsu, publico } from "../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  limitar(ctx, "conferir", 20);
  const d = await corpo(ctx.request);
  const r = await conferir(nsu(ctx.params.nsu), texto(d.transaction_nsu), texto(d.slug), d.receipt_url);
  await depois(ctx, r.envio);
  return publico(r.pedido);
});
