import { sair } from "../../../servidor/acesso";
import { rota, token } from "../../../servidor/http";

export const POST = rota(async (ctx) => {
  await sair(token(ctx.request));
  return { ok: true };
});
