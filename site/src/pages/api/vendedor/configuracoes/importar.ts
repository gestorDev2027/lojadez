import { importarDoAmbiente } from "../../../../servidor/configuracoes";
import { confirmarSenha, corpo, rota, vendedor } from "../../../../servidor/http";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  await confirmarSenha(ctx, email, await corpo(ctx.request));
  return importarDoAmbiente(email);
});
