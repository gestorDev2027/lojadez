// Frete e envio pela Loggi: endereço pelo CEP (ViaCEP), token OAuth2, cotação, envio, etiqueta, cancelamento e rastreio.
//
// No ambiente "simulado" tudo é uma conta local (para desenvolver sem as credenciais). Em staging/producao, chama a API
// da Loggi (sempre em /v1/companies/{company_id}):
// - POST /v2/oauth2/token (client_id e client_secret → idToken, vale 24 h);
// - POST /quotations (cotação);
// - POST /async-shipments (cria o pacote; a Loggi confirma depois, por isso a etiqueta pode demorar uns segundos);
// - POST /labels (etiqueta em PDF, base64);
// - POST /packages/cancel?loggi_key= (cancela);
// - GET /packages/{tracking_code}/tracking (rastreio).
//
// O token fica na memória do servidor e também no Vault (LOGGI_TOKEN_CACHE): ao reiniciar (cada publicação), o servidor
// não pede um token novo.
import { createHash, randomBytes } from "node:crypto";
import * as catalogo from "./catalogo";
import * as cofre from "./cofre";
import { cfg, type Config } from "./config";
import { ErroLoja } from "./erros";

/** Erro com mensagem que pode ir para o cliente. */
export class ErroFrete extends ErroLoja {}

export type Endereco = { cep: string; rua: string; bairro: string; cidade: string; uf: string };
export type Medidas = { peso_g: number; comprimento_cm: number; largura_cm: number; altura_cm: number };
export type OpcaoFrete = { tipo: string; nome: string; centavos: number; prazo_dias: number; servico: string | null };

const ESPERA_MS = 30_000;

async function buscar(url: string, opcoes: RequestInit = {}, espera = ESPERA_MS): Promise<Response> {
  return fetch(url, { ...opcoes, signal: AbortSignal.timeout(espera) });
}

// ───────── CEP ─────────

const cacheCep = new Map<string, Endereco>();

export function limparCep(cep: string): string {
  const digitos = String(cep ?? "").replace(/\D/g, "");
  if (digitos.length !== 8) throw new ErroFrete("CEP inválido: use os 8 números.");
  return digitos;
}

/** Rua, bairro, cidade e UF pelo ViaCEP (com cache na memória da instância). */
export async function enderecoDoCep(cepBruto: string): Promise<Endereco> {
  const cep = limparCep(cepBruto);
  const guardado = cacheCep.get(cep);
  if (guardado) return guardado;
  let dados: Record<string, any> = {};
  try {
    const r = await buscar(`https://viacep.com.br/ws/${cep}/json/`, {}, 8000);
    dados = r.ok ? await r.json() : {};
  } catch {
    throw new ErroFrete("Não consegui consultar o CEP agora. Tente de novo em instantes.");
  }
  if (!dados || dados.erro) throw new ErroFrete("CEP não encontrado.");
  const endereco = { cep, rua: dados.logradouro || "", bairro: dados.bairro || "", cidade: dados.localidade || "", uf: dados.uf || "" };
  if (cacheCep.size > 2000) cacheCep.clear();
  cacheCep.set(cep, endereco);
  return endereco;
}

// ───────── O pacote ─────────

/** Uma caixa com as unidades empilhadas (altura × quantidade) e 100 g de embalagem. Sem medidas: as do kit de lâminas. */
export async function pacote(kits: number, valorCentavos: number, medidas?: Medidas | null) {
  const p = medidas ?? (await catalogo.produto());
  return {
    peso_g: p.peso_g * kits + 100,
    comprimento_cm: p.comprimento_cm,
    largura_cm: p.largura_cm,
    altura_cm: Math.min(p.altura_cm * kits, 100),
    valor_centavos: valorCentavos,
  };
}

// ───────── Token (OAuth2 client credentials) ─────────

const CHAVE_TOKEN = "LOGGI_TOKEN_CACHE";
let token: { valor: string; vence: number; conta: string } | null = null;

/** Um resumo das credenciais: o token guardado só vale para as mesmas chaves. */
const conta = (c: Config) => createHash("sha256").update(`${c.LOGGI_URL}|${c.LOGGI_CLIENT_ID}|${c.LOGGI_COMPANY_ID}`).digest("hex").slice(0, 16);

