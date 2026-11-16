// A tarefa agendada da loja (Netlify Scheduled Function, a cada 15 minutos, em UTC):
// - confere de novo os pedidos esperando pagamento que já têm os dados da InfinitePay (o webhook ou a volta do cliente
//   chegaram, mas a conferência falhou na hora);
// - libera as reservas de estoque dos pedidos que não foram pagos no prazo.
// O DATABASE_URL vem das variáveis da Netlify (o mesmo das páginas).
import type { Config } from "@netlify/functions";
import { conferirPendentes } from "../../src/servidor/pedidos";

export default async () => {
  const r = await conferirPendentes();
  await Promise.allSettled(r.envios); // o envio automático dos que acabaram de ser pagos
  console.info(`Tarefas: ${r.conferidos} conferidos, ${r.pagos} pagos, ${r.liberados} reservas liberadas.`);
};

export const config: Config = { schedule: "*/15 * * * *" };
