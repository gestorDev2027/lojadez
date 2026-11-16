// O mapa do site para o Google: a landing do kit, a vitrine e a página de cada produto ativo (vem do banco, por isso
// não é o @astrojs/sitemap, que só conhece as páginas fixas). Vai para o cache da CDN e é limpo junto com a vitrine.
import { emCache } from "../servidor/cdn";
import { cfg } from "../servidor/config";
import { listar } from "../servidor/produtos";

const escapar = (texto: string) => texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const GET = async ({ url }: { url: URL }) => {
  const [c, produtos] = await Promise.all([cfg(), listar(true)]);
  const base = c.SITE_URL.startsWith("http") ? c.SITE_URL : url.origin;
  const paginas = [
    { caminho: "/", quando: undefined as Date | undefined },
    { caminho: "/produtos", quando: undefined as Date | undefined },
    ...produtos.map((p) => ({ caminho: `/p/${p.slug}`, quando: p.atualizado_em ? new Date(p.atualizado_em) : undefined })),
  ];
  const corpo =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paginas
      .map((p) => `  <url><loc>${escapar(new URL(p.caminho, base).href)}</loc>${p.quando ? `<lastmod>${p.quando.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`)
      .join("\n") +
    "\n</urlset>\n";
  const resposta = new Response(corpo, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  emCache(resposta.headers);
  return resposta;
};
