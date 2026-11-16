-- As tabelas da loja no esquema "loja" (as mesmas que o servidor Python criou no Supabase).
-- Pode rodar de novo: só cria o que falta. Os testes usam este arquivo num Postgres em memória (PGlite).
--
-- O "loja" não é publicado na API REST do Supabase (a chave anon, que é pública, leria CPF e endereço), e as tabelas
-- ficam com RLS ligado e sem política: só o dono (o usuário do DATABASE_URL) lê e grava.

create schema if not exists loja;

create table if not exists loja.pedidos (
  id serial primary key,
  order_nsu varchar(36) not null unique,
  criado_em timestamptz not null,
  situacao varchar(30) not null default 'aguardando_pagamento',
  sku varchar(40) not null,
  oferta varchar(20) not null,
  produto text not null,
  kits integer not null,
  preco_centavos integer not null,
  frete_tipo varchar(40) not null,
  frete_descricao text not null,
  frete_prazo_dias integer,
  frete_centavos integer not null,
  frete_custo_centavos integer,
  total_centavos integer not null,
  nome text not null,
  cpf varchar(11) not null,
  email text not null,
  telefone text not null,
  cep varchar(8) not null,
  rua text not null,
  numero text not null,
  complemento text,
  bairro text not null,
  cidade text not null,
  uf varchar(2) not null,
  link_pagamento text,
  slug text,
  transaction_nsu text,
  forma_pagamento varchar(30),
  valor_pago_centavos integer,
  parcelas integer,
  recibo_url text,
  pago_em timestamptz,
  codigo_rastreio text,
  enviado_em timestamptz,
  loggi_key text,
  envio_criado_em timestamptz,
  desconto_pix double precision,
  envio_erro text,
  produto_id varchar(60),
  afiliado_id integer,
  afiliado_codigo varchar(30),
  comissao_pct double precision,
  comissao_centavos integer,
  reembolso_motivo text,
  reembolso_centavos integer,
  reembolso_pedido_em timestamptz,
  reembolsado_em timestamptz,
  cupom_codigo varchar(30),
  desconto_cupom_centavos integer,
  campanha_codigo varchar(12),
  repasse_id integer
);
create index if not exists ix_loja_pedidos_order_nsu on loja.pedidos (order_nsu);

