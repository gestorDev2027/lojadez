// Os pedidos para a área do vendedor (com a situação, se vier: ?situacao=pago).
import { rota, vendedor } from "../../../../servidor/http";
import { listar, paraTela } from "../../../../servidor/pedidos";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  const situacao = new URL(ctx.request.url).searchParams.get("situacao") || null;
  return (await listar(situacao)).map(paraTela);
});
