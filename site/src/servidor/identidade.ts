// As contas de quem entra no painel ficam no Supabase Auth: a senha (o hash fica lá), o app autenticador (TOTP) e os
// links de convite e de troca de senha. O papel e as permissões de cada pessoa ficam no nosso banco (servidor/acesso.ts).
//
// A sessão do painel é nossa (um token aleatório em cookie, servidor/acesso.ts): a sessão que o Supabase abre em cada
// conferência só serve para aquele passo e é encerrada logo depois (nenhum token do Supabase vai para o navegador).
//
// Nos testes, um provedor em memória faz o papel do Supabase (usarIdentidade).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { amb } from "./ambiente";

export type TipoLink = "convite" | "senha";

export interface Fator {
  id: string;
  verificado: boolean;
}

/** Uma conferência aberta: a senha (ou o link) bateu, e dá para mexer na conta antes de encerrar. */
export interface Conferencia {
  usuarioId: string;
  email: string;
  fatores(): Promise<Fator[]>;
  /** Começa o cadastro de um app autenticador (tira os cadastros que ficaram pela metade). */
  cadastrarApp(): Promise<{ fatorId: string; qr: string; segredo: string }>;
  conferirCodigo(fatorId: string, codigo: string): Promise<boolean>;
  trocarSenha(nova: string): Promise<void>;
  encerrar(): Promise<void>;
}

export interface Identidade {
  /** null quando o e-mail ou a senha não batem. */
  conferirSenha(email: string, senha: string): Promise<Conferencia | null>;
  /** null quando o link venceu ou já foi usado. */
  abrirLink(tokenHash: string, tipo: TipoLink): Promise<Conferencia | null>;
  /** Cria a conta (sem senha) e devolve o link para a pessoa criar a dela; se a conta já existe, um link de senha. */
  convidar(email: string): Promise<{ usuarioId: string; tokenHash: string; tipo: TipoLink }>;
  linkDeSenha(email: string): Promise<{ usuarioId: string; tokenHash: string }>;
  /** A conta do acesso das variáveis de ambiente (a primeira da loja). Já existindo, só devolve o id. */
  criarConta(email: string, senha: string): Promise<string>;
  apagarConta(usuarioId: string): Promise<void>;
  /** Tira os apps autenticadores da conta (a pessoa perdeu o celular): no próximo login, cadastra de novo. */
  zerarApps(usuarioId: string): Promise<void>;
}

export class ErroIdentidade extends Error {
  constructor(
    mensagem: string,
    public status = 503,
  ) {
    super(mensagem);
  }
}

// ───────── O Supabase Auth ─────────

const OPCOES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

function chaves() {
  const url = amb("SUPABASE_URL");
  const publica = amb("SUPABASE_PUBLISHABLE_KEY");
  const secreta = amb("SUPABASE_SECRET_KEY");
  if (!url || !publica || !secreta)
    throw new ErroIdentidade("O login ainda não está configurado: faltam SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY.");
  return { url, publica, secreta };
}

/** Um cliente novo por conferência: a sessão de uma pessoa nunca fica num cliente que outra requisição usa. */
const clienteDeUsuario = () => createClient(chaves().url, chaves().publica, OPCOES);
let admin: SupabaseClient | null = null;
const clienteAdmin = () => (admin ??= createClient(chaves().url, chaves().secreta, OPCOES));

function falhou(acao: string, erro: { message?: string; code?: string } | null): never {
  console.error(`Supabase Auth: ${acao}`, erro?.code ?? "", erro?.message ?? "");
  throw new ErroIdentidade("O serviço de login não respondeu. Tente de novo.");
}

