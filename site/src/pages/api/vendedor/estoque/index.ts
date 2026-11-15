// A aba Estoque: os itens (kit e produtos) com saldo físico, reservado, disponível, mínimo e custo médio.
import { painel } from "../../../../servidor/estoque";
import { rota, vendedor } from "../../../../servidor/http";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  return painel();
});
