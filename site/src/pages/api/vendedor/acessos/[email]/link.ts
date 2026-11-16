// Um link novo de convite (quem ainda não criou a senha) ou de troca de senha, para o dono mandar à pessoa.
import { novoLink } from "../../../../../servidor/acesso";
import { rota, vendedor } from "../../../../../servidor/http";
import { comUrl } from "../../../../../servidor/links";

export const POST = rota(async (ctx) => {
  const quem = await vendedor(ctx);
  return { link: comUrl(ctx.request, await novoLink(quem, ctx.params.email ?? "")) };
});
