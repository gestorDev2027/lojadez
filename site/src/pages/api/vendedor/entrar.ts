// Entrar no painel: e-mail e senha e o código do app autenticador (servidor/acesso.ts, entrar). Pronto, a sessão vai
// num cookie que o JavaScript da página não lê.
import { entrar } from "../../../servidor/acesso";
import { cookieDaSessao, corpo, json, limitar, rota, texto } from "../../../servidor/http";

export const POST = rota(async (ctx) => {
  limitar(ctx, "entrar", 10);
  const dados = await corpo(ctx.request);
  const r = await entrar(texto(dados.email), texto(dados.senha), texto(dados.codigo), texto(dados.fator_id));
  if (r.etapa !== "pronto") return r;
  return json({ etapa: "pronto", acesso: r.acesso }, 200, { "Set-Cookie": cookieDaSessao(ctx.request, r.token, r.expira_em) });
});
