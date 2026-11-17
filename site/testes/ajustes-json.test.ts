// O JSON dos ajustes: o postgres.js não pode passar o texto pelo JSON.stringify de novo, e o que foi gravado assim
// antes da correção (texto com JSON dentro, em camadas) ainda precisa valer no site.
import { beforeEach, describe, expect, it } from "vitest";
import { TIPOS, desembrulhar } from "../src/servidor/banco";
import { limparCache, ofertas, produto } from "../src/servidor/catalogo";
import { esquecer } from "../src/servidor/config";
import { bancoNovo } from "./apoio";

describe("JSON dos ajustes", () => {
  it("o texto JSON vai para o banco como está; o objeto ainda é convertido", () => {
    expect(TIPOS.json.serialize('{"kit1":{"preco_centavos":2490}}')).toBe('{"kit1":{"preco_centavos":2490}}');
    expect(TIPOS.json.serialize('"Kit Barbeador"')).toBe('"Kit Barbeador"');
    expect(TIPOS.json.serialize({ a: 1 })).toBe('{"a":1}');
    expect(TIPOS.json.parse('{"a":1}')).toEqual({ a: 1 });
  });

  it("abre as camadas do que foi gravado errado e deixa o texto comum em paz", () => {
    expect(desembrulhar('{"kit1":{"preco_centavos":2490}}')).toEqual({ kit1: { preco_centavos: 2490 } });
    expect(desembrulhar('"\\"Kit Barbeador com 21 Refis\\""')).toBe("Kit Barbeador com 21 Refis");
    expect(desembrulhar("22")).toBe(22);
    expect(desembrulhar("true")).toBe(true);
    expect(desembrulhar("Kit Barbeador")).toBe("Kit Barbeador");
    expect(desembrulhar("3 lâminas")).toBe("3 lâminas"); // começa com número mas não é JSON
    expect(desembrulhar({ a: 1 })).toEqual({ a: 1 });
  });

  describe("no site", () => {
    let pg: Awaited<ReturnType<typeof bancoNovo>>;
    beforeEach(async () => {
      pg = await bancoNovo();
      esquecer();
      limparCache();
    });

    it("as ofertas, os refis e o nome gravados como texto em camadas valem como o vendedor salvou", async () => {
      const gravar = (chave: string, texto: string) =>
        pg.query("insert into loja.ajustes (chave, valor, atualizado_em) values ($1, $2::json, now())", [chave, texto]);
      // como estava no Supabase: cada valor é um texto JSON (json_typeof = 'string')
      await gravar("ofertas", JSON.stringify(JSON.stringify({ kit1: { preco_centavos: 2490 }, kit2: { preco_centavos: 4690 } })));
      await gravar("refis", JSON.stringify("22"));
      await gravar("nome", JSON.stringify(JSON.stringify(JSON.stringify("Kit Barbeador com 22 Refis"))));

      const lista = await ofertas();
      expect(lista.find((o) => o.id === "kit1")?.preco_centavos).toBe(2490);
      expect(lista.find((o) => o.id === "kit2")?.preco_centavos).toBe(4690);
      const kit = await produto();
      expect(kit.refis).toBe(22);
      expect(kit.nome).toBe("Kit Barbeador com 22 Refis");
    });
  });
});
