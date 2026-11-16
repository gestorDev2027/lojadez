// O histórico de um item (GET) e um lançamento do vendedor (POST): entrada, ajuste, perda, devolução ou inventário.
import { historico, lancar } from "../../../../../servidor/estoque";
import { corpo, rota, vendedor } from "../../../../../servidor/http";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  return historico(ctx.params.produto ?? "");
});

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  return lancar(ctx.params.produto ?? "", await corpo(ctx.request), email);
});
