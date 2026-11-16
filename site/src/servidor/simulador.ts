// Uma InfinitePay de mentira, só para o desenvolvimento (INFINITEPAY_AMBIENTE=simulado). Nenhum dinheiro é cobrado.
//
// O link do pedido abre uma página da própria loja com "Pagar com Pix", "Pagar com cartão" e "Desistir". Pagar faz o
// mesmo que a InfinitePay faria: avisa o webhook e manda o cliente para o redirect_url com os parâmetros.
//
// Nada fica na memória (o servidor reinicia a cada publicação): o "slug" do pagamento leva a forma e uma
// assinatura do pedido (sim-pix-<hash>), e a conferência refaz a conta a partir do pedido no banco.
import { createHash, randomUUID } from "node:crypto";
import { uma } from "./banco";
import type { Config } from "./config";
import type { Conferencia } from "./infinitepay";

export type Forma = "pix" | "cartao";

export type Pagamento = {
  order_nsu: string;
  transaction_nsu: string;
  slug: string;
  amount: number;
  paid_amount: number;
  installments: number;
  capture_method: "pix" | "credit_card";
  receipt_url: string;
};

type PedidoSimulado = { order_nsu: string; situacao: string; nome: string; total_centavos: number; desconto_pix: number | null };

const buscar = (orderNsu: string) =>
  uma<PedidoSimulado>("select order_nsu, situacao, nome, total_centavos, desconto_pix from loja.pedidos where order_nsu = $1", [orderNsu]);

const assinatura = (orderNsu: string, transactionNsu: string, forma: Forma) =>
  createHash("sha256").update(`simulador|${orderNsu}|${transactionNsu}|${forma}`).digest("hex").slice(0, 10);

export const criarLink = (c: Config, orderNsu: string) => `${c.SITE_URL}/simulador/pagamento/${orderNsu}`;

/** Os valores que a InfinitePay cobraria: no Pix com desconto, o total com o desconto; no cartão, 0,99% de juros. */
function valores(p: PedidoSimulado, forma: Forma) {
  if (forma === "pix") {
    const pago = Math.round(p.total_centavos * (1 - (p.desconto_pix ?? 0) / 100));
    return { amount: pago, paid_amount: pago, capture_method: "pix" as const };
  }
  return { amount: p.total_centavos, paid_amount: p.total_centavos + Math.round(p.total_centavos * 0.0099), capture_method: "credit_card" as const };
}

export async function pagar(c: Config, orderNsu: string, forma: Forma): Promise<Pagamento | null> {
  const p = await buscar(orderNsu);
  if (!p) return null;
  const transaction_nsu = randomUUID();
  return {
    order_nsu: orderNsu,
    transaction_nsu,
    slug: `sim-${forma}-${assinatura(orderNsu, transaction_nsu, forma)}`,
    installments: 1,
    receipt_url: `${c.SITE_URL}/simulador/comprovante/${orderNsu}`,
    ...valores(p, forma),
  };
}

export async function conferir(orderNsu: string, transactionNsu: string, slug: string): Promise<Conferencia> {
  const [, forma, hash] = /^sim-(pix|cartao)-([0-9a-f]{10})$/.exec(slug ?? "") ?? [];
  const p = forma ? await buscar(orderNsu) : null;
  if (!p || hash !== assinatura(orderNsu, transactionNsu, forma as Forma)) return { paid: false };
  return { paid: true, installments: 1, ...valores(p, forma as Forma) };
}

/** O corpo que a InfinitePay manda no webhook. */
export function avisoWebhook(p: Pagamento) {
  return {
    invoice_slug: p.slug, amount: p.amount, paid_amount: p.paid_amount, installments: p.installments,
    capture_method: p.capture_method, transaction_nsu: p.transaction_nsu, order_nsu: p.order_nsu, receipt_url: p.receipt_url, items: [],
  };
}

export function urlDeVolta(c: Config, p: Pagamento): string {
  const q = new URLSearchParams({
    receipt_url: p.receipt_url, order_nsu: p.order_nsu, slug: p.slug, capture_method: p.capture_method, transaction_nsu: p.transaction_nsu,
  });
  return `${c.SITE_URL}/obrigado?${q}`;
}

const esc = (t: string) => String(t ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const reais = (centavos: number) =>
  "R$ " + (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ESTILO = `
  body { font-family: system-ui, sans-serif; background: #0b0b0c; color: #f4f4f5; margin: 0; padding: 24px 16px; }
  main { max-width: 420px; margin: 0 auto; background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 24px; }
  .faixa { background: #422006; color: #fed7aa; border-radius: 8px; padding: 8px 12px; font-size: 14px; margin-bottom: 16px; }
  .total { font-size: 28px; font-weight: 700; margin: 4px 0 20px; }
  button { width: 100%; padding: 14px; border-radius: 10px; border: 1px solid #3f3f46; background: #27272a; color: #f4f4f5;
           font-size: 16px; margin-bottom: 10px; cursor: pointer; }
  button.pix { background: #FF5A00; color: #fff; border: 0; font-weight: 600; }
  a { display: block; text-align: center; color: #A9B8C8; margin-top: 8px; }
  .aviso { color: #A9B8C8; }`;

function documento(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titulo)}</title><style>${ESTILO}</style></head><body><main>
  <div class="faixa">Ambiente de testes: nenhum dinheiro é cobrado.</div>
  ${corpo}
</main></body></html>`;
}

export async function pagina(c: Config, orderNsu: string): Promise<string | null> {
  const p = await buscar(orderNsu);
  if (!p) return null;
  const desconto = p.desconto_pix ?? 0;
  const pix = desconto ? ` · ${reais(Math.round(p.total_centavos * (1 - desconto / 100)))} (${String(desconto).replace(".", ",")}% off)` : "";
  const acao = `/simulador/pagar/${esc(orderNsu)}`;
  const botoes =
    p.situacao !== "aguardando_pagamento"
      ? "<p class='aviso'>Este pedido já foi pago ou cancelado.</p><a href='/'>Voltar à loja</a>"
      : `<form method="post" action="${acao}"><input type="hidden" name="forma" value="pix"><button class="pix">Pagar com Pix${esc(pix)}</button></form>
  <form method="post" action="${acao}"><input type="hidden" name="forma" value="cartao"><button>Pagar com cartão</button></form>
  <a href="/">Desistir e voltar à loja</a>`;
  return documento(
    "Pagamento simulado",
    `<div>Pedido de ${esc(p.nome.split(" ")[0])} na ${esc(c.LOJA_NOME)}</div>
  <div class="total">${reais(p.total_centavos)}</div>
  ${botoes}`,
  );
}

export async function comprovante(orderNsu: string): Promise<string | null> {
  const p = await uma<{ order_nsu: string; valor_pago_centavos: number | null; total_centavos: number; forma_pagamento: string | null; pago_em: Date | null }>(
    "select order_nsu, valor_pago_centavos, total_centavos, forma_pagamento, pago_em from loja.pedidos where order_nsu = $1",
    [orderNsu],
  );
  if (!p?.pago_em) return null;
  return documento(
    "Comprovante simulado",
    `<h1 style="font-size:20px">Comprovante (simulado)</h1>
  <p>Pedido ${esc(p.order_nsu)}</p><p>Valor: ${reais(p.valor_pago_centavos ?? p.total_centavos)}</p>
  <p>Forma: ${esc(p.forma_pagamento ?? "")}</p><a href="/">Voltar à loja</a>`,
  );
}
