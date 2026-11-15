// A aba Configurações: banco > ambiente > padrão, segredos que nunca voltam para a tela, conferência e auditoria.
import { beforeEach, describe, expect, it } from "vitest";
import { entrar, definirAdministrador } from "../src/servidor/acesso";
import { cfg, conferir, descontoPix, esquecer, montar } from "../src/servidor/config";
import { GET as rotaLer, PUT as rotaSalvar } from "../src/pages/api/vendedor/configuracoes/index";
import { POST as rotaImportar } from "../src/pages/api/vendedor/configuracoes/importar";
import { bancoNovo, chamar } from "./apoio";

const EMAIL = "vendedor@exemplo.com";
const SENHA = "senha-de-teste-123";
let token = "";

describe("configurações", () => {
  beforeEach(async () => {
    for (const chave of ["LOJA_NOME", "INFINITEPAY_API_KEY", "INFINITEPAY_DESCONTO_PIX", "LOGGI_AMBIENTE", "LOJA_ADMIN_EMAIL"])
      delete process.env[chave];
    await bancoNovo();
    esquecer();
    await definirAdministrador(EMAIL, SENHA);
    token = (await entrar(EMAIL, SENHA)).token;
  });

  it("monta a configuração: banco vale sobre o ambiente, que vale sobre o padrão", () => {
    expect(montar().LOJA_NOME).toBe("Wolf & Co");
    process.env.LOJA_NOME = "Do Ambiente";
    expect(montar().LOJA_NOME).toBe("Do Ambiente");
    expect(montar({ LOJA_NOME: "Do Banco" }).LOJA_NOME).toBe("Do Banco");
    const c = montar({ INFINITEPAY_DESCONTO_PIX: "80", PRODUTO_DIMENSOES_CM: "10x20x3", INFINITEPAY_HANDLE: "$loja" });
    expect(c.INFINITEPAY_DESCONTO_PIX).toBe(50);
    expect([c.PRODUTO.comprimento_cm, c.PRODUTO.largura_cm, c.PRODUTO.altura_cm]).toEqual([10, 20, 3]);
    expect(c.INFINITEPAY_HANDLE).toBe("loja");
    // desconto no Pix no modo real só com a API Key
    const real = montar({ INFINITEPAY_AMBIENTE: "real", INFINITEPAY_DESCONTO_PIX: "5", INFINITEPAY_HANDLE: "loja" });
    expect(descontoPix(real)).toBe(0);
    expect(conferir(real)).toContain("InfinitePay: o desconto no Pix só vale com a API Key do Checkout Integrado.");
  });

  it("salva com a senha, guarda o segredo sem devolver o valor e registra quem mudou", async () => {
    expect((await chamar(rotaLer)).status).toBe(401);

    const semSenha = await chamar(rotaSalvar, { metodo: "PUT", corpo: { valores: { LOJA_NOME: "Nova" } }, token });
    expect(semSenha.status).toBe(401);

    const ruim = await chamar(rotaSalvar, {
      metodo: "PUT",
      corpo: { senha: SENHA, valores: { LOJA_WHATSAPP: "123" } },
      token,
    });
    expect(ruim.status).toBe(422);
    expect(ruim.dados.erro).toBe("WhatsApp: 12 ou 13 números.");

    const ok = await chamar(rotaSalvar, {
      metodo: "PUT",
      corpo: {
        senha: SENHA,
        valores: { LOJA_NOME: "  Wolf   & Co  ", INFINITEPAY_API_KEY: "inchk_segredo", INFINITEPAY_DESCONTO_PIX: "5,5", SITE_URL: "https://loja.com.br/" },
      },
      token,
    });
    expect(ok.status).toBe(200);
    const campos = Object.fromEntries(ok.dados.campos.map((c: any) => [c.chave, c]));
    expect(campos.LOJA_NOME).toMatchObject({ valor: "Wolf & Co", origem: "banco" });
    expect(campos.SITE_URL.valor).toBe("https://loja.com.br");
    expect(campos.INFINITEPAY_DESCONTO_PIX.valor).toBe("5.5");
    expect(campos.INFINITEPAY_API_KEY).toMatchObject({ configurado: true });
    expect(JSON.stringify(ok.dados)).not.toContain("inchk_segredo");
    expect(ok.dados.mudancas[0]).toMatchObject({ acao: "configuracao", email: EMAIL });
    expect(ok.dados.mudancas[0].detalhe).not.toContain("inchk_segredo");

    const atual = await cfg();
    expect(atual.INFINITEPAY_API_KEY).toBe("inchk_segredo");
    expect(atual.INFINITEPAY_DESCONTO_PIX).toBe(5.5);

    // apagar o segredo
    const apagou = await chamar(rotaSalvar, {
      metodo: "PUT",
      corpo: { senha: SENHA, valores: {}, apagar_segredos: ["INFINITEPAY_API_KEY", "LOJA_NOME"] },
      token,
    });
    expect(apagou.dados.campos.find((c: any) => c.chave === "INFINITEPAY_API_KEY").configurado).toBe(false);
  });

  it("recusa campo desconhecido sem gravar nada", async () => {
    const r = await chamar(rotaSalvar, {
      metodo: "PUT",
      corpo: { senha: SENHA, valores: { LOJA_NOME: "Gravaria", NAO_EXISTE: "x" } },
      token,
    });
    expect(r.status).toBe(422);
    expect((await chamar(rotaLer, { token })).dados.campos.find((c: any) => c.chave === "LOJA_NOME").origem).toBe("padrao");
  });

  it("leva para o banco o que está no ambiente", async () => {
    process.env.LOGGI_AMBIENTE = "staging";
    process.env.INFINITEPAY_API_KEY = "inchk_do_ambiente";
    const antes = await chamar(rotaLer, { token });
    expect(antes.dados.no_env).toEqual(expect.arrayContaining(["LOGGI_AMBIENTE", "INFINITEPAY_API_KEY"]));
    const r = await chamar(rotaImportar, { corpo: { senha: SENHA }, token });
    expect(r.status).toBe(200);
    expect(r.dados.no_env).toEqual([]);
    const campos = Object.fromEntries(r.dados.campos.map((c: any) => [c.chave, c]));
    expect(campos.LOGGI_AMBIENTE).toMatchObject({ valor: "staging", origem: "banco" });
    expect(campos.INFINITEPAY_API_KEY).toMatchObject({ configurado: true, origem: "banco" });
    delete process.env.LOGGI_AMBIENTE;
    delete process.env.INFINITEPAY_API_KEY;
  });
});
