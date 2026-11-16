// As abas do painel que ainda não foram reescritas em TypeScript continuam no servidor Python (servidor/). O Astro fica
// na frente: confere a sessão, a origem e a permissão da área (o Python só confere a sessão) e repassa o pedido.
//
// - No Render, o Python roda no mesmo serviço, só por dentro (PYTHON_URL=http://127.0.0.1:8001, servidor.mjs).
// - No computador, é o `uvicorn` da porta 8000 (o padrão).
// - Cada aba reescrita sai de AREAS_NO_PYTHON. Vazia a lista, o Python sai do serviço.
import type { APIContext } from "astro";
import { amb } from "./ambiente";
import { ErroHttp, acessoAtual, ipDoCliente, token } from "./http";

export const AREAS_NO_PYTHON = ["painel", "financeiro", "afiliados", "campanhas", "cupons", "repasses", "integracoes", "ia"];

const PADRAO = "http://127.0.0.1:8000";

// O que não passa adiante: o cookie (o Python lê a sessão no Authorization) e o que é da conexão de cada lado.
const NAO_REPASSA = new Set([
  "host", "connection", "keep-alive", "upgrade", "cookie", "authorization", "content-length", "transfer-encoding",
  "accept-encoding", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded",
]);
// O fetch já descompacta a resposta: o tamanho e a compressão do Python não valem para o que sai daqui.
const NAO_DEVOLVE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export function vaiProPython(caminho: string): boolean {
  const area = /^\/api\/vendedor\/([^/?]+)/.exec(caminho)?.[1];
  return !!area && AREAS_NO_PYTHON.includes(area);
}

export async function repassarAoPython(ctx: APIContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  if (!vaiProPython(url.pathname)) throw new ErroHttp("Não encontrado.", 404);
  await acessoAtual(ctx);

  const cabecalhos = new Headers();
  ctx.request.headers.forEach((valor, nome) => {
    if (!NAO_REPASSA.has(nome.toLowerCase())) cabecalhos.set(nome, valor);
  });
  cabecalhos.set("authorization", `Bearer ${token(ctx.request)}`);
  cabecalhos.set("x-forwarded-for", ipDoCliente(ctx)); // o limite por IP do Python vê o cliente, não o Astro

  const metodo = ctx.request.method;
  let resposta: Response;
  try {
    resposta = await fetch(new URL(url.pathname + url.search, amb("PYTHON_URL") ?? PADRAO), {
      method: metodo,
      headers: cabecalhos,
      body: metodo === "GET" || metodo === "HEAD" ? undefined : await ctx.request.arrayBuffer(),
      redirect: "manual",
      signal: AbortSignal.timeout(120_000), // a IA (fotos e textos) pode demorar
    });
  } catch (erro) {
    console.error(`Python fora do ar (${metodo} ${url.pathname})`, erro);
    throw new ErroHttp("Esta parte do painel não respondeu. Tente de novo em instantes.", 502);
  }

  const saida = new Headers();
  resposta.headers.forEach((valor, nome) => {
    if (!NAO_DEVOLVE.has(nome.toLowerCase())) saida.set(nome, valor);
  });
  return new Response(metodo === "HEAD" ? null : await resposta.arrayBuffer(), { status: resposta.status, headers: saida });
}
