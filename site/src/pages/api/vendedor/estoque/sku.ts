// O SKU sugerido para um produto novo (GET ?nome=&categoria=) e a geração dos que faltam (POST).
import { gerarSkusQueFaltam, sugerirSku } from "../../../../servidor/estoque";
import { rota, vendedor } from "../../../../servidor/http";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  const q = new URL(ctx.request.url).searchParams;
  return { sku: await sugerirSku(q.get("nome") ?? "", q.get("categoria")) };
});

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  return { gerados: await gerarSkusQueFaltam(email) };
});
