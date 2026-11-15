// Configurações: o que antes ficava no .env, editável na tela. Salvar pede a senha de novo (são as chaves de pagamento).
import { estado, salvar } from "../../../../servidor/configuracoes";
import { confirmarSenha, corpo, rota, vendedor } from "../../../../servidor/http";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  return estado();
});

export const PUT = rota(async (ctx) => {
  const email = await vendedor(ctx);
  const dados = await corpo(ctx.request);
  await confirmarSenha(ctx, email, dados);
  return salvar(dados.valores ?? {}, dados.apagar_segredos ?? [], email);
});
