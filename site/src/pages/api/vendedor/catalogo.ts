// Produto e preços do kit de lâminas: o que muda aqui vale na hora na landing page e no checkout.
import * as catalogo from "../../../servidor/catalogo";
import { corpo, rota, vendedor } from "../../../servidor/http";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  return catalogo.resumo();
});

export const PUT = rota(async (ctx) => {
  await vendedor(ctx);
  return catalogo.salvar(await corpo(ctx.request));
});