import { corpo, rota, vendedor } from "../../../../../servidor/http";
import { excluir, paraVendedor, salvar } from "../../../../../servidor/produtos";

export const PUT = rota(async (ctx) => {
  const email = await vendedor(ctx);
  return paraVendedor(await salvar(await corpo(ctx.request), ctx.params.slug ?? "", email));
});

export const DELETE = rota(async (ctx) => {
  const email = await vendedor(ctx);
  await excluir(ctx.params.slug ?? "", email);
  return { ok: true };
});