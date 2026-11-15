// O login do vendedor: compatível com as senhas que o servidor Python gravou, sessões e bloqueio.
import { beforeEach, describe, expect, it } from "vitest";
import { definirAdministrador, entrar, esquecerAcessoDoAmbiente, senhaConfere, sessao } from "../src/servidor/acesso";
import { POST as rotaEntrar } from "../src/pages/api/vendedor/entrar";
import { GET as rotaEu } from "../src/pages/api/vendedor/eu";
import { POST as rotaSair } from "../src/pages/api/vendedor/sair";
import { POST as rotaSenha } from "../src/pages/api/vendedor/senha";
import { GET as rotaPrimeiroAcesso } from "../src/pages/api/vendedor/primeiro-acesso";
import { bancoNovo, chamar } from "./apoio";

// Gerado pelo servidor Python (servidor/acesso.py, gerar_hash) para a senha "senha-de-teste-123".
const HASH_DO_PYTHON = "scrypt$16384$8$1$45lTAZlz7sd13Pt075Sd3g==$uoA52ScXYkiWuiazX9uaJRJ9x9K4A1FhdWvWHdEWI8w=";
const EMAIL = "vendedor@exemplo.com";
const SENHA = "senha-de-teste-123";

describe("acesso", () => {
  beforeEach(async () => {
    delete process.env.LOJA_ADMIN_EMAIL;
    delete process.env.LOJA_ADMIN_SENHA;
    esquecerAcessoDoAmbiente();
    const db = await bancoNovo();
    await db.query(
      "insert into loja.administradores (email, senha_hash, criado_em, atualizado_em) values ($1, $2, now(), now())",
      [EMAIL, HASH_DO_PYTHON],
    );
  });

  it("confere a senha gravada pelo Python", async () => {
    expect(await senhaConfere(SENHA, HASH_DO_PYTHON)).toBe(true);
    expect(await senhaConfere("outra-senha-qualquer", HASH_DO_PYTHON)).toBe(false);
    expect(await senhaConfere(SENHA, "lixo")).toBe(false);
  });

  it("entra, mostra quem é e sai", async () => {
    const errada = await chamar(rotaEntrar, { corpo: { email: EMAIL, senha: "errada-errada" } });
    expect(errada.status).toBe(401);
    expect(errada.dados.erro).toBe("E-mail ou senha errados.");

    const certa = await chamar(rotaEntrar, { corpo: { email: " Vendedor@Exemplo.com ", senha: SENHA } });
    expect(certa.status).toBe(200);
    expect(certa.dados.email).toBe(EMAIL);
    const token = certa.dados.token as string;
    expect(token.length).toBeGreaterThan(40);

    expect((await chamar(rotaEu)).status).toBe(401);
    expect((await chamar(rotaEu, { token })).dados).toEqual({ email: EMAIL });

    await chamar(rotaSair, { corpo: {}, token });
    expect(await sessao(token)).toBeNull();
    expect((await chamar(rotaEu, { token })).status).toBe(401);
  });

  it("bloqueia depois de cinco senhas erradas", async () => {
    const email = "bloqueio@exemplo.com";
    await definirAdministrador(email, "uma-senha-boa-1");
    for (let i = 0; i < 5; i++) await expect(entrar(email, "errada-errada")).rejects.toMatchObject({ status: 401 });
    await expect(entrar(email, "uma-senha-boa-1")).rejects.toMatchObject({ status: 429 });
  });

  it("troca a senha e fecha as sessões", async () => {
    const { token } = await entrar(EMAIL, SENHA);
    const curta = await chamar(rotaSenha, { corpo: { atual: SENHA, nova: "curta" }, token });
    expect(curta.status).toBe(422);
    const ok = await chamar(rotaSenha, { corpo: { atual: SENHA, nova: "nova-senha-longa" }, token });
    expect(ok.status).toBe(200);
    expect(await sessao(token)).toBeNull();
    await expect(entrar(EMAIL, "nova-senha-longa")).resolves.toMatchObject({ email: EMAIL });
  });

  it("cria o acesso das variáveis de ambiente e não deixa trocar a senha dele pela tela", async () => {
    await bancoNovo(); // sem administrador
    process.env.LOJA_ADMIN_EMAIL = "dono@exemplo.com";
    process.env.LOJA_ADMIN_SENHA = "senha-do-ambiente";
    esquecerAcessoDoAmbiente();
    const { token } = await entrar("dono@exemplo.com", "senha-do-ambiente");
    const troca = await chamar(rotaSenha, { corpo: { atual: "senha-do-ambiente", nova: "outra-senha-longa" }, token });
    expect(troca.status).toBe(409);
  });

  it("não tem tela de primeiro acesso", async () => {
    expect((await chamar(rotaPrimeiroAcesso)).dados).toEqual({ disponivel: false });
  });
});
