// Tira o app autenticador da pessoa (perdeu o celular): no próximo login, ela cadastra outro.
import { zerarApp } from "../../../../../servidor/acesso";
import { rota, vendedor } from "../../../../../servidor/http";

export const DELETE = rota(async (ctx) => {
  const quem = await vendedor(ctx);
  await zerarApp(quem, ctx.params.email ?? "");
  return { ok: true };
});
