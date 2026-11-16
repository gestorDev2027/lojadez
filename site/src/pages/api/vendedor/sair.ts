import { sair } from "../../../servidor/acesso";
import { cookieDaSessao, json, rota, token } from "../../../servidor/http";

export const POST = rota(async (ctx) => {
  await sair(token(ctx.request));
  return json({ ok: true }, 200, { "Set-Cookie": cookieDaSessao(ctx.request, "", null) });
});
