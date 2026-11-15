// A configuração da loja. De onde vem cada valor, nesta ordem:
// 1. o que o vendedor salvou na aba Configurações (tabela `configuracoes`; os segredos no Vault do Supabase);
// 2. as variáveis de ambiente (na Netlify, o painel dela; no computador, o .env);
// 3. o padrão abaixo.
//
// Na Netlify cada Function guarda a configuração por CACHE_MS; quem salva limpa na hora a da própria instância.
import { amb } from "./ambiente";

export type TipoCampo =
  | "texto" | "segredo" | "escolha" | "sim_nao" | "inteiro" | "decimal" | "digitos" | "dimensoes" | "url" | "email" | "data";

export type Campo = {
  chave: string;
  rotulo: string;
  grupo: string;
  tipo: TipoCampo;
  padrao: string;
  ajuda: string;
  opcoes: string[];
  minimo?: number;
  maximo?: number;
  tamanhos: number[]; // para "digitos": quantos dígitos valem
};

function campo(
  chave: string,
  rotulo: string,
  grupo: string,
  tipo: TipoCampo = "texto",
  padrao = "",
  ajuda = "",
  extra: Partial<Pick<Campo, "opcoes" | "minimo" | "maximo" | "tamanhos">> = {},
): Campo {
  return { chave, rotulo, grupo, tipo, padrao, ajuda, opcoes: [], tamanhos: [], ...extra };
}

const faixa = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);

export const GRUPOS: Record<string, string> = {
  loja: "A loja",
  pacote: "O pacote (para a Loggi)",
  loggi: "Loggi",
  remetente: "Remetente (quem envia)",
  infinitepay: "InfinitePay",
  afiliados: "Afiliados",
  financeiro: "Financeiro (taxas da InfinitePay)",
  ia: "IA (Google Gemini)",
  rastreamento: "Rastreamento (opcional)",
};

