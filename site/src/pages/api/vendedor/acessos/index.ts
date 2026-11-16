// A aba Acessos (só o dono): quem tem acesso ao painel e os convites.
import { convidar, listar } from "../../../../servidor/acesso";
import { corpo, rota, vendedor } from "../../../../servidor/http";
import { comUrl } from "../../../../servidor/links";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  return { acessos: await listar() };
});

export const POST = rota(async (ctx) => {
  const quem = await vendedor(ctx);
  const r = await convidar(quem, await corpo(ctx.request));
  return { acesso: r.acesso, link: comUrl(ctx.request, r.link) };
});
