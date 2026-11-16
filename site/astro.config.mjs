// A loja em Astro: as páginas e a API (src/pages/api) rodam no servidor; na Netlify, como Functions.
//
// Durante a migração, no computador, o que ainda não foi reescrito em TypeScript continua no servidor Python
// (porta 8000): o `npm run dev` repassa essas rotas para ele (lista em PYTHON). Cada etapa tira itens da lista.
import netlify from "@astrojs/netlify";
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { config as carregarEnv } from "dotenv";
import { defineConfig, envField } from "astro/config";

// No computador, as variáveis vêm do .env da raiz do repositório (o mesmo do Python). Na Netlify, do painel dela.
// Nos testes, nunca: eles não podem ver as chaves de verdade (vitest.paginas.config.ts lê este arquivo).
if (!process.env.VITEST) carregarEnv({ path: new URL("../.env", import.meta.url), quiet: true });

const PYTHON = "http://localhost:8000";
// O que já está em TypeScript (Astro). O resto da API, no desenvolvimento, vai para o Python.
const JA_NO_ASTRO = [
  "vendedor/(entrar|sair|eu|senha|configuracoes|primeiro-acesso)", // etapa 1
  "loja", "vitrine", "produtos", "vendedor/(catalogo|foto|produtos)", // etapa 2
  "vendedor/estoque", // estoque e SKU
  "cep", "frete", "cupons/validar", "afiliados/clique", "pedidos", "webhooks", // etapa 3: a compra
];
const apiNoPython = `^/api/(?!(${JA_NO_ASTRO.join("|")})(/|$|\\?)).*`;

// O Partytown roda o Meta Pixel e o GTM num Web Worker. Os scripts deles vêm de outro domínio sem liberar o acesso
// (CORS): no site publicado passam pelo próprio site (/~partytown/<domínio>/..., repassado pela Netlify: netlify.toml).
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
  // A loja não usa as sessões do Astro (o afiliado e o carrinho ficam no navegador): sem elas, a Function fica menor.
  session: false,
  // Pré-carrega a página do produto quando o cliente passa o mouse (ou foca) no link: só os links com
  // data-astro-prefetch (vitrine e landing). Em conexão lenta ou economia de dados, o Astro espera o clique.
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  // As variáveis conferidas ao subir e no build (na Netlify, o build falha se faltar o banco). As outras configurações
  // (Loggi, InfinitePay...) vêm da tela de Configurações e do Vault, não daqui.
  env: {
    schema: {
      DATABASE_URL: envField.string({ context: "server", access: "secret", startsWith: "postgres" }),
      LOJA_ADMIN_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
      LOJA_ADMIN_SENHA: envField.string({ context: "server", access: "secret", optional: true, min: 10 }),
      SITE_URL: envField.string({ context: "server", access: "public", optional: true, url: true }),
    },
    validateSecrets: true,
  },
  // No computador, sem a emulação da Netlify (as Edge Functions pedem o Deno, e a loja não usa nenhuma).
  adapter: netlify({ devFeatures: { environmentVariables: false, images: false, edgeFunctions: false } }),
  integrations: [react(), partytown({ config: { debug: false, forward: ["dataLayer.push", "fbq"], resolveUrl: resolverUrl } })],
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        [apiNoPython]: PYTHON,
      },
    },
  },
});
