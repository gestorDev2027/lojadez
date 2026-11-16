// O estoque (saldo por movimentos, reservas dos pedidos, custo médio, inventário) e o SKU automático.
import { beforeEach, describe, expect, it } from "vitest";
import { definirAdministrador, entrar } from "../src/servidor/acesso";
import { banco } from "../src/servidor/banco";
import { limparCache } from "../src/servidor/catalogo";
import { esquecer } from "../src/servidor/config";
import * as estoque from "../src/servidor/estoque";
import { salvar } from "../src/servidor/produtos";
import * as sku from "../src/servidor/sku";
import { GET as rotaEstoque } from "../src/pages/api/vendedor/estoque/index";
import { POST as rotaLancar } from "../src/pages/api/vendedor/estoque/[produto]/movimentos";
import { GET as rotaVitrine } from "../src/pages/api/vitrine";
import { POST as rotaCriar } from "../src/pages/api/vendedor/produtos/index";
import { bancoNovo, chamar } from "./apoio";

const POMADA = {
  nome: "Pomada Modeladora",
  unidade: "pote",
  unidade_plural: "potes",
  peso_g: 180,
  comprimento_cm: 10,
  largura_cm: 10,
  altura_cm: 6,
  categoria: "Cabelo",
  ofertas: [{ quantidade: 1, preco_centavos: 3990 }],
};

let token = "";
const item = async (id: string) => (await estoque.painel()).itens.find((i) => i.produto_id === id)!;
const lancar = (id: string, dados: Record<string, unknown>) => estoque.lancar(id, dados, "vendedor@exemplo.com");
const daqui = (minutos: number) => new Date(Date.now() + minutos * 60_000);

describe("SKU automático", () => {
  beforeEach(async () => {
    await bancoNovo();
    esquecer();
    limparCache();
  });

  it("monta o começo pela categoria e pelo nome, sem acento nem palavras vazias", () => {
    expect(sku.base("Pomada Modeladora", "Cabelo")).toBe("WLF-CAB-POMA");
    expect(sku.base("Óleo de Barba", "Barba", "wolf")).toBe("WOLF-BAR-OLEO");
    expect(sku.base("Kit de Lâminas", null)).toBe("WLF-GER-LAMI");
    expect(sku.normalizar(" abc 12-x ")).toBe("ABC-12-X");
  });

  it("gera o próximo número livre e não deixa dois produtos com o mesmo SKU", async () => {
    const a = await salvar(POMADA, null, null);
    expect(a.sku).toBe("WLF-CAB-POMA-001");
    const b = await salvar({ ...POMADA, nome: "Pomada Matte" }, null, null);
    expect(b.sku).toBe("WLF-CAB-POMA-002");
    await expect(salvar({ ...POMADA, nome: "Outra", sku: "wlf-cab-poma-001" }, null, null)).rejects.toThrow(
      "O SKU WLF-CAB-POMA-001 já é do produto “Pomada Modeladora”.",
    );
    // O próprio produto pode manter o SKU dele.
    expect((await salvar({ ...POMADA, sku: "WLF-CAB-POMA-001", chamada: "nova" }, a.slug, null)).sku).toBe("WLF-CAB-POMA-001");
  });

  it("gera o SKU dos produtos antigos que estão sem", async () => {
    await salvar(POMADA, null, null);
    await banco().consulta("update loja.produtos set sku = null");
    expect(await estoque.gerarSkusQueFaltam(null)).toBe(1);
    expect((await item("pomada-modeladora")).sku).toBe("WLF-CAB-POMA-001");
  });
});