export const CAMPOS: Campo[] = [
  campo("LOJA_NOME", "Nome da loja", "loja", "texto", "Wolf & Co"),
  campo("SITE_URL", "Endereço do site", "loja", "url", "http://localhost:4321",
    "Sem a barra no fim. A InfinitePay manda o cliente de volta para cá; o aviso de pagamento só vem com https."),
  campo("LOJA_WHATSAPP", "WhatsApp", "loja", "digitos", "5511983910543", "Com 55 e o DDD, só números.", { tamanhos: [12, 13] }),
  campo("LOJA_PROMO_ATE", "Fim da promoção", "loja", "data", "2026-11-30T23:59:59-03:00",
    "Contagem regressiva da página. Vazio: não aparece. Use só uma data real."),
  campo("EMPRESA_RAZAO_SOCIAL", "Razão social", "loja"),
  campo("EMPRESA_CNPJ", "CNPJ", "loja", "digitos", "", "", { tamanhos: [14] }),
  campo("EMPRESA_EMAIL", "E-mail de contato", "loja", "email"),

  campo("PRODUTO_NOME", "Nome do produto", "pacote", "texto", "Kit Barbeador 3 Lâminas"),
  campo("PRODUTO_PESO_G", "Peso de 1 kit embalado (g)", "pacote", "inteiro", "300", "", { minimo: 1, maximo: 30000 }),
  campo("PRODUTO_DIMENSOES_CM", "Medidas de 1 kit embalado (cm)", "pacote", "dimensoes", "32x17x5",
    "Comprimento x largura x altura, ex.: 25x15x2."),

  campo("LOGGI_AMBIENTE", "Ambiente", "loggi", "escolha", "simulado", "simulado: frete de mentira, nada vai para a Loggi.",
    { opcoes: ["simulado", "staging", "producao"] }),
  campo("LOGGI_CLIENT_ID", "client_id", "loggi", "segredo"),
  campo("LOGGI_CLIENT_SECRET", "client_secret", "loggi", "segredo"),
  campo("LOGGI_COMPANY_ID", "company_id", "loggi", "digitos", "", "", { tamanhos: faixa(1, 20) }),
  campo("LOGGI_SERVICOS", "Código do serviço (externalServiceId)", "loggi", "texto", "", "Mais de um: separe por vírgula."),
  campo("LOGGI_ENVIO_AUTOMATICO", "Criar o envio sozinho quando o pagamento entra", "loggi", "sim_nao", "nao",
    "Se a Loggi recusar, o pedido mostra o motivo e o envio é criado à mão."),
  campo("LOGGI_DESCRICAO_CONTEUDO", "Conteúdo declarado", "loggi", "texto", "Kit barbeador com aparelho e refis de lâminas"),

  campo("LOJA_ORIGEM_CEP", "CEP de onde sai o envio", "remetente", "digitos", "01310100", "", { tamanhos: [8] }),
  campo("LOJA_ORIGEM_NUMERO", "Número", "remetente"),
  campo("LOJA_ORIGEM_COMPLEMENTO", "Complemento", "remetente"),
  campo("LOJA_ORIGEM_RUA", "Rua", "remetente", "texto", "", "Vazio: a rua do CEP."),
  campo("LOJA_ORIGEM_BAIRRO", "Bairro", "remetente", "texto", "", "Vazio: o bairro do CEP."),
  campo("LOJA_ORIGEM_INSTRUCOES", "Instruções para a coleta", "remetente", "texto", "Remetente da loja"),
  campo("LOJA_REMETENTE_NOME", "Nome ou razão social", "remetente"),
  campo("LOJA_REMETENTE_DOCUMENTO", "CPF ou CNPJ", "remetente", "digitos", "", "", { tamanhos: [11, 14] }),
  campo("LOJA_REMETENTE_TELEFONE", "Telefone com DDD", "remetente", "digitos", "", "", { tamanhos: [10, 11] }),

  campo("INFINITEPAY_AMBIENTE", "Ambiente", "infinitepay", "escolha", "simulado",
    "simulado: página de pagamento de mentira da própria loja.", { opcoes: ["simulado", "real"] }),
  campo("INFINITEPAY_HANDLE", "InfiniteTag", "infinitepay", "texto", "", "Seu usuário no app da InfinitePay, sem o $."),
  campo("INFINITEPAY_API_KEY", "API Key do Checkout Integrado", "infinitepay", "segredo", "",
    "Começa com inchk_. Necessária para o desconto no Pix e para o link valer um pagamento só."),
  campo("INFINITEPAY_DESCONTO_PIX", "Desconto no Pix (%)", "infinitepay", "decimal", "0",
    "0: sem desconto. Vale sobre o total (kit + frete). Precisa da API Key.", { minimo: 0, maximo: 50 }),
  campo("INFINITEPAY_VALIDADE_HORAS", "Validade do link (horas)", "infinitepay", "inteiro", "48", "", { minimo: 1, maximo: 720 }),

  campo("AFILIADOS_DIAS_LIBERACAO", "Dias para liberar a comissão", "afiliados", "inteiro", "7",
    "A comissão fica “a liberar” por estes dias depois do pagamento (o prazo de devolução); depois fica disponível " +
      "para repassar.", { minimo: 0, maximo: 90 }),
  campo("FINANCEIRO_TAXA_PIX", "Taxa do Pix (%)", "financeiro", "decimal", "0",
    "O que a InfinitePay desconta de cada venda no Pix (veja no app, em Taxas). 0: sem taxa.", { minimo: 0, maximo: 20 }),
  campo("FINANCEIRO_TAXA_CARTAO", "Taxa do cartão à vista (%)", "financeiro", "decimal", "0",
    "O que a InfinitePay desconta de cada venda no crédito à vista.", { minimo: 0, maximo: 20 }),
  campo("FINANCEIRO_TAXA_PARCELADO", "Taxa do cartão parcelado (%)", "financeiro", "decimal", "0",
    "O que a loja paga quando a venda é parcelada. Se o cliente paga os juros, use a mesma taxa do à vista.",
    { minimo: 0, maximo: 30 }),
  campo("GEMINI_API_KEY", "Chave da API do Gemini", "ia", "segredo", "",
    "Do Google AI Studio. Liga as sugestões de texto e a edição de foto no cadastro de produtos."),
  campo("GEMINI_MODELO_TEXTO", "Modelo de texto", "ia", "texto", "gemini-3.8-flash"),
  campo("GEMINI_MODELO_IMAGEM", "Modelo de imagem", "ia", "texto", "gemini-nano-banana-2.1"),

  campo("META_PIXEL_ID", "Meta Pixel ID", "rastreamento", "digitos", "", "", { tamanhos: faixa(10, 20) }),
  campo("GTM_ID", "Google Tag Manager ID", "rastreamento", "texto", "", "Ex.: GTM-XXXXXXX."),
];

export const POR_CHAVE: Record<string, Campo> = Object.fromEntries(CAMPOS.map((c) => [c.chave, c]));

// Valores que não mudam pela tela
export const PRODUTO_SKU = "MADE-BB006";
export const PRODUTO_EAN = "7892125080110";
export const INFINITEPAY_URL = "https://api.checkout.infinitepay.io";

