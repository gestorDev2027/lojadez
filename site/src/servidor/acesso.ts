// Quem entra no painel da loja e o que cada um pode fazer.
//
// - A conta de cada pessoa (senha, app autenticador, convites) fica no Supabase Auth (servidor/identidade.ts). Aqui
//   ficam o papel e as permissões (loja.acessos) e as sessões do painel (loja.sessoes).
// - Entrar: e-mail e senha e, sempre, o código do app autenticador. Quem ainda não tem o app cadastra na hora (QR code).
// - A sessão é um token aleatório num cookie que o JavaScript da página não lê (servidor/http.ts). No banco fica só o
//   hash dele. Vale ACESSO_HORAS. Bloquear ou remover a pessoa derruba as sessões dela na hora.
// - Cinco erros (senha ou código) para o mesmo e-mail em 15 minutos bloqueiam esse e-mail por 15 minutos (por instância).
// - O dono pode tudo e é quem convida, muda papéis e bloqueia (aba Acessos). Ninguém altera o próprio acesso, e a loja
//   sempre tem um dono ativo. Afiliados ainda não têm painel.
// - O primeiro dono vem das variáveis de ambiente (LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA): só enquanto não existe
//   nenhum acesso. Depois, a senha dele é a do Supabase (trocada no painel), e as variáveis podem sair.
import { createHash, randomBytes } from "node:crypto";
import { amb } from "./ambiente";
import { agora, banco, registrar, uma } from "./banco";
import { identidade, type Conferencia, type TipoLink } from "./identidade";

export const ACESSO_HORAS = 12;
export const SENHA_MINIMA = 10;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;
const CODIGO = /^\d{6}$/;

export class ErroAcesso extends Error {
  constructor(
    public mensagem: string,
    public status = 401,
  ) {
    super(mensagem);
  }
}

// ───────── Papéis e permissões ─────────

/** Cada permissão é uma área do painel (uma aba e as rotas dela: servidor/http.ts, permissaoDaRota). */
export const PERMISSOES = [
  { id: "visao", rotulo: "Visão geral" },
  { id: "pedidos", rotulo: "Pedidos, envios e reembolsos" },
  { id: "produtos", rotulo: "Produtos e kit" },
  { id: "estoque", rotulo: "Estoque" },
  { id: "afiliados", rotulo: "Afiliados e campanhas" },
  { id: "cupons", rotulo: "Cupons" },
  { id: "repasses", rotulo: "Repasses" },
  { id: "financeiro", rotulo: "Financeiro" },
  { id: "integracoes", rotulo: "Integrações" },
  { id: "configuracoes", rotulo: "Configurações e chaves" },
  { id: "acessos", rotulo: "Acessos" },
] as const;
export type Permissao = (typeof PERMISSOES)[number]["id"];
const TODAS = PERMISSOES.map((p) => p.id) as Permissao[];
/** O que só o dono faz: não dá para liberar para outro papel. */
const SO_DO_DONO: Permissao[] = ["acessos"];

export const PAPEIS = {
  dono: { rotulo: "Dono", permissoes: TODAS },
  operacao: { rotulo: "Operação", permissoes: ["visao", "pedidos", "estoque"] as Permissao[] },
  financeiro: { rotulo: "Financeiro", permissoes: ["visao", "pedidos", "financeiro", "repasses"] as Permissao[] },
  marketing: { rotulo: "Marketing", permissoes: ["visao", "produtos", "afiliados", "cupons"] as Permissao[] },
  afiliado: { rotulo: "Afiliado (sem painel por enquanto)", permissoes: [] as Permissao[] },
} as const;
export type Papel = keyof typeof PAPEIS;

export interface Acesso {
  email: string;
  nome: string | null;
  papel: Papel;
  permissoes: Permissao[];
  ativo: boolean;
  usuario_id: string | null;
  criado_por: string | null;
  criado_em: Date;
  ultimo_acesso_em: Date | null;
}

/** O que a pessoa pode de fato: o dono, tudo; os outros, o que foi liberado (nunca o que é só do dono). */
export function permissoesDe(a: Pick<Acesso, "papel" | "permissoes">): Permissao[] {
  if (a.papel === "dono") return TODAS;
  if (a.papel === "afiliado") return [];
  return TODAS.filter((p) => a.permissoes.includes(p) && !SO_DO_DONO.includes(p));
}

