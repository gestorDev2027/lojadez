// Cupons de desconto: percentual, valor fixo ou frete grátis, com validade, limite de usos, valor mínimo e produtos.
//
// - O desconto vale sobre os produtos (não sobre o frete) e nunca deixa o produto abaixo de R$ 1,00 (a InfinitePay não
//   aceita item de valor zero). O cupom de frete grátis zera a entrega mais barata (a loja paga a Loggi).
// - O cupom pode ser de um afiliado: quem usa gera a venda (e a comissão) para ele, mesmo sem ter vindo pelo link.
// - O limite de usos conta os pedidos pagos e os aguardando pagamento das últimas 2 horas (para não estourar o limite
//   com vários checkouts abertos).
// - O servidor confere o cupom de novo na hora de criar o pedido: o navegador só mostra a prévia.
import { uma } from "./banco";
import { ErroLoja } from "./erros";
import { KIT } from "./produtos";

export class ErroCupom extends ErroLoja {}

export const PRECO_MINIMO = 100; // o produto com desconto não fica abaixo de R$ 1,00

export type Cupom = {
  id: number;
  codigo: string;
  tipo: "percentual" | "valor" | "frete";
  valor: number;
  inicio: string | null;
  fim: string | null;
  limite_usos: number | null;
  minimo_centavos: number | null;
  todos_produtos: boolean;
  produtos: string[] | null;
  afiliado_id: number | null;
  ativo: boolean;
  descricao_interna: string | null;
};

export type CupomAplicado = { cupom: Cupom; desconto_centavos: number; frete_gratis: boolean; descricao: string };

export const limparCodigo = (texto: unknown) => String(texto ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30);

/** A data de hoje no Brasil (AAAA-MM-DD): as validades dos cupons são datas, sem hora. */
export const hojeNoBrasil = (quando = new Date()) => new Date(quando.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

export async function buscarCodigo(codigo: unknown): Promise<Cupom | null> {
  const limpo = limparCodigo(codigo);
  return limpo ? uma<Cupom>("select * from loja.cupons where codigo = $1", [limpo]) : null;
}

export async function usos(codigo: string): Promise<number> {
  const recente = new Date(Date.now() - 2 * 3600_000);
  const linha = await uma<{ n: string | number }>(
    `select count(*) as n from loja.pedidos where cupom_codigo = $1
       and (situacao in ('pago', 'enviado') or (situacao = 'aguardando_pagamento' and criado_em >= $2))`,
    [codigo, recente],
  );
  return Number(linha?.n ?? 0);
}

const reais = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");

export function descricao(c: Pick<Cupom, "tipo" | "valor">): string {
  if (c.tipo === "percentual") return `${String(Number(c.valor)).replace(".", ",")}% de desconto`;
  if (c.tipo === "valor") return `R$ ${reais(Math.trunc(Number(c.valor)))} de desconto`;
  return "Frete grátis";
}

/** Confere o cupom para este produto e preço. */
export async function aplicar(codigo: unknown, produtoId: string | null, precoCentavos: number): Promise<CupomAplicado> {
  const cupom = await buscarCodigo(codigo);
  if (!cupom || !cupom.ativo) throw new ErroCupom("Cupom inválido.");
  const hoje = hojeNoBrasil();
  if (cupom.inicio && hoje < cupom.inicio) throw new ErroCupom("Este cupom ainda não começou a valer.");
  if (cupom.fim && hoje > cupom.fim) throw new ErroCupom("Este cupom já venceu.");
  const id = produtoId || KIT;
  if (!cupom.todos_produtos && !(cupom.produtos ?? []).includes(id)) throw new ErroCupom("Este cupom não vale para este produto.");
  if (cupom.minimo_centavos && precoCentavos < cupom.minimo_centavos)
    throw new ErroCupom(`Este cupom vale a partir de R$ ${reais(cupom.minimo_centavos)}.`);
  if (cupom.limite_usos && (await usos(cupom.codigo)) >= cupom.limite_usos) throw new ErroCupom("Este cupom já atingiu o limite de usos.");
  let desconto = 0;
  let frete = false;
  if (cupom.tipo === "percentual") desconto = Math.round((precoCentavos * Number(cupom.valor)) / 100);
  else if (cupom.tipo === "valor") desconto = Math.round(Number(cupom.valor));
  else frete = true;
  desconto = Math.max(0, Math.min(desconto, precoCentavos - PRECO_MINIMO));
  return { cupom, desconto_centavos: desconto, frete_gratis: frete, descricao: descricao(cupom) };
}