const digitos = (texto: string) => (texto ?? "").replace(/\D/g, "");

function inteiro(texto: string | undefined, padrao: number): number {
  const t = String(texto ?? "").trim();
  if (!t) return padrao;
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : padrao;
}

function decimal(texto: string | undefined, padrao: number): number {
  const t = String(texto ?? "").trim().replace(",", ".");
  if (!t) return padrao;
  const n = Number(t);
  return Number.isFinite(n) ? n : padrao;
}

const entre = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export function dimensoes(texto: string, padrao = "32x17x5"): [number, number, number] {
  const partes = String(texto).toLowerCase().replace(/ /g, "").split("x").filter(Boolean);
  if (partes.length === 3 && partes.every((p) => /^\d+$/.test(p))) return partes.map(Number) as [number, number, number];
  return padrao.split("x").map(Number) as [number, number, number];
}

export function doAmbiente(chave: string): string | undefined {
  return amb(chave);
}

/** Monta a configuração: o que veio do banco (`sobrepor`) vale sobre o ambiente, que vale sobre o padrão. */
export function montar(sobrepor: Record<string, string | null | undefined> = {}) {
  const v = (chave: string): string => {
    const salvo = sobrepor[chave];
    if (salvo !== null && salvo !== undefined) return String(salvo).trim();
    return doAmbiente(chave) ?? POR_CHAVE[chave].padrao;
  };
  const [comprimento, largura, altura] = dimensoes(v("PRODUTO_DIMENSOES_CM"));
  const loggiAmbiente = v("LOGGI_AMBIENTE").toLowerCase();
  const infinitepayAmbiente = v("INFINITEPAY_AMBIENTE").toLowerCase();
  const cfg = {
    LOJA_NOME: v("LOJA_NOME"),
    SITE_URL: v("SITE_URL").replace(/\/+$/, ""),
    LOJA_WHATSAPP: digitos(v("LOJA_WHATSAPP")),
    LOJA_PROMO_ATE: v("LOJA_PROMO_ATE"),
    EMPRESA: { razaoSocial: v("EMPRESA_RAZAO_SOCIAL"), cnpj: v("EMPRESA_CNPJ"), email: v("EMPRESA_EMAIL") },
    RASTREAMENTO: { metaPixelId: v("META_PIXEL_ID"), gtmId: v("GTM_ID") },
    PRODUTO: {
      sku: PRODUTO_SKU,
      ean: PRODUTO_EAN,
      nome: v("PRODUTO_NOME"),
      aparelhos: 1,
      // refis e preços: os padrões; o vendedor muda pela aba Produto e preços (catálogo)
      refis: inteiro(doAmbiente("PRODUTO_REFIS"), 19),
      laminas_por_refil: 3,
      peso_g: inteiro(v("PRODUTO_PESO_G"), 300),
      comprimento_cm: comprimento,
      largura_cm: largura,
      altura_cm: altura,
    },
    LOGGI_AMBIENTE: loggiAmbiente,
    LOGGI_URL: ({ staging: "https://stg.api.loggi.com", producao: "https://api.loggi.com" } as Record<string, string>)[loggiAmbiente] ?? "",
    LOGGI_CLIENT_ID: v("LOGGI_CLIENT_ID"),
    LOGGI_CLIENT_SECRET: v("LOGGI_CLIENT_SECRET"),
    LOGGI_COMPANY_ID: v("LOGGI_COMPANY_ID"),
    LOGGI_SERVICOS: v("LOGGI_SERVICOS").split(",").map((s) => s.trim()).filter(Boolean),
    LOGGI_ENVIO_AUTOMATICO: ["sim", "s", "true", "1"].includes(v("LOGGI_ENVIO_AUTOMATICO").toLowerCase()),
    CONTEUDO_DECLARADO: v("LOGGI_DESCRICAO_CONTEUDO"),
    ORIGEM_CEP: digitos(v("LOJA_ORIGEM_CEP")),
    REMETENTE: {
      nome: v("LOJA_REMETENTE_NOME"),
      documento: digitos(v("LOJA_REMETENTE_DOCUMENTO")),
      telefone: digitos(v("LOJA_REMETENTE_TELEFONE")),
      numero: v("LOJA_ORIGEM_NUMERO"),
      complemento: v("LOJA_ORIGEM_COMPLEMENTO"),
      rua: v("LOJA_ORIGEM_RUA"),
      bairro: v("LOJA_ORIGEM_BAIRRO"),
      instrucoes: v("LOJA_ORIGEM_INSTRUCOES"),
    },
    INFINITEPAY_AMBIENTE: infinitepayAmbiente,
    INFINITEPAY_HANDLE: v("INFINITEPAY_HANDLE").replace(/^\$+/, ""),
    INFINITEPAY_API_KEY: v("INFINITEPAY_API_KEY"),
    INFINITEPAY_VALIDADE_HORAS: inteiro(v("INFINITEPAY_VALIDADE_HORAS"), 48),
    INFINITEPAY_DESCONTO_PIX: entre(decimal(v("INFINITEPAY_DESCONTO_PIX"), 0), 0, 50),
    AFILIADOS_DIAS_LIBERACAO: inteiro(v("AFILIADOS_DIAS_LIBERACAO"), 7),
    FINANCEIRO_TAXA_PIX: entre(decimal(v("FINANCEIRO_TAXA_PIX"), 0), 0, 20),
    FINANCEIRO_TAXA_CARTAO: entre(decimal(v("FINANCEIRO_TAXA_CARTAO"), 0), 0, 20),
    FINANCEIRO_TAXA_PARCELADO: entre(decimal(v("FINANCEIRO_TAXA_PARCELADO"), 0), 0, 30),
    GEMINI_API_KEY: v("GEMINI_API_KEY"),
    GEMINI_MODELO_TEXTO: v("GEMINI_MODELO_TEXTO") || "gemini-3.8-flash",
    GEMINI_MODELO_IMAGEM: v("GEMINI_MODELO_IMAGEM") || "gemini-nano-banana-2.1",
  };
  return cfg;
}