create table if not exists loja.ajustes (
  chave varchar(60) primary key,
  valor json not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.afiliados (
  id serial primary key,
  codigo varchar(30) not null unique,
  nome text not null,
  documento varchar(14),
  email text,
  telefone varchar(20),
  chave_pix text,
  comissao_pct double precision not null,
  todos_produtos boolean not null default true,
  produtos json not null,
  comissoes_produto json,
  ativo boolean not null default true,
  observacoes text,
  criado_em timestamptz not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.cupons (
  id serial primary key,
  codigo varchar(30) not null unique,
  tipo varchar(20) not null,
  valor double precision not null,
  inicio varchar(10),
  fim varchar(10),
  limite_usos integer,
  minimo_centavos integer,
  todos_produtos boolean not null default true,
  produtos json not null,
  afiliado_id integer,
  ativo boolean not null default true,
  descricao_interna text,
  criado_em timestamptz not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.campanhas (
  id serial primary key,
  codigo varchar(12) not null unique,
  afiliado_id integer not null,
  nome text not null,
  destino varchar(20) not null,
  produto_id varchar(60),
  oferta varchar(20),
  cliques integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null
);

create table if not exists loja.repasses (
  id serial primary key,
  afiliado_id integer not null,
  valor_centavos integer not null,
  pedidos json not null,
  pago_em varchar(10) not null,
  chave_pix text,
  observacao text,
  criado_em timestamptz not null,
  criado_por text
);

create table if not exists loja.afiliado_cliques (
  afiliado_id integer not null,
  dia varchar(10) not null,
  cliques integer not null default 0,
  primary key (afiliado_id, dia)
);

create table if not exists loja.produtos (
  slug varchar(30) primary key,
  nome text not null,
  chamada text,
  descricao text,
  sku varchar(60),
  ativo boolean not null default true,
  ordem integer not null default 0,
  unidade varchar(30) not null,
  unidade_plural varchar(30) not null,
  conteudo text,
  peso_g integer not null,
  comprimento_cm integer not null,
  largura_cm integer not null,
  altura_cm integer not null,
  ofertas json not null,
  montar json not null,
  frete_gratis_a_partir integer not null default 0,
  destaque boolean default false,
  categoria varchar(40),
  selo varchar(40),
  criado_em timestamptz not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.fotos (
  nome varchar(40) primary key,
  tipo varchar(40) not null,
  dados bytea not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.configuracoes (
  chave varchar(60) primary key,
  valor text not null,
  atualizado_em timestamptz not null,
  atualizado_por text
);

-- Só sem o Vault do Supabase (os testes): os segredos ficam aqui, SEM criptografia.
create table if not exists loja.segredos_locais (
  nome varchar(80) primary key,
  valor text not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.administradores (
  email varchar(200) primary key,
  senha_hash text not null,
  criado_em timestamptz not null,
  atualizado_em timestamptz not null
);

create table if not exists loja.sessoes (
  token_hash varchar(64) primary key,
  email varchar(200) not null,
  criado_em timestamptz not null,
  expira_em timestamptz not null
);
create index if not exists ix_loja_sessoes_email on loja.sessoes (email);

create table if not exists loja.auditoria (
  id serial primary key,
  quando timestamptz not null,
  email text,
  acao varchar(60) not null,
  detalhe text
);
create index if not exists ix_loja_auditoria_quando on loja.auditoria (quando);

-- ───────── Estoque (15/11/2026) ─────────
-- O SKU interno é gerado pela loja (WLF-CAB-POMA-001); o código do fornecedor e o EAN ficam à parte.
alter table loja.produtos add column if not exists ean varchar(14);
alter table loja.produtos add column if not exists codigo_fornecedor varchar(60);
create unique index if not exists ux_loja_produtos_sku on loja.produtos (sku) where sku is not null;

-- Uma linha por item com estoque: o slug do produto ou "kit-laminas" (o kit da landing).
create table if not exists loja.estoque (
  produto_id varchar(30) primary key,
  controlar boolean not null default true, -- false: vende sem olhar o saldo
  minimo integer not null default 0,
  custo_medio_centavos integer not null default 0,
  atualizado_em timestamptz not null
);

-- Toda mudança do saldo é um movimento (o saldo é a soma): entrada, venda, devolucao, ajuste, perda.
create table if not exists loja.estoque_movimentos (
  id bigserial primary key,
  produto_id varchar(30) not null,
  tipo varchar(20) not null,
  quantidade integer not null, -- positivo entra, negativo sai
  custo_unitario_centavos integer,
  saldo_depois integer not null,
  pedido_nsu varchar(60),
  fornecedor varchar(120),
  nota varchar(60),
  motivo varchar(300),
  email text,
  quando timestamptz not null
);
create index if not exists ix_loja_estoque_movimentos_produto on loja.estoque_movimentos (produto_id, quando);

-- O que um pedido ainda não pago segura: ativa → baixada (pagou) ou liberada (venceu, cancelou).
create table if not exists loja.estoque_reservas (
  pedido_nsu varchar(60) not null,
  produto_id varchar(30) not null,
  quantidade integer not null,
  situacao varchar(12) not null,
  criado_em timestamptz not null,
  expira_em timestamptz not null,
  atualizado_em timestamptz not null,
  primary key (pedido_nsu, produto_id)
);
create index if not exists ix_loja_estoque_reservas_ativas on loja.estoque_reservas (produto_id) where situacao = 'ativa';

alter table loja.pedidos enable row level security;
alter table loja.ajustes enable row level security;
alter table loja.afiliados enable row level security;
alter table loja.cupons enable row level security;
alter table loja.campanhas enable row level security;
alter table loja.repasses enable row level security;
alter table loja.afiliado_cliques enable row level security;
alter table loja.produtos enable row level security;
alter table loja.fotos enable row level security;
alter table loja.configuracoes enable row level security;
alter table loja.segredos_locais enable row level security;
alter table loja.administradores enable row level security;
alter table loja.sessoes enable row level security;
alter table loja.auditoria enable row level security;
alter table loja.estoque enable row level security;
alter table loja.estoque_movimentos enable row level security;
alter table loja.estoque_reservas enable row level security;
