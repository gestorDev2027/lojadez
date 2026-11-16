// O link de convite ou de troca de senha (o dono gera na aba Acessos): a pessoa cria a senha nova. Sem login.
import { usarLink } from "../../../servidor/acesso";
import { corpo, limitar, rota, texto } from "../../../servidor/http";
import type { TipoLink } from "../../../servidor/identidade";

export const POST = rota(async (ctx) => {
  limitar(ctx, "link", 10);
  const dados = await corpo(ctx.request);
  return usarLink(texto(dados.token_hash), texto(dados.tipo) as TipoLink, texto(dados.senha));
});
