// O estoque da loja.
//
// - Cada item com estoque é um produto (o slug) ou o kit de lâminas ("kit-laminas"); a unidade é a do produto (1 kit,
//   1 pote...). Um pedido de "2 kits" movimenta 2.
// - O saldo físico é a soma dos movimentos (estoque_movimentos): entrada, venda, devolução, ajuste e perda. Nada muda o
//   saldo sem um movimento, com quem fez, quando e o motivo.
// - O pedido criado reserva as unidades (estoque_reservas, "ativa"); o pagamento confirmado vira a venda (baixa); o
//   link vencido ou o pedido cancelado libera. Disponível = físico − reservado.
// - Sem saldo disponível, o item aparece como esgotado e o pedido é recusado. Item com "controlar" desligado vende sem
//   olhar o saldo (e o saldo pode ficar negativo). Todo item começa assim, sem controle (nada fica esgotado só porque
//   o estoque ainda não foi lançado): o controle liga no primeiro lançamento do vendedor ou na aba Estoque.
// - O custo médio muda a cada entrada com custo: (saldo × custo atual + entrada × custo da entrada) / saldo novo. Ele
//   vai para o financeiro (custo das vendas).
import { agora, banco, registrar, type Banco } from "./banco";
import * as catalogo from "./catalogo";
import { cfg } from "./config";
import { ErroLoja } from "./erros";
import * as produtos from "./produtos";
import * as sku from "./sku";

export class ErroEstoque extends ErroLoja {}

export const TIPOS_MANUAIS = ["entrada", "ajuste", "perda", "devolucao"] as const;
export type TipoManual = (typeof TIPOS_MANUAIS)[number];
const MAXIMO = 1_000_000;

export type Situacao = "ok" | "baixo" | "esgotado" | "sem_controle";

export type ItemEstoque = {
  produto_id: string;
  nome: string;
  sku: string | null;
  ativo: boolean;
  controlar: boolean;
  minimo: number;
  fisico: number;
  reservado: number;
  disponivel: number;
  custo_medio_centavos: number;
  valor_centavos: number;
  situacao: Situacao;
};

function inteiro(valor: unknown, rotulo: string, minimo: number, maximo: number): number {
  const ok = typeof valor === "number" ? Number.isInteger(valor) : /^[+-]?\d+$/.test(String(valor ?? "").trim());
  if (!ok) throw new ErroEstoque(`${rotulo}: use um número inteiro.`);
  const n = Number(valor);
  if (n < minimo || n > maximo) throw new ErroEstoque(`${rotulo}: de ${minimo} a ${maximo}.`);
  return n;
}

const curto = (valor: unknown, maximo: number) => String(valor ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, maximo) || null;

/** Os itens que podem ter estoque: o kit e todos os produtos (os fora de venda também). */
async function itens(): Promise<{ id: string; nome: string; sku: string | null; ativo: boolean }[]> {
  const [kit, lista] = await Promise.all([catalogo.produto(), produtos.listar(false)]);
  return [
    { id: produtos.KIT, nome: kit.nome, sku: kit.sku, ativo: true },
    ...lista.map((p) => ({ id: p.slug, nome: p.nome, sku: p.sku, ativo: p.ativo })),
  ];
}

async function existe(produtoId: string): Promise<{ id: string; nome: string }> {
  const item = (await itens()).find((i) => i.id === produtoId);
  if (!item) throw new ErroEstoque("Produto não encontrado.", 404);
  return item;
}

function situacao(controlar: boolean, disponivel: number, minimo: number): Situacao {
  if (!controlar) return "sem_controle";
  if (disponivel <= 0) return "esgotado";
  if (disponivel <= minimo) return "baixo";
  return "ok";
}

type Numeros = { controlar: boolean; minimo: number; custo: number; fisico: number; reservado: number };
const PADRAO: Numeros = { controlar: false, minimo: 0, custo: 0, fisico: 0, reservado: 0 };

