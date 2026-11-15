// Produtos do catálogo (além do kit de lâminas, que fica em Produto e preços).
import { corpo, rota, vendedor } from "../../../../servidor/http";
import { listar, paraVendedor, salvar } from "../../../../servidor/produtos";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  return Promise.all((await listar(false)).map(paraVendedor));
});

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  return paraVendedor(await salvar(await corpo(ctx.request), null, email));
});