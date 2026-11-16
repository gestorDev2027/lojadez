// Os testes rodam num Postgres em memória (PGlite) com o mesmo esquema do Supabase (banco/esquema.sql).
// O Supabase Auth vira um provedor em memória (IdentidadeFalsa): o código certo do app autenticador é sempre 123456.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { entrar, esquecerTentativas, type Papel } from "../src/servidor/acesso";
import { agora, banco, usarBanco, type Banco } from "../src/servidor/banco";
import { usarIdentidade, type Conferencia, type Identidade, type TipoLink } from "../src/servidor/identidade";

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
  identidadeDeTeste = new IdentidadeFalsa();
  usarIdentidade(identidadeDeTeste);
  esquecerTentativas();
  return db;
}

export const CODIGO_DO_APP = "123456";
export const SENHA_DE_TESTE = "senha-de-teste-123";

interface ContaFalsa {
  id: string;
  email: string;
  senha: string | null;
  fatores: { id: string; verificado: boolean }[];
}

export class IdentidadeFalsa implements Identidade {
  contas = new Map<string, ContaFalsa>();
  links = new Map<string, { email: string; tipo: TipoLink }>();

  private conta(email: string, senha: string | null): ContaFalsa {
    const existente = this.contas.get(email);
    if (existente) return existente;
    const nova = { id: randomUUID(), email, senha, fatores: [] };
    this.contas.set(email, nova);
    return nova;
  }

  private link(email: string, tipo: TipoLink) {
    const tokenHash = randomUUID().replaceAll("-", "");
    this.links.set(tokenHash, { email, tipo });
    return { usuarioId: this.contas.get(email)!.id, tokenHash };
  }

  private conferencia(c: ContaFalsa): Conferencia {
    return {
      usuarioId: c.id,
      email: c.email,
      fatores: async () => c.fatores.map((f) => ({ ...f })),
      cadastrarApp: async () => {
        c.fatores = c.fatores.filter((f) => f.verificado);
        const f = { id: randomUUID(), verificado: false };
        c.fatores.push(f);
        return { fatorId: f.id, qr: "data:image/svg+xml;utf8,<svg/>", segredo: "SEGREDODOAPP" };
      },
      conferirCodigo: async (id, codigo) => {
        const f = c.fatores.find((x) => x.id === id);
        if (!f || codigo !== CODIGO_DO_APP) return false;
        f.verificado = true;
        return true;
      },
      trocarSenha: async (nova) => {
        c.senha = nova;
      },
      encerrar: async () => undefined,
    };
  }

  async conferirSenha(email: string, senha: string) {
    const c = this.contas.get(email);
    return c && c.senha !== null && c.senha === senha ? this.conferencia(c) : null;
  }

  async abrirLink(tokenHash: string, tipo: TipoLink) {
    const l = this.links.get(tokenHash);
    if (!l || l.tipo !== tipo || !this.contas.has(l.email)) return null;
    this.links.delete(tokenHash); // vale uma vez só
    return this.conferencia(this.contas.get(l.email)!);
  }

  async convidar(email: string) {
    if (this.contas.has(email)) return { ...this.link(email, "senha"), tipo: "senha" as const };
    this.conta(email, null);
    return { ...this.link(email, "convite"), tipo: "convite" as const };
  }

  async linkDeSenha(email: string) {
    return this.link(email, "senha");
  }

  async criarConta(email: string, senha: string) {
    return this.conta(email, senha).id;
  }

  async apagarConta(usuarioId: string) {
    for (const [email, c] of this.contas) if (c.id === usuarioId) this.contas.delete(email);
  }

  async zerarApps(usuarioId: string) {
    for (const c of this.contas.values()) if (c.id === usuarioId) c.fatores = [];
  }
}

export let identidadeDeTeste = new IdentidadeFalsa();

/** Cria o acesso (e a conta, com SENHA_DE_TESTE), cadastra o app e entra. Devolve o token da sessão. */
export async function entrarComo(email: string, papel: Papel = "dono", permissoes: string[] = []): Promise<string> {
  await identidadeDeTeste.criarConta(email, SENHA_DE_TESTE);
  const quando = agora();
  await banco().consulta(
    `insert into loja.acessos (email, papel, permissoes, ativo, criado_em, atualizado_em) values ($1, $2, $3, true, $4, $4)
     on conflict (email) do update set papel = $2, permissoes = $3`,
    [email, papel, permissoes, quando],
  );
  const passo = await entrar(email, SENHA_DE_TESTE);
  const fator = passo.etapa === "cadastrar_app" ? passo.fator_id : "";
  const pronto = await entrar(email, SENHA_DE_TESTE, CODIGO_DO_APP, fator);
  if (pronto.etapa !== "pronto") throw new Error("não entrou");
  return pronto.token;
}

/** Uma chamada a uma rota da API, como o Astro faria. */
export async function chamar(
  rota: (ctx: APIContext) => Promise<Response> | Response,
  opcoes: { metodo?: string; corpo?: unknown; token?: string; caminho?: string; cabecalhos?: Record<string, string> } = {},
): Promise<{ status: number; dados: any; cabecalhos: Headers }> {
  const cabecalhos: Record<string, string> = { Origin: "http://localhost", ...opcoes.cabecalhos };
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  if (opcoes.token) cabecalhos.Cookie = `loja_sessao=${opcoes.token}`;
  const request = new Request(`http://localhost${opcoes.caminho ?? "/api/teste"}`, {
    method: opcoes.metodo ?? (opcoes.corpo !== undefined ? "POST" : "GET"),
    headers: cabecalhos,
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const resposta = await rota({ request, clientAddress: "127.0.0.1", params: {} } as unknown as APIContext);
  const saida = { status: resposta.status, dados: await resposta.json() };
  // Os cabeçalhos ficam fora das comparações (toEqual) dos testes que só olham o status e os dados.
  return Object.defineProperty(saida, "cabecalhos", { value: resposta.headers, enumerable: false }) as typeof saida & { cabecalhos: Headers };
}