/** Os números de cada item (sem linha em `estoque`: sem controle, saldo zero). */
async function numeros(b: Banco = banco(), id?: string): Promise<Map<string, Numeros>> {
  const filtro = id ? "where produto_id = $1" : "";
  const p = id ? [id] : [];
  const [config, saldos, reservas] = await Promise.all([
    b.consulta<{ produto_id: string; controlar: boolean; minimo: number; custo_medio_centavos: number }>(
      `select produto_id, controlar, minimo, custo_medio_centavos from loja.estoque ${filtro}`, p),
    b.consulta<{ produto_id: string; n: string | number }>(
      `select produto_id, sum(quantidade) as n from loja.estoque_movimentos ${filtro} group by produto_id`, p),
    b.consulta<{ produto_id: string; n: string | number }>(
      `select produto_id, sum(quantidade) as n from loja.estoque_reservas where situacao = 'ativa'${id ? " and produto_id = $1" : ""}
       group by produto_id`, p),
  ]);
  const mapa = new Map<string, Numeros>();
  const pegar = (id: string) => {
    if (!mapa.has(id)) mapa.set(id, { ...PADRAO });
    return mapa.get(id)!;
  };
  for (const c of config) Object.assign(pegar(c.produto_id), { controlar: c.controlar, minimo: c.minimo, custo: c.custo_medio_centavos });
  for (const s of saldos) pegar(s.produto_id).fisico = Number(s.n || 0);
  for (const r of reservas) pegar(r.produto_id).reservado = Number(r.n || 0);
  return mapa;
}

function montarItem(i: { id: string; nome: string; sku: string | null; ativo: boolean }, n: Numeros = PADRAO): ItemEstoque {
  const disponivel = n.fisico - n.reservado;
  return {
    produto_id: i.id, nome: i.nome, sku: i.sku, ativo: i.ativo, controlar: n.controlar, minimo: n.minimo,
    fisico: n.fisico, reservado: n.reservado, disponivel, custo_medio_centavos: n.custo,
    valor_centavos: Math.max(n.fisico, 0) * n.custo, situacao: situacao(n.controlar, disponivel, n.minimo),
  };
}

/** A aba Estoque: cada item com os números e o resumo. */
export async function painel() {
  const [lista, mapa] = await Promise.all([itens(), numeros()]);
  const linhas = lista.map((i) => montarItem(i, mapa.get(i.id)));
  return {
    itens: linhas,
    resumo: {
      valor_centavos: linhas.reduce((s, i) => s + i.valor_centavos, 0),
      unidades: linhas.reduce((s, i) => s + Math.max(i.fisico, 0), 0),
      esgotados: linhas.filter((i) => i.ativo && i.situacao === "esgotado").length,
      baixos: linhas.filter((i) => i.ativo && i.situacao === "baixo").length,
      reservado: linhas.reduce((s, i) => s + i.reservado, 0),
    },
  };
}

/** O que a vitrine e o checkout precisam: quanto dá para vender de cada item (null: sem controle). */
export async function disponiveis(): Promise<Map<string, number | null>> {
  const mapa = await numeros();
  const saida = new Map<string, number | null>();
  for (const [id, n] of mapa) saida.set(id, n.controlar ? Math.max(n.fisico - n.reservado, 0) : null);
  return saida;
}

/** Disponível de um item (null: sem controle, inclusive o item que ainda não teve estoque lançado). */
export function disponivelDe(mapa: Map<string, number | null>, produtoId: string): number | null {
  return mapa.get(produtoId) ?? null;
}

/**
 * Cria a linha do item (se faltar) e trava ela até o fim da transação: dois pedidos ao mesmo tempo não vendem a mesma
 * unidade. `controlarSeNovo`: a linha nasce controlando o saldo (lançamento do vendedor) ou não (venda de item que nunca
 * teve estoque lançado).
 */
