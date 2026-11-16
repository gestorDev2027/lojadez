// O que toda rota da API usa: respostas em JSON, erros no formato {"erro": "..."}, o limite por IP e a sessão do vendedor.
import type { APIContext, APIRoute } from "astro";
import { ErroAcesso, conferirCredenciais, pode, sessao, type Acesso, type Permissao } from "./acesso";
import { emCache } from "./cdn";
import { ErroLoja } from "./erros";
import { ErroIdentidade } from "./identidade";

export class ErroHttp extends Error {
  constructor(
    public mensagem: string,
    public status = 422,
  ) {
    super(mensagem);
  }
}

export function json(dados: unknown, status = 200, cabecalhos: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cabecalhos },
  });
}

/** Os erros conhecidos viram {"erro": "..."} com o status certo; o resto vira 500 (e vai para o log). */
export function rota(fn: (ctx: APIContext) => Promise<Response | unknown>): APIRoute {
  return async (ctx) => {
    try {
      const saida = await fn(ctx);
      return saida instanceof Response ? saida : json(saida);
    } catch (erro) {
      if (erro instanceof ErroHttp || erro instanceof ErroAcesso) return json({ erro: erro.mensagem }, erro.status);
      if (erro instanceof ErroLoja) return json({ erro: erro.message }, erro.status);
      if (erro instanceof ErroIdentidade) return json({ erro: erro.message }, erro.status);
      console.error(`Erro em ${ctx.request.method} ${new URL(ctx.request.url).pathname}`, erro);
      return json({ erro: "Algo deu errado. Tente de novo." }, 500);
    }
  };
}

/** Rota pública (igual para todo visitante): os cabeçalhos de cache de servidor/cdn.ts. */
export function rotaPublica(fn: (ctx: APIContext) => Promise<Response | unknown>): APIRoute {
  const r = rota(fn);
  return async (ctx) => {
    const resposta = await r(ctx);
    if (resposta.status === 200) emCache(resposta.headers);
    return resposta;
  };
}

export async function corpo(request: Request): Promise<Record<string, unknown>> {
  let dados: unknown;
  try {
    dados = await request.json();
  } catch {
    throw new ErroHttp("Corpo inválido.", 400);
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new ErroHttp("Corpo inválido.", 400);
  return dados as Record<string, unknown>;
}

export const texto = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));

// ───────── Limite de chamadas por IP (na memória da instância) ─────────

const chamadas = new Map<string, number[]>();

/** O IP de quem chamou. No Render, o primeiro do X-Forwarded-For (o proxy dele põe o do cliente). */
export function ipDoCliente(ctx: APIContext): string {
  const encaminhado = ctx.request.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  try {
    return ctx.clientAddress;
  } catch {
    return "?";
  }
}

export function limitar(ctx: APIContext, grupo: string, porMinuto: number): void {
  const chave = `${grupo}:${ipDoCliente(ctx)}`;
  const agora = Date.now();
  const fila = (chamadas.get(chave) ?? []).filter((t) => agora - t <= 60_000);
  if (fila.length >= porMinuto) throw new ErroHttp("Muitas tentativas. Espere um minuto.", 429);
  fila.push(agora);
  chamadas.set(chave, fila);
}

// ───────── O painel da loja ─────────

/** O cookie da sessão: o JavaScript da página não lê (HttpOnly) e não vai em pedidos vindos de outros sites (Strict). */
export const COOKIE = "loja_sessao";

export function token(request: Request): string {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`).exec(request.headers.get("cookie") ?? "");
  try {
    return m ? decodeURIComponent(m[1]).trim() : "";
  } catch {
    return "";
  }
}

export function cookieDaSessao(request: Request, valor: string, expira: Date | null): string {
  const seguro = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const validade = expira ? `; Expires=${expira.toUTCString()}` : "; Max-Age=0";
  return `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Strict${seguro}${validade}`;
}

/**
 * Cada rota do painel pertence a uma área (a permissão). Rota que não está aqui é só do dono: uma rota nova nunca
 * fica aberta por esquecimento. null = basta estar logado.
 */
const AREAS: Record<string, Permissao | null> = {
  eu: null,
  sair: null,
  senha: null,
  painel: "visao",
  pedidos: "pedidos",
  produtos: "produtos",
  catalogo: "produtos",
  foto: "produtos",
  ia: "produtos",
  estoque: "estoque",
  afiliados: "afiliados",
  campanhas: "afiliados",
  cupons: "cupons",
  repasses: "repasses",
  financeiro: "financeiro",
  integracoes: "integracoes",
  configuracoes: "configuracoes",
  acessos: "acessos",
};

export function permissaoDaRota(caminho: string): Permissao | null {
  const area = /^\/api\/vendedor\/([^/?]+)/.exec(caminho)?.[1] ?? "";
  return area in AREAS ? AREAS[area] : "acessos";
}

/** Pedido que muda algo precisa vir da própria loja (além do SameSite do cookie). */
function mesmaOrigem(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origem = request.headers.get("origin");
  if (origem) return origem === new URL(request.url).origin;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin";
}

/** Confere a sessão e a permissão da área da rota; devolve quem entrou. */
export async function acessoAtual(ctx: APIContext): Promise<Acesso> {
  limitar(ctx, "vendedor", 120);
  if (!mesmaOrigem(ctx.request)) throw new ErroHttp("Pedido de outra origem.", 403);
  const acesso = await sessao(token(ctx.request));
  if (!acesso) throw new ErroHttp("Entre de novo na área do vendedor.", 401);
  const precisa = permissaoDaRota(new URL(ctx.request.url).pathname);
  if (precisa && !pode(acesso, precisa)) throw new ErroHttp("Seu acesso não permite esta área. Fale com o dono da loja.", 403);
  return acesso;
}

/** Confere a sessão e a permissão e devolve o e-mail de quem entrou. */
export async function vendedor(ctx: APIContext): Promise<string> {
  return (await acessoAtual(ctx)).email;
}

/** Ações sensíveis (as chaves de pagamento) pedem a senha de novo. */
export async function confirmarSenha(ctx: APIContext, email: string, dados: Record<string, unknown>): Promise<void> {
  limitar(ctx, "confirmar", 10);
  await conferirCredenciais(email, texto(dados.senha));
}

// ───────── Trabalho depois da resposta ─────────

/**
 * Roda `tarefa` sem segurar a resposta: no site publicado, o servidor (sempre ligado) termina depois; no computador e
 * nos testes, espera aqui mesmo. A tarefa nunca lança (pedidos.ts), mas um erro inesperado vai para o log.
 */
export async function depois(_ctx: APIContext, tarefa: Promise<unknown> | null): Promise<void> {
  if (!tarefa) return;
  if (import.meta.env?.PROD) void tarefa.catch((erro) => console.error("Tarefa depois da resposta", erro));
  else await tarefa;
}
