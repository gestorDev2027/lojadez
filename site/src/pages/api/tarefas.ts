// As tarefas a cada 15 minutos, chamadas pelo próprio servidor (servidor.mjs), com a chave que ele sorteia ao ligar:
// - confere de novo os pedidos esperando pagamento que já têm os dados da InfinitePay (o webhook ou a volta do cliente
//   chegaram, mas a conferência falhou na hora) e faz o envio automático dos que acabaram de ser pagos;
// - libera as reservas de estoque dos pedidos que não foram pagos no prazo.
// Sem a chave (no computador, com `npm run dev`), a rota não existe.
import { timingSafeEqual } from "node:crypto";
import { amb } from "../../servidor/ambiente";
import { ErroHttp, rota } from "../../servidor/http";
import { conferirPendentes } from "../../servidor/pedidos";

function chaveCerta(recebida: string): boolean {
  const chave = amb("TAREFAS_CHAVE");
  if (!chave) return false;
  const a = Buffer.from(recebida);
  const b = Buffer.from(chave);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST = rota(async (ctx) => {
  if (!chaveCerta(ctx.request.headers.get("x-tarefas-chave") ?? "")) throw new ErroHttp("Não encontrado.", 404);
  const r = await conferirPendentes();
  await Promise.allSettled(r.envios);
  return { conferidos: r.conferidos, pagos: r.pagos, liberados: r.liberados };
});
