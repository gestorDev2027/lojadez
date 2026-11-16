// Os scripts do Meta Pixel e do GTM pelo próprio site, para o Partytown (astro.config.mjs, resolverUrl): os servidores
// deles não liberam o acesso de outro domínio (CORS). Só esses dois domínios e só GET; os arquivos do próprio Partytown
// (/~partytown/partytown.js...) são de public/ e saem antes desta rota.
import type { APIRoute } from "astro";

const DOMINIOS = new Set(["connect.facebook.net", "www.googletagmanager.com"]);

export const GET: APIRoute = async ({ params, url }) => {
  const dominio = params.dominio ?? "";
  if (!DOMINIOS.has(dominio)) return new Response("Não encontrado.", { status: 404 });
  let resposta: Response;
  try {
    resposta = await fetch(`https://${dominio}/${params.caminho ?? ""}${url.search}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return new Response("Não respondeu.", { status: 502 });
  }
  return new Response(await resposta.arrayBuffer(), {
    status: resposta.status,
    headers: {
      "Content-Type": resposta.headers.get("content-type") ?? "application/javascript",
      "Cache-Control": resposta.headers.get("cache-control") ?? "public, max-age=3600",
    },
  });
};
