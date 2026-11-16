// O cache das respostas públicas, o mapa do site e o robots.txt.
import { beforeEach, describe, expect, it } from "vitest";
import { limparCache } from "../src/servidor/catalogo";
import { fotoOtimizada } from "../src/servidor/cdn";
import { esquecer } from "../src/servidor/config";
import { GET as rotaLoja } from "../src/pages/api/loja";
import { GET as rotaVitrine } from "../src/pages/api/vitrine";
import { GET as rotaSitemap } from "../src/pages/sitemap.xml";
import { GET as rotaRobots } from "../src/pages/robots.txt";
import { bancoNovo } from "./apoio";

describe("cache das respostas públicas", () => {
  beforeEach(async () => {
    await bancoNovo();
    esquecer();
    limparCache();
  });

  it("a API pública sai sem guardar no navegador (cada visita pergunta ao servidor)", async () => {
    for (const rota of [rotaLoja, rotaVitrine]) {
      const resposta = await rota({ request: new Request("http://localhost/api/x") } as any);
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
      expect(resposta.headers.get("Netlify-CDN-Cache-Control")).toBeNull();
    }
  });

  it("as fotos saem com o endereço original (sem a Image CDN da Netlify)", () => {
    expect(fotoOtimizada("/produtos/pomada/foto?v=2", 640)).toBe("/produtos/pomada/foto?v=2");
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
