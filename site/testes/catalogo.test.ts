// O catálogo do kit, os produtos, a vitrine e as fotos.
import { beforeEach, describe, expect, it } from "vitest";
import { definirAdministrador, entrar } from "../src/servidor/acesso";
import { limparCache } from "../src/servidor/catalogo";
import { esquecer } from "../src/servidor/config";
import { configDaLanding } from "../src/servidor/loja";
import { GET as rotaLoja } from "../src/pages/api/loja";
import { GET as rotaVitrine } from "../src/pages/api/vitrine";
import { GET as rotaProduto } from "../src/pages/api/produtos/[slug]";
import { GET as rotaCatalogo, PUT as rotaSalvarCatalogo } from "../src/pages/api/vendedor/catalogo";
import { PUT as rotaFotoKit } from "../src/pages/api/vendedor/foto";
import { GET as rotaVerFotoKit } from "../src/pages/produto/foto";
import { GET as rotaProdutos, POST as rotaCriar } from "../src/pages/api/vendedor/produtos/index";
import { DELETE as rotaExcluir, PUT as rotaAlterar } from "../src/pages/api/vendedor/produtos/[slug]/index";
import { bancoNovo, chamar } from "./apoio";

const POMADA = {
  nome: "Pomada Modeladora",
  chamada: "Fixação forte, efeito seco",
  descricao: "Para o dia todo.",
  unidade: "pote",
  unidade_plural: "potes",
  conteudo: "1 pote de 120 g",
  peso_g: 180,
  comprimento_cm: 10,
  largura_cm: 10,
  altura_cm: 6,
  frete_gratis_a_partir: 3,
  categoria: "Cabelo",
  selo: "Novo",
  destaque: true,
  ofertas: [
    { quantidade: 2, preco_centavos: 6990, selo: "Leve 2" },
    { quantidade: 1, preco_centavos: 3990 },
  ],
  montar: { ativo: true, maximo: 6, preco_unidade_centavos: 3290 },
};

let token = "";

async function chamarComParams(rota: any, params: Record<string, string>, opcoes: any = {}) {
  return chamar((ctx) => rota({ ...ctx, params }), opcoes);
}