export const pode = (a: Pick<Acesso, "papel" | "permissoes">, p: Permissao) => permissoesDe(a).includes(p);

/** O que vai para a tela (o id da conta no Supabase não sai do servidor). */
export function publico(a: Acesso) {
  return {
    email: a.email,
    nome: a.nome,
    papel: a.papel,
    permissoes: permissoesDe(a),
    ativo: a.ativo,
    criado_por: a.criado_por,
    criado_em: a.criado_em,
    ultimo_acesso_em: a.ultimo_acesso_em,
    senha_criada: a.ultimo_acesso_em !== null,
  };
}

function conferirEmail(email: string): string {
  const e = (email ?? "").trim().toLowerCase();
  if (!EMAIL.test(e)) throw new ErroAcesso("E-mail inválido.", 422);
  return e;
}

export function conferirSenhaNova(senha: string): void {
  if ((senha ?? "").length < SENHA_MINIMA) throw new ErroAcesso(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`, 422);
  if (senha.length > 200) throw new ErroAcesso("Senha grande demais.", 422);
}

function conferirPapel(papel: unknown): Papel {
  if (typeof papel !== "string" || !(papel in PAPEIS)) throw new ErroAcesso("Papel inválido.", 422);
  return papel as Papel;
}

function conferirPermissoes(lista: unknown, papel: Papel): Permissao[] {
  if (lista === undefined || lista === null) return [...PAPEIS[papel].permissoes];
  if (!Array.isArray(lista) || lista.some((p) => !TODAS.includes(p))) throw new ErroAcesso("Permissão inválida.", 422);
  return TODAS.filter((p) => lista.includes(p) && !SO_DO_DONO.includes(p));
}

const lerAcesso = (linha: Record<string, unknown> | null): Acesso | null =>
  linha ? ({ ...linha, permissoes: (linha.permissoes as string[] | null) ?? [] } as Acesso) : null;

export async function buscar(email: string): Promise<Acesso | null> {
  return lerAcesso(await uma("select * from loja.acessos where email = $1", [(email ?? "").trim().toLowerCase()]));
}

export async function listar() {
  const linhas = await banco().consulta<Record<string, unknown>>(
    "select * from loja.acessos order by (papel = 'dono') desc, ativo desc, criado_em",
  );
  return linhas.map((l) => publico(lerAcesso(l)!));
}

// ───────── O primeiro dono (variáveis de ambiente) ─────────

let ambienteConferido: Promise<void> | null = null;

/** Os testes mudam as variáveis de ambiente: a próxima entrada confere de novo. */
export function esquecerAcessoDoAmbiente(): void {
  ambienteConferido = null;
}

/** Sem nenhum acesso, cria o dono das variáveis de ambiente (a conta no Supabase e a linha aqui). Uma vez por instância. */
function acessoDoAmbiente(): Promise<void> {
  return (ambienteConferido ??= (async () => {
    if (await uma("select email from loja.acessos limit 1")) return;
    const email = (amb("LOJA_ADMIN_EMAIL") ?? "").toLowerCase();
    const senha = process.env.LOJA_ADMIN_SENHA ?? "";
    if (!email || !senha) return;
    try {
      conferirEmail(email);
      conferirSenhaNova(senha);
    } catch (erro) {
      console.warn("Acesso do ambiente ignorado:", (erro as ErroAcesso).mensagem);
      return;
    }
    const usuarioId = await identidade().criarConta(email, senha);
    const quando = agora();
    await banco().consulta(
      `insert into loja.acessos (email, usuario_id, papel, permissoes, ativo, criado_por, criado_em, atualizado_em)
       values ($1, $2, 'dono', '{}', true, null, $3, $3) on conflict (email) do nothing`,
      [email, usuarioId, quando],
    );
    await registrar(email, "acesso", "Dono criado a partir das variáveis de ambiente");
    console.info("Primeiro acesso (dono) criado a partir das variáveis de ambiente.");
  })().catch((erro) => {
    ambienteConferido = null; // tenta de novo na próxima
    throw erro;
  }));
}

// ───────── Tentativas erradas (na memória da instância) ─────────

const erros = new Map<string, number[]>();

/** Os testes começam sem tentativas erradas. */
export const esquecerTentativas = () => erros.clear();

function bloqueado(email: string): boolean {
  const recentes = (erros.get(email) ?? []).filter((t) => t > Date.now() - 15 * 60_000);
  erros.set(email, recentes);
  return recentes.length >= 5;
}

function errou(email: string, mensagem = "E-mail ou senha errados.", status = 401): never {
  erros.set(email, [...(erros.get(email) ?? []), Date.now()]);
  throw new ErroAcesso(mensagem, status);
}

/** Confere a senha no Supabase. Sem dizer se o e-mail existe. A conferência precisa ser encerrada depois. */
async function conferirSenha(email: string, senha: string): Promise<Conferencia> {
  if (bloqueado(email)) throw new ErroAcesso("Muitas tentativas erradas. Espere 15 minutos.", 429);
  const conferencia = await identidade().conferirSenha(email, (senha ?? "").slice(0, 200));
  if (!conferencia) errou(email);
  return conferencia;
}

/** Ações sensíveis (as chaves de pagamento) pedem a senha de novo. */
export async function conferirCredenciais(email: string, senha: string): Promise<string> {
  email = (email ?? "").trim().toLowerCase();
  const conferencia = await conferirSenha(email, senha);
  await conferencia.encerrar();
  erros.delete(email);
  return email;
}

// ───────── Entrar, sessão e sair ─────────

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type Entrada =
  | { etapa: "codigo" }
  | { etapa: "cadastrar_app"; fator_id: string; qr: string; segredo: string }
  | { etapa: "pronto"; token: string; expira_em: Date; acesso: ReturnType<typeof publico> };

/**
 * Entrar em até dois passos (a tela manda a senha de novo no segundo; nada fica guardado entre eles):
 * 1. e-mail e senha → pede o código do app ("codigo") ou, sem app, o QR code para cadastrar ("cadastrar_app");
 * 2. e-mail, senha e código (e o fator_id no cadastro) → abre a sessão.
 */
export async function entrar(email: string, senha: string, codigo = "", fatorId = ""): Promise<Entrada> {
  email = (email ?? "").trim().toLowerCase();
  await acessoDoAmbiente();
  if (!(await uma("select email from loja.acessos limit 1")))
    throw new ErroAcesso("Ainda não há acesso. Defina LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA nas variáveis de ambiente.", 403);
  const conferencia = await conferirSenha(email, senha);
  try {
    const acesso = await buscar(email);
    if (!acesso) errou(email); // tem conta no Supabase, mas não tem acesso à loja: a mesma resposta da senha errada
    if (!acesso.ativo) throw new ErroAcesso("Este acesso está bloqueado. Fale com o dono da loja.", 403);
    if (acesso.papel === "afiliado") throw new ErroAcesso("Ainda não há painel para afiliados.", 403);

    codigo = (codigo ?? "").replace(/\s/g, "");
    const verificado = (await conferencia.fatores()).find((f) => f.verificado);
    if (!codigo) {
      if (verificado) return { etapa: "codigo" };
      const app = await conferencia.cadastrarApp();
      return { etapa: "cadastrar_app", fator_id: app.fatorId, qr: app.qr, segredo: app.segredo };
    }
    const fator = verificado?.id ?? (fatorId || "");
    if (!CODIGO.test(codigo) || !fator || !(await conferencia.conferirCodigo(fator, codigo)))
      errou(email, "Código errado ou vencido. Confira o app e tente de novo.");
    erros.delete(email);

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
      await b.consulta("update loja.acessos set usuario_id = $2, ultimo_acesso_em = $3 where email = $1", [
        email,
        conferencia.usuarioId,
        quando,
      ]);
    });
    await registrar(email, "entrada", verificado ? "Entrou no painel" : "Cadastrou o app autenticador e entrou no painel");
    return { etapa: "pronto", token, expira_em: expira, acesso: publico({ ...acesso, ultimo_acesso_em: quando }) };
  } finally {
    await conferencia.encerrar();
  }
}

/** Quem está com esta sessão (ativo e com painel), ou null. */
export async function sessao(token: string): Promise<Acesso | null> {
  if (!token || token.length > 100) return null;
  const linha = await uma<Record<string, unknown> & { expira_em: Date }>(
    `select a.*, s.expira_em from loja.sessoes s join loja.acessos a on a.email = s.email
     where s.token_hash = $1 and a.ativo and a.papel <> 'afiliado'`,
    [hashToken(token)],
  );
  if (!linha || new Date(linha.expira_em).getTime() <= Date.now()) return null;
  return lerAcesso(linha);
}

export async function sair(token: string): Promise<void> {
  await banco().consulta("delete from loja.sessoes where token_hash = $1", [hashToken(token ?? "")]);
}

const fecharSessoes = (email: string) => banco().consulta("delete from loja.sessoes where email = $1", [email]);

export async function trocarSenha(email: string, atual: string, nova: string): Promise<void> {
  conferirSenhaNova(nova);
  const conferencia = await conferirSenha(email, atual).catch((erro) => {
    if (erro instanceof ErroAcesso && erro.status === 401) throw new ErroAcesso("A senha atual não confere.", 422);
    throw erro;
  });
  try {
    await conferencia.trocarSenha(nova);
  } finally {
    await conferencia.encerrar();
  }
  await fecharSessoes(email);
  await registrar(email, "senha", "Senha trocada");
}

/** O link de convite ou de troca de senha: a pessoa cria a senha nova. Depois, entra (e cadastra o app). */
export async function usarLink(tokenHash: string, tipo: TipoLink, senhaNova: string): Promise<{ email: string }> {
  conferirSenhaNova(senhaNova);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash ?? "") || (tipo !== "convite" && tipo !== "senha"))
    throw new ErroAcesso("Link inválido.", 422);
  const conferencia = await identidade().abrirLink(tokenHash, tipo);
  if (!conferencia) throw new ErroAcesso("Este link venceu ou já foi usado. Peça um novo ao dono da loja.", 410);
  try {
    const acesso = await buscar(conferencia.email);
    if (!acesso || !acesso.ativo) throw new ErroAcesso("Este acesso não está ativo. Fale com o dono da loja.", 403);
    await conferencia.trocarSenha(senhaNova);
    await banco().consulta("update loja.acessos set usuario_id = $2, atualizado_em = $3 where email = $1", [
      acesso.email,
      conferencia.usuarioId,
      agora(),
    ]);
    await fecharSessoes(acesso.email);
    await registrar(acesso.email, "senha", tipo === "convite" ? "Criou a senha pelo convite" : "Trocou a senha pelo link");
    return { email: acesso.email };
  } finally {
    await conferencia.encerrar();
  }
}

// ───────── A aba Acessos (só o dono) ─────────

export interface Link {
  token_hash: string;
  tipo: TipoLink;
}

async function precisaExistir(email: string): Promise<Acesso> {
  const acesso = await buscar(email);
  if (!acesso) throw new ErroAcesso("Acesso não encontrado.", 404);
  return acesso;
}

function naoEhVoceMesmo(quem: string, email: string): void {
  if (quem === email) throw new ErroAcesso("Ninguém altera o próprio acesso. Peça a outro dono.", 409);
}

async function outroDonoAtivo(email: string): Promise<boolean> {
  return (await uma("select email from loja.acessos where papel = 'dono' and ativo and email <> $1 limit 1", [email])) !== null;
}

const resumo = (a: Pick<Acesso, "papel" | "permissoes" | "ativo">) =>
  `${PAPEIS[a.papel].rotulo}${a.papel === "dono" ? "" : ` [${permissoesDe(a).join(", ") || "nada"}]`}${a.ativo ? "" : " (bloqueado)"}`;

export async function convidar(
  quem: string,
  dados: Record<string, unknown>,
): Promise<{ acesso: ReturnType<typeof publico>; link: Link }> {
  const email = conferirEmail(String(dados.email ?? ""));
  const papel = conferirPapel(dados.papel);
  const permissoes = papel === "dono" ? [] : conferirPermissoes(dados.permissoes, papel);
  const nome = String(dados.nome ?? "").trim().slice(0, 120) || null;
  if (await buscar(email)) throw new ErroAcesso("Esse e-mail já tem acesso.", 409);
  const link = await identidade().convidar(email);
  const quando = agora();
  await banco().consulta(
    `insert into loja.acessos (email, usuario_id, nome, papel, permissoes, ativo, criado_por, criado_em, atualizado_em)
     values ($1, $2, $3, $4, $5, true, $6, $7, $7)`,
    [email, link.usuarioId, nome, papel, permissoes, quem, quando],
  );
  await registrar(quem, "acesso", `Convidou ${email}: ${resumo({ papel, permissoes, ativo: true })}`);
  return { acesso: publico((await buscar(email))!), link: { token_hash: link.tokenHash, tipo: link.tipo } };
}

export async function alterar(
  quem: string,
  email: string,
  dados: { nome?: unknown; papel?: unknown; permissoes?: unknown; ativo?: unknown },
): Promise<ReturnType<typeof publico>> {
  email = (email ?? "").trim().toLowerCase();
  naoEhVoceMesmo(quem, email);
  const antes = await precisaExistir(email);
  const papel = dados.papel === undefined ? antes.papel : conferirPapel(dados.papel);
  const permissoes =
    papel === "dono" ? [] : dados.permissoes === undefined && papel === antes.papel ? antes.permissoes : conferirPermissoes(dados.permissoes, papel);
  const ativo = dados.ativo === undefined ? antes.ativo : dados.ativo === true;
  const nome = dados.nome === undefined ? antes.nome : String(dados.nome ?? "").trim().slice(0, 120) || null;
  if (antes.papel === "dono" && antes.ativo && (papel !== "dono" || !ativo) && !(await outroDonoAtivo(email)))
    throw new ErroAcesso("A loja precisa de pelo menos um dono ativo.", 409);
  await banco().consulta(
    "update loja.acessos set nome = $2, papel = $3, permissoes = $4, ativo = $5, atualizado_em = $6 where email = $1",
    [email, nome, papel, permissoes, ativo, agora()],
  );
  if (!ativo || papel === "afiliado") await fecharSessoes(email);
  await registrar(quem, "acesso", `Alterou ${email}: ${resumo(antes)} → ${resumo({ papel, permissoes, ativo })}`);
  return publico((await buscar(email))!);
}

export async function remover(quem: string, email: string): Promise<void> {
  email = (email ?? "").trim().toLowerCase();
  naoEhVoceMesmo(quem, email);
  const antes = await precisaExistir(email);
  if (antes.papel === "dono" && antes.ativo && !(await outroDonoAtivo(email)))
    throw new ErroAcesso("A loja precisa de pelo menos um dono ativo.", 409);
  await banco().transacao(async (b) => {
    await b.consulta("delete from loja.sessoes where email = $1", [email]);
    await b.consulta("delete from loja.acessos where email = $1", [email]);
  });
  if (antes.usuario_id) await identidade().apagarConta(antes.usuario_id);
  await registrar(quem, "acesso", `Removeu ${email} (${resumo(antes)})`);
}

/** Um link novo: de convite, se a pessoa ainda não criou a senha; senão, de troca de senha. */
export async function novoLink(quem: string, email: string): Promise<Link> {
  email = (email ?? "").trim().toLowerCase();
  const acesso = await precisaExistir(email);
  if (!acesso.ativo) throw new ErroAcesso("Desbloqueie o acesso antes de gerar um link.", 409);
  const link = acesso.ultimo_acesso_em
    ? { ...(await identidade().linkDeSenha(email)), tipo: "senha" as const }
    : await identidade().convidar(email);
  await banco().consulta("update loja.acessos set usuario_id = $2 where email = $1", [email, link.usuarioId]);
  await registrar(quem, "acesso", `Gerou um link de ${link.tipo === "convite" ? "convite" : "troca de senha"} para ${email}`);
  return { token_hash: link.tokenHash, tipo: link.tipo };
}

/** A pessoa perdeu o celular: tira o app autenticador da conta; no próximo login, cadastra outro. */
export async function zerarApp(quem: string, email: string): Promise<void> {
  email = (email ?? "").trim().toLowerCase();
  naoEhVoceMesmo(quem, email);
  const acesso = await precisaExistir(email);
  if (acesso.usuario_id) await identidade().zerarApps(acesso.usuario_id);
  await fecharSessoes(email);
  await registrar(quem, "acesso", `Tirou o app autenticador de ${email}`);
}