async function travar(b: Banco, produtoId: string, controlarSeNovo = false): Promise<Numeros> {
  await b.consulta(
    "insert into loja.estoque (produto_id, controlar, minimo, custo_medio_centavos, atualizado_em) values ($1, $2, 0, 0, $3) on conflict (produto_id) do nothing",
    [produtoId, controlarSeNovo, agora()],
  );
  await b.consulta("select produto_id from loja.estoque where produto_id = $1 for update", [produtoId]);
  return (await numeros(b, produtoId)).get(produtoId) ?? { ...PADRAO };
}

/** Liga ou desliga o controle e muda o mínimo de um item. */
export async function configurar(produtoId: string, dados: Record<string, unknown>, email: string | null): Promise<ItemEstoque> {
  const item = await existe(produtoId);
  const minimo = inteiro(dados.minimo ?? 0, "Estoque mínimo", 0, MAXIMO);
  const controlar = dados.controlar === undefined ? true : Boolean(dados.controlar);
  await banco().transacao(async (b) => {
    await travar(b, produtoId, true);
    await b.consulta("update loja.estoque set controlar = $2, minimo = $3, atualizado_em = $4 where produto_id = $1", [
      produtoId, controlar, minimo, agora(),
    ]);
  });
  await registrar(email, "estoque", `${item.nome}: mínimo ${minimo}, ${controlar ? "controla o saldo" : "vende sem controlar o saldo"}`);
  return (await painel()).itens.find((i) => i.produto_id === produtoId)!;
}

type Movimento = {
  tipo: string;
  quantidade: number;
  custo_unitario_centavos?: number | null;
  pedido_nsu?: string | null;
  fornecedor?: string | null;
  nota?: string | null;
  motivo?: string | null;
};

