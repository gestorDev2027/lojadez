# A loja em Astro (Netlify)

A loja Wolf & Co está mudando do servidor Python (Render) para o Astro (Netlify), uma etapa por PR. O banco continua o
mesmo: o Postgres do Supabase, esquema `loja` (as tabelas estão em `banco/esquema.sql`).

## Rodar no computador

```powershell
cd site
npm install
npm run dev      # http://localhost:4321
npm test         # testes num Postgres em memória (PGlite)
npm run build    # confere os tipos e gera o build da Netlify
```

As variáveis vêm do `.env` da raiz do repositório. Durante a migração, o que ainda não foi reescrito continua no
servidor Python: deixe ele rodando na porta 8000 (`.venv\Scripts\python -m uvicorn servidor.app:app --port 8000`), e o
`npm run dev` repassa essas rotas para ele (lista em `astro.config.mjs`).

## O que já está em TypeScript

| Etapa | O quê |
|---|---|
| 1 | Banco, configuração (banco > ambiente > padrão), cofre de chaves (Vault), login do vendedor e a aba Configurações. O app React (checkout, obrigado, vendedor, vitrine, produto) roda dentro do Astro, já com as cores e as fontes da marca nova. |
| 2 | A landing do kit (`src/pages/index.astro`) montada no servidor, com os preços do banco (sem o `/lp-config.js`) e a marca nova; o catálogo do kit, os produtos, a vitrine e as fotos; título, descrição, foto e preço prontos para o Google e as prévias de link em `/produtos` e `/p/<slug>`. |

## A marca

Preto de base (`#0B0B0B`), **laranja `#FF5A00` só no que é compra e oferta** (botões, preço, faixas de oferta, o
"& Co" do logo), branco nos títulos e **azul-aço `#A9B8C8`** nos detalhes de confiança (ícones, rótulos, linhas).
Títulos em Bebas Neue, texto em Inter. O logo ainda é provisório (`src/components/Simbolo.astro` e `Simbolo` em
`src/app/App.tsx`): troca pelo SVG oficial quando chegar.

## Na Netlify

- **Base directory:** `site` (o `netlify.toml` fica aqui).
- **Variáveis:** `DATABASE_URL` (Supabase, Connect > **Transaction pooler**, porta 6543), `LOJA_ADMIN_EMAIL` e
  `LOJA_ADMIN_SENHA` (o acesso à área do vendedor; não há tela de primeiro acesso).
- O resto da configuração (Loggi, InfinitePay...) fica na aba Configurações, com as chaves no Vault do Supabase.
