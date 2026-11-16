-- O que só existe no Supabase (os testes, no PGlite, não rodam este arquivo). Rodar depois de esquema.sql, no SQL Editor
-- ou pela conexão do dono (postgres). Pode rodar de novo: tudo confere antes de criar.
--
-- 1. O cofre: funções da loja que leem e gravam no Vault (só os segredos "loja:..."). O site chama estas funções em
--    vez de mexer no Vault direto, e assim o usuário do site não precisa de acesso ao Vault.
-- 2. O usuário do site (loja_app): só o schema loja e as funções do cofre. Sem ser o postgres, uma senha vazada não
--    abre o resto do banco. A senha é definida à mão (passo 4) e vai só no DATABASE_URL da Netlify.
-- 3. Limpezas: índices repetidos (sobras do servidor Python), sessões vencidas e o SITE_URL salvo no banco (agora vem
--    só da variável de cada ambiente).

-- ───────── 1. O cofre ─────────

create or replace function loja.cofre_ler()
returns table (nome text, valor text)
language sql
security definer
set search_path = ''
as $$
  select s.name::text, s.decrypted_secret::text from vault.decrypted_secrets s where s.name like 'loja:%';
$$;

create or replace function loja.cofre_gravar(p_nome text, p_valor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_nome is null or p_nome not like 'loja:%' then
    raise exception 'Nome de segredo inválido';
  end if;
  select id into v_id from vault.secrets where name = p_nome;
  if v_id is null then
    perform vault.create_secret(p_valor, p_nome, 'Loja: chave salva pela área do vendedor');
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end;
$$;

create or replace function loja.cofre_apagar(p_nome text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = p_nome and p_nome like 'loja:%';
$$;

-- No Postgres, toda função nasce liberada para todos: aqui, só para quem a loja escolher.
revoke all on function loja.cofre_ler(), loja.cofre_gravar(text, text), loja.cofre_apagar(text) from public, anon, authenticated;

-- ───────── 2. O usuário do site (loja_app) ─────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'loja_app') then
    create role loja_app nologin;
  end if;
end $$;

grant usage on schema loja to loja_app;
grant select, insert, update, delete on all tables in schema loja to loja_app;
revoke update, delete on loja.auditoria from loja_app; -- o histórico só cresce
grant usage, select on all sequences in schema loja to loja_app;
grant execute on function loja.cofre_ler(), loja.cofre_gravar(text, text), loja.cofre_apagar(text) to loja_app;
-- Tabela nova (criada pelo postgres) já nasce liberada para o site.
alter default privileges for role postgres in schema loja grant select, insert, update, delete on tables to loja_app;
alter default privileges for role postgres in schema loja grant usage, select on sequences to loja_app;

-- O RLS está ligado em todas as tabelas e sem regra nenhuma (a API pública do Supabase não vê nada). O loja_app não
-- passa por cima do RLS como o postgres: cada tabela ganha uma regra só para ele. Tabela nova: rode este bloco de novo.
do $$
declare
  t record;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'loja'::regnamespace and c.relkind = 'r' loop
    if not exists (select 1 from pg_policies where schemaname = 'loja' and tablename = t.relname and policyname = 'loja_app') then
      execute format('create policy loja_app on loja.%I for all to loja_app using (true) with check (true)', t.relname);
    end if;
  end loop;
end $$;

-- ───────── 3. Limpezas ─────────

drop index if exists loja.ix_auditoria_quando;        -- repete ix_loja_auditoria_quando
drop index if exists loja.ix_sessoes_email;           -- repete ix_loja_sessoes_email
drop index if exists loja.ix_loja_pedidos_order_nsu;  -- o "unique" de order_nsu já tem índice
delete from loja.sessoes where expira_em < now();
delete from loja.configuracoes where chave = 'SITE_URL';

-- ───────── 4. A senha do loja_app (à mão, uma vez) ─────────
-- No SQL Editor do Supabase, com uma senha forte que só você sabe:
--   alter role loja_app with login password '...';
-- Na Netlify, DATABASE_URL com o usuário "loja_app.<id-do-projeto>" no lugar de "postgres.<id-do-projeto>" (Transaction
-- pooler, porta 6543). O .env do computador continua com o postgres enquanto o servidor Python existir (ele cria tabelas
-- e usa o Vault direto).
