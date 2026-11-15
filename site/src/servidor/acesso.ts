// Quem entra na área do vendedor: e-mail e senha, com sessão.
// - A senha fica só como hash scrypt (sal próprio), no mesmo formato do servidor Python: os acessos já criados valem.
// - Entrou: um token aleatório (vale ACESSO_HORAS). No banco fica só o hash dele.
// - Cinco senhas erradas para o mesmo e-mail em 15 minutos bloqueiam esse e-mail por 15 minutos (por instância).
// - O acesso vem das variáveis de ambiente (LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA): a loja cria esse administrador ou acerta
//   a senha dele no banco (só o hash). A senha dele só muda lá. Na Netlify não há tela de primeiro acesso: não existe um
//   terminal único onde mostrar o código, e cada Function tem a sua memória.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { amb } from "./ambiente";
import { agora, banco, registrar, uma } from "./banco";

export const ACESSO_HORAS = 12;
export const SENHA_MINIMA = 10;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;
const N = 2 ** 14;
const R = 8;
const P = 1;

export class ErroAcesso extends Error {
  constructor(
    public mensagem: string,
    public status = 401,
  ) {
    super(mensagem);
  }
}

function scrypt(senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, falha) => scryptCb(senha, sal, tamanho, opcoes, (erro, chave) => (erro ? falha(erro) : ok(chave))));
}

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await scrypt(senha, sal, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${chave.toString("base64")}`;
}

export async function senhaConfere(senha: string, guardado: string): Promise<boolean> {
  try {
    const [nome, n, r, p, sal, chave] = guardado.split("$");
    if (nome !== "scrypt" || !chave) return false;
    const esperada = Buffer.from(chave, "base64");
    const calculada = await scrypt(senha, Buffer.from(sal, "base64"), esperada.length, {
      N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024,
    });
    return calculada.length === esperada.length && timingSafeEqual(calculada, esperada);
  } catch {
    return false;
  }
}

let hashFalso: Promise<string> | null = null; // e-mail que não existe gasta o mesmo tempo
const falso = () => (hashFalso ??= gerarHash(randomBytes(16).toString("base64url")));

function conferirEmail(email: string): string {
  const e = (email ?? "").trim().toLowerCase();
  if (!EMAIL.test(e)) throw new ErroAcesso("E-mail inválido.", 422);
  return e;
}

export function conferirSenhaNova(senha: string): void {
  if ((senha ?? "").length < SENHA_MINIMA) throw new ErroAcesso(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`, 422);
  if (senha.length > 200) throw new ErroAcesso("Senha grande demais.", 422);
}

export async function existeAdministrador(): Promise<boolean> {
  return (await uma("select email from loja.administradores limit 1")) !== null;
}

/** Cria o administrador ou troca a senha dele (e fecha as sessões abertas). */
export async function definirAdministrador(email: string, senha: string): Promise<string> {
  email = conferirEmail(email);
  conferirSenhaNova(senha);
  const hash = await gerarHash(senha);
  const quando = agora();
  const existia = await banco().transacao(async (b) => {
    const [existe] = await b.consulta("select email from loja.administradores where email = $1", [email]);
    if (existe)
      await b.consulta("update loja.administradores set senha_hash = $2, atualizado_em = $3 where email = $1", [email, hash, quando]);
    else
      await b.consulta(
        "insert into loja.administradores (email, senha_hash, criado_em, atualizado_em) values ($1, $2, $3, $3)",
        [email, hash, quando],
      );
    await b.consulta("delete from loja.sessoes where email = $1", [email]);
    return Boolean(existe);
  });
  await registrar(email, existia ? "senha" : "administrador", existia ? "Senha trocada" : "Administrador criado");
  return email;
}

export const emailDoAmbiente = () => (amb("LOJA_ADMIN_EMAIL") ?? "").toLowerCase();

let ambienteConferido: Promise<string | null> | null = null;

/** Os testes mudam as variáveis de ambiente: a próxima entrada confere de novo. */
export function esquecerAcessoDoAmbiente(): void {
  ambienteConferido = null;
}

