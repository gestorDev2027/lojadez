// As variáveis de ambiente (na Netlify, as do painel; no computador, o .env da raiz, carregado pelo astro.config).
// Vazio conta como "não existe".
export function amb(chave: string): string | undefined {
  const valor = (process.env[chave] ?? "").trim();
  return valor || undefined;
}
