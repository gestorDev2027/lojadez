// A landing page do kit de lâminas. Por enquanto, a mesma página estática de antes (public/loja.html); na etapa 2 ela
// é refeita em Astro com a marca nova.
import landing from "../../public/loja.html?raw";

export const GET = () =>
  new Response(landing, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
