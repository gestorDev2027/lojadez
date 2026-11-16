// As variáveis de ambiente (no Render, as do painel dele; no computador, o .env da raiz, carregado pelo astro.config).
// Vazio conta como "não existe".
export function amb(chave: string): string | undefined {
  const valor = (process.env[chave] ?? "").trim();
  return valor || undefined;
}