/** Grava um movimento (dentro de uma transação, com a linha travada). Devolve o saldo físico depois. */
async function gravar(b: Banco, produtoId: string, atual: Numeros, m: Movimento, email: string | null): Promise<number> {
  const depois = atual.fisico + m.quantidade;
  if (m.quantidade < 0 && atual.controlar && depois < 0)
    throw new ErroEstoque(`Saldo insuficiente: há ${atual.fisico} em estoque.`);
  let custo = atual.custo;
  if (m.tipo === "entrada" && m.custo_unitario_centavos != null && m.quantidade > 0) {
    const antes = Math.max(atual.fisico, 0);
    custo = Math.round((antes * atual.custo + m.quantidade * m.custo_unitario_centavos) / (antes + m.quantidade));
  }
  await b.consulta(
    `insert into loja.estoque_movimentos
       (produto_id, tipo, quantidade, custo_unitario_centavos, saldo_depois, pedido_nsu, fornecedor, nota, motivo, email, quando)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [produtoId, m.tipo, m.quantidade, m.custo_unitario_centavos ?? null, depois, m.pedido_nsu ?? null, m.fornecedor ?? null,
      m.nota ?? null, m.motivo ?? null, email, agora()],
  );
  await b.consulta("update loja.estoque set custo_medio_centavos = $2, atualizado_em = $3 where produto_id = $1", [produtoId, custo, agora()]);
  return depois;
}

const ROTULOS: Record<string, string> = {
  entrada: "Entrada", venda: "Venda", devolucao: "Devolução", ajuste: "Ajuste", perda: "Perda", inventario: "Inventário",
};

/**
 * Um movimento lançado pelo vendedor:
 * - entrada: quantidade > 0, custo por unidade (opcional, muda o custo médio), fornecedor e nota;
 * - perda: quantidade > 0 (sai), motivo obrigatório;
 * - ajuste: quantidade com sinal (+ entra, − sai), motivo obrigatório;
 * - devolucao: quantidade > 0 (volta), motivo;
 * - inventario: a contagem; vira um ajuste da diferença.
 */
export async function lancar(produtoId: string, dados: Record<string, unknown>, email: string | null): Promise<ItemEstoque> {
  const item = await existe(produtoId);
  const tipo = String(dados.tipo ?? "");
  if (![...TIPOS_MANUAIS, "inventario"].includes(tipo)) throw new ErroEstoque("Tipo de movimento inválido.");
  const motivo = curto(dados.motivo, 300);
  let movimento: Movimento;
  if (tipo === "inventario") {
    movimento = { tipo: "ajuste", quantidade: inteiro(dados.contagem, "Contagem", 0, MAXIMO), motivo: `Inventário${motivo ? `: ${motivo}` : ""}` };
  } else if (tipo === "ajuste") {
    const q = inteiro(dados.quantidade, "Quantidade", -MAXIMO, MAXIMO);
    if (q === 0) throw new ErroEstoque("Quantidade: diferente de zero.");
    movimento = { tipo, quantidade: q, motivo };
  } else {
    const q = inteiro(dados.quantidade, "Quantidade", 1, MAXIMO);
    movimento = { tipo, quantidade: tipo === "perda" ? -q : q, motivo };
  }
  if (["ajuste", "perda"].includes(tipo) && !motivo) throw new ErroEstoque("Escreva o motivo.");
  if (tipo === "entrada") {
    const custo = dados.custo_unitario_centavos;
    movimento.custo_unitario_centavos = custo === undefined || custo === null || custo === "" ? null : inteiro(custo, "Custo por unidade (centavos)", 0, 100_000_000);
    movimento.fornecedor = curto(dados.fornecedor, 120);
    movimento.nota = curto(dados.nota, 60);
  }
  let resultado = 0;
  await banco().transacao(async (b) => {
    const atual = await travar(b, produtoId, true);
    if (tipo === "inventario") {
      movimento.quantidade -= atual.fisico; // a diferença entre o contado e o saldo
      if (movimento.quantidade === 0) {
        resultado = atual.fisico;
        return;
      }
    }
    resultado = await gravar(b, produtoId, { ...atual, controlar: tipo === "inventario" ? false : atual.controlar }, movimento, email);
  });
  await registrar(email, "estoque", `${item.nome}: ${ROTULOS[tipo]} ${movimento.quantidade > 0 ? "+" : ""}${movimento.quantidade} (saldo ${resultado})`);
  return (await painel()).itens.find((i) => i.produto_id === produtoId)!;
}

/** O histórico de um item, do mais novo ao mais antigo. */
export async function historico(produtoId: string, limite = 100) {
  await existe(produtoId);
  return banco().consulta(
    `select id, tipo, quantidade, custo_unitario_centavos, saldo_depois, pedido_nsu, fornecedor, nota, motivo, email, quando
     from loja.estoque_movimentos where produto_id = $1 order by quando desc, id desc limit $2`,
    [produtoId, Math.min(Math.max(limite, 1), 500)],
  );
}

// ───────── Pedidos: reserva, baixa, liberação e devolução ─────────

export type ItemPedido = { produto_id: string | null; quantidade: number };

/** Reserva as unidades do pedido (dentro da transação que cria o pedido). Sem saldo, recusa com a mensagem para o cliente. */
export async function reservar(b: Banco, pedidoNsu: string, itensPedido: ItemPedido[], expiraEm: Date): Promise<void> {
  for (const it of itensPedido) {
    const id = it.produto_id || produtos.KIT;
    const atual = await travar(b, id);
    const disponivel = atual.fisico - atual.reservado;
    if (atual.controlar && disponivel < it.quantidade)
      throw new ErroEstoque(disponivel > 0 ? `Só temos ${disponivel} em estoque. Escolha uma quantidade menor.` : "Esgotado no momento.");
    await b.consulta(
      `insert into loja.estoque_reservas (pedido_nsu, produto_id, quantidade, situacao, criado_em, expira_em, atualizado_em)
       values ($1, $2, $3, 'ativa', $4, $5, $4)`,
      [pedidoNsu, id, it.quantidade, agora(), expiraEm],
    );
  }
}

/** O pagamento entrou: as reservas do pedido viram venda (saem do saldo físico). Repetir não baixa de novo. */
export async function baixar(pedidoNsu: string): Promise<void> {
  await banco().transacao(async (b) => {
    const reservas = await b.consulta<{ produto_id: string; quantidade: number }>(
      "select produto_id, quantidade from loja.estoque_reservas where pedido_nsu = $1 and situacao in ('ativa', 'liberada')",
      [pedidoNsu],
    );
    for (const r of reservas) {
      const atual = await travar(b, r.produto_id);
      // A venda paga sai mesmo que o saldo fique negativo (o dinheiro já entrou): o painel mostra e o vendedor ajusta.
      await gravar(b, r.produto_id, { ...atual, controlar: false }, { tipo: "venda", quantidade: -r.quantidade, pedido_nsu: pedidoNsu }, null);
      await b.consulta("update loja.estoque_reservas set situacao = 'baixada', atualizado_em = $3 where pedido_nsu = $1 and produto_id = $2", [
        pedidoNsu, r.produto_id, agora(),
      ]);
    }
  });
}

/** O pedido não vai ser pago (link vencido, cancelado): as unidades voltam a ficar disponíveis. */
export async function liberar(pedidoNsu: string): Promise<number> {
  const linhas = await banco().consulta(
    "update loja.estoque_reservas set situacao = 'liberada', atualizado_em = $2 where pedido_nsu = $1 and situacao = 'ativa' returning produto_id",
    [pedidoNsu, agora()],
  );
  return linhas.length;
}

/** As reservas vencidas (pedido sem pagamento depois do prazo do link) são liberadas. Roda na tarefa agendada. */
export async function liberarVencidas(): Promise<string[]> {
  const linhas = await banco().consulta<{ pedido_nsu: string }>(
    "update loja.estoque_reservas set situacao = 'liberada', atualizado_em = $1 where situacao = 'ativa' and expira_em < $1 returning pedido_nsu",
    [agora()],
  );
  return [...new Set(linhas.map((l) => l.pedido_nsu))];
}

/** Reembolso com o produto de volta: o que foi vendido no pedido volta ao saldo. Repetir não devolve de novo. */
export async function devolver(pedidoNsu: string, email: string | null): Promise<number> {
  let total = 0;
  await banco().transacao(async (b) => {
    const reservas = await b.consulta<{ produto_id: string; quantidade: number }>(
      "select produto_id, quantidade from loja.estoque_reservas where pedido_nsu = $1 and situacao = 'baixada'",
      [pedidoNsu],
    );
    for (const r of reservas) {
      const atual = await travar(b, r.produto_id);
      await gravar(b, r.produto_id, atual, { tipo: "devolucao", quantidade: r.quantidade, pedido_nsu: pedidoNsu, motivo: "Reembolso com o produto de volta" }, email);
      await b.consulta("update loja.estoque_reservas set situacao = 'devolvida', atualizado_em = $3 where pedido_nsu = $1 and produto_id = $2", [
        pedidoNsu, r.produto_id, agora(),
      ]);
      total += r.quantidade;
    }
  });
  return total;
}

// ───────── SKUs ─────────

/** A sugestão de SKU para um produto novo (o formulário mostra antes de salvar). */
export async function sugerirSku(nome: string, categoria: string | null): Promise<string> {
  if (!String(nome ?? "").trim()) throw new ErroEstoque("Escreva o nome do produto.");
  return sku.proximo(nome, categoria, (await cfg()).SKU_PREFIXO);
}

/** Gera o SKU dos produtos que estão sem. Devolve quantos ganharam. */
export async function gerarSkusQueFaltam(email: string | null): Promise<number> {
  const sem = (await produtos.listar(false)).filter((p) => !p.sku);
  const prefixo = (await cfg()).SKU_PREFIXO;
  for (const p of sem) {
    await banco().consulta("update loja.produtos set sku = $2 where slug = $1 and sku is null", [p.slug, await sku.proximo(p.nome, p.categoria, prefixo)]);
  }
  if (sem.length) await registrar(email, "estoque", `SKU gerado para ${sem.length} produto(s)`);
  return sem.length;
}