/** Cria o administrador das variáveis de ambiente ou acerta a senha dele. Uma vez por instância. */
export function acessoDoAmbiente(): Promise<string | null> {
  return (ambienteConferido ??= (async () => {
    const email = emailDoAmbiente();
    const senha = process.env.LOJA_ADMIN_SENHA ?? "";
    if (!email && !senha) return null;
    if (!email || !senha) {
      console.warn("Acesso do ambiente ignorado: preencha LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA.");
      return null;
    }
    try {
      conferirEmail(email);
      conferirSenhaNova(senha);
    } catch (erro) {
      console.warn("Acesso do ambiente ignorado:", (erro as ErroAcesso).mensagem);
      return null;
    }
    const linha = await uma<{ senha_hash: string }>("select senha_hash from loja.administradores where email = $1", [email]);
    if (linha && (await senhaConfere(senha, linha.senha_hash))) return email;
    await definirAdministrador(email, senha); // cria, ou troca a senha (e fecha as sessões abertas)
    console.info(`Acesso do ambiente ${linha ? "atualizado" : "criado"} na área do vendedor.`);
    return email;
  })().catch((erro) => {
    ambienteConferido = null; // tenta de novo na próxima
    throw erro;
  }));
}

// ───────── Tentativas erradas (na memória da instância) ─────────

const erros = new Map<string, number[]>();

function bloqueado(email: string): boolean {
  const recentes = (erros.get(email) ?? []).filter((t) => t > Date.now() - 15 * 60_000);
  erros.set(email, recentes);
  return recentes.length >= 5;
}

/** Devolve o e-mail se a senha confere; senão, ErroAcesso (sem dizer se o e-mail existe). */
export async function conferirCredenciais(email: string, senha: string): Promise<string> {
  email = (email ?? "").trim().toLowerCase();
  if (bloqueado(email)) throw new ErroAcesso("Muitas tentativas erradas. Espere 15 minutos.", 429);
  const linha = await uma<{ senha_hash: string }>("select senha_hash from loja.administradores where email = $1", [email]);
  const confere = await senhaConfere(senha ?? "", linha?.senha_hash ?? (await falso()));
  if (!linha || !confere) {
    erros.set(email, [...(erros.get(email) ?? []), Date.now()]);
    throw new ErroAcesso("E-mail ou senha errados.");
  }
  erros.delete(email);
  return email;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function entrar(email: string, senha: string) {
  await acessoDoAmbiente();
  if (!(await existeAdministrador()))
    throw new ErroAcesso("Ainda não há acesso. Defina LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA nas variáveis de ambiente da Netlify.", 403);
  email = await conferirCredenciais(email, senha);
  const token = randomBytes(32).toString("base64url");
  const quando = agora();
  const expira = new Date(quando.getTime() + ACESSO_HORAS * 3600_000);
  await banco().transacao(async (b) => {
    await b.consulta("delete from loja.sessoes where expira_em < $1", [quando]);
    await b.consulta("insert into loja.sessoes (token_hash, email, criado_em, expira_em) values ($1, $2, $3, $4)", [
      hashToken(token),
      email,
      quando,
      expira,
    ]);
  });
  await registrar(email, "entrada", "Entrou na área do vendedor");
  return { token, email, expira_em: expira.toISOString() };
}

/** O e-mail de quem está com esta sessão, ou null. */
export async function sessao(token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const linha = await uma<{ email: string; expira_em: Date }>(
    "select email, expira_em from loja.sessoes where token_hash = $1",
    [hashToken(token)],
  );
  if (!linha) return null;
  return new Date(linha.expira_em).getTime() > Date.now() ? linha.email : null;
}

export async function sair(token: string): Promise<void> {
  await banco().consulta("delete from loja.sessoes where token_hash = $1", [hashToken(token ?? "")]);
}

export async function trocarSenha(email: string, atual: string, nova: string): Promise<void> {
  if (emailDoAmbiente() && email === emailDoAmbiente())
    throw new ErroAcesso("A senha deste acesso vem das variáveis de ambiente (LOJA_ADMIN_SENHA): troque lá.", 409);
  await conferirCredenciais(email, atual);
  await definirAdministrador(email, nova);
}