describe("estoque", () => {
  beforeEach(async () => {
    await bancoNovo();
    esquecer();
    limparCache();
    await definirAdministrador("vendedor@exemplo.com", "senha-de-teste-123");
    token = (await entrar("vendedor@exemplo.com", "senha-de-teste-123")).token;
    await salvar(POMADA, null, null);
  });

  it("todo item começa sem controle: nada fica esgotado antes de lançar o estoque", async () => {
    expect(await item("pomada-modeladora")).toMatchObject({ controlar: false, fisico: 0, situacao: "sem_controle" });
    const vitrine = (await chamar(rotaVitrine)).dados;
    expect(vitrine.itens.every((i: any) => i.esgotado === false && i.disponivel === null)).toBe(true);
    // Um pedido de item sem controle passa.
    await banco().transacao((b) => estoque.reservar(b, "P1", [{ produto_id: null, quantidade: 3 }], daqui(60)));
  });

  it("entrada, custo médio, perda, ajuste e inventário", async () => {
    expect((await lancar("pomada-modeladora", { tipo: "entrada", quantidade: 10, custo_unitario_centavos: 1000, fornecedor: "Distribuidora X" }))).toMatchObject({
      controlar: true, fisico: 10, custo_medio_centavos: 1000, valor_centavos: 10_000, situacao: "ok",
    });
    expect((await lancar("pomada-modeladora", { tipo: "entrada", quantidade: 10, custo_unitario_centavos: 2000 })).custo_medio_centavos).toBe(1500);
    await expect(lancar("pomada-modeladora", { tipo: "perda", quantidade: 2 })).rejects.toThrow("Escreva o motivo.");
    await expect(lancar("pomada-modeladora", { tipo: "perda", quantidade: 50, motivo: "quebrou" })).rejects.toThrow("Saldo insuficiente: há 20 em estoque.");
    expect((await lancar("pomada-modeladora", { tipo: "perda", quantidade: 2, motivo: "quebrou" })).fisico).toBe(18);
    expect((await lancar("pomada-modeladora", { tipo: "ajuste", quantidade: -1, motivo: "contagem errada" })).fisico).toBe(17);
    expect((await lancar("pomada-modeladora", { tipo: "inventario", contagem: 15 })).fisico).toBe(15);
    const historico = await estoque.historico("pomada-modeladora");
    expect(historico.map((m: any) => [m.tipo, m.quantidade, m.saldo_depois])).toEqual([
      ["ajuste", -2, 15], ["ajuste", -1, 17], ["perda", -2, 18], ["entrada", 10, 20], ["entrada", 10, 10],
    ]);
    expect(historico[0].motivo).toBe("Inventário");
    expect(historico[0].email).toBe("vendedor@exemplo.com");
  });

  it("o pedido reserva, o pagamento baixa, o vencido libera e o reembolso devolve", async () => {
    await lancar("pomada-modeladora", { tipo: "entrada", quantidade: 10 });
    await estoque.configurar("pomada-modeladora", { minimo: 3, controlar: true }, null);
    const reservar = (nsu: string, q: number, expira = daqui(60)) =>
      banco().transacao((b) => estoque.reservar(b, nsu, [{ produto_id: "pomada-modeladora", quantidade: q }], expira));

    await reservar("A", 6);
    expect(await item("pomada-modeladora")).toMatchObject({ fisico: 10, reservado: 6, disponivel: 4, situacao: "ok" });
    await expect(reservar("B", 5)).rejects.toThrow("Só temos 4 em estoque. Escolha uma quantidade menor.");
    await reservar("B", 2);
    expect((await item("pomada-modeladora")).situacao).toBe("baixo"); // disponível 2, mínimo 3

    await estoque.baixar("A");
    await estoque.baixar("A"); // repetir não baixa de novo
    expect(await item("pomada-modeladora")).toMatchObject({ fisico: 4, reservado: 2, disponivel: 2 });

    expect(await estoque.liberar("B")).toBe(1);
    expect(await item("pomada-modeladora")).toMatchObject({ fisico: 4, reservado: 0, disponivel: 4 });

    await reservar("C", 4, daqui(-1)); // já vencido
    expect((await item("pomada-modeladora")).situacao).toBe("esgotado");
    const vitrine = (await chamar(rotaVitrine)).dados;
    expect(vitrine.itens.find((i: any) => i.id === "pomada-modeladora")).toMatchObject({ esgotado: true, disponivel: 0 });
    expect(await estoque.liberarVencidas()).toEqual(["C"]);
    expect((await item("pomada-modeladora")).disponivel).toBe(4);

    expect(await estoque.devolver("A", null)).toBe(6);
    expect(await estoque.devolver("A", null)).toBe(0);
    expect((await item("pomada-modeladora")).fisico).toBe(10);
  });

  it("a venda paga depois de vencer a reserva ainda sai do estoque", async () => {
    await lancar("pomada-modeladora", { tipo: "entrada", quantidade: 1 });
    await banco().transacao((b) => estoque.reservar(b, "D", [{ produto_id: "pomada-modeladora", quantidade: 1 }], daqui(-1)));
    await estoque.liberarVencidas();
    await estoque.baixar("D");
    expect(await item("pomada-modeladora")).toMatchObject({ fisico: 0, reservado: 0 });
  });

  it("as rotas pedem o login e lançam com o e-mail de quem fez", async () => {
    expect((await chamar(rotaEstoque)).status).toBe(401);
    const painel = await chamar(rotaEstoque, { token });
    expect(painel.dados.itens.map((i: any) => i.produto_id)).toEqual(["kit-laminas", "pomada-modeladora"]);
    const lancado = await chamar((ctx) => rotaLancar({ ...ctx, params: { produto: "kit-laminas" } } as any), {
      corpo: { tipo: "entrada", quantidade: 50, custo_unitario_centavos: 900 },
      token,
    });
    expect(lancado.dados).toMatchObject({ produto_id: "kit-laminas", fisico: 50, custo_medio_centavos: 900 });
    const ruim = await chamar((ctx) => rotaLancar({ ...ctx, params: { produto: "nao-existe" } } as any), { corpo: { tipo: "entrada", quantidade: 1 }, token });
    expect(ruim).toMatchObject({ status: 404, dados: { erro: "Produto não encontrado." } });
    const criado = await chamar(rotaCriar, { corpo: { ...POMADA, nome: "Gel Fixador" }, token });
    expect(criado.dados.sku).toBe("WLF-CAB-GELX-001");
  });
});
