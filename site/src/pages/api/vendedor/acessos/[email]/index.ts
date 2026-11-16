import { alterar, remover } from "../../../../../servidor/acesso";
import { corpo, rota, vendedor } from "../../../../../servidor/http";

export const PATCH = rota(async (ctx) => {
  const quem = await vendedor(ctx);
  return alterar(quem, ctx.params.email ?? "", await corpo(ctx.request));
});

export const DELETE = rota(async (ctx) => {
  const quem = await vendedor(ctx);
  await remover(quem, ctx.params.email ?? "");
  return { ok: true };
});
