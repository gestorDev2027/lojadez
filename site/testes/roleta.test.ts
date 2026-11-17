// A roleta de cupons: o sorteio no servidor, o mesmo cupom para o mesmo navegador, um cupom da roleta por CPF, o valor
// mínimo e o cupom da próxima compra (preso ao CPF do pedido pago).
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { banco } from "../src/servidor/banco";
import { limparCache } from "../src/servidor/catalogo";
import { esquecer, premios } from "../src/servidor/config";
import * as pedidos from "../src/servidor/pedidos";
import { sortear } from "../src/servidor/roleta";
import { POST as rotaRoleta } from "../src/pages/api/roleta";
import { GET as rotaVerPremio, POST as rotaGirarPedido } from "../src/pages/api/pedidos/[nsu]/roleta";
import { POST as rotaCupom } from "../src/pages/api/cupons/validar";
import { bancoNovo, chamar } from "./apoio";

const MARIA = { nome: "Maria da Silva", cpf: "529.982.247-25", email: "maria@exemplo.com", telefone: "(11) 98765-4321", cep: "01310-100", numero: "100" };
const JOSE = { ...MARIA, nome: "José Souza", cpf: "111.444.777-35", email: "jose@exemplo.com" };

vi.stubGlobal("fetch", async (entrada: any) => {
  if (String(entrada).startsWith("https://viacep.com.br/"))
    return Response.json({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" });
  throw new Error(`Chamada de rede inesperada no teste: ${entrada}`);
});

const comParams = (rota: any, params: Record<string, string>) => (ctx: APIContext) => rota({ ...ctx, params } as APIContext);

async function comprar(comprador: Record<string, string>, cupom?: string, oferta = "kit2") {
  const frete = await pedidos.cotarFrete(comprador.cep, oferta, null, cupom ?? null);
  return pedidos.criar({ oferta, ...comprador, frete_tipo: frete.opcoes[0].tipo, cupom });
}

const pagar = (nsu: string) => banco().consulta("update loja.pedidos set situacao = 'pago', pago_em = now() where order_nsu = $1", [nsu]);

/** Gira a roleta da página inicial (com o cookie de quem já girou, se houver). Cada chamada vem de um IP, para o limite
 * por minuto (5) não atrapalhar os testes. */
let ip = 0;
async function girar(cookie?: string) {
  const cabecalhos: Record<string, string> = { "X-Forwarded-For": `10.0.0.${++ip}` };
  if (cookie) cabecalhos.Cookie = cookie;
  const r = await chamar(rotaRoleta, { corpo: {}, cabecalhos });
  return { status: r.status, dados: r.dados, cabecalhos: r.cabecalhos, cookie: (r.cabecalhos.get("set-cookie") ?? "").split(";")[0] };
}

describe("roleta", () => {
  beforeEach(async () => {
    delete process.env.ROLETA_ATIVA;
    await bancoNovo();
    esquecer();
    limparCache();
  });
  afterEach(() => {
    delete process.env.ROLETA_ATIVA;
  });

  it("sorteia com o primeiro prêmio mais provável e lê os prêmios dos ajustes", () => {
    const saidas = [0, 1, 2, 3, 4, 5].map((n) => sortear([200, 300, 400], () => n));
    expect(saidas).toEqual([200, 200, 200, 300, 300, 400]);
    expect(premios("2, 3, 4")).toEqual([200, 300, 400]);
    expect(premios("5;5 10 0 99 abc")).toEqual([500, 1000]);
    expect(premios("")).toEqual([200, 300, 400]);
  });

  it("gira, devolve o mesmo cupom para o mesmo navegador e o cupom vale só a partir do mínimo", async () => {
    const primeira = await girar();
    expect(primeira.status).toBe(200);
    expect(primeira.dados.codigo).toMatch(/^LOBO-[A-Z2-9]{6}$/);
    expect([200, 300, 400]).toContain(primeira.dados.valor_centavos);
    expect(primeira.dados).toMatchObject({ minimo_centavos: 4000, origem: "roleta" });
    expect(primeira.cabecalhos.get("set-cookie")).toContain("HttpOnly");

    expect((await girar(primeira.cookie)).dados.codigo).toBe(primeira.dados.codigo);
    expect((await girar()).dados.codigo).not.toBe(primeira.dados.codigo); // outro navegador, outro cupom

    // o kit de 1 fica abaixo do mínimo; o de 2 usa
    const noKit1 = await chamar(rotaCupom, { corpo: { cupom: primeira.dados.codigo, oferta: "kit1" } });
    expect(noKit1.dados.erro).toBe("Este cupom vale a partir de R$ 40,00.");
    const noKit2 = await chamar(rotaCupom, { corpo: { cupom: primeira.dados.codigo, oferta: "kit2" } });
    expect(noKit2.dados.desconto_centavos).toBe(primeira.dados.valor_centavos);
  });

  it("cada CPF usa um cupom da roleta, e cada cupom serve uma vez", async () => {
    const a = (await girar()).dados;
    const b = (await girar()).dados;
    const { order_nsu } = await comprar(MARIA, a.codigo);
    const p = (await pedidos.buscar(order_nsu))!;
    expect(p).toMatchObject({ cupom_codigo: a.codigo, desconto_cupom_centavos: a.valor_centavos });

    await expect(comprar(MARIA, b.codigo)).rejects.toThrow("Este CPF já usou um cupom da roleta.");
    await expect(comprar(JOSE, a.codigo)).rejects.toThrow("Este cupom já foi usado.");
    // a prévia do checkout também avisa, quando o CPF já está preenchido
    const previa = await chamar(rotaCupom, { corpo: { cupom: b.codigo, oferta: "kit2", cpf: MARIA.cpf } });
    expect(previa.dados.erro).toBe("Este CPF já usou um cupom da roleta.");
    expect((await comprar(JOSE, b.codigo)).order_nsu).toBeTruthy();

    // depois de usado, o mesmo navegador ganha outro cupom
    const cookie = `loja_roleta=${a.codigo}`;
    expect((await girar(cookie)).dados.codigo).not.toBe(a.codigo);
  });

  it("o pedido pago gira a roleta da próxima compra: um cupom por pedido, só para o CPF dele", async () => {
    const { order_nsu } = await comprar(MARIA);
    const ver = comParams(rotaVerPremio, { nsu: order_nsu });
    const girarPedido = comParams(rotaGirarPedido, { nsu: order_nsu });

    expect((await chamar(ver)).dados).toEqual({ ativa: true, premio: null });
    expect((await chamar(girarPedido, { corpo: {} })).status).toBe(409); // ainda não pagou

    await pagar(order_nsu);
    const premio = (await chamar(girarPedido, { corpo: {} })).dados;
    expect(premio.codigo).toMatch(/^VOLTA-/);
    expect(premio.origem).toBe("volta");
    expect((await chamar(girarPedido, { corpo: {} })).dados.codigo).toBe(premio.codigo); // girar de novo não dá outro
    expect((await chamar(ver)).dados.premio.codigo).toBe(premio.codigo);

    await expect(comprar(JOSE, premio.codigo)).rejects.toThrow("Este cupom é de outro cliente");
    // Maria usa, mesmo já tendo usado (ou não) um cupom da roleta da página inicial
    const roleta = (await girar()).dados;
    await comprar(MARIA, roleta.codigo);
    const proxima = await comprar(MARIA, premio.codigo);
    expect((await pedidos.buscar(proxima.order_nsu))!.desconto_cupom_centavos).toBe(premio.valor_centavos);

    expect((await chamar(comParams(rotaVerPremio, { nsu: "nao-e-um-uuid" }))).status).toBe(404);
  });

  it("desligada nos ajustes, a roleta não gira", async () => {
    process.env.ROLETA_ATIVA = "nao";
    esquecer();
    const r = await girar();
    expect(r.status).toBe(404);
    expect(r.dados.erro).toBe("A roleta está desligada.");
  });
});
