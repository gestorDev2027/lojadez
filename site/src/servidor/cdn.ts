// O cache da CDN da Netlify. A landing, a vitrine, as páginas dos produtos e a API pública saem do servidor da CDN mais
// perto do cliente, sem chamar a Function (que roda longe do banco) a cada visita.
//
// - Tudo o que vai para o cache leva a etiqueta "loja". Quando o vendedor muda algo que aparece na vitrine (preço,
//   produto, foto, configuração), a etiqueta é limpa na hora (limparCdn): a mudança vale na visita seguinte.
// - O navegador não guarda (max-age=0): só a CDN guarda, e a CDN a gente consegue limpar.
// - Nada com cookie ou login vai para o cache: o checkout, o painel e a API do vendedor ficam de fora.
// - No computador (sem a Netlify) os cabeçalhos não fazem nada e a limpeza é pulada.
import { purgeCache } from "@netlify/functions";

export const ETIQUETA = "loja";

/** Por quanto tempo a CDN serve sem perguntar; a limpeza na hora cobre as mudanças do vendedor. */
const SEGUNDOS = 600;

/** Os cabeçalhos de uma resposta pública (igual para todo visitante). */
export function cabecalhosCdn(segundos = SEGUNDOS): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${segundos}, stale-while-revalidate=86400`,
    "Netlify-Cache-Tag": ETIQUETA,
  };
}

export function emCache(cabecalhos: Headers, segundos = SEGUNDOS): void {
  for (const [nome, valor] of Object.entries(cabecalhosCdn(segundos))) cabecalhos.set(nome, valor);
}

/** Foto com a versão no endereço (?v=): a CDN e o navegador guardam para sempre; a versão nova é outro endereço. */
export const cabecalhosFoto = (tipo: string): Record<string, string> => ({
  "Content-Type": tipo,
  "Cache-Control": "public, max-age=31536000, immutable",
  "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
  "Netlify-Vary": "query=v",
  "Netlify-Cache-Tag": ETIQUETA,
});

// As rotas do vendedor que mudam o que o visitante vê. As outras (login, senha, pedidos...) não limpam o cache.
const MUDA_A_VITRINE = /^\/api\/vendedor\/(catalogo|foto|produtos|configuracoes|estoque)(\/|$)/;

export const mudaAVitrine = (metodo: string, caminho: string) => metodo !== "GET" && MUDA_A_VITRINE.test(caminho);

/** Limpa o que a CDN guardou. Só roda numa Function da Netlify (que tem o token de limpeza). */
export async function limparCdn(): Promise<void> {
  if (!process.env.NETLIFY_PURGE_API_TOKEN) return;
  try {
    await purgeCache({ tags: [ETIQUETA] });
  } catch (erro) {
    // A mudança já foi gravada; no pior caso aparece quando o cache vencer (SEGUNDOS).
    console.error("Não deu para limpar o cache da CDN", erro);
  }
}

/**
 * O endereço da foto passando pela Image CDN da Netlify (tamanho certo e WebP/AVIF conforme o navegador).
 * Só no site publicado: no computador, o endereço original.
 */
export function fotoOtimizada(url: string, largura: number): string {
  if (!import.meta.env.PROD || !url || !url.startsWith("/") || url.endsWith(".svg")) return url;
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${largura}`;
}
