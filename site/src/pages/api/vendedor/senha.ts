import { trocarSenha } from "../../../servidor/acesso";
import { corpo, limitar, rota, texto, vendedor } from "../../../servidor/http";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  limitar(ctx, "senha", 10);
  const dados = await corpo(ctx.request);
  await trocarSenha(email, texto(dados.atual), texto(dados.nova));
  return { ok: true }; // as sessões foram fechadas: a tela pede para entrar de novo
});
