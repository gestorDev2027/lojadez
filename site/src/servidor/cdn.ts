// Os cabeçalhos de cache das respostas públicas (a landing, a vitrine, as páginas dos produtos e a API pública).
//
// - No Render não há CDN na frente do site: o navegador não guarda (max-age=0) e cada visita pergunta ao servidor, que
//   guarda a configuração e o catálogo na memória. Assim, a mudança do vendedor vale na visita seguinte.
// - As fotos têm a versão no endereço (?v=): o navegador guarda para sempre; a versão nova é outro endereço.
// - Nada com cookie ou login leva estes cabeçalhos: o checkout, o painel e a API do vendedor ficam de fora.

/** Os cabeçalhos de uma resposta pública (igual para todo visitante). */
export function cabecalhosCdn(): Record<string, string> {
  return { "Cache-Control": "public, max-age=0, must-revalidate" };
}

export function emCache(cabecalhos: Headers): void {
  for (const [nome, valor] of Object.entries(cabecalhosCdn())) cabecalhos.set(nome, valor);
}

/** Foto com a versão no endereço (?v=): o navegador guarda para sempre. */
export const cabecalhosFoto = (tipo: string): Record<string, string> => ({
  "Content-Type": tipo,
  "Cache-Control": "public, max-age=31536000, immutable",
});

/**
 * O endereço da foto na largura pedida. Sem a Image CDN da Netlify, a foto sai como foi enviada; a largura fica para
 * quando houver um serviço de imagens.
 */
export function fotoOtimizada(url: string, _largura: number): string {
  return url;
}
