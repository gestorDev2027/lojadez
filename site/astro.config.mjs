// A loja em Astro: as páginas e a API (src/pages/api) rodam no servidor; na Netlify, como Functions.
//
// Durante a migração, no computador, o que ainda não foi reescrito em TypeScript continua no servidor Python
// (porta 8000): o `npm run dev` repassa essas rotas para ele (lista em PYTHON). Cada etapa tira itens da lista.
import netlify from "@astrojs/netlify";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { config as carregarEnv } from "dotenv";
import { defineConfig } from "astro/config";

// No computador, as variáveis vêm do .env da raiz do repositório (o mesmo do Python). Na Netlify, do painel dela.
carregarEnv({ path: new URL("../.env", import.meta.url), quiet: true });

const PYTHON = "http://localhost:8000";
// O que já está em TypeScript (Astro). O resto da API, no desenvolvimento, vai para o Python.
const JA_NO_ASTRO = [
  "vendedor/(entrar|sair|eu|senha|configuracoes|primeiro-acesso)", // etapa 1
  "loja", "vitrine", "produtos", "vendedor/(catalogo|foto|produtos)", // etapa 2
];
const apiNoPython = `^/api/(?!(${JA_NO_ASTRO.join("|")})(/|$|\\?)).*`;

export default defineConfig({
  output: "server",
  // No computador, sem a emulação da Netlify (as Edge Functions pedem o Deno, e a loja não usa nenhuma).
  adapter: netlify({ devFeatures: { environmentVariables: false, images: false, edgeFunctions: false } }),
  integrations: [react()],
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        [apiNoPython]: PYTHON,
        "^/l/": PYTHON,
        "/simulador": PYTHON,
      },
    },
  },
});