function conferencia(cliente: SupabaseClient, usuarioId: string, email: string): Conferencia {
  return {
    usuarioId,
    email,
    async fatores() {
      const { data, error } = await cliente.auth.mfa.listFactors();
      if (error) falhou("listar os apps", error);
      return data.all.filter((f) => f.factor_type === "totp").map((f) => ({ id: f.id, verificado: f.status === "verified" }));
    },
    async cadastrarApp() {
      for (const f of await this.fatores()) if (!f.verificado) await cliente.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await cliente.auth.mfa.enroll({ factorType: "totp", friendlyName: `Painel ${Date.now()}` });
      if (error) falhou("cadastrar o app", error);
      return { fatorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret };
    },
    async conferirCodigo(fatorId, codigo) {
      const { error } = await cliente.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo });
      if (!error) return true;
      if (["mfa_verification_failed", "mfa_challenge_expired", "mfa_factor_not_found", "validation_failed"].includes(error.code ?? "")) return false;
      falhou("conferir o código", error);
    },
    async trocarSenha(nova) {
      const { error } = await cliente.auth.updateUser({ password: nova });
      if (!error) return;
      if (error.code === "same_password") throw new ErroIdentidade("A senha nova precisa ser diferente da atual.", 422);
      if (error.code === "weak_password") throw new ErroIdentidade("Senha fraca: misture letras, números e símbolos.", 422);
      falhou("trocar a senha", error);
    },
    async encerrar() {
      await cliente.auth.signOut({ scope: "local" }).catch(() => undefined);
    },
  };
}

const supabase: Identidade = {
  async conferirSenha(email, senha) {
    const cliente = clienteDeUsuario();
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
    if (error) {
      if (["invalid_credentials", "email_not_confirmed", "user_banned"].includes(error.code ?? "")) return null;
      falhou("conferir a senha", error);
    }
    return conferencia(cliente, data.user.id, data.user.email ?? email);
  },

  async abrirLink(tokenHash, tipo) {
    const cliente = clienteDeUsuario();
    const { data, error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: tipo === "convite" ? "invite" : "recovery" });
    if (error || !data.user) {
      if (!error || ["otp_expired", "invite_not_found", "validation_failed"].includes(error.code ?? "") || error.status === 403) return null;
      falhou("abrir o link", error);
    }
    return conferencia(cliente, data.user.id, data.user.email ?? "");
  },

  async convidar(email) {
    const { data, error } = await clienteAdmin().auth.admin.generateLink({ type: "invite", email });
    if (!error) return { usuarioId: data.user.id, tokenHash: data.properties.hashed_token, tipo: "convite" };
    if (error.code !== "email_exists" && error.code !== "user_already_exists") falhou("convidar", error);
    return { ...(await this.linkDeSenha(email)), tipo: "senha" };
  },

  async linkDeSenha(email) {
    const { data, error } = await clienteAdmin().auth.admin.generateLink({ type: "recovery", email });
    if (error) falhou("gerar o link de senha", error);
    return { usuarioId: data.user.id, tokenHash: data.properties.hashed_token };
  },

  async criarConta(email, senha) {
    const { data, error } = await clienteAdmin().auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (!error) return data.user.id;
    if (error.code !== "email_exists" && error.code !== "user_already_exists") falhou("criar a conta", error);
    return (await this.linkDeSenha(email)).usuarioId; // já existe: o link (não enviado) só serve para achar o id
  },

  async apagarConta(usuarioId) {
    const { error } = await clienteAdmin().auth.admin.deleteUser(usuarioId);
    if (error && error.code !== "user_not_found") falhou("apagar a conta", error);
  },

  async zerarApps(usuarioId) {
    const mfa = clienteAdmin().auth.admin.mfa;
    const { data, error } = await mfa.listFactors({ userId: usuarioId });
    if (error) falhou("listar os apps", error);
    for (const f of data.factors) {
      const r = await mfa.deleteFactor({ id: f.id, userId: usuarioId });
      if (r.error) falhou("tirar o app", r.error);
    }
  },
};

let atual: Identidade = supabase;

export const identidade = () => atual;

/** Os testes trocam o Supabase por um provedor em memória; sem argumento, volta o Supabase. */
export function usarIdentidade(outra?: Identidade): void {
  atual = outra ?? supabase;
}