export type Config = ReturnType<typeof montar>;

/** O desconto no Pix que vale de fato: a InfinitePay só aplica com a API Key (no simulado, sempre). */
export function descontoPix(c: Config): number {
  return c.INFINITEPAY_AMBIENTE === "simulado" || c.INFINITEPAY_API_KEY ? c.INFINITEPAY_DESCONTO_PIX : 0;
}

/** Os problemas de configuração que impedem o modo real (aparecem na aba Integrações). */
export function conferir(c: Config): string[] {
  const problemas: string[] = [];
  if (!["simulado", "staging", "producao"].includes(c.LOGGI_AMBIENTE))
    problemas.push("Loggi: o ambiente deve ser simulado, staging ou producao.");
  if (c.LOGGI_AMBIENTE !== "simulado") {
    for (const [nome, valor] of [["client_id", c.LOGGI_CLIENT_ID], ["client_secret", c.LOGGI_CLIENT_SECRET], ["company_id", c.LOGGI_COMPANY_ID]])
      if (!valor) problemas.push(`Loggi: falta o ${nome}.`);
    if (!c.LOGGI_SERVICOS.length) problemas.push("Loggi: falta o código do serviço (externalServiceId).");
  }
  if (c.ORIGEM_CEP.length !== 8) problemas.push("Remetente: o CEP de origem precisa ter 8 dígitos.");
  if (c.LOGGI_AMBIENTE !== "simulado") {
    if (!c.REMETENTE.nome || ![11, 14].includes(c.REMETENTE.documento.length))
      problemas.push("Remetente: para criar envios na Loggi, preencha o nome e o CPF ou CNPJ.");
    if (!c.REMETENTE.numero) problemas.push("Remetente: para criar envios na Loggi, preencha o número do endereço de origem.");
  }
  if (!["simulado", "real"].includes(c.INFINITEPAY_AMBIENTE)) problemas.push("InfinitePay: o ambiente deve ser simulado ou real.");
  if (c.INFINITEPAY_AMBIENTE === "real" && !c.INFINITEPAY_HANDLE)
    problemas.push("InfinitePay: falta a InfiniteTag (usada também para conferir os pagamentos).");
  if (c.INFINITEPAY_DESCONTO_PIX && !descontoPix(c))
    problemas.push("InfinitePay: o desconto no Pix só vale com a API Key do Checkout Integrado.");
  return problemas;
}

// ───────── A configuração em uso (com o que foi salvo no banco e no Vault) ─────────

const CACHE_MS = 30_000;
let guardada: { quando: number; valor: Config } | null = null;

/** A configuração que vale agora. Lê o banco e o Vault no máximo a cada CACHE_MS por instância. */
export async function cfg(): Promise<Config> {
  if (guardada && Date.now() - guardada.quando < CACHE_MS) return guardada.valor;
  const { lerSalvos } = await import("./configuracoes");
  const valor = montar(await lerSalvos());
  guardada = { quando: Date.now(), valor };
  return valor;
}

/** Depois de salvar: a próxima leitura busca de novo. */
export function esquecer(): void {
  guardada = null;
}
