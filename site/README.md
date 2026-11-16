# A loja em Astro (Render)

A loja Wolf & Co está mudando do servidor Python para o Astro, uma etapa por PR, e fica no Render (um serviço Docker). O
banco continua o mesmo: o Postgres do Supabase, esquema `loja` (as tabelas estão em `banco/esquema.sql`).

## Rodar no computador

```powershell
cd site
npm install
npm run dev      # http://localhost:4321
npm test         # testes num Postgres em memória (PGlite)
npm run build    # confere os tipos e gera o servidor (dist/)
```

As variáveis vêm do `.env` da raiz do repositório. Durante a migração, o que ainda não foi reescrito continua no
servidor Python (as abas Visão geral, Financeiro, Afiliados, Cupons, Repasses, Integrações e IA): deixe ele rodando na
porta 8000 (`.venv\Scripts\python -m uvicorn servidor.app:app --reload --port 8000`). O Astro confere a sessão e a
permissão e repassa (`src/servidor/python.ts`).

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

## No Render

- **Um serviço web (Docker):** `Dockerfile` e `render.yaml` na raiz do repositório. O Node (`site/servidor.mjs`)
  atende o site; o Python roda por dentro (só em 127.0.0.1:8001) para as abas do painel que ainda não foram reescritas.
  Se o Python cair, o servidor liga de novo.
- **Variáveis** (lista no `render.yaml`): `DATABASE_URL` (Supabase, Connect > **Session pooler**, porta 5432; usuário
  `postgres` enquanto o Python existir, porque ele cria tabelas e usa o Vault direto), `SITE_URL`, `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `LOJA_ADMIN_EMAIL` e `LOJA_ADMIN_SENHA`.
- O resto da configuração (Loggi, InfinitePay...) fica na aba Configurações, com as chaves no Vault do Supabase.
- **Tarefas a cada 15 minutos** (`src/pages/api/tarefas.ts`): o próprio servidor chama, com uma chave sorteada ao
  ligar. Conferem os pagamentos pendentes, fazem o envio automático e liberam as reservas vencidas.
- **Cache** (`src/servidor/cdn.ts`): as páginas públicas saem com `max-age=0` (o navegador sempre pergunta; o servidor
  guarda a configuração e o catálogo na memória). As fotos têm a versão no endereço e ficam no navegador.
- **Meta Pixel e GTM** pelo Partytown (fora da linha principal), com os scripts passando pelo próprio site
  (`src/pages/~partytown`). Onde o navegador não aceita service worker, rodam do jeito normal. Desliga em
  Configurações → Rastreamento em segundo plano.
- `/sitemap.xml` e `/robots.txt` saem do banco (os produtos ativos) e usam o `SITE_URL`.
- Região: Virginia (EUA), perto do Supabase. Plano Starter (o grátis dorme, e o aviso de pagamento pode chegar com o site
  dormindo).
- Testar o build no computador sem mexer nos pedidos: `npm run build`, depois `TAREFAS_DESLIGADAS=sim node servidor.mjs`.

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
