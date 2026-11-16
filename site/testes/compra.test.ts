// A compra no Astro: frete, cupom, afiliado, pedido com reserva de estoque, pagamento (simulador da InfinitePay),
// webhook, conferência agendada e envio automático na Loggi (simulada). Nada sai para a Loggi nem para a InfinitePay:
// o ViaCEP é trocado por uma resposta fixa e, quando um teste usa a InfinitePay "real", a resposta também é fixa.
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { banco } from "../src/servidor/banco";
import { limparCache } from "../src/servidor/catalogo";
import { esquecer } from "../src/servidor/config";
import * as estoque from "../src/servidor/estoque";
import * as pedidos from "../src/servidor/pedidos";
import { salvar } from "../src/servidor/produtos";
import { POST as rotaFrete } from "../src/pages/api/frete";
import { POST as rotaCupom } from "../src/pages/api/cupons/validar";
import { POST as rotaClique } from "../src/pages/api/afiliados/clique";
import { POST as rotaPedido } from "../src/pages/api/pedidos/index";
import { GET as rotaVerPedido } from "../src/pages/api/pedidos/[nsu]/index";
import { POST as rotaConferir } from "../src/pages/api/pedidos/[nsu]/conferir";
import { GET as rotaRastreio } from "../src/pages/api/pedidos/[nsu]/rastreio";
import { POST as rotaWebhook } from "../src/pages/api/webhooks/infinitepay";
import { GET as rotaLink } from "../src/pages/l/[codigo]";
import { GET as rotaPagina } from "../src/pages/simulador/pagamento/[nsu]";
import { POST as rotaPagar } from "../src/pages/simulador/pagar/[nsu]";
import { bancoNovo, chamar } from "./apoio";

const VARIAVEIS = ["LOGGI_AMBIENTE", "LOGGI_ENVIO_AUTOMATICO", "INFINITEPAY_AMBIENTE", "INFINITEPAY_API_KEY", "INFINITEPAY_DESCONTO_PIX",
  "INFINITEPAY_HANDLE", "SITE_URL", "LOJA_ORIGEM_CEP"];

const COMPRADOR = {
  nome: "Maria da Silva", cpf: "529.982.247-25", email: "maria@exemplo.com", telefone: "(11) 98765-4321",
  cep: "01310-100", numero: "100", complemento: "ap 12",
};

const POMADA = {
  nome: "Pomada Modeladora", unidade: "pote", unidade_plural: "potes", peso_g: 180, comprimento_cm: 10, largura_cm: 10, altura_cm: 6,
  categoria: "Cabelo", ofertas: [{ quantidade: 1, preco_centavos: 3990 }, { quantidade: 2, preco_centavos: 6990 }],
};

/** O ViaCEP de mentira (e, quando o teste pede, a InfinitePay de mentira). */
let infinitepay: ((url: string, corpo: any) => Response) | null = null;
const fetchFalso = vi.fn(async (entrada: any, opcoes: any = {}) => {
  const url = String(entrada);
  if (url.startsWith("https://viacep.com.br/")) {
    return Response.json({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" });
  }
  if (url.startsWith("https://api.checkout.infinitepay.io") && infinitepay) return infinitepay(url, JSON.parse(opcoes.body));
  throw new Error(`Chamada de rede inesperada no teste: ${url}`);
});

/** Uma chamada com params (as rotas com [nsu], [codigo]). */
const comParams = (rota: any, params: Record<string, string>) => (ctx: APIContext) => rota({ ...ctx, params } as APIContext);

async function comprar(extra: Record<string, unknown> = {}) {
  const frete = await pedidos.cotarFrete(COMPRADOR.cep, extra.oferta ?? "kit2", extra.produto ?? null, extra.cupom ?? null);
  return pedidos.criar({ oferta: "kit2", ...COMPRADOR, frete_tipo: frete.opcoes[0].tipo, ...extra });
}

/** "Pagar" no simulador, como o navegador faria (formulário), e devolve os parâmetros da volta para /obrigado. */
async function pagarNoSimulador(orderNsu: string, forma = "pix") {
  const request = new Request(`http://localhost/simulador/pagar/${orderNsu}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `forma=${forma}`,
  });
  const r = await rotaPagar({ request, params: { nsu: orderNsu }, locals: {} } as unknown as APIContext);
  expect(r.status).toBe(303);
  return new URL(r.headers.get("Location")!);
}

const pedido = async (orderNsu: string) => (await pedidos.buscar(orderNsu))!;

describe("compra", () => {
  beforeEach(async () => {
    for (const v of VARIAVEIS) delete process.env[v];
    vi.stubGlobal("fetch", fetchFalso);
    infinitepay = null;
    await bancoNovo();
    esquecer();
    limparCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const v of VARIAVEIS) delete process.env[v];
  });

  it("cota o frete com o total de cada opção e o endereço pelo CEP", async () => {
    const r = await chamar(rotaFrete, { corpo: { cep: "01310100", oferta: "kit2" } });
    expect(r.status).toBe(200);
    expect(r.dados.endereco).toMatchObject({ cep: "01310100", rua: "Avenida Paulista", cidade: "São Paulo", uf: "SP" });
    expect(r.dados.produto_centavos).toBe(4490);
    expect(r.dados.opcoes).toHaveLength(2);
    for (const o of r.dados.opcoes) expect(o.total_centavos).toBe(4490 + o.centavos);
    expect(r.dados.frete_gratis).toBe(false);
    expect((await chamar(rotaFrete, { corpo: { cep: "123", oferta: "kit2" } })).dados.erro).toBe("CEP inválido: use os 8 números.");
    expect((await chamar(rotaFrete, { corpo: { cep: "01310100", oferta: "kit99" } })).dados.erro).toBe("Escolha um dos kits.");
  });

  it("compra completa: pedido, página do simulador, pagamento no Pix, webhook e volta para /obrigado", async () => {
    const frete = await pedidos.cotarFrete(COMPRADOR.cep, "kit2", null, null);
    // O preço que vem do navegador é ignorado.
    const criado = await chamar(rotaPedido, { corpo: { oferta: "kit2", ...COMPRADOR, frete_tipo: frete.opcoes[0].tipo, preco_centavos: 1 } });
    expect(criado.status).toBe(200);
    const { order_nsu, link_pagamento } = criado.dados;
    expect(link_pagamento).toBe(`http://localhost:4321/simulador/pagamento/${order_nsu}`);

    const p = await pedido(order_nsu);
    expect(p).toMatchObject({
      situacao: "aguardando_pagamento", preco_centavos: 4490, total_centavos: 4490 + frete.opcoes[0].centavos, kits: 2,
      cpf: "52998224725", telefone: "11987654321", rua: "Avenida Paulista", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP",
      complemento: "ap 12", sku: "MADE-BB006",
    });
    expect(p.produto).toContain("2 Kits");

    const pagina = await rotaPagina({ params: { nsu: order_nsu } } as unknown as APIContext);
    expect(await pagina.text()).toContain("Pagar com Pix");

    const volta = await pagarNoSimulador(order_nsu, "pix");
    expect(volta.pathname).toBe("/obrigado");
    expect(volta.searchParams.get("order_nsu")).toBe(order_nsu);
    expect(await pedido(order_nsu)).toMatchObject({ situacao: "pago", forma_pagamento: "pix", valor_pago_centavos: p.total_centavos, parcelas: 1 });

    // A página /obrigado confere de novo (repetir não muda nada).
    const conferido = await chamar(comParams(rotaConferir, { nsu: order_nsu }), {
      corpo: Object.fromEntries(volta.searchParams),
    });
    expect(conferido.dados).toMatchObject({ situacao: "pago", primeiro_nome: "Maria", link_pagamento: null });
    expect(conferido.dados).not.toHaveProperty("cpf");
    expect(conferido.dados).not.toHaveProperty("email");
    expect((await chamar(comParams(rotaVerPedido, { nsu: order_nsu }))).dados.situacao).toBe("pago");
    expect((await chamar(comParams(rotaRastreio, { nsu: order_nsu }))).dados).toEqual({ codigo: null, rastreio: null });
    expect((await chamar(comParams(rotaVerPedido, { nsu: "nao-e-um-uuid" }))).status).toBe(404);
  });

  it("o webhook falso não marca como pago, mas guarda os dados para conferir de novo", async () => {
    const { order_nsu } = await comprar();
    const r = await chamar(rotaWebhook, { corpo: { order_nsu, transaction_nsu: "abc", invoice_slug: "sim-pix-0000000000", amount: 1 } });
    expect(r).toEqual({ status: 200, dados: { ok: true } });
    expect(await pedido(order_nsu)).toMatchObject({ situacao: "aguardando_pagamento", transaction_nsu: "abc", slug: "sim-pix-0000000000" });
    expect((await chamar(rotaWebhook, { corpo: { nada: 1 } })).dados).toEqual({ ok: true }); // não é nosso: ignora
  });

  it("confere os dados do comprador e a opção de frete", async () => {
    const frete = await pedidos.cotarFrete(COMPRADOR.cep, "kit2", null, null);
    const base = { oferta: "kit2", ...COMPRADOR, frete_tipo: frete.opcoes[0].tipo };
    await expect(pedidos.criar({ ...base, nome: "Maria" })).rejects.toThrow("Informe nome e sobrenome.");
    await expect(pedidos.criar({ ...base, cpf: "111.111.111-11" })).rejects.toThrow("CPF inválido.");
    await expect(pedidos.criar({ ...base, email: "maria@" })).rejects.toThrow("E-mail inválido.");
    await expect(pedidos.criar({ ...base, telefone: "1234" })).rejects.toThrow("Telefone com DDD: 10 ou 11 números.");
    await expect(pedidos.criar({ ...base, numero: "" })).rejects.toThrow("Preencha o número.");
    await expect(pedidos.criar({ ...base, frete_tipo: "TELETRANSPORTE" })).rejects.toMatchObject({ status: 409 });
    expect(pedidos.cpfValido("52998224725")).toBe(true);
    expect(pedidos.cpfValido("52998224724")).toBe(false);
  });

  it("cupom de desconto e de frete grátis, com o afiliado do cupom e a comissão sobre o preço com desconto", async () => {
    const quando = new Date();
    await banco().consulta(
      `insert into loja.afiliados (codigo, nome, comissao_pct, produtos, criado_em, atualizado_em) values
         ('joao', 'João', 10, '[]', $1, $1), ('ana', 'Ana', 20, '[]', $1, $1)`, [quando]);
    await banco().consulta(
      `insert into loja.cupons (codigo, tipo, valor, produtos, afiliado_id, criado_em, atualizado_em) values
         ('JOAO10', 'percentual', 10, '[]', 1, $1, $1), ('FRETEGRATIS', 'frete', 0, '[]', null, $1, $1),
         ('VENCIDO', 'valor', 500, '[]', null, $1, $1)`, [quando]);
    await banco().consulta("update loja.cupons set fim = '2020-01-01' where codigo = 'VENCIDO'");

    expect((await chamar(rotaCupom, { corpo: { cupom: "joao10", oferta: "kit2" } })).dados).toEqual({
      codigo: "JOAO10", descricao: "10% de desconto", desconto_centavos: 449, frete_gratis: false,
    });
    expect((await chamar(rotaCupom, { corpo: { cupom: "VENCIDO", oferta: "kit2" } })).dados.erro).toBe("Este cupom já venceu.");
    expect((await chamar(rotaCupom, { corpo: { cupom: "", oferta: "kit2" } })).dados.erro).toBe("Digite o cupom.");

    const gratis = await pedidos.cotarFrete(COMPRADOR.cep, "kit2", null, "FRETEGRATIS");
    expect(gratis.frete_gratis).toBe(true);
    expect(gratis.opcoes[0]).toMatchObject({ centavos: 0, gratis: true });
    expect(gratis.opcoes[0].custo_centavos).toBeGreaterThan(0);

    // Veio pelo link da Ana, mas digitou o cupom do João: a venda é do João.
    const { order_nsu } = await comprar({ cupom: "JOAO10", ref: "ana" });
    expect(await pedido(order_nsu)).toMatchObject({
      cupom_codigo: "JOAO10", desconto_cupom_centavos: 449, afiliado_codigo: "joao", comissao_pct: 10, comissao_centavos: 404,
    });
    const soLink = await comprar({ ref: "ana", campanha: "naoexiste" });
    expect(await pedido(soLink.order_nsu)).toMatchObject({ afiliado_codigo: "ana", comissao_centavos: 898, campanha_codigo: null });
    await expect(comprar({ cupom: "VENCIDO" })).rejects.toThrow("Este cupom já venceu.");
  });

  it("o link curto da campanha conta o clique e leva ao destino com o afiliado", async () => {
    const quando = new Date();
    await banco().consulta(
      `insert into loja.afiliados (codigo, nome, comissao_pct, produtos, criado_em, atualizado_em) values ('ana', 'Ana', 20, '[]', $1, $1)`, [quando]);
    await banco().consulta(
      `insert into loja.campanhas (codigo, afiliado_id, nome, destino, oferta, produto_id, criado_em) values
         ('insta1', 1, 'Instagram', 'checkout', 'kit3', 'kit-laminas', $1)`, [quando]);
    const r = await rotaLink({ request: new Request("http://localhost/l/insta1"), params: { codigo: "insta1" }, clientAddress: "1.2.3.4" } as unknown as APIContext);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/checkout?oferta=kit3&ref=ana&cp=insta1&rc=1");
    const nada = await rotaLink({ request: new Request("http://localhost/l/x"), params: { codigo: "x" }, clientAddress: "1.2.3.4" } as unknown as APIContext);
    expect(nada.headers.get("Location")).toBe("/");
    expect((await chamar(rotaClique, { corpo: { ref: "ana" } })).dados).toEqual({ ok: true, dias: 30 });
    expect((await chamar(rotaClique, { corpo: { ref: "ninguem" } })).dados.ok).toBe(false);
    const cliques = await banco().consulta("select cliques from loja.afiliado_cliques");
    expect(cliques[0].cliques).toBe(2);
    const campanha = await banco().consulta("select cliques from loja.campanhas");
    expect(campanha[0].cliques).toBe(1);
  });

  it("o pedido reserva o estoque, o pagamento baixa e o que esgotou é recusado", async () => {
    await salvar(POMADA, null, null);
    await estoque.lancar("pomada-modeladora", { tipo: "entrada", quantidade: 3 }, null);
    const item = async () => (await estoque.painel()).itens.find((i) => i.produto_id === "pomada-modeladora")!;

    const a = await comprar({ produto: "pomada-modeladora", oferta: "q2" });
    expect(await pedido(a.order_nsu)).toMatchObject({ produto_id: "pomada-modeladora", kits: 2, sku: "WLF-CAB-POMA-001" });
    expect(await item()).toMatchObject({ fisico: 3, reservado: 2, disponivel: 1 });
    await expect(comprar({ produto: "pomada-modeladora", oferta: "q2" })).rejects.toMatchObject({
      status: 409, message: "Só temos 1 em estoque. Escolha uma quantidade menor.",
    });
    expect(await banco().consulta("select count(*)::int as n from loja.pedidos")).toEqual([{ n: 1 }]); // o recusado não ficou

    await pagarNoSimulador(a.order_nsu, "cartao");
    expect(await pedido(a.order_nsu)).toMatchObject({ situacao: "pago", forma_pagamento: "credit_card" });
    expect((await pedido(a.order_nsu)).valor_pago_centavos).toBeGreaterThan((await pedido(a.order_nsu)).total_centavos); // juros
    expect(await item()).toMatchObject({ fisico: 1, reservado: 0, disponivel: 1 });

    const b = await comprar({ produto: "pomada-modeladora", oferta: "q1" });
    await pedidos.cancelar(b.order_nsu);
    expect(await item()).toMatchObject({ disponivel: 1 });
    await expect(pedidos.cancelar(a.order_nsu)).rejects.toMatchObject({ status: 409 });
  });

  it("a InfinitePay recusou o link: o pedido é cancelado e a reserva volta", async () => {
    process.env.INFINITEPAY_AMBIENTE = "real";
    process.env.INFINITEPAY_HANDLE = "loja-teste";
    esquecer();
    await estoque.lancar("kit-laminas", { tipo: "entrada", quantidade: 5 }, null);
    infinitepay = () => new Response(JSON.stringify({ message: "handle inválido" }), { status: 400 });
    await expect(comprar()).rejects.toMatchObject({ status: 502, message: "A InfinitePay recusou o pedido (erro 400)." });
    const [p] = await banco().consulta("select order_nsu, situacao from loja.pedidos");
    expect(p.situacao).toBe("cancelado");
    expect((await estoque.painel()).itens.find((i) => i.produto_id === "kit-laminas")).toMatchObject({ reservado: 0, disponivel: 5 });

    // Aceito: o corpo leva os itens, o cliente com +55 e o order_nsu; o link volta para o cliente.
    let corpo: any = null;
    infinitepay = (_url, c) => {
      corpo = c;
      return Response.json({ url: "https://checkout.infinitepay.io/loja-teste/abc" });
    };
    const ok = await comprar();
    expect(ok.link_pagamento).toBe("https://checkout.infinitepay.io/loja-teste/abc");
    expect(corpo).toMatchObject({ handle: "loja-teste", order_nsu: ok.order_nsu, customer: { phone_number: "+5511987654321" } });
    expect(corpo.items[0]).toMatchObject({ quantity: 1, price: 4490 });
    expect(corpo).not.toHaveProperty("webhook_url"); // só com https
  });

  it("valor pago diferente do pedido vira pagamento divergente", async () => {
    process.env.INFINITEPAY_AMBIENTE = "real";
    process.env.INFINITEPAY_HANDLE = "loja-teste";
    esquecer();
    let conferido: any = null;
    infinitepay = (url, c) => {
      if (url.endsWith("/links")) return Response.json({ url: "https://checkout.infinitepay.io/loja-teste/abc" });
      conferido = c;
      return Response.json({ success: true, paid: true, amount: 100, paid_amount: 100, installments: 1, capture_method: "credit_card" });
    };
    const { order_nsu } = await comprar();
    await chamar(comParams(rotaConferir, { nsu: order_nsu }), { corpo: { transaction_nsu: "t1", slug: "s1", receipt_url: "http://falso" } });
    expect(conferido).toEqual({ handle: "loja-teste", order_nsu, transaction_nsu: "t1", slug: "s1" });
    expect(await pedido(order_nsu)).toMatchObject({ situacao: "pagamento_divergente", pago_em: null });
  });

  it("desconto no Pix: o valor com desconto confere; no cartão, não", async () => {
    process.env.INFINITEPAY_DESCONTO_PIX = "5";
    esquecer();
    const { order_nsu } = await comprar();
    const p = await pedido(order_nsu);
    expect(p.desconto_pix).toBe(5);
    await pagarNoSimulador(order_nsu, "pix");
    expect(await pedido(order_nsu)).toMatchObject({ situacao: "pago", valor_pago_centavos: Math.round(p.total_centavos * 0.95) });
    expect(pedidos.valorConfere(p, { paid: true, amount: Math.round(p.total_centavos * 0.95), capture_method: "credit_card" })).toBe(false);
  });

  it("a tarefa agendada confere o que ficou para trás e libera as reservas vencidas", async () => {
    await estoque.lancar("kit-laminas", { tipo: "entrada", quantidade: 10 }, null);
    const a = await comprar();
    const b = await comprar();
    // O cliente pagou, mas a volta e o webhook não conseguiram conferir: os dados ficaram guardados.
    const volta = await pagarNoSimulador(a.order_nsu);
    await banco().consulta(
      "update loja.pedidos set situacao = 'aguardando_pagamento', pago_em = null, transaction_nsu = $2, slug = $3 where order_nsu = $1",
      [a.order_nsu, volta.searchParams.get("transaction_nsu"), volta.searchParams.get("slug")],
    );
    await banco().consulta("update loja.estoque_reservas set situacao = 'ativa' where pedido_nsu = $1", [a.order_nsu]);
    await banco().consulta("delete from loja.estoque_movimentos where pedido_nsu = $1", [a.order_nsu]);
    await banco().consulta("update loja.estoque_reservas set expira_em = $2 where pedido_nsu = $1", [b.order_nsu, new Date(Date.now() - 60_000)]);

    const r = await pedidos.conferirPendentes();
    expect(r).toMatchObject({ conferidos: 1, pagos: 1, liberados: 1 });
    expect((await pedido(a.order_nsu)).situacao).toBe("pago");
    expect((await estoque.painel()).itens.find((i) => i.produto_id === "kit-laminas")).toMatchObject({ fisico: 8, reservado: 0 });
  });

  it("envio automático na Loggi depois do pagamento (e o aviso quando não dá)", async () => {
    process.env.LOGGI_ENVIO_AUTOMATICO = "sim";
    esquecer();
    const { order_nsu } = await comprar();
    await pagarNoSimulador(order_nsu);
    const p = await pedido(order_nsu);
    expect(p.loggi_key).toMatch(/^SIM/);
    expect(p.codigo_rastreio).toBe(p.loggi_key.slice(-8));
    expect(p.envio_erro).toBeNull();
    expect((await chamar(comParams(rotaRastreio, { nsu: order_nsu }))).dados).toMatchObject({
      codigo: p.codigo_rastreio, rastreio: { situacao: "simulado" },
    });
    await expect(pedidos.criarEnvioLoggi(order_nsu)).rejects.toThrow("Este pedido já tem envio na Loggi.");

    const outro = await comprar();
    await pedidos.envioAutomatico(outro.order_nsu); // não pago: fica o aviso para o vendedor
    expect((await pedido(outro.order_nsu)).envio_erro).toBe("Só pedidos pagos podem ir para a Loggi.");
  });
});
