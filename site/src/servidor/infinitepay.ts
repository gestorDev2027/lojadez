// Pagamento pela InfinitePay (Checkout Integrado).
//
// - POST /links: cria o link de pagamento do pedido (itens em centavos, order_nsu, redirect_url, webhook_url, cliente).
// - POST /payment_check: confere se o pedido foi pago. O webhook da InfinitePay não é assinado: o servidor SEMPRE
//   confere aqui antes de dar o pedido como pago.
//
// No ambiente "simulado" o link abre uma página de pagamento falsa da própria loja (servidor/simulador.ts).
import { cfg, INFINITEPAY_URL, type Config } from "./config";
import { ErroLoja } from "./erros";
import * as simulador from "./simulador";

/** Erro com mensagem que pode ir para o cliente. */
export class ErroPagamento extends ErroLoja {}

export type PedidoPagamento = {
  order_nsu: string;
  produto: string;
  preco_centavos: number;
  desconto_cupom_centavos: number | null;
  cupom_codigo: string | null;
  frete_centavos: number;
  frete_descricao: string;
  total_centavos: number;
  desconto_pix: number | null;
  nome: string;
  email: string | null;
  telefone: string;
  cep: string;
  rua: string;
  bairro: string;
  numero: string;
  complemento: string | null;
  cidade: string | null;
  uf: string | null;
};

export type Conferencia = {
  paid: boolean;
  amount?: number;
  paid_amount?: number;
  installments?: number;
  capture_method?: string;
};

const digitos = (texto: string) => String(texto ?? "").replace(/\D/g, "");

export function telefone(numero: string): string {
  const d = digitos(numero);
  return "+" + (d.startsWith("55") && d.length >= 12 ? d : "55" + d);
}

/** A mensagem de erro da InfinitePay (para o log; nunca leva a chave). */
async function motivo(r: Response, c: Config): Promise<string> {
  let texto = "";
  try {
    texto = await r.text();
    const dados = JSON.parse(texto);
    if (dados && typeof dados === "object" && !Array.isArray(dados)) texto = String(dados.message || dados.error || texto);
  } catch {
    /* texto puro */
  }
  return (c.INFINITEPAY_API_KEY ? texto.split(c.INFINITEPAY_API_KEY).join("***") : texto).slice(0, 300);
}

function cabecalhos(c: Config): Record<string, string> {
  return { "Content-Type": "application/json", ...(c.INFINITEPAY_API_KEY ? { "X-Api-Key": c.INFINITEPAY_API_KEY } : {}) };
}

export function montarCorpo(c: Config, pedido: PedidoPagamento, agora = new Date()) {
  const corpo: Record<string, any> = {
    items: [
      {
        quantity: 1,
        price: pedido.preco_centavos - (pedido.desconto_cupom_centavos ?? 0),
        description: pedido.produto + (pedido.cupom_codigo ? ` (cupom ${pedido.cupom_codigo})` : ""),
      },
      // frete grátis: a loja paga a Loggi, o comprador não vê a linha
      ...(pedido.frete_centavos > 0 ? [{ quantity: 1, price: pedido.frete_centavos, description: pedido.frete_descricao }] : []),
    ],
    order_nsu: pedido.order_nsu,
    redirect_url: `${c.SITE_URL}/obrigado`,
    // Os dados vão preenchidos: a tela de contato da InfinitePay sempre aparece, mas o cliente só confere.
    customer: { name: pedido.nome, phone_number: telefone(pedido.telefone), ...(pedido.email ? { email: pedido.email } : {}) },
    address: {
      cep: pedido.cep, street: pedido.rua, neighborhood: pedido.bairro, number: pedido.numero,
      complement: pedido.complemento ?? "", city: pedido.cidade ?? "", state: pedido.uf ?? "",
    },
  };
  if (c.INFINITEPAY_HANDLE) corpo.handle = c.INFINITEPAY_HANDLE;
  // A InfinitePay só aceita webhook num endereço público com https.
  if (c.SITE_URL.startsWith("https://")) corpo.webhook_url = `${c.SITE_URL}/api/webhooks/infinitepay`;
  if (c.INFINITEPAY_API_KEY) {
    const validade = new Date(agora.getTime() + c.INFINITEPAY_VALIDADE_HORAS * 3600_000);
    // require_delivery_address: false tira a etapa "Entrega" da InfinitePay (o endereço já veio do nosso checkout).
    corpo.options = {
      single_payment: true,
      require_delivery_address: false,
      payment_methods_enabled: ["credit_card", "pix"],
      valid_until: validade.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      // a InfinitePay mostra e aplica o desconto quando o cliente escolhe Pix
      ...(pedido.desconto_pix ? { discounts: { pix: pedido.desconto_pix } } : {}),
    };
  }
  return corpo;
}

async function postar(c: Config, caminho: string, corpo: unknown, espera: number): Promise<Response> {
  try {
    return await fetch(`${INFINITEPAY_URL}${caminho}`, {
      method: "POST", headers: cabecalhos(c), body: JSON.stringify(corpo), signal: AbortSignal.timeout(espera),
    });
  } catch {
    throw new ErroPagamento("A InfinitePay não respondeu. Tente de novo em instantes.", 502);
  }
}

export async function criarLink(pedido: PedidoPagamento): Promise<string> {
  const c = await cfg();
  if (c.INFINITEPAY_AMBIENTE === "simulado") return simulador.criarLink(c, pedido.order_nsu);
  const r = await postar(c, "/links", montarCorpo(c, pedido), 20_000);
  if (r.status >= 400) {
    console.warn(`InfinitePay recusou o link (erro ${r.status}): ${await motivo(r, c)}`);
    throw new ErroPagamento(`A InfinitePay recusou o pedido (erro ${r.status}).`, 502);
  }
  const dados = (await r.json()) as Record<string, unknown>;
  const link = ["url", "link", "checkout_url", "payment_url"].map((k) => dados[k]).find((v) => typeof v === "string");
  if (!link) throw new ErroPagamento(`A InfinitePay respondeu sem o link (campos: ${Object.keys(dados).sort().join(", ").slice(0, 200)}).`, 502);
  return link as string;
}

/** {paid, amount, paid_amount, installments, capture_method}: valores em centavos. */
export async function conferirPagamento(orderNsu: string, transactionNsu: string, slug: string): Promise<Conferencia> {
  const c = await cfg();
  if (c.INFINITEPAY_AMBIENTE === "simulado") return simulador.conferir(orderNsu, transactionNsu, slug);
  const r = await postar(c, "/payment_check", { handle: c.INFINITEPAY_HANDLE, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }, 15_000);
  if (r.status >= 400) {
    console.warn(`InfinitePay não confirmou o pagamento (erro ${r.status}): ${await motivo(r, c)}`);
    throw new ErroPagamento(`A InfinitePay não confirmou o pagamento (erro ${r.status}).`, 502);
  }
  return (await r.json()) as Conferencia;
}
