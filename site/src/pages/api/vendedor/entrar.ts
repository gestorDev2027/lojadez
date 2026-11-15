import { entrar } from "../../../servidor/acesso";
import { corpo, limitar, rota, texto } from "../../../servidor/http";

export const POST = rota(async (ctx) => {
  limitar(ctx, "entrar", 10);
  const dados = await corpo(ctx.request);
  return entrar(texto(dados.email), texto(dados.senha));
});
