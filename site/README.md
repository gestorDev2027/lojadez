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
- As variáveis com o escopo **All scopes**: o build confere o `DATABASE_URL` (`env.schema` no `astro.config.mjs`).
- **Cache na CDN** (`src/servidor/cdn.ts`): a landing, a vitrine, as páginas dos produtos, o mapa do site e a API
  pública saem da CDN (10 min, etiqueta `loja`). Quando o vendedor muda preço, produto, foto ou configuração, a
  etiqueta é limpa na hora. Checkout, painel e API do vendedor nunca vão para o cache.
- **Fotos** da landing e da vitrine pela Image CDN da Netlify (`/.netlify/images`, tamanho certo e WebP/AVIF); no
  computador, os endereços originais.
- **Meta Pixel e GTM** pelo Partytown (fora da linha principal), com os scripts passando pelo próprio site
  (`/~partytown/...`, no `netlify.toml`). Onde o navegador não aceita service worker, rodam do jeito normal. Desliga em
  Configurações → Rastreamento em segundo plano.
- `/sitemap.xml` e `/robots.txt` saem do banco (os produtos ativos) e usam o `SITE_URL`.
- Região das Functions: no plano grátis, Ohio (EUA); São Paulo (`gru`) só no plano Pro.

## Estoque e SKU

- **SKU automático** (`src/servidor/sku.ts`): produto salvo sem SKU ganha `WLF-<CATEGORIA>-<NOME>-<Nº>` (ex.:
  `WLF-CAB-POMA-001`; o começo muda em Configurações). O SKU é único; EAN e código do fornecedor ficam à parte.
- **Estoque** (`src/servidor/estoque.ts`, aba Estoque): o saldo é a soma dos movimentos (entrada, venda, devolução,
  ajuste, perda), cada um com quem, quando e o motivo. Inventário vira um ajuste da diferença. Custo médio pelas
  entradas com custo.
- **Reservas:** o pedido criado reserva; o pagamento baixa; o vencido ou cancelado libera; o reembolso com o produto de
  volta devolve. Sem saldo, o item aparece “Esgotado” e o pedido é recusado (a compra entra na etapa 3).
- Todo item começa **sem controle** (vende sem olhar o saldo): nada fica esgotado só porque o estoque ainda não foi
  lançado. O controle liga no primeiro lançamento ou na aba Estoque.
- **Banco:** `npm run banco:conferir` (só lê: o que falta) e `npm run banco:atualizar` (aplica o `banco/esquema.sql`;
  só cria o que falta, não apaga nada). Rode antes de publicar uma versão que traz tabela nova.
