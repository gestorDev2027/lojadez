// Na Netlify não há tela de primeiro acesso: o acesso vem de LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA (ver servidor/acesso.ts).
import { ErroHttp, json, rota } from "../../../servidor/http";

export const GET = rota(async () => json({ disponivel: false }));

export const POST = rota(async () => {
  throw new ErroHttp("Entre com o e-mail e a senha definidos em LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA.", 409);
});