describe("catálogo e produtos", () => {
  beforeEach(async () => {
    await bancoNovo();
    esquecer();
    limparCache();
    await definirAdministrador("vendedor@exemplo.com", "senha-de-teste-123");
    token = (await entrar("vendedor@exemplo.com", "senha-de-teste-123")).token;
  });

  it("o resumo da loja traz o kit com as ofertas padrão e o desconto do Pix", async () => {
    const { status, dados } = await chamar(rotaLoja);
    expect(status).toBe(200);
    expect(dados.nome).toBe("Wolf & Co");
    expect(dados.ofertas.map((o: any) => o.id)).toEqual(["kit1", "kit2", "kit3"]);
    expect(dados.ofertas[1].descricao).toBe("Kit Barbeador 3 Lâminas - 2 Kits (2 aparelhos + 38 refis)");
    expect(dados.oferta_padrao).toBe("kit2");
    expect(dados.foto).toBe("/assets/img/kit-foto.jpg");
    expect(dados.montar).toMatchObject({ ativo: true, minimo: 4 });
    expect(dados.testes).toBe(true);
  });

  it("o vendedor muda preço, refis e oferta, e vale na hora", async () => {
    expect((await chamar(rotaCatalogo)).status).toBe(401);
    const ruim = await chamar(rotaSalvarCatalogo, { metodo: "PUT", corpo: { refis: 0 }, token });
    expect(ruim).toMatchObject({ status: 422, dados: { erro: "Refis por kit: de 1 a 200." } });
    const nenhuma = await chamar(rotaSalvarCatalogo, {
      metodo: "PUT",
      corpo: { ofertas: { kit1: { preco_centavos: 2000, ativa: false } } },
      token,
    });
    expect(nenhuma.dados.erro).toBe("Deixe pelo menos uma oferta ativa.");

    const ok = await chamar(rotaSalvarCatalogo, {
      metodo: "PUT",
      corpo: {
        refis: 22,
        nome: "Kit Wolf",
        ofertas: { kit1: { preco_centavos: 2190, selo: "", ativa: true }, kit2: { preco_centavos: 3990, ativa: false } },
        frete_gratis_a_partir: 0,
      },
      token,
    });
    expect(ok.status).toBe(200);
    const loja = (await chamar(rotaLoja)).dados;
    expect(loja.produto.refis).toBe(22);
    expect(loja.ofertas.map((o: any) => o.id)).toEqual(["kit1", "kit3"]);
    expect(loja.ofertas[0].preco_centavos).toBe(2190);
    expect(loja.oferta_padrao).toBe("kit1"); // a padrão (kit2) saiu
    expect(loja.frete_gratis_a_partir).toBe(0);

    const landing = await configDaLanding();
    expect(landing.produto).toMatchObject({ nome: "Kit Wolf", refis: 22 });
    expect(landing.ofertas[0]).toMatchObject({ id: "kit1", preco: 21.9, checkoutUrl: "/checkout?oferta=kit1" });
  });

  it("a foto do kit: confere o tipo e serve com versão", async () => {
    const ruim = await chamar(
      async (ctx) => {
        const req = new Request(ctx.request.url, { method: "PUT", headers: { ...Object.fromEntries(ctx.request.headers), "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]) });
        return rotaFotoKit({ ...ctx, request: req } as any);
      },
      { token },
    );
    expect(ruim.status).toBe(422);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const ok = await chamar(
      async (ctx) => {
        const req = new Request(ctx.request.url, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "image/png" }, body: png });
        return rotaFotoKit({ ...ctx, request: req } as any);
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.dados.foto).toMatch(/^\/produto\/foto\?v=\d+$/);
    const resposta = await rotaVerFotoKit();
    expect(resposta.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await resposta.arrayBuffer())).toEqual(png);
  });

  it("cria, mostra na vitrine, altera e exclui um produto", async () => {
    const criado = await chamar(rotaCriar, { corpo: POMADA, token });
    expect(criado.status).toBe(200);
    expect(criado.dados).toMatchObject({ slug: "pomada-modeladora", url: "/p/pomada-modeladora", foto: "/assets/img/produto.svg" });
    expect(criado.dados.ofertas.map((o: any) => o.quantidade)).toEqual([1, 2]);
    expect(criado.dados.montar_limites).toEqual({ ativo: true, minimo: 3, maximo: 6, preco_kit_centavos: 3290 });

    const repetido = await chamar(rotaCriar, { corpo: POMADA, token });
    expect(repetido.dados.erro).toBe("Já existe um produto com o endereço /p/pomada-modeladora.");

    const publico = await chamarComParams(rotaProduto, { slug: "pomada-modeladora" });
    expect(publico.dados).toMatchObject({ id: "pomada-modeladora", oferta_padrao: "q1", unidade: "pote" });
    expect(publico.dados.ofertas[1]).toMatchObject({ id: "q2", titulo: "2 Potes", selo: "Leve 2", frete_gratis: false });

    const vitrine = (await chamar(rotaVitrine)).dados;
    expect(vitrine.categorias).toEqual(["Barbear", "Cabelo"]);
    const pomada = vitrine.itens.find((i: any) => i.id === "pomada-modeladora");
    expect(pomada).toMatchObject({ a_partir_de_centavos: 3990, por_unidade_centavos: 3495, comprar: "/checkout?produto=pomada-modeladora&oferta=q1" });

    const alterado = await chamarComParams(rotaAlterar, { slug: "pomada-modeladora" }, { metodo: "PUT", corpo: { ...POMADA, ativo: false }, token });
    expect(alterado.dados.ativo).toBe(false);
    expect((await chamarComParams(rotaProduto, { slug: "pomada-modeladora" })).status).toBe(404);
    expect((await chamar(rotaProdutos, { token })).dados).toHaveLength(1);

    const excluido = await chamarComParams(rotaExcluir, { slug: "pomada-modeladora" }, { metodo: "DELETE", token });
    expect(excluido.dados).toEqual({ ok: true });
    expect((await chamar(rotaProdutos, { token })).dados).toHaveLength(0);
  });

  it("confere o cadastro do produto", async () => {
    const semOferta = await chamar(rotaCriar, { corpo: { ...POMADA, ofertas: [] }, token });
    expect(semOferta.dados.erro).toBe("Cadastre de 1 a 4 ofertas (1 unidade, 2 unidades...).");
    const dupla = await chamar(rotaCriar, { corpo: { ...POMADA, ofertas: [{ quantidade: 1, preco_centavos: 100 }, { quantidade: 1, preco_centavos: 200 }] }, token });
    expect(dupla.dados.erro).toBe("Duas ofertas com 1 unidades.");
    const montar = await chamar(rotaCriar, { corpo: { ...POMADA, montar: { ativo: true, maximo: 2, preco_unidade_centavos: 3000 } }, token });
    expect(montar.dados.erro).toBe("Máximo do “monte o seu”: de 3 a 30.");
  });
});
