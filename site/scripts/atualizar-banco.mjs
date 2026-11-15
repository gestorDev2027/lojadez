// Aplica o banco/esquema.sql no Postgres do DATABASE_URL (o .env da raiz). Pode rodar quantas vezes quiser: tudo é
// "if not exists" (tabelas, colunas, índices) e nada apaga dado. Uso: npm run banco:atualizar
// Com --conferir, só lê: diz o que falta e se algo impediria a atualização (ex.: dois produtos com o mesmo SKU).
import { config as carregarEnv } from "dotenv";
import { readFileSync } from "node:fs";
import postgres from "postgres";

carregarEnv({ path: new URL("../../.env", import.meta.url), quiet: true });
const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) {
  console.error("Falta o DATABASE_URL no .env da raiz.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const tabelas = (await sql`select table_name from information_schema.tables where table_schema = 'loja'`).map((t) => t.table_name);
  const faltam = ["estoque", "estoque_movimentos", "estoque_reservas"].filter((t) => !tabelas.includes(t));
  const colunas = (await sql`select column_name from information_schema.columns where table_schema = 'loja' and table_name = 'produtos'`).map((c) => c.column_name);
  const repetidos = await sql`select sku, count(*)::int as n from loja.produtos where sku is not null group by sku having count(*) > 1`;
  console.log(`Tabelas que faltam: ${faltam.join(", ") || "nenhuma"}`);
  console.log(`Colunas que faltam em produtos: ${["ean", "codigo_fornecedor"].filter((c) => !colunas.includes(c)).join(", ") || "nenhuma"}`);
  console.log(`SKUs repetidos: ${repetidos.length ? repetidos.map((r) => `${r.sku} (${r.n})`).join(", ") : "nenhum"}`);
  if (process.argv.includes("--conferir")) process.exit(0);
  if (repetidos.length) {
    console.error("Corrija os SKUs repetidos antes (cada produto com o seu).");
    process.exit(1);
  }
  await sql.unsafe(readFileSync(new URL("../banco/esquema.sql", import.meta.url), "utf8"));
  console.log("Banco atualizado.");
} finally {
  await sql.end();
}
