// Os segredos da loja (chaves da Loggi, da InfinitePay e do Gemini).
// - No Supabase: no Vault (criptografados no disco e nos backups), cada um com o nome "loja:<CHAVE>".
// - No banco dos testes (sem o Vault): na tabela `segredos_locais`, sem criptografia.
// - Num Postgres sem o Vault: recusa gravar.
// O valor de um segredo nunca volta para a tela: só se ele está configurado.
import { agora, banco, uma } from "./banco";

const PREFIXO = "loja:";

export class ErroCofre extends Error {}

export type TipoCofre = "vault" | "local" | "indisponivel";

let tipoGuardado: TipoCofre | null = null;

export async function tipo(): Promise<TipoCofre> {
  if (banco().tipo === "memoria") return "local";
  if (tipoGuardado) return tipoGuardado;
  const linha = await uma<{ tem: boolean }>("select to_regclass('vault.decrypted_secrets') is not null as tem");
  tipoGuardado = linha?.tem ? "vault" : "indisponivel";
  return tipoGuardado;
}

/** {CHAVE: valor} de todos os segredos da loja. */
export async function lerTodos(): Promise<Record<string, string>> {
  const modo = await tipo();
  if (modo === "indisponivel") return {};
  const linhas =
    modo === "local"
      ? await banco().consulta<{ nome: string; valor: string }>("select nome, valor from loja.segredos_locais")
      : await banco().consulta<{ nome: string; valor: string }>(
          "select name as nome, decrypted_secret as valor from vault.decrypted_secrets where name like $1",
          [PREFIXO + "%"],
        );
  const saida: Record<string, string> = {};
  for (const { nome, valor } of linhas) if (nome.startsWith(PREFIXO) && valor) saida[nome.slice(PREFIXO.length)] = valor;
  return saida;
}

export async function gravar(chave: string, valor: string): Promise<void> {
  const modo = await tipo();
  if (modo === "indisponivel") throw new ErroCofre("Este banco não tem o Vault do Supabase: guarde as chaves nas variáveis de ambiente.");
  const nome = PREFIXO + chave;
  await banco().transacao(async (b) => {
    if (modo === "local") {
      await b.consulta("delete from loja.segredos_locais where nome = $1", [nome]);
      await b.consulta("insert into loja.segredos_locais (nome, valor, atualizado_em) values ($1, $2, $3)", [nome, valor, agora()]);
      return;
    }
    const [existente] = await b.consulta<{ id: string }>("select id from vault.secrets where name = $1", [nome]);
    if (existente) await b.consulta("select vault.update_secret($1::uuid, $2)", [existente.id, valor]);
    else await b.consulta("select vault.create_secret($1, $2, $3)", [valor, nome, "Loja: chave salva pela área do vendedor"]);
  });
}

export async function apagar(chave: string): Promise<void> {
  const modo = await tipo();
  if (modo === "indisponivel") return;
  const nome = PREFIXO + chave;
  if (modo === "local") await banco().consulta("delete from loja.segredos_locais where nome = $1", [nome]);
  else await banco().consulta("delete from vault.secrets where name = $1", [nome]);
}
