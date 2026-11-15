import { ErroHttp, rota, vendedor } from "../../../../../servidor/http";
import { apagarFoto, buscar, paraVendedor, salvarFoto } from "../../../../../servidor/produtos";

export const PUT = rota(async (ctx) => {
  await vendedor(ctx);
  const slug = ctx.params.slug ?? "";
  await salvarFoto(slug, ctx.request.headers.get("content-type") ?? "", new Uint8Array(await ctx.request.arrayBuffer()));
  return paraVendedor((await buscar(slug))!);
});

export const DELETE = rota(async (ctx) => {
  await vendedor(ctx);
  const slug = ctx.params.slug ?? "";
  const produto = await buscar(slug);
  if (!produto) throw new ErroHttp("Produto não encontrado.", 404);
  await apagarFoto(slug);
  return paraVendedor(produto);
});