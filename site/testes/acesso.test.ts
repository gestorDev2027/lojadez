// Os acessos ao painel: login com senha e app autenticador, sessão em cookie, permissões por rota, convites e as
// regras do dono. O Supabase Auth é o provedor em memória de testes/apoio.ts (o código certo do app é 123456).
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it } from "vitest";
import { alterar, entrar, esquecerAcessoDoAmbiente, sessao } from "../src/servidor/acesso";
import { permissaoDaRota, rota, vendedor } from "../src/servidor/http";
import { POST as rotaEntrar } from "../src/pages/api/vendedor/entrar";
import { GET as rotaEu } from "../src/pages/api/vendedor/eu";
import { POST as rotaSair } from "../src/pages/api/vendedor/sair";
import { POST as rotaSenha } from "../src/pages/api/vendedor/senha";
import { POST as rotaLink } from "../src/pages/api/vendedor/link";
import { GET as rotaListar, POST as rotaConvidar } from "../src/pages/api/vendedor/acessos/index";
import { DELETE as rotaRemover, PATCH as rotaAlterar } from "../src/pages/api/vendedor/acessos/[email]/index";
import { POST as rotaNovoLink } from "../src/pages/api/vendedor/acessos/[email]/link";
import { DELETE as rotaZerarApp } from "../src/pages/api/vendedor/acessos/[email]/app";
import { CODIGO_DO_APP, SENHA_DE_TESTE, bancoNovo, chamar, entrarComo, identidadeDeTeste } from "./apoio";
import type { PGlite } from "@electric-sql/pglite";

const DONO = "dono@exemplo.com";
const OPERACAO = "operacao@exemplo.com";
let db: PGlite;

/** Uma rota qualquer do painel no caminho dado (para conferir a permissão de cada área). */
const rotaQualquer = rota(async (ctx) => ({ email: await vendedor(ctx) }));
const naRota = (caminho: string, token: string, metodo = "GET", cabecalhos: Record<string, string> = {}) =>
  chamar(rotaQualquer, { caminho, token, metodo, cabecalhos });
const comEmail = (r: any, email: string) => (ctx: APIContext) => r({ ...ctx, params: { email } });
const tokenDoCookie = (cabecalhos: Headers) => /loja_sessao=([^;]*)/.exec(cabecalhos.get("set-cookie") ?? "")?.[1] ?? "";