/** As chaves mudaram (aba Configurações): o próximo pedido pega um token novo. */
export async function esquecerToken(): Promise<void> {
  token = null;
  try {
    await cofre.apagar(CHAVE_TOKEN);
  } catch {
    /* sem o Vault: só a memória */
  }
}

async function obterToken(c: Config, renovar = false): Promise<string> {
  const minha = conta(c);
  const valido = (t: typeof token) => t && t.conta === minha && t.vence > Date.now() + 60_000;
  if (!renovar && valido(token)) return token!.valor;
  if (!renovar) {
    try {
      const salvo = JSON.parse((await cofre.lerTodos())[CHAVE_TOKEN] ?? "null");
      if (valido(salvo)) return (token = salvo)!.valor;
    } catch {
      /* sem o Vault ou guardado inválido: pede um novo */
    }
  }
  let r: Response;
  try {
    r = await buscar(`${c.LOGGI_URL}/v2/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: c.LOGGI_CLIENT_ID, client_secret: c.LOGGI_CLIENT_SECRET }),
    }, 15_000);
  } catch {
    throw new ErroFrete("A Loggi não respondeu. Tente de novo em instantes.");
  }
  if (r.status !== 200) throw new ErroFrete("Não consegui entrar na Loggi (credenciais). Avise a loja.");
  const dados = await r.json();
  const validade = Number.parseFloat(String(dados.expiresIn ?? "3600").replace(/s$/, "")) || 3600;
  token = { valor: dados.idToken, vence: Date.now() + validade * 1000, conta: minha };
  try {
    await cofre.gravar(CHAVE_TOKEN, JSON.stringify(token));
  } catch {
    /* sem o Vault: fica só na memória desta instância */
  }
  return token.valor;
}

async function chamar(c: Config, metodo: string, caminho: string, corpo?: unknown, params?: Record<string, string>): Promise<Response> {
  const url = new URL(`${c.LOGGI_URL}/v1/companies/${c.LOGGI_COMPANY_ID}${caminho}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  let r: Response | null = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const cabecalhos: Record<string, string> = { Authorization: `Bearer ${await obterToken(c, tentativa > 0)}` };
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
    try {
      r = await buscar(url.href, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    } catch {
      throw new ErroFrete("A Loggi não respondeu. Tente de novo em instantes.");
    }
    if (r.status !== 401) return r; // token vencido antes da hora: renova uma vez
  }
  return r!;
}

// ───────── Cotação ─────────

export const ROTULOS: Record<string, string> = { FREIGHT_TYPE_ECONOMIC: "Econômico", FREIGHT_TYPE_EXPRESS: "Expresso" };

/** O preço da Loggi pode vir como número, texto ou dinheiro do Google ({units, nanos}). */
export function centavos(valor: unknown): number {
  if (valor && typeof valor === "object") {
    const v = valor as { units?: unknown; nanos?: unknown };
    return Math.round((Number(v.units || 0) + Number(v.nanos || 0) / 1e9) * 100);
  }
  return Math.round(Number(String(valor ?? 0).replace(",", ".")) * 100);
}

const linhas = (e: Endereco) => ({ addressLine1: e.rua || e.cidade, postalCode: e.cep, city: e.cidade, state: e.uf });

async function cotarLoggi(c: Config, destino: Endereco, caixa: Awaited<ReturnType<typeof pacote>>): Promise<OpcaoFrete[]> {
  const origem = await enderecoDoCep(c.ORIGEM_CEP);
  const corpo = {
    shipFrom: { lines: linhas(origem) },
    shipTo: { lines: linhas(destino) },
    packages: [{
      weightG: caixa.peso_g, lengthCm: caixa.comprimento_cm, widthCm: caixa.largura_cm, heightCm: caixa.altura_cm,
      goodsValue: { currencyCode: "BRL", units: Math.floor(caixa.valor_centavos / 100), nanos: (caixa.valor_centavos % 100) * 10_000_000 },
    }],
    externalServiceIds: c.LOGGI_SERVICOS,
  };
  const r = await chamar(c, "POST", "/quotations", corpo);
  if (r.status === 429) throw new ErroFrete("Muitas cotações agora. Tente de novo em um minuto.");
  if (r.status >= 400) throw new ErroFrete("A Loggi não conseguiu cotar este endereço.");
  let dados = (await r.json()).packagesQuotations ?? [];
  if (!Array.isArray(dados)) dados = [dados]; // a documentação mostra lista e objeto
  return ((dados[0]?.quotations ?? []) as any[]).map((cotacao) => {
    const tipo = cotacao.freightType || "FREIGHT_TYPE_ECONOMIC";
    const rotulo = String(cotacao.freightTypeLabel || ROTULOS[tipo] || tipo).replace(/^Loggi /, "").trim(); // "Loggi Econômico"
    return {
      tipo,
      nome: rotulo || ROTULOS[tipo] || tipo,
      centavos: centavos(cotacao.price?.totalAmount ?? 0),
      prazo_dias: Math.trunc(Number(cotacao.sloInDays || 0)),
      servico: cotacao.externalServiceId ?? null,
    };
  });
}

/** Uma conta local, para desenvolver sem a Loggi: distância pela região do CEP e peso. */
function cotarSimulado(c: Config, destino: Endereco, caixa: { peso_g: number }): OpcaoFrete[] {
  const distancia = Math.abs(Number(destino.cep[0]) - Number(c.ORIGEM_CEP[0] ?? 0));
  const quilos = Math.ceil(caixa.peso_g / 1000);
  const economico = 1490 + distancia * 350 + quilos * 200;
  return [
    { tipo: "FREIGHT_TYPE_ECONOMIC", nome: "Econômico", centavos: economico, prazo_dias: 3 + distancia, servico: "SIMULADO" },
    { tipo: "FREIGHT_TYPE_EXPRESS", nome: "Expresso", centavos: Math.round((economico * 1.6) / 10) * 10, prazo_dias: Math.max(1, Math.floor((3 + distancia) / 2)), servico: "SIMULADO" },
  ];
}

/** As opções de frete para o CEP e a quantidade: o endereço achado e as opções (mais barata primeiro). */
export async function cotar(cep: string, kits: number, valorCentavos: number, medidas?: Medidas | null) {
  const c = await cfg();
  const destino = await enderecoDoCep(cep);
  const caixa = await pacote(kits, valorCentavos, medidas);
  const opcoes = c.LOGGI_AMBIENTE === "simulado" ? cotarSimulado(c, destino, caixa) : await cotarLoggi(c, destino, caixa);
  if (!opcoes.length) throw new ErroFrete("A Loggi não entrega neste CEP.");
  return { endereco: destino, opcoes: [...opcoes].sort((a, b) => a.centavos - b.centavos) };
}

// ───────── Envio (criar o pacote na Loggi) ─────────

async function erroDaLoggi(r: Response, acao: string): Promise<ErroFrete> {
  let detalhe = "";
  try {
    const dados = await r.json();
    detalhe = String(dados.message || dados.detail || "");
  } catch {
    /* sem corpo */
  }
  return new ErroFrete(`A Loggi recusou ${acao} (erro ${r.status})${detalhe ? `: ${detalhe.slice(0, 300)}` : ""}.`);
}

function enderecoCorreios(rua: string, numero: string, complemento: string | null, bairro: string, cep: string, cidade: string, uf: string) {
  const e: Record<string, string> = {
    logradouro: rua.slice(0, 128), numero: (numero || "S/N").slice(0, 8), bairro: bairro.slice(0, 64), cep, cidade: cidade.slice(0, 32), uf,
  };
  if (complemento) e.complemento = complemento.slice(0, 128);
  return e;
}

export async function remetente(c: Config) {
  const r = c.REMETENTE;
  if (!r.nome || ![11, 14].includes(r.documento.length) || !r.numero)
    throw new ErroFrete("Faltam os dados do remetente em Configurações: nome, CPF/CNPJ e número do endereço de origem.");
  const origem = await enderecoDoCep(c.ORIGEM_CEP);
  const dados: Record<string, unknown> = {
    name: r.nome.slice(0, 128),
    federalTaxId: r.documento,
    address: {
      instructions: (r.instrucoes || "").slice(0, 300),
      correiosAddress: enderecoCorreios(r.rua || origem.rua, r.numero, r.complemento || null, r.bairro || origem.bairro, origem.cep, origem.cidade, origem.uf),
    },
  };
  if (r.telefone) dados.phoneNumber = r.telefone.slice(0, 16);
  return dados;
}

export type PedidoEnvio = {
  order_nsu: string;
  produto_id: string | null;
  kits: number;
  preco_centavos: number;
  frete_tipo: string;
  nome: string;
  cpf: string;
  email: string | null;
  telefone: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
};

/** As medidas da caixa e o conteúdo declarado: do produto do catálogo, ou (sem produto_id) os do kit de lâminas. */
async function doProduto(c: Config, pedido: PedidoEnvio): Promise<[Medidas | null, string]> {
  if (pedido.produto_id) {
    const produtos = await import("./produtos"); // aqui, para não importar em ciclo
    const p = await produtos.buscar(pedido.produto_id);
    if (p) return [produtos.medidas(p), `${p.nome} (${pedido.kits} ${pedido.kits === 1 ? p.unidade : p.unidade_plural})`];
  }
  return [null, `${c.CONTEUDO_DECLARADO} (${pedido.kits} kit${pedido.kits > 1 ? "s" : ""})`];
}

export async function corpoEnvio(c: Config, pedido: PedidoEnvio) {
  const [medidas, conteudo] = await doProduto(c, pedido);
  const caixa = await pacote(pedido.kits, pedido.preco_centavos, medidas);
  return {
    externalServiceId: c.LOGGI_SERVICOS[0] ?? "SIMULADO",
    shipFrom: c.LOGGI_AMBIENTE !== "simulado" ? await remetente(c) : { name: "Loja (simulado)" },
    shipTo: {
      name: pedido.nome.slice(0, 128),
      federalTaxId: pedido.cpf,
      email: (pedido.email ?? "").slice(0, 300),
      phoneNumber: pedido.telefone.slice(0, 16),
      address: {
        instructions: (pedido.complemento || "Entregar ao destinatário").slice(0, 300),
        correiosAddress: enderecoCorreios(pedido.rua, pedido.numero, pedido.complemento, pedido.bairro, pedido.cep, pedido.cidade, pedido.uf),
      },
    },
    packages: [{
      // um código novo a cada envio: com o mesmo, a Loggi devolve o pacote antigo (mesmo já cancelado)
      sequence: `${pedido.order_nsu.slice(0, 29)}-${randomBytes(3).toString("hex")}`,
      freightType: pedido.frete_tipo in ROTULOS ? pedido.frete_tipo : "FREIGHT_TYPE_ECONOMIC",
      weightG: caixa.peso_g, lengthCm: caixa.comprimento_cm, widthCm: caixa.largura_cm, heightCm: caixa.altura_cm,
      documentTypes: [{ contentDeclaration: { totalValue: (pedido.preco_centavos / 100).toFixed(2), description: conteudo.slice(0, 200) } }],
    }],
  };
}

/** Cria o pacote na Loggi. Devolve { loggi_key, tracking_code }. */
export async function criarEnvio(pedido: PedidoEnvio): Promise<{ loggi_key: string; tracking_code: string }> {
  const c = await cfg();
  const corpo = await corpoEnvio(c, pedido);
  if (c.LOGGI_AMBIENTE === "simulado") {
    const chave = "SIM" + pedido.order_nsu.replace(/-/g, "").toUpperCase().slice(0, 23);
    return { loggi_key: chave, tracking_code: chave.slice(-8) };
  }
  const r = await chamar(c, "POST", "/async-shipments", corpo);
  if (r.status >= 400) throw await erroDaLoggi(r, "o envio");
  const pacotes = (await r.json()).packages ?? [];
  if (!pacotes[0]?.loggiKey) throw new ErroFrete("A Loggi aceitou o envio, mas não devolveu o código do pacote.");
  return { loggi_key: pacotes[0].loggiKey, tracking_code: pacotes[0].trackingCode || "" };
}

// Um PDF mínimo, só para o modo simulado.
const PDF_SIMULADO = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 298 420]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

/** A etiqueta Loggi em PDF. Logo depois de criar o envio, a Loggi ainda pode estar processando: tente de novo. */
export async function etiqueta(loggiKey: string, layout = "LABEL_LAYOUT_A6"): Promise<Uint8Array> {
  const c = await cfg();
  if (c.LOGGI_AMBIENTE === "simulado") return PDF_SIMULADO;
  const r = await chamar(c, "POST", "/labels", {
    loggiKeys: [loggiKey], format: "LABEL_FORMAT_PDF", layout, responseType: "LABEL_RESPONSE_TYPE_BASE_64", labelType: "LABEL_TYPE_DEFAULT",
  });
  if (r.status >= 400) throw await erroDaLoggi(r, "a etiqueta");
  const dados = await r.json();
  if (dados.failure?.length) {
    const motivo = String(dados.failure[0]?.status?.message ?? "").trim();
    throw new ErroFrete(`A etiqueta ainda não está pronta (a Loggi está confirmando o envio). Tente de novo em alguns segundos.${motivo ? ` Motivo: ${motivo}` : ""}`);
  }
  const conteudo = dados.success?.content;
  if (!conteudo) throw new ErroFrete("A Loggi não devolveu a etiqueta.");
  return new Uint8Array(Buffer.from(conteudo, "base64"));
}

/** Cancela o pacote. Devolve o aviso da Loggi, se houver (ex.: já em rota, cancelamento não garantido). */
export async function cancelarEnvio(loggiKey: string): Promise<string | null> {
  const c = await cfg();
  if (c.LOGGI_AMBIENTE === "simulado") return null;
  const r = await chamar(c, "POST", "/packages/cancel", undefined, { loggi_key: loggiKey });
  if (r.status >= 400) throw await erroDaLoggi(r, "o cancelamento");
  try {
    return (await r.json()).warning_message || null;
  } catch {
    return null;
  }
}

/** O pacote já está cancelado na Loggi? (cancelar de novo dá erro 400) */
export async function jaCancelado(trackingCode: string | null): Promise<boolean> {
  if (!trackingCode || (await cfg()).LOGGI_AMBIENTE === "simulado") return false;
  try {
    const r = await rastrear(trackingCode);
    return /cancel|interrompido/i.test(`${r.situacao ?? ""} ${r.descricao ?? ""}`);
  } catch {
    return false;
  }
}

export type Rastreio = {
  descricao: string;
  situacao: string | null;
  atualizado_em: string | null;
  previsao: string | null;
  local?: string | null;
  historico: { descricao: string; quando: string | null; local: string | null }[];
};

/** A situação do pacote, só com o que pode ir para o cliente (sem nome, documento ou dados do motorista). */
export async function rastrear(trackingCode: string): Promise<Rastreio> {
  const c = await cfg();
  const vazio = (descricao: string, situacao: string | null = null): Rastreio => ({ descricao, situacao, atualizado_em: null, previsao: null, historico: [] });
  if (c.LOGGI_AMBIENTE === "simulado") return vazio("Pedido recebido pela Loggi (simulado)", "simulado");
  const r = await chamar(c, "GET", `/packages/${encodeURIComponent(trackingCode)}/tracking`);
  if (r.status === 404) return vazio("A Loggi ainda não registrou movimentação.");
  if (r.status >= 400) throw await erroDaLoggi(r, "o rastreio");
  const p = ((await r.json()).packages ?? [])[0];
  if (!p) return vazio("Sem informações ainda.");
  const estado = p.status ?? {};
  const local = (item: any) => [item?.location?.city, item?.location?.state].filter(Boolean).join(", ") || null;
  return {
    descricao: estado.description || estado.highLevelStatus || "",
    situacao: estado.highLevelStatus ?? null,
    atualizado_em: estado.updatedTime ?? null,
    previsao: p.promisedDate ?? null,
    local: local(p),
    historico: ((p.trackingHistory ?? []) as any[])
      .map((h) => ({ descricao: h.status?.description || "", quando: h.status?.updatedTime ?? null, local: local(h) }))
      .slice(-15),
  };
}
