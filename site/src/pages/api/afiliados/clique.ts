// Conta uma visita pelo link de um afiliado (só a contagem do dia: nada do visitante).
import { DIAS_ATRIBUICAO, registrarClique } from "../../../servidor/afiliados";
import { corpo, limitar, rota, texto } from "../../../servidor/http";

export const POST = rota(async (ctx) => {
  limitar(ctx, "clique", 30);
  const d = await corpo(ctx.request);
  return { ok: await registrarClique(texto(d.ref).slice(0, 40)), dias: DIAS_ATRIBUICAO };
});
