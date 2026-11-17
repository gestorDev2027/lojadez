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
  atual = dePostgres(postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 10, types: TIPOS }));
  return atual;
}

/**
 * O JSON vai pronto, como texto (JSON.stringify antes de chamar). O postgres.js descobre que o parâmetro é json (pelo
 * ::json) e, sem isto, passava o texto pelo JSON.stringify de novo: o objeto virava um texto JSON dentro do JSON (as
 * ofertas salvas no painel eram ignoradas) e cada salvamento punha mais uma camada de aspas no nome do kit.
 * Texto passa como está; objeto (quem não fez o stringify) ainda é convertido.
 */
export const TIPOS = {
  json: {
    to: 114,
    from: [114, 3802],
    serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)),
    parse: (x: string) => JSON.parse(x),
  },
};

/**
 * O valor de um ajuste gravado antes da correção acima: texto com JSON dentro, às vezes em várias camadas
 * ("{\"kit1\":...}", "\"\\\"Kit\\\"\""). Abre as camadas até sobrar o valor de verdade. Texto comum fica como está.
 */
export function desembrulhar(valor: unknown): unknown {
  for (let i = 0; i < 10 && typeof valor === "string"; i++) {
    const t = valor.trim();
    if (!/^(?:[{["]|-?\d|true$|false$|null$)/.test(t)) break;
    try {
      valor = JSON.parse(t);
    } catch {
      break;
    }
  }
  return valor;
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
  return Object.fromEntries(linhas.map((l) => [l.chave, desembrulhar(l.valor)]));
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
