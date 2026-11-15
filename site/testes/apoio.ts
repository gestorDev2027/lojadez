// Os testes rodam num Postgres em memória (PGlite) com o mesmo esquema do Supabase (banco/esquema.sql).
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { usarBanco, type Banco } from "../src/servidor/banco";

const ESQUEMA = readFileSync(new URL("../banco/esquema.sql", import.meta.url), "utf8");

function adaptar(db: PGlite | Transaction): Banco {
  return {
    tipo: "memoria",
    async consulta(sql, parametros = []) {
      return (await db.query(sql, parametros as any[])).rows as any[];
    },
    async transacao(fn) {
      if (!("transaction" in db)) return fn(adaptar(db));
      return (db as PGlite).transaction((tx) => fn(adaptar(tx)));
    },
  };
}

export async function bancoNovo(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(ESQUEMA);
  usarBanco(adaptar(db));
  return db;
}

/** Uma chamada a uma rota da API, como o Astro faria. */
export async function chamar(
  rota: (ctx: APIContext) => Promise<Response> | Response,
  opcoes: { metodo?: string; corpo?: unknown; token?: string; caminho?: string } = {},
): Promise<{ status: number; dados: any }> {
  const cabecalhos: Record<string, string> = {};
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  if (opcoes.token) cabecalhos.Authorization = `Bearer ${opcoes.token}`;
  const request = new Request(`http://localhost${opcoes.caminho ?? "/api/teste"}`, {
    method: opcoes.metodo ?? (opcoes.corpo !== undefined ? "POST" : "GET"),
    headers: cabecalhos,
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const resposta = await rota({ request, clientAddress: "127.0.0.1", params: {} } as unknown as APIContext);
  return { status: resposta.status, dados: await resposta.json() };
}
