// O que toda rota da API usa: respostas em JSON, erros no formato {"erro": "..."}, o limite por IP e a sessão do vendedor.
import type { APIContext, APIRoute } from "astro";
import { ErroAcesso, conferirCredenciais, sessao } from "./acesso";
import { emCache, limparCdn, mudaAVitrine } from "./cdn";
import { ErroLoja } from "./erros";

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
      // O vendedor mudou algo que aparece na vitrine: a CDN esquece o que guardou.
      if (mudaAVitrine(ctx.request.method, new URL(ctx.request.url).pathname)) await limparCdn();
      return saida instanceof Response ? saida : json(saida);
    } catch (erro) {
      if (erro instanceof ErroHttp || erro instanceof ErroAcesso) return json({ erro: erro.mensagem }, erro.status);
      if (erro instanceof ErroLoja) return json({ erro: erro.message }, erro.status);
      console.error(`Erro em ${ctx.request.method} ${new URL(ctx.request.url).pathname}`, erro);
      return json({ erro: "Algo deu errado. Tente de novo." }, 500);
    }
  };
}

/** Rota pública (igual para todo visitante): a resposta certa vai para o cache da CDN (servidor/cdn.ts). */
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

function ip(ctx: APIContext): string {
  const encaminhado = ctx.request.headers.get("x-nf-client-connection-ip") ?? ctx.request.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  try {
    return ctx.clientAddress;
  } catch {
    return "?";
  }
}

export function limitar(ctx: APIContext, grupo: string, porMinuto: number): void {
  const chave = `${grupo}:${ip(ctx)}`;
  const agora = Date.now();
  const fila = (chamadas.get(chave) ?? []).filter((t) => agora - t <= 60_000);
  if (fila.length >= porMinuto) throw new ErroHttp("Muitas tentativas. Espere um minuto.", 429);
  fila.push(agora);
  chamadas.set(chave, fila);
}

// ───────── A área do vendedor ─────────

export const token = (request: Request) => (request.headers.get("authorization") ?? "").replace(/^Bearer /, "").trim();

/** Confere a sessão e devolve o e-mail de quem entrou. */
export async function vendedor(ctx: APIContext): Promise<string> {
  limitar(ctx, "vendedor", 120);
  const email = await sessao(token(ctx.request));
  if (!email) throw new ErroHttp("Entre de novo na área do vendedor.", 401);
  return email;
}

/** Ações sensíveis (as chaves de pagamento) pedem a senha de novo. */
export async function confirmarSenha(ctx: APIContext, email: string, dados: Record<string, unknown>): Promise<void> {
  limitar(ctx, "confirmar", 10);
  await conferirCredenciais(email, texto(dados.senha));
}
