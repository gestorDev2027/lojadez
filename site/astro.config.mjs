// A loja em Astro: as páginas e a API (src/pages/api) rodam num servidor Node (no Render, servidor.mjs).
//
// Durante a migração, as abas do painel que ainda não foram reescritas em TypeScript continuam no servidor Python: a
// rota src/pages/api/vendedor/[...resto].ts repassa para ele (servidor/python.ts), no computador e no Render.
import node from "@astrojs/node";
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { config as carregarEnv } from "dotenv";
import { defineConfig, envField } from "astro/config";

// No computador, as variáveis vêm do .env da raiz do repositório (o mesmo do Python). No Render, do painel dele.
// Nos testes, nunca: eles não podem ver as chaves de verdade (vitest.paginas.config.ts lê este arquivo).
if (!process.env.VITEST) carregarEnv({ path: new URL("../.env", import.meta.url), quiet: true });

// O Partytown roda o Meta Pixel e o GTM num Web Worker. Os scripts deles vêm de outro domínio sem liberar o acesso
// (CORS): no site publicado passam pelo próprio site (/~partytown/<domínio>/..., src/pages/~partytown).
// A função vai para o navegador como texto: não pode usar nada de fora dela.
function resolverUrl(url, location, tipo) {
  const dominios = ["connect.facebook.net", "www.googletagmanager.com"];
  if (tipo !== "script" || !dominios.includes(url.hostname) || location.hostname === "localhost") return url;
  const proxy = new URL(location.origin);
  proxy.pathname = "/~partytown/" + url.hostname + url.pathname;
  proxy.search = url.search;
  return proxy;
}

export default defineConfig({
  output: "server",
  // A loja não usa as sessões do Astro (o afiliado e o carrinho ficam no navegador).
  session: false,
  // Pré-carrega a página do produto quando o cliente passa o mouse (ou foca) no link: só os links com
  // data-astro-prefetch (vitrine e landing). Em conexão lenta ou economia de dados, o Astro espera o clique.
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  // As variáveis conferidas ao subir e no build (o Dockerfile põe um DATABASE_URL de mentira só para o build). As outras
  // configurações (Loggi, InfinitePay...) vêm da tela de Configurações e do Vault, não daqui.
  env: {
    schema: {
      DATABASE_URL: envField.string({ context: "server", access: "secret", startsWith: "postgres" }),
      LOJA_ADMIN_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
      LOJA_ADMIN_SENHA: envField.string({ context: "server", access: "secret", optional: true, min: 10 }),
      // O login do painel (Supabase Auth): as chaves em Project Settings → API.
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true, url: true }),
      SUPABASE_PUBLISHABLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_SECRET_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SITE_URL: envField.string({ context: "server", access: "public", optional: true, url: true }),
    },
    validateSecrets: true,
  },
  // Um servidor Node que serve as páginas, a API e os arquivos de public/ (node ./dist/server/entry.mjs).
  adapter: node({ mode: "standalone" }),
  // No Render, o https termina no balanceador, que repassa ao Node por dentro (http) com o endereço real no Host e
  // em X-Forwarded-Proto. O Astro só confia nesses cabeçalhos para os domínios daqui; sem a lista, cada pedido parece
  // vir de http://localhost e a conferência de origem do painel (servidor/http.ts) recusa tudo ("Pedido de outra
  // origem"). Domínio novo da loja = mais uma linha (e o domínio no Render).
  security: {
    allowedDomains: [
      { protocol: "https", hostname: "wolfco.online" },
      { protocol: "https", hostname: "www.wolfco.online" },
      { protocol: "https", hostname: "lojadez.onrender.com" },
    ],
  },
  integrations: [react(), partytown({ config: { debug: false, forward: ["dataLayer.push", "fbq"], resolveUrl: resolverUrl } })],
  server: { port: 4321 },
  vite: { plugins: [tailwindcss()] },
});
