// Liga ou desliga o controle do saldo e muda o estoque mínimo de um item.
import { configurar } from "../../../../../servidor/estoque";
import { corpo, rota, vendedor } from "../../../../../servidor/http";

export const PUT = rota(async (ctx) => {
  const email = await vendedor(ctx);
  return configurar(ctx.params.produto ?? "", await corpo(ctx.request), email);
});
