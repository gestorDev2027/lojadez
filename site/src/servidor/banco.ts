// O banco: o Postgres do Supabase (esquema "loja") pelo DATABASE_URL. Nos testes, um Postgres em memória (PGlite).
//
// Todas as consultas escrevem o esquema por extenso (loja.pedidos...): no Transaction pooler do Supabase (o próprio
// para Functions), configuração de sessão como o search_path não vale entre uma consulta e outra.
// JSON vai como texto com ::json; datas, como Date.
import postgres from "postgres";
import { amb } from "./ambiente";

export type Linha = Record<string, any>;

export interface Banco {
  readonly tipo: "postgres" | "memoria";
  consulta<T extends Linha = Linha>(sql: string, parametros?: unknown[]): Promise<T[]>;
  transacao<T>(fn: (b: Banco) => Promise<T>): Promise<T>;
}

let atual: Banco | null = null;

/** Os testes trocam o banco (PGlite). */
export function usarBanco(banco: Banco | null): void {
  atual = banco;
}

function dePostgres(sql: postgres.Sql | postgres.TransactionSql): Banco {
  return {
    tipo: "postgres",
    async consulta(texto, parametros = []) {
      return (await sql.unsafe(texto, parametros as any[])) as any[];
    },
    async transacao(fn) {
      if (!("begin" in sql)) return fn(dePostgres(sql)); // já dentro de uma transação
      return (await (sql as postgres.Sql).begin((tx) => fn(dePostgres(tx)))) as any;
    },
  };
}

export function banco(): Banco {
  if (atual) return atual;
  const url = amb("DATABASE_URL");
  if (!url) throw new Error("Falta o DATABASE_URL (o Postgres do Supabase).");
  // Uma conexão por instância da Function; prepare: false porque o pooler do Supabase (Supavisor) não guarda
  // comandos preparados entre transações.
  atual = dePostgres(postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 10 }));
  return atual;
}

export const agora = () => new Date();

/** Primeira linha ou null. */
export async function uma<T extends Linha = Linha>(sql: string, parametros: unknown[] = []): Promise<T | null> {
  return (await banco().consulta<T>(sql, parametros))[0] ?? null;
}

export async function registrar(email: string | null, acao: string, detalhe = ""): Promise<void> {
  await banco().consulta("insert into loja.auditoria (quando, email, acao, detalhe) values ($1, $2, $3, $4)", [
    agora(),
    email,
    acao,
    detalhe.slice(0, 1000),
  ]);
}

export async function ultimasMudancas(limite = 20) {
  return banco().consulta<{ quando: Date; email: string | null; acao: string; detalhe: string | null }>(
    "select quando, email, acao, detalhe from loja.auditoria order by quando desc, id desc limit $1",
    [limite],
  );
}

export async function lerAjustes(): Promise<Record<string, unknown>> {
  const linhas = await banco().consulta<{ chave: string; valor: unknown }>("select chave, valor from loja.ajustes");
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

export async function gravarAjustes(valores: Record<string, unknown>): Promise<void> {
  await banco().transacao(async (b) => {
    for (const [chave, valor] of Object.entries(valores)) {
      await b.consulta("delete from loja.ajustes where chave = $1", [chave]);
      if (valor !== null && valor !== undefined)
        await b.consulta("insert into loja.ajustes (chave, valor, atualizado_em) values ($1, $2::json, $3)", [
          chave,
          JSON.stringify(valor),
          agora(),
        ]);
    }
  });
}
