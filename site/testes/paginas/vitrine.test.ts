// A vitrine e a página do produto em Astro: o HTML sai pronto do servidor (sem "Carregando…"), com o preço, o estoque, a
// transição da foto, o pré-carregamento e os dados de produto para o Google. Banco em memória (PGlite).
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { limparCache } from "../../src/servidor/catalogo";
import { esquecer } from "../../src/servidor/config";
import * as estoque from "../../src/servidor/estoque";
import { salvar } from "../../src/servidor/produtos";
import Compra from "../../src/components/produto/Compra.astro";
import PaginaProduto from "../../src/pages/p/[slug].astro";
import Vitrine from "../../src/pages/produtos.astro";
import { bancoNovo } from "../apoio";

const POMADA = {
  nome: "Pomada Modeladora", unidade: "pote", unidade_plural: "potes", peso_g: 180, comprimento_cm: 10, largura_cm: 10, altura_cm: 6,
  categoria: "Cabelo", chamada: "Fixação forte, efeito seco.", descricao: "Primeiro parágrafo.\n\nSegundo parágrafo.",
  ofertas: [{ quantidade: 1, preco_centavos: 3990 }, { quantidade: 2, preco_centavos: 6990, selo: "Mais pedido" }],
};

let container: AstroContainer;
const pedido = (caminho: string) => new Request(`http://localhost${caminho}`);
// O preço sai com espaço sem quebra ("R$ 39,90"): os testes comparam com espaço comum.
const texto = (html: string) => html.replaceAll(" ", " ");

// O Container do Astro não recebe a lista das Server Islands (no build, quem monta é o Astro): sem ela, o
// `server:defer` da página do produto falha. Só nestes testes, a lista vai pelo protótipo do manifesto (um objeto
// comum) e sai no fim.
const ARQUIVO_COMPRA = fileURLToPath(new URL("../../src/components/produto/Compra.astro", import.meta.url)).replaceAll("\\", "/");
beforeAll(() => {
  Object.defineProperty(Object.prototype, "serverIslandMappings", {
    configurable: true,
    value: async () => ({ serverIslandMap: new Map([["Compra", async () => ({ default: Compra })]]), serverIslandNameMap: new Map([[ARQUIVO_COMPRA, "Compra"]]) }),
  });
});
afterAll(() => {
  delete (Object.prototype as Record<string, unknown>).serverIslandMappings;
});

async function produto(slug: string) {
  const r = await container.renderToResponse(PaginaProduto, { params: { slug }, request: pedido(`/p/${slug}`) });
  return { status: r.status, html: texto(await r.text()), cache: r.headers.get("Cache-Control") };
}

describe("vitrine e produto em Astro", () => {
  beforeEach(async () => {
    for (const v of ["LOGGI_AMBIENTE", "INFINITEPAY_AMBIENTE"]) delete process.env[v];
    await bancoNovo();
    esquecer();
    limparCache();
    await salvar(POMADA, null, null);
    container = await AstroContainer.create();
  });

  it("a vitrine sai pronta: cartões, categorias, foto com transição e link pré-carregado", async () => {
    const html = texto(await container.renderToString(Vitrine, { request: pedido("/produtos") }));
    expect(html).not.toContain("Carregando");
    expect(html).toContain("Pomada Modeladora");
    expect(html).toContain("Kit Barbeador 3 Lâminas");
    expect(html).toMatch(/data-categoria="Cabelo"/);
    expect(html).toContain("view-transition-name: foto-pomada-modeladora");
    expect(html).toMatch(/href="\/p\/pomada-modeladora" data-astro-prefetch/);
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain("R$ 39,90");
  });

  it("a página do produto: HTML pronto, a mesma foto da vitrine, dados para o Google e o bloco de compra", async () => {
    const r = await produto("pomada-modeladora");
    expect(r.status).toBe(200);
    expect(r.cache).toBe("public, max-age=0, must-revalidate"); // pública: o navegador sempre pergunta
    expect(r.html).toContain("<h1");
    expect(r.html).toContain("Fixação forte, efeito seco.");
    expect(r.html).toContain("<p>Segundo parágrafo.</p>");
    expect(r.html).toContain("view-transition-name: foto-pomada-modeladora");
    const jsonLd = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(r.html)![1]);
    expect(jsonLd).toMatchObject({
      "@type": "Product", name: "Pomada Modeladora", sku: "WLF-CAB-POMA-001", category: "Cabelo",
      offers: { lowPrice: "39.90", highPrice: "69.90", offerCount: 2, availability: "https://schema.org/InStock", priceCurrency: "BRL" },
    });
    // O bloco de compra aparece já com os dados do cache (funciona mesmo antes da Server Island chegar), e a ilha
    // busca o estoque da hora.
    expect(r.html).toContain("/_server-islands/Compra");
    expect(r.html).toContain("/checkout?produto=pomada-modeladora&amp;oferta=q2");
    expect(r.html).toContain("Mais pedido");
  });

  it("a Server Island traz o estoque da hora: últimas unidades e esgotado", async () => {
    await estoque.lancar("pomada-modeladora", { tipo: "entrada", quantidade: 3 }, null);
    let html = texto(await container.renderToString(Compra, { props: { slug: "pomada-modeladora" }, partial: true }));
    expect(html).toContain("Últimas 3 unidades");
    expect(html).toContain(">Comprar<");

    await estoque.lancar("pomada-modeladora", { tipo: "perda", quantidade: 3, motivo: "quebrou" }, null);
    html = texto(await container.renderToString(Compra, { props: { slug: "pomada-modeladora" }, partial: true }));
    expect(html).toContain("Esgotado · me avise no WhatsApp");
    expect(html).not.toContain(">Comprar<");
    expect((await produto("pomada-modeladora")).html).toContain("https://schema.org/OutOfStock");

    html = await container.renderToString(Compra, { props: { slug: "nao-existe" }, partial: true });
    expect(html).toContain("Este produto saiu de venda.");
  });

  it("produto que não existe ou foi desativado: 404 sem cache", async () => {
    const r = await produto("nao-existe");
    expect(r.status).toBe(404);
    expect(r.cache ?? "").not.toContain("public");
    expect(r.html).toContain("Produto não encontrado.");
  });
});