describe("acessos ao painel", () => {
  beforeEach(async () => {
    delete process.env.LOJA_ADMIN_EMAIL;
    delete process.env.LOJA_ADMIN_SENHA;
    esquecerAcessoDoAmbiente();
    db = await bancoNovo();
  });

  it("o primeiro dono vem das variáveis: cadastra o app e entra; a sessão vai num cookie HttpOnly", async () => {
    expect((await chamar(rotaEntrar, { corpo: { email: DONO, senha: SENHA_DE_TESTE } })).status).toBe(403); // ainda não há acesso

    process.env.LOJA_ADMIN_EMAIL = DONO;
    process.env.LOJA_ADMIN_SENHA = SENHA_DE_TESTE;
    esquecerAcessoDoAmbiente();
    const passo1 = await chamar(rotaEntrar, { corpo: { email: DONO, senha: SENHA_DE_TESTE } });
    expect(passo1.dados).toMatchObject({ etapa: "cadastrar_app", segredo: expect.any(String), qr: expect.stringContaining("data:") });
    expect(passo1.cabecalhos.get("set-cookie")).toBeNull();

    const errado = await chamar(rotaEntrar, { corpo: { email: DONO, senha: SENHA_DE_TESTE, codigo: "000000", fator_id: passo1.dados.fator_id } });
    expect(errado.status).toBe(401);

    const pronto = await chamar(rotaEntrar, {
      corpo: { email: DONO, senha: SENHA_DE_TESTE, codigo: CODIGO_DO_APP, fator_id: passo1.dados.fator_id },
    });
    expect(pronto.dados).toMatchObject({ etapa: "pronto", acesso: { email: DONO, papel: "dono" } });
    expect(JSON.stringify(pronto.dados)).not.toContain("token");
    const cookie = pronto.cabecalhos.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    const token = tokenDoCookie(pronto.cabecalhos);
    expect(token.length).toBeGreaterThan(40);

    const eu = await chamar(rotaEu, { token });
    expect(eu.dados).toMatchObject({ email: DONO, papel: "dono" });
    expect(eu.dados.permissoes).toContain("acessos");
    expect(eu.dados).not.toHaveProperty("usuario_id");

    // Da segunda vez, o app já está cadastrado: só pede o código.
    expect((await entrar(DONO, SENHA_DE_TESTE)).etapa).toBe("codigo");

    const saida = await chamar(rotaSair, { corpo: {}, token });
    expect(saida.cabecalhos.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await sessao(token)).toBeNull();
    expect((await chamar(rotaEu, { token })).status).toBe(401);
  });

  it("senha errada, conta sem acesso à loja e o bloqueio por tentativas", async () => {
    await entrarComo(DONO);
    await identidadeDeTeste.criarConta("de-fora@exemplo.com", SENHA_DE_TESTE); // tem conta no Supabase, não tem acesso
    await expect(entrar("de-fora@exemplo.com", SENHA_DE_TESTE)).rejects.toMatchObject({ status: 401, mensagem: "E-mail ou senha errados." });
    for (let i = 0; i < 4; i++) await expect(entrar(DONO, "errada-errada")).rejects.toMatchObject({ status: 401 });
    await expect(entrar(DONO, SENHA_DE_TESTE, "111111")).rejects.toMatchObject({ status: 401 }); // código errado conta também
    await expect(entrar(DONO, SENHA_DE_TESTE)).rejects.toMatchObject({ status: 429 });
  });

  it("cada área do painel confere a permissão; rota que ninguém mapeou é só do dono", async () => {
    expect(permissaoDaRota("/api/vendedor/estoque/pomada")).toBe("estoque");
    expect(permissaoDaRota("/api/vendedor/rota-nova")).toBe("acessos");
    expect(permissaoDaRota("/api/vendedor/eu")).toBeNull();

    const dono = await entrarComo(DONO);
    const op = await entrarComo(OPERACAO, "operacao", ["visao", "pedidos", "estoque"]);
    for (const caminho of ["/api/vendedor/eu", "/api/vendedor/painel", "/api/vendedor/pedidos", "/api/vendedor/estoque/sku"])
      expect((await naRota(caminho, op)).status, caminho).toBe(200);
    for (const caminho of ["/api/vendedor/configuracoes", "/api/vendedor/integracoes", "/api/vendedor/acessos", "/api/vendedor/rota-nova"])
      expect((await naRota(caminho, op)).status, caminho).toBe(403);
    expect((await chamar(rotaListar, { token: op, caminho: "/api/vendedor/acessos" })).status).toBe(403);
    for (const caminho of ["/api/vendedor/configuracoes", "/api/vendedor/acessos", "/api/vendedor/rota-nova"])
      expect((await naRota(caminho, dono)).status, caminho).toBe(200);
    expect((await naRota("/api/vendedor/eu", "")).status).toBe(401);
  });

  it("pedido que muda algo precisa vir da própria loja", async () => {
    const dono = await entrarComo(DONO);
    expect((await naRota("/api/vendedor/estoque", dono, "POST")).status).toBe(200);
    expect((await naRota("/api/vendedor/estoque", dono, "POST", { Origin: "https://outro-site.com" })).status).toBe(403);
    expect((await naRota("/api/vendedor/estoque", dono, "POST", { Origin: "", "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });

  it("o dono convida pelo link; a pessoa cria a senha, cadastra o app e entra só nas áreas dela", async () => {
    const dono = await entrarComo(DONO);
    const op = { caminho: "/api/vendedor/acessos", token: dono };
    const convite = await chamar(rotaConvidar, {
      ...op,
      corpo: { email: " Fulana@Exemplo.com ", nome: "Fulana", papel: "marketing", permissoes: ["produtos", "cupons", "acessos"] },
    });
    expect(convite.status).toBe(200);
    expect(convite.dados.acesso).toMatchObject({ email: "fulana@exemplo.com", papel: "marketing", permissoes: ["produtos", "cupons"], senha_criada: false });
    expect(convite.dados.link.url).toBe(`http://localhost/vendedor#convite=${convite.dados.link.token_hash}`);
    expect((await chamar(rotaConvidar, { ...op, corpo: { email: "fulana@exemplo.com", papel: "operacao" } })).status).toBe(409);
    expect((await chamar(rotaConvidar, { ...op, corpo: { email: "x@exemplo.com", papel: "chefe" } })).status).toBe(422);

    const link = { token_hash: convite.dados.link.token_hash, tipo: "convite" };
    expect((await chamar(rotaLink, { corpo: { ...link, senha: "curta" } })).status).toBe(422);
    const criada = await chamar(rotaLink, { corpo: { ...link, senha: "senha-da-fulana-1" } });
    expect(criada.dados).toEqual({ email: "fulana@exemplo.com" });
    expect((await chamar(rotaLink, { corpo: { ...link, senha: "senha-da-fulana-2" } })).status).toBe(410); // uma vez só

    const passo = await entrar("fulana@exemplo.com", "senha-da-fulana-1");
    expect(passo.etapa).toBe("cadastrar_app");
    const pronto = await entrar("fulana@exemplo.com", "senha-da-fulana-1", CODIGO_DO_APP, passo.etapa === "cadastrar_app" ? passo.fator_id : "");
    expect(pronto.etapa).toBe("pronto");
    const token = pronto.etapa === "pronto" ? pronto.token : "";
    expect((await naRota("/api/vendedor/cupons", token)).status).toBe(200);
    expect((await naRota("/api/vendedor/pedidos", token)).status).toBe(403);

    // Com a senha criada, o link novo é de troca de senha.
    const novo = await chamar(comEmail(rotaNovoLink, "fulana@exemplo.com"), { ...op, caminho: "/api/vendedor/acessos/x/link", corpo: {} });
    expect(novo.dados.link.tipo).toBe("senha");

    const lista = await chamar(rotaListar, op);
    expect(lista.dados.acessos.map((a: any) => a.email)).toEqual([DONO, "fulana@exemplo.com"]);
    const auditoria = await db.query<{ detalhe: string }>("select detalhe from loja.auditoria where acao = 'acesso' order by id");
    expect(auditoria.rows.map((r) => r.detalhe)).toContain("Convidou fulana@exemplo.com: Marketing [produtos, cupons]");
  });

  it("bloquear, mudar permissões, trocar o celular e remover; ninguém mexe no próprio acesso", async () => {
    const dono = await entrarComo(DONO);
    let op = await entrarComo(OPERACAO, "operacao", ["visao", "pedidos", "estoque"]);
    const base = { token: dono, caminho: "/api/vendedor/acessos/x" };
    const alterarOp = (corpo: unknown) => chamar(comEmail(rotaAlterar, OPERACAO), { ...base, metodo: "PATCH", corpo });

    expect((await chamar(comEmail(rotaAlterar, DONO), { ...base, metodo: "PATCH", corpo: { ativo: false } })).status).toBe(409);
    expect((await chamar(comEmail(rotaRemover, DONO), { ...base, metodo: "DELETE" })).status).toBe(409);

    // Mudar as permissões vale na hora (a sessão continua).
    expect((await alterarOp({ permissoes: ["visao", "financeiro"] })).dados.permissoes).toEqual(["visao", "financeiro"]);
    expect((await naRota("/api/vendedor/financeiro", op)).status).toBe(200);
    expect((await naRota("/api/vendedor/estoque", op)).status).toBe(403);

    // Bloquear derruba a sessão e impede de entrar.
    await alterarOp({ ativo: false });
    expect((await naRota("/api/vendedor/eu", op)).status).toBe(401);
    await expect(entrar(OPERACAO, SENHA_DE_TESTE)).rejects.toMatchObject({ status: 403 });
    await alterarOp({ ativo: true });
    op = await entrarComo(OPERACAO, "operacao", ["visao"]);

    // Trocar o celular: tira o app, derruba a sessão; no próximo login, cadastra de novo.
    expect((await chamar(comEmail(rotaZerarApp, OPERACAO), { ...base, metodo: "DELETE" })).status).toBe(200);
    expect((await naRota("/api/vendedor/eu", op)).status).toBe(401);
    expect((await entrar(OPERACAO, SENHA_DE_TESTE)).etapa).toBe("cadastrar_app");

    // A loja sempre tem um dono ativo.
    await expect(alterar("outra@exemplo.com", DONO, { papel: "operacao" })).rejects.toMatchObject({ status: 409 });

    // Afiliado ainda não tem painel.
    await alterarOp({ papel: "afiliado" });
    await expect(entrar(OPERACAO, SENHA_DE_TESTE)).rejects.toMatchObject({ status: 403 });

    // Remover apaga o acesso e a conta.
    expect((await chamar(comEmail(rotaRemover, OPERACAO), { ...base, metodo: "DELETE" })).status).toBe(200);
    expect(identidadeDeTeste.contas.has(OPERACAO)).toBe(false);
    await expect(entrar(OPERACAO, SENHA_DE_TESTE)).rejects.toMatchObject({ status: 401 });
  });

  it("trocar a senha confere a atual e fecha as sessões", async () => {
    const token = await entrarComo(DONO);
    expect((await chamar(rotaSenha, { corpo: { atual: "errada-errada", nova: "outra-senha-longa" }, token })).status).toBe(422);
    expect((await chamar(rotaSenha, { corpo: { atual: SENHA_DE_TESTE, nova: "curta" }, token })).status).toBe(422);
    expect((await chamar(rotaSenha, { corpo: { atual: SENHA_DE_TESTE, nova: "outra-senha-longa" }, token })).status).toBe(200);
    expect(await sessao(token)).toBeNull();
    expect((await entrar(DONO, "outra-senha-longa")).etapa).toBe("codigo");
  });
});
