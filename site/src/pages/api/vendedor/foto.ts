import * as catalogo from "../../../servidor/catalogo";
import { rota, vendedor } from "../../../servidor/http";

export const PUT = rota(async (ctx) => {
  await vendedor(ctx);
  const dados = new Uint8Array(await ctx.request.arrayBuffer());
  await catalogo.salvarFoto(ctx.request.headers.get("content-type") ?? "", dados);
  return catalogo.resumo();
});

export const DELETE = rota(async (ctx) => {
  await vendedor(ctx);
  await catalogo.apagarFoto();
  return catalogo.resumo();
});