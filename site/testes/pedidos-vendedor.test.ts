// Os pedidos na área do vendedor: lista, enviado, cancelar, envio/etiqueta/cancelamento na Loggi (simulada) e o
// reembolso com o estoque de volta. Nada sai para a Loggi nem para a InfinitePay.
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { banco } from "../src/servidor/banco";
import { limparCache } from "../src/servidor/catalogo";
import { esquecer } from "../src/servidor/config";
import * as estoque from "../src/servidor/estoque";
import * as pedidos from "../src/servidor/pedidos";
import { GET as rotaLista } from "../src/pages/api/vendedor/pedidos/index";
import { POST as rotaEnviado } from "../src/pages/api/vendedor/pedidos/[nsu]/enviado";
import { POST as rotaCancelar } from "../src/pages/api/vendedor/pedidos/[nsu]/cancelar";
import { POST as rotaReembolso } from "../src/pages/api/vendedor/pedidos/[nsu]/reembolso";
import { POST as rotaReembolsado } from "../src/pages/api/vendedor/pedidos/[nsu]/reembolsado";
import { POST as rotaEnvio } from "../src/pages/api/vendedor/pedidos/[nsu]/loggi/envio";
import { GET as rotaEtiqueta } from "../src/pages/api/vendedor/pedidos/[nsu]/loggi/etiqueta";
import { POST as rotaCancelarEnvio } from "../src/pages/api/vendedor/pedidos/[nsu]/loggi/cancelar";
import { bancoNovo, chamar, entrarComo } from "./apoio";

const COMPRADOR = { nome: "Maria da Silva", cpf: "52998224725", email: "maria@exemplo.com", telefone: "11987654321", cep: "01310100", numero: "100" };
let token = "";

const fetchFalso = vi.fn(async (entrada: any) => {
  const url = String(entrada);
  if (url.startsWith("https://viacep.com.br/"))
    return Response.json({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" });
  throw new Error(`Chamada de rede inesperada no teste: ${url}`);
});

const comNsu = (rota: any, nsu: string) => (ctx: APIContext) => rota({ ...ctx, params: { nsu }, url: new URL(ctx.request.url) } as APIContext);
const pedido = async (nsu: string) => (await pedidos.buscar(nsu))!;
const kit = async () => (await estoque.painel()).itens.find((i) => i.produto_id === "kit-laminas")!;

/** Um pedido de 2 kits já pago (como se a InfinitePay tivesse confirmado). */
async function pedidoPago(): Promise<string> {
  const frete = await pedidos.cotarFrete(COMPRADOR.cep, "kit2", null, null);
  const { order_nsu } = await pedidos.criar({ oferta: "kit2", ...COMPRADOR, frete_tipo: frete.opcoes[0].tipo });
  await banco().consulta("update loja.pedidos set situacao = 'pago', pago_em = $2, forma_pagamento = 'pix' where order_nsu = $1", [order_nsu, new Date()]);
  await estoque.baixar(order_nsu);
  return order_nsu;
}

describe("pedidos na área do vendedor", () => {
  beforeEach(async () => {
    for (const v of ["LOGGI_AMBIENTE", "INFINITEPAY_AMBIENTE", "LOGGI_ENVIO_AUTOMATICO"]) delete process.env[v];
    vi.stubGlobal("fetch", fetchFalso);
    await bancoNovo();
    esquecer();
    limparCache();
    token = await entrarComo("vendedor@exemplo.com");
    await estoque.lancar("kit-laminas", { tipo: "entrada", quantidade: 10 }, null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lista com o login, filtra pela situação e não mostra o id interno", async () => {
    const pago = await pedidoPago();
    const frete = await pedidos.cotarFrete(COMPRADOR.cep, "kit1", null, null);
    await pedidos.criar({ oferta: "kit1", ...COMPRADOR, frete_tipo: frete.opcoes[0].tipo });
    expect((await chamar(rotaLista)).status).toBe(401);
    const todos = await chamar(rotaLista, { token });
    expect(todos.dados).toHaveLength(2);
    expect(todos.dados[0]).not.toHaveProperty("id");
    expect(typeof todos.dados[0].criado_em).toBe("string");
    const pagos = await chamar(rotaLista, { token, caminho: "/api/vendedor/pedidos?situacao=pago" });
    expect(pagos.dados.map((p: any) => p.order_nsu)).toEqual([pago]);
    expect(pagos.dados[0]).toMatchObject({ cpf: "52998224725", email: "maria@exemplo.com" }); // o vendedor vê tudo
  });

  it("envio na Loggi, etiqueta, cancelamento do envio e marcar como enviado", async () => {
    const nsu = await pedidoPago();
    const criado = await chamar(comNsu(rotaEnvio, nsu), { token, metodo: "POST" });
    expect(criado.dados.loggi_key).toMatch(/^SIM/);
    expect((await chamar(comNsu(rotaEnvio, nsu), { token, metodo: "POST" })).dados.erro).toBe("Este pedido já tem envio na Loggi.");

    const etiqueta = await comNsu(rotaEtiqueta, nsu)({
      request: new Request("http://localhost/x", { headers: { cookie: `loja_sessao=${token}` } }), clientAddress: "127.0.0.1",
    } as unknown as APIContext);
    expect(etiqueta.headers.get("Content-Type")).toBe("application/pdf");
    expect(new TextDecoder().decode(new Uint8Array(await etiqueta.arrayBuffer())).startsWith("%PDF")).toBe(true);

    const cancelado = await chamar(comNsu(rotaCancelarEnvio, nsu), { token, metodo: "POST" });
    expect(cancelado.dados).toMatchObject({ loggi_key: null, codigo_rastreio: null, situacao: "pago", aviso_loggi: null });

    expect((await chamar(comNsu(rotaEnviado, nsu), { token, corpo: {} })).dados.erro).toBe("Informe o código de rastreio (ou crie o envio na Loggi).");
    const enviado = await chamar(comNsu(rotaEnviado, nsu), { token, corpo: { codigo_rastreio: " BR123  456 " } });
    expect(enviado.dados).toMatchObject({ situacao: "enviado", codigo_rastreio: "BR123 456" });
    expect((await chamar(comNsu(rotaEnviado, nsu), { token, corpo: { codigo_rastreio: "X" } })).status).toBe(409);
    const auditoria = await banco().consulta("select acao, detalhe, email from loja.auditoria where acao = 'pedido' order by id");
    expect(auditoria.map((a) => a.detalhe)).toEqual([
      `Envio criado na Loggi: ${nsu.slice(0, 8)}`, `Envio na Loggi cancelado: ${nsu.slice(0, 8)}`, `Enviado: ${nsu.slice(0, 8)} · BR123 456`,
    ]);
  });

  it("cancelar um pedido não pago devolve a reserva; pago não cancela por aqui", async () => {
    const frete = await pedidos.cotarFrete(COMPRADOR.cep, "kit3", null, null);
    const { order_nsu } = await pedidos.criar({ oferta: "kit3", ...COMPRADOR, frete_tipo: frete.opcoes[0].tipo });
    expect(await kit()).toMatchObject({ reservado: 3, disponivel: 7 });
    expect((await chamar(comNsu(rotaCancelar, order_nsu), { token, metodo: "POST" })).dados.situacao).toBe("cancelado");
    expect(await kit()).toMatchObject({ reservado: 0, disponivel: 10 });
    const pago = await pedidoPago();
    expect((await chamar(comNsu(rotaCancelar, pago), { token, metodo: "POST" })).status).toBe(409);
  });

  it("reembolso de pedido que não saiu: cancela o envio e o produto volta na hora", async () => {
    const nsu = await pedidoPago();
    await pedidos.criarEnvioLoggi(nsu);
    expect(await kit()).toMatchObject({ fisico: 8 });
    expect((await chamar(comNsu(rotaReembolso, nsu), { token, corpo: { motivo: "nada" } })).dados.erro).toBe("Escolha o motivo do cancelamento.");
    const total = (await pedido(nsu)).total_centavos;
    expect((await chamar(comNsu(rotaReembolso, nsu), { token, corpo: { motivo: "arrependimento", valor_centavos: total + 1 } })).dados.erro)
      .toContain("O reembolso vai de R$ 0,01 até o valor pago");

    const r = await chamar(comNsu(rotaReembolso, nsu), { token, corpo: { motivo: "arrependimento", detalhe: "  mudou   de ideia " } });
    expect(r.dados).toMatchObject({
      situacao: "reembolso_pendente", reembolso_motivo: "Cliente desistiu da compra: mudou de ideia", reembolso_centavos: total,
      aviso_loggi: "O envio na Loggi foi cancelado.", voltou_ao_estoque: 2, loggi_key: null,
    });
    expect(await kit()).toMatchObject({ fisico: 10 });

    const confirmado = await chamar(comNsu(rotaReembolsado, nsu), { token, corpo: { valor_centavos: 1000, voltou_ao_estoque: true } });
    expect(confirmado.dados).toMatchObject({ situacao: "reembolsado", reembolso_centavos: 1000 });
    expect(await kit()).toMatchObject({ fisico: 10 }); // não devolve duas vezes
    expect((await chamar(comNsu(rotaReembolsado, nsu), { token, corpo: {} })).status).toBe(409);
  });

  it("reembolso de pedido enviado: o produto só volta quando o vendedor confirma que voltou", async () => {
    const nsu = await pedidoPago();
    await pedidos.marcarEnviado(nsu, "BR999", null);
    const r = await chamar(comNsu(rotaReembolso, nsu), { token, corpo: { motivo: "defeito" } });
    expect(r.dados).toMatchObject({ situacao: "reembolso_pendente", voltou_ao_estoque: 0, aviso_loggi: null });
    expect(await kit()).toMatchObject({ fisico: 8 });
    await chamar(comNsu(rotaReembolsado, nsu), { token, corpo: { voltou_ao_estoque: true } });
    expect(await kit()).toMatchObject({ fisico: 10 });
    const movimentos = await estoque.historico("kit-laminas");
    expect(movimentos[0]).toMatchObject({ tipo: "devolucao", quantidade: 2, email: "vendedor@exemplo.com" });
  });
});
