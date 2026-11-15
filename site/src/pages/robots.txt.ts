// O robots.txt: tudo liberado, menos o checkout, a área do vendedor e a API; aponta o mapa do site.
import { emCache } from "../servidor/cdn";
import { cfg } from "../servidor/config";

export const GET = async ({ url }: { url: URL }) => {
  const c = await cfg();
  const base = c.SITE_URL.startsWith("http") ? c.SITE_URL : url.origin;
  const texto = [
    "User-agent: *",
    "Disallow: /checkout",
    "Disallow: /obrigado",
    "Disallow: /vendedor",
    "Disallow: /api/",
    "",
    `Sitemap: ${new URL("/sitemap.xml", base).href}`,
    "",
  ].join("\n");
  const resposta = new Response(texto, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  emCache(resposta.headers);
  return resposta;
};
