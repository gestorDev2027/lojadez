// O cache da CDN da Netlify, o mapa do site e o robots.txt.
import { beforeEach, describe, expect, it } from "vitest";
import { limparCache } from "../src/servidor/catalogo";
import { mudaAVitrine } from "../src/servidor/cdn";
import { esquecer } from "../src/servidor/config";
import { GET as rotaLoja } from "../src/pages/api/loja";
import { GET as rotaVitrine } from "../src/pages/api/vitrine";
import { GET as rotaSitemap } from "../src/pages/sitemap.xml";
import { GET as rotaRobots } from "../src/pages/robots.txt";
import { bancoNovo, chamar } from "./apoio";

describe("cache da CDN", () => {
  beforeEach(async () => {
    await bancoNovo();
    esquecer();
    limparCache();
  });

  it("a API pública vai para o cache da CDN com a etiqueta da loja; o navegador não guarda", async () => {
    for (const rota of [rotaLoja, rotaVitrine]) {
      const resposta = await rota({ request: new Request("http://localhost/api/x") } as any);
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("Netlify-CDN-Cache-Control")).toMatch(/^public, durable, s-maxage=\d+/);
      expect(resposta.headers.get("Netlify-Cache-Tag")).toBe("loja");
      expect(resposta.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    }
  });

  it("só as mudanças do vendedor no que aparece na vitrine limpam o cache", () => {
    expect(mudaAVitrine("PUT", "/api/vendedor/catalogo")).toBe(true);
    expect(mudaAVitrine("POST", "/api/vendedor/produtos")).toBe(true);
    expect(mudaAVitrine("DELETE", "/api/vendedor/produtos/pomada/foto")).toBe(true);
    expect(mudaAVitrine("PUT", "/api/vendedor/configuracoes")).toBe(true);
    expect(mudaAVitrine("GET", "/api/vendedor/catalogo")).toBe(false);
    expect(mudaAVitrine("POST", "/api/vendedor/entrar")).toBe(false);
    expect(mudaAVitrine("PUT", "/api/vendedor/senha")).toBe(false);
  });

  it("o mapa do site traz a landing, a vitrine e o robots aponta para ele", async () => {
    const url = new URL("http://localhost:4321/sitemap.xml");
    const xml = await (await rotaSitemap({ url })).text();
    expect(xml).toContain("<loc>http://localhost:4321/</loc>");
    expect(xml).toContain("<loc>http://localhost:4321/produtos</loc>");
    const robots = await (await rotaRobots({ url })).text();
    expect(robots).toContain("Disallow: /vendedor");
    expect(robots).toContain("Sitemap: http://localhost:4321/sitemap.xml");
  });
});
