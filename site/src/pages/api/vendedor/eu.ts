// Quem está logado e o que pode (a tela mostra só as abas liberadas; quem confere de verdade é cada rota).
import { PAPEIS, PERMISSOES, publico } from "../../../servidor/acesso";
import { acessoAtual, rota } from "../../../servidor/http";

export const GET = rota(async (ctx) => ({
  ...publico(await acessoAtual(ctx)),
  papeis: Object.fromEntries(Object.entries(PAPEIS).map(([id, p]) => [id, { rotulo: p.rotulo, permissoes: p.permissoes }])),
  todas_permissoes: PERMISSOES,
}));
