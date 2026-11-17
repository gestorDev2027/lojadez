// As regras dos pedidos: criar (com o frete cotado de novo no servidor e o estoque reservado), conferir o pagamento e
// despachar pela Loggi.
//
// O preço e o frete nunca vêm do navegador: o servidor recalcula tudo na hora de criar o pedido.
// O estoque: criar reserva as unidades (na mesma transação do pedido); pago, a reserva vira venda; cancelado ou com o
// link vencido, a reserva é liberada (a tarefa agendada cuida dos vencidos).
import { randomUUID } from "node:crypto";
import * as afiliados from "./afiliados";
import { agora, banco, registrar, uma, type Linha } from "./banco";
import * as catalogo from "./catalogo";
import { cfg, descontoPix } from "./config";
import * as cupons from "./cupons";
import { ErroLoja } from "./erros";
import * as estoque from "./estoque";
import * as infinitepay from "./infinitepay";
import * as loggi from "./loggi";
import * as produtos from "./produtos";

export class ErroPedido extends ErroLoja {}

/** Quanto tempo as unidades ficam reservadas esperando o pagamento (depois, voltam para a vitrine). */
export const RESERVA_HORAS = 2;

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;
const NSU = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Pedido = Linha & {
  order_nsu: string;
  situacao: string;
  criado_em: Date;
  produto_id: string | null;
  kits: number;
  preco_centavos: number;
  total_centavos: number;
  desconto_pix: number | null;
  nome: string;
};

/** O order_nsu da URL: só um UUID; o resto é "não encontrado". */
export function nsu(texto: unknown): string {
  const t = String(texto ?? "").trim().toLowerCase();
  if (!NSU.test(t)) throw new ErroPedido("Pedido não encontrado.", 404);
  return t;
}

export const buscar = (orderNsu: string) => uma<Pedido>("select * from loja.pedidos where order_nsu = $1", [orderNsu]);

async function pedido(orderNsu: string): Promise<Pedido> {
  const p = await buscar(orderNsu);
  if (!p) throw new ErroPedido("Pedido não encontrado.", 404);
  return p;
}

/** Altera o pedido. Com `soSeSituacao`, só altera se ele estiver numa dessas situações (evita corrida). */
export async function alterar(orderNsu: string, valores: Record<string, unknown>, soSeSituacao?: string[]): Promise<boolean> {
  const colunas = Object.keys(valores);
  const sets = colunas.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const parametros: unknown[] = [orderNsu, ...colunas.map((c) => valores[c]), ...(soSeSituacao ?? [])];
  const filtro = soSeSituacao?.length
    ? ` and situacao in (${soSeSituacao.map((_, i) => `$${colunas.length + 2 + i}`).join(", ")})`
    : "";
  const linhas = await banco().consulta(`update loja.pedidos set ${sets} where order_nsu = $1${filtro} returning id`, parametros);
  return linhas.length > 0;
}

// ───────── A oferta escolhida ─────────

type OfertaPedido = catalogo.Oferta & {
  produto_id: string | null;
  sku: string;
  descricao: string;
  medidas: loggi.Medidas | null;
};

/** A oferta, já com o que o pedido precisa do produto. Sem produto (ou com o do kit), é o kit de lâminas da landing. */
async function oferta(ofertaId: unknown, produtoId: unknown): Promise<OfertaPedido> {
  const id = String(produtoId ?? "").trim();
  if (!id || id === produtos.KIT) {
    const o = await catalogo.oferta(String(ofertaId ?? ""));
    if (!o) throw new ErroPedido("Escolha um dos kits.");
    return { ...o, produto_id: null, sku: (await cfg()).PRODUTO.sku, descricao: await catalogo.descricaoOferta(o), medidas: null };
  }
  const p = await produtos.buscar(id, true);
  if (!p) throw new ErroPedido("Este produto não está mais à venda.");
  const o = produtos.oferta(p, String(ofertaId ?? ""));
  if (!o) throw new ErroPedido("Escolha uma das quantidades.");
  return { ...o, produto_id: p.slug, sku: p.sku || p.slug, descricao: produtos.descricaoPedido(p, o), medidas: produtos.medidas(p) };
}

// ───────── Validações ─────────

/** Os dois dígitos verificadores do CPF. */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || cpf === cpf[0].repeat(11)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[tamanho])) return false;
  }
  return true;
}

function campo(dados: Record<string, unknown>, nome: string, rotulo: string, { minimo = 1, maximo = 120, obrigatorio = true } = {}): string {
  const valor = String(dados[nome] ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (obrigatorio && valor.length < minimo) throw new ErroPedido(`Preencha ${rotulo}.`);
  if (valor.length > maximo) throw new ErroPedido(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} tem até ${maximo} caracteres.`);
  return valor;
}

// ───────── Frete e cupom ─────────

type Opcao = loggi.OpcaoFrete & { custo_centavos: number; gratis: boolean };

/** A cotação da Loggi. Com frete grátis (pela quantidade ou por cupom), a opção mais barata sai por 0 para o comprador
 * (a loja paga); as outras ele paga normalmente. Cada opção leva o custo da Loggi em custo_centavos. */
async function cotar(cep: string, o: OfertaPedido, freteDoCupom = false) {
  const cotacao = await loggi.cotar(cep, o.kits, o.preco_centavos, o.medidas);
  const opcoes: Opcao[] = cotacao.opcoes.map((op) => ({ ...op, custo_centavos: op.centavos, gratis: false }));
  const gratis = Boolean(o.frete_gratis) || freteDoCupom;
  if (gratis && opcoes.length) opcoes[0] = { ...opcoes[0], centavos: 0, gratis: true }; // já vêm da mais barata
  return { endereco: cotacao.endereco, opcoes, frete_gratis: gratis };
}

async function cupom(codigo: unknown, o: OfertaPedido, cpf?: string | null): Promise<cupons.CupomAplicado | null> {
  if (!String(codigo ?? "").trim()) return null;
  try {
    return await cupons.aplicar(codigo, o.produto_id, o.preco_centavos, cpf);
  } catch (erro) {
    if (erro instanceof cupons.ErroCupom) throw new ErroPedido(erro.message);
    throw erro;
  }
}

/** A prévia do cupom no checkout (o servidor confere de novo ao criar o pedido). */
export async function validarCupom(codigo: unknown, ofertaId: unknown, produtoId: unknown, cpf?: unknown) {
  const doCpf = String(cpf ?? "").replace(/\D/g, "");
  const aplicado = await cupom(codigo, await oferta(ofertaId, produtoId), cpfValido(doCpf) ? doCpf : null);
  if (!aplicado) throw new ErroPedido("Digite o cupom.");
  return {
    codigo: aplicado.cupom.codigo, descricao: aplicado.descricao,
    desconto_centavos: aplicado.desconto_centavos, frete_gratis: aplicado.frete_gratis,
  };
}

export async function cotarFrete(cep: unknown, ofertaId: unknown, produtoId: unknown, codigoCupom: unknown) {
  const o = await oferta(ofertaId, produtoId);
  let freteDoCupom = false;
  try { // um cupom de frete grátis já aparece na cotação; cupom inválido aqui só não muda nada
    freteDoCupom = Boolean(codigoCupom) && (await cupons.aplicar(codigoCupom, o.produto_id, o.preco_centavos)).frete_gratis;
  } catch (erro) {
    if (!(erro instanceof cupons.ErroCupom)) throw erro;
  }
  const cotacao = await cotar(String(cep ?? ""), o, freteDoCupom);
  return {
    ...cotacao,
    produto_centavos: o.preco_centavos,
    opcoes: cotacao.opcoes.map((op) => ({ ...op, total_centavos: o.preco_centavos + op.centavos })),
  };
}

// ───────── Afiliado ─────────

/** O afiliado que trouxe a venda e a comissão fixada agora (sobre os produtos com o desconto do cupom).
 * O cupom de um afiliado vale sobre o link (quem digitou o cupom dele veio por ele). */
async function doAfiliado(ref: unknown, o: OfertaPedido, c: cupons.CupomAplicado | null, campanha: unknown) {
  let a: afiliados.Afiliado | null = null;
  if (c?.cupom.afiliado_id) {
    const doCupom = await afiliados.buscar(c.cupom.afiliado_id);
    a = doCupom && afiliados.podeVender(doCupom, o.produto_id) ? doCupom : null;
  }
  a ??= await afiliados.atribuir(String(ref ?? "").slice(0, 40), o.produto_id);
  if (!a) return { afiliado_id: null, afiliado_codigo: null, comissao_pct: null, comissao_centavos: null, campanha_codigo: null };
  const daCampanha = campanha ? await afiliados.buscarCampanha(campanha) : null;
  return {
    afiliado_id: a.id,
    afiliado_codigo: a.codigo,
    comissao_pct: afiliados.comissaoPct(a, o.produto_id),
    comissao_centavos: afiliados.comissao(a, o.preco_centavos - (c?.desconto_centavos ?? 0), o.produto_id),
    // a campanha do link curto, se for deste afiliado (senão a venda fica sem campanha)
    campanha_codigo: daCampanha && daCampanha.afiliado_id === a.id ? daCampanha.codigo : null,
  };
}

// ───────── Criar ─────────

export async function criar(dados: Record<string, unknown>): Promise<{ order_nsu: string; link_pagamento: string }> {
  const c = await cfg();
  const o = await oferta(dados.oferta, dados.produto);
  const nome = campo(dados, "nome", "o nome completo", { minimo: 5 });
  if (nome.split(" ").length < 2) throw new ErroPedido("Informe nome e sobrenome.");
  const cpf = String(dados.cpf ?? "").replace(/\D/g, "");
  if (!cpfValido(cpf)) throw new ErroPedido("CPF inválido.");
  const email = campo(dados, "email", "o e-mail", { maximo: 200 }).toLowerCase(); // vai preenchido para a InfinitePay
  if (!EMAIL.test(email)) throw new ErroPedido("E-mail inválido.");
  const telefone = String(dados.telefone ?? "").replace(/\D/g, "");
  if (![10, 11].includes(telefone.length)) throw new ErroPedido("Telefone com DDD: 10 ou 11 números.");
  const numero = campo(dados, "numero", "o número", { maximo: 20 });
  const complemento = campo(dados, "complemento", "o complemento", { maximo: 80, obrigatorio: false });

  const aplicado = await cupom(dados.cupom, o, cpf);
  const desconto = aplicado?.desconto_centavos ?? 0;
  const cotacao = await cotar(String(dados.cep ?? ""), o, Boolean(aplicado?.frete_gratis));
  const opcao = cotacao.opcoes.find((op) => op.tipo === dados.frete_tipo);
  if (!opcao) throw new ErroPedido("Esta opção de frete não está mais disponível. Calcule o frete de novo.", 409);
  const endereco = cotacao.endereco; // cidade e UF vêm do CEP, não da tela
  const rua = campo(dados, "rua", "a rua", { maximo: 160, obrigatorio: false }) || endereco.rua;
  const bairro = campo(dados, "bairro", "o bairro", { maximo: 100, obrigatorio: false }) || endereco.bairro;
  if (!rua || !bairro) throw new ErroPedido("Preencha a rua e o bairro.");

  const criadoEm = agora();
  const novo: Record<string, unknown> = {
    order_nsu: randomUUID(), criado_em: criadoEm, situacao: "aguardando_pagamento",
    sku: o.sku.slice(0, 40), oferta: o.id, produto: o.descricao, kits: o.kits, produto_id: o.produto_id,
    ...(await doAfiliado(dados.ref, o, aplicado, dados.campanha)),
    cupom_codigo: aplicado?.cupom.codigo ?? null, desconto_cupom_centavos: desconto || null,
    preco_centavos: o.preco_centavos, frete_tipo: opcao.tipo,
    frete_descricao: `Frete ${opcao.gratis ? "grátis " : ""}Loggi ${opcao.nome} (até ${opcao.prazo_dias} dias úteis)`,
    frete_prazo_dias: opcao.prazo_dias, frete_centavos: opcao.centavos, frete_custo_centavos: opcao.custo_centavos,
    total_centavos: o.preco_centavos - desconto + opcao.centavos, desconto_pix: descontoPix(c) || null,
    nome, cpf, email, telefone, cep: endereco.cep, rua, numero, complemento: complemento || null, bairro,
    cidade: endereco.cidade, uf: endereco.uf,
  };
  const orderNsu = novo.order_nsu as string;
  const colunas = Object.keys(novo);
  await banco().transacao(async (b) => {
    await b.consulta(
      `insert into loja.pedidos (${colunas.join(", ")}) values (${colunas.map((_, i) => `$${i + 1}`).join(", ")})`,
      colunas.map((k) => novo[k]),
    );
    try {
      await estoque.reservar(b, orderNsu, [{ produto_id: o.produto_id, quantidade: o.kits }],
        new Date(criadoEm.getTime() + RESERVA_HORAS * 3600_000));
    } catch (erro) {
      if (erro instanceof estoque.ErroEstoque) throw new ErroPedido(erro.message, 409);
      throw erro;
    }
  });

  let link: string;
  try {
    link = await infinitepay.criarLink(novo as unknown as infinitepay.PedidoPagamento);
  } catch (erro) {
    await alterar(orderNsu, { situacao: "cancelado" });
    await estoque.liberar(orderNsu);
    if (erro instanceof infinitepay.ErroPagamento) {
      console.warn(`Link de pagamento não criado para ${orderNsu}: ${erro.message}`);
      throw new ErroPedido(erro.message, 502);
    }
    throw erro;
  }
  await alterar(orderNsu, { link_pagamento: link });
  return { order_nsu: orderNsu, link_pagamento: link };
}

// ───────── Conferir o pagamento ─────────

/** O total com o desconto do Pix que valia quando o pedido foi criado (a InfinitePay arredonda ao centavo). */
export const totalComPix = (p: Pick<Pedido, "total_centavos" | "desconto_pix">) =>
  Math.round(p.total_centavos * (1 - (p.desconto_pix ?? 0) / 100));

/** O valor da InfinitePay bate com o do pedido: o total, ou, pago no Pix com desconto, o total com o desconto. */
export function valorConfere(p: Pick<Pedido, "total_centavos" | "desconto_pix">, r: infinitepay.Conferencia): boolean {
  const valor = Math.trunc(Number(r.amount ?? 0));
  if (valor === p.total_centavos) return true;
  return Boolean(p.desconto_pix) && r.capture_method === "pix" && Math.abs(valor - totalComPix(p)) <= 1;
}

export type Conferido = {
  pedido: Pedido;
  /** O envio automático na Loggi, quando este pedido acabou de ser pago (a rota não precisa esperar). */
  envio: Promise<void> | null;
};

/** Confere na InfinitePay e, se pago com o valor certo, marca o pedido como pago. Pode ser chamado várias vezes. */
export async function conferir(orderNsu: string, transactionNsu: string, slug: string, reciboUrl: unknown = null): Promise<Conferido> {
  const p = await pedido(orderNsu);
  if (p.situacao !== "aguardando_pagamento" || !transactionNsu || !slug) return { pedido: p, envio: null };
  // Guarda o que a InfinitePay mandou: se a conferência falhar agora, a tarefa agendada tenta de novo.
  if (p.transaction_nsu !== transactionNsu || p.slug !== slug)
    await alterar(orderNsu, { transaction_nsu: transactionNsu.slice(0, 100), slug: slug.slice(0, 100) }, ["aguardando_pagamento"]);
  let r: infinitepay.Conferencia;
  try {
    r = await infinitepay.conferirPagamento(orderNsu, transactionNsu, slug);
  } catch (erro) {
    if (erro instanceof infinitepay.ErroPagamento) throw new ErroPedido(erro.message, 502);
    throw erro;
  }
  if (!r.paid) return { pedido: await pedido(orderNsu), envio: null };
  if (!valorConfere(p, r)) {
    console.warn(`Pagamento de ${orderNsu} com valor diferente: ${r.amount} em vez de ${p.total_centavos}.`);
    await alterar(orderNsu, { situacao: "pagamento_divergente" }, ["aguardando_pagamento"]);
    return { pedido: await pedido(orderNsu), envio: null };
  }
  const c = await cfg();
  const recibo = String(reciboUrl ?? "");
  const marcou = await alterar(orderNsu, {
    situacao: "pago",
    forma_pagamento: r.capture_method ? String(r.capture_method).slice(0, 30) : null,
    valor_pago_centavos: Math.trunc(Number(r.paid_amount ?? r.amount ?? 0)),
    parcelas: Math.trunc(Number(r.installments ?? 1)) || 1,
    recibo_url: recibo.startsWith("https://") || (c.INFINITEPAY_AMBIENTE === "simulado" && recibo) ? recibo : null,
    pago_em: agora(),
  }, ["aguardando_pagamento"]);
  if (!marcou) return { pedido: await pedido(orderNsu), envio: null };
  // A reserva vira venda (sai do estoque). Só quem marcou o pedido como pago dispara o envio: o webhook e a página
  // do cliente conferem ao mesmo tempo.
  await estoque.baixar(orderNsu);
  return { pedido: await pedido(orderNsu), envio: c.LOGGI_ENVIO_AUTOMATICO ? envioAutomatico(orderNsu) : null };
}

/** O aviso da InfinitePay não é assinado: só serve de gatilho para conferir. */
export async function processarWebhook(aviso: Record<string, unknown>): Promise<Conferido> {
  const orderNsu = String(aviso.order_nsu ?? "");
  if (!orderNsu) throw new ErroPedido("Aviso sem order_nsu.", 400);
  return conferir(nsu(orderNsu), String(aviso.transaction_nsu ?? ""), String(aviso.invoice_slug ?? ""), aviso.receipt_url);
}

/** A tarefa agendada: confere de novo os pedidos esperando pagamento que já têm os dados da InfinitePay (o webhook
 * ou a volta do cliente chegaram, mas a conferência falhou) e libera as reservas vencidas. */
export async function conferirPendentes(): Promise<{ conferidos: number; pagos: number; liberados: number; envios: Promise<void>[] }> {
  const desde = new Date(Date.now() - 3 * 24 * 3600_000);
  const pendentes = await banco().consulta<{ order_nsu: string; transaction_nsu: string; slug: string }>(
    `select order_nsu, transaction_nsu, slug from loja.pedidos
      where situacao = 'aguardando_pagamento' and transaction_nsu is not null and slug is not null and criado_em >= $1
      order by criado_em limit 20`,
    [desde],
  );
  let pagos = 0;
  const envios: Promise<void>[] = [];
  for (const p of pendentes) {
    try {
      const r = await conferir(p.order_nsu, p.transaction_nsu, p.slug);
      if (r.pedido.situacao === "pago") pagos++;
      if (r.envio) envios.push(r.envio);
    } catch (erro) {
      console.warn(`Conferência agendada de ${p.order_nsu} falhou`, erro);
    }
  }
  const liberados = (await estoque.liberarVencidas()).length;
  return { conferidos: pendentes.length, pagos, liberados, envios };
}

/** Cancela um pedido não pago (o vendedor, ou o cliente que desistiu): a reserva volta para a vitrine. */
export async function cancelar(orderNsu: string): Promise<Pedido> {
  if (!(await alterar(orderNsu, { situacao: "cancelado" }, ["aguardando_pagamento", "pagamento_divergente"])))
    throw new ErroPedido("Só pedidos não pagos podem ser cancelados aqui (pago: estorne na InfinitePay).", 409);
  await estoque.liberar(orderNsu);
  return pedido(orderNsu);
}

// ───────── O que o comprador vê ─────────

/** O pedido para o comprador (sem e-mail, telefone ou endereço completo). */
export function publico(p: Pedido) {
  return {
    order_nsu: p.order_nsu, situacao: p.situacao, primeiro_nome: p.nome.split(" ")[0],
    produto: p.produto, kits: p.kits, preco_centavos: p.preco_centavos, frete_descricao: p.frete_descricao,
    frete_centavos: p.frete_centavos, total_centavos: p.total_centavos, cidade: p.cidade, uf: p.uf,
    forma_pagamento: p.forma_pagamento, recibo_url: p.recibo_url, codigo_rastreio: p.codigo_rastreio,
    link_pagamento: p.situacao === "aguardando_pagamento" ? p.link_pagamento : null,
    valor_pago_centavos: p.valor_pago_centavos ?? null, desconto_pix: p.desconto_pix ?? null,
    tem_envio_loggi: Boolean(p.loggi_key), produto_id: p.produto_id ?? null,
    cupom_codigo: p.cupom_codigo ?? null, desconto_cupom_centavos: p.desconto_cupom_centavos ?? null,
  };
}

/** O rastreio público do pedido (o order_nsu é o segredo do link do cliente). */
export async function rastreio(orderNsu: string) {
  const p = await pedido(orderNsu);
  if (!p.codigo_rastreio || !p.loggi_key) return { codigo: p.codigo_rastreio ?? null, rastreio: null };
  try {
    return { codigo: p.codigo_rastreio, rastreio: await loggi.rastrear(p.codigo_rastreio) };
  } catch (erro) {
    if (erro instanceof loggi.ErroFrete) return { codigo: p.codigo_rastreio, rastreio: null };
    throw erro;
  }
}

// ───────── Envio pela Loggi ─────────

/** Cria o pacote na Loggi (uma vez por pedido pago). O código de rastreio passa a aparecer para o cliente.
 * A trava é no banco (envio_criado_em): duas Functions ao mesmo tempo não criam dois pacotes. */
export async function criarEnvioLoggi(orderNsu: string): Promise<Pedido> {
  const p = await pedido(orderNsu);
  if (!["pago", "enviado"].includes(p.situacao)) throw new ErroPedido("Só pedidos pagos podem ir para a Loggi.", 409);
  if (p.loggi_key) throw new ErroPedido("Este pedido já tem envio na Loggi.", 409);
  if (!p.cpf) throw new ErroPedido("O pedido não tem CPF: a Loggi exige o CPF de quem recebe.", 409);
  // Marca "criando" (envio_criado_em sem loggi_key); outra chamada nos próximos 2 minutos desiste.
  const trava = await banco().consulta(
    `update loja.pedidos set envio_criado_em = $2 where order_nsu = $1 and loggi_key is null
        and (envio_criado_em is null or envio_criado_em < $3) returning id`,
    [orderNsu, agora(), new Date(Date.now() - 120_000)],
  );
  if (!trava.length) throw new ErroPedido("O envio deste pedido já está sendo criado. Atualize em instantes.", 409);
  let envio: { loggi_key: string; tracking_code: string };
  try {
    envio = await loggi.criarEnvio(p as unknown as loggi.PedidoEnvio);
  } catch (erro) {
    await alterar(orderNsu, { envio_criado_em: null });
    if (erro instanceof loggi.ErroFrete) throw new ErroPedido(erro.message, 502);
    throw erro;
  }
  await alterar(orderNsu, {
    loggi_key: envio.loggi_key, envio_criado_em: agora(), envio_erro: null,
    codigo_rastreio: envio.tracking_code || p.codigo_rastreio || null,
  });
  console.info(`Envio criado na Loggi para o pedido ${orderNsu}.`);
  return pedido(orderNsu);
}

/** Cria o envio logo depois do pagamento. Se a Loggi recusar, guarda o motivo no pedido (o vendedor cria à mão).
 * Nunca lança: roda depois da resposta (http.depois). */
export async function envioAutomatico(orderNsu: string): Promise<void> {
  try {
    await criarEnvioLoggi(orderNsu);
  } catch (erro) {
    const mensagem = erro instanceof ErroLoja ? erro.message : "Erro inesperado ao falar com a Loggi. Crie o envio à mão.";
    if (erro instanceof ErroLoja && /já tem envio|já está sendo criado/.test(erro.message)) return;
    console.warn(`Envio automático na Loggi falhou para ${orderNsu}: ${mensagem}`, erro instanceof ErroLoja ? "" : erro);
    try {
      await alterar(orderNsu, { envio_erro: mensagem.slice(0, 500) });
    } catch {
      /* nada mais a fazer */
    }
  }
}

// ───────── A área do vendedor ─────────

/** Os pedidos, do mais novo para o mais antigo (com a situação, se vier). */
export async function listar(situacao: string | null = null, limite = 5000): Promise<Pedido[]> {
  return situacao
    ? banco().consulta<Pedido>("select * from loja.pedidos where situacao = $1 order by criado_em desc limit $2", [situacao, limite])
    : banco().consulta<Pedido>("select * from loja.pedidos order by criado_em desc limit $1", [limite]);
}

/** O pedido para a tela do vendedor: tudo, menos o id interno; datas em ISO. */
export function paraTela(p: Pedido): Record<string, unknown> {
  const { id: _id, ...resto } = p;
  return Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}

export async function marcarEnviado(orderNsu: string, codigoRastreio: unknown, email: string | null): Promise<Pedido> {
  const atual = await pedido(orderNsu);
  const codigo = String(codigoRastreio ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 60) || atual.codigo_rastreio;
  if (!codigo) throw new ErroPedido("Informe o código de rastreio (ou crie o envio na Loggi).");
  if (!(await alterar(orderNsu, { situacao: "enviado", codigo_rastreio: codigo, enviado_em: agora() }, ["pago"])))
    throw new ErroPedido("Só pedidos pagos podem ser marcados como enviados.", 409);
  await registrar(email, "pedido", `Enviado: ${orderNsu.slice(0, 8)} · ${codigo}`);
  return pedido(orderNsu);
}

// Cancelar um pedido pago (reembolso). A API da InfinitePay não estorna: o estorno é feito no app ou no site dela.
// A loja marca o pedido, cancela o envio na Loggi (se ainda der), tira a comissão do afiliado (o pedido deixa de contar
// como venda) e guarda o motivo e o valor. O estoque: se o pacote não saiu (pedido "pago", sem envio ou com o envio
// cancelado), o produto volta na hora; se já saiu, o vendedor diz se voltou ao confirmar o reembolso.

export const MOTIVOS_REEMBOLSO: Record<string, string> = {
  arrependimento: "Cliente desistiu da compra",
  sem_estoque: "Sem estoque",
  endereco: "Endereço errado ou entrega não feita",
  defeito: "Produto com defeito",
  outro: "Outro motivo",
};

/** O que o cliente pagou de fato (no Pix com desconto, o total com o desconto). */
export const valorPago = (p: Pedido) => (p.desconto_pix && p.forma_pagamento === "pix" ? totalComPix(p) : p.total_centavos);

const reaisTexto = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");

function valorReembolso(texto: unknown, pago: number): number {
  if (texto === null || texto === undefined || texto === "") return pago;
  const valor = Number(texto);
  if (!Number.isInteger(valor)) throw new ErroPedido("Valor do reembolso inválido.");
  if (valor < 1 || valor > pago) throw new ErroPedido(`O reembolso vai de R$ 0,01 até o valor pago (R$ ${reaisTexto(pago)}).`);
  return valor;
}

export async function pedirReembolso(
  orderNsu: string,
  dados: Record<string, unknown>,
  email: string | null,
): Promise<Pedido & { aviso_loggi: string | null; voltou_ao_estoque: number }> {
  const p = await pedido(orderNsu);
  if (!["pago", "enviado"].includes(p.situacao))
    throw new ErroPedido("Só pedidos pagos ou enviados são reembolsados (os não pagos: “Cancelar pedido”).", 409);
  const motivo = String(dados.motivo ?? "");
  if (!(motivo in MOTIVOS_REEMBOLSO)) throw new ErroPedido("Escolha o motivo do cancelamento.");
  const valor = valorReembolso(dados.valor_centavos, valorPago(p));
  const detalhe = String(dados.detalhe ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 300);
  const texto = MOTIVOS_REEMBOLSO[motivo] + (detalhe ? `: ${detalhe}` : "");
  const mudar: Record<string, unknown> = {
    situacao: "reembolso_pendente", reembolso_motivo: texto, reembolso_centavos: valor, reembolso_pedido_em: agora(),
  };
  let aviso: string | null = null;
  let pacoteFicou = !p.loggi_key; // sem envio na Loggi: o produto não saiu
  if (p.loggi_key) {
    const semEnvio = { loggi_key: null, envio_criado_em: null, codigo_rastreio: null };
    try {
      await loggi.cancelarEnvio(p.loggi_key);
      Object.assign(mudar, semEnvio);
      aviso = "O envio na Loggi foi cancelado.";
      pacoteFicou = true;
    } catch (erro) {
      if (!(erro instanceof loggi.ErroFrete)) throw erro;
      if (await loggi.jaCancelado(p.codigo_rastreio)) {
        Object.assign(mudar, semEnvio);
        aviso = "O envio na Loggi já estava cancelado.";
        pacoteFicou = true;
      } else {
        // já em rota ou entregue: o frete fica como custo da loja
        aviso = `O envio na Loggi não foi cancelado (${erro.message}). Se o pacote já saiu, combine a devolução com o cliente.`;
      }
    }
  }
  if (!(await alterar(orderNsu, mudar, ["pago", "enviado"])))
    throw new ErroPedido("O pedido mudou enquanto isso. Atualize e tente de novo.", 409);
  const voltou = p.situacao === "pago" && pacoteFicou ? await estoque.devolver(orderNsu, email) : 0;
  await registrar(email, "reembolso", `Reembolso pedido: ${orderNsu.slice(0, 8)} · ${reaisTexto(valor)} · ${texto}`);
  return { ...(await pedido(orderNsu)), aviso_loggi: aviso, voltou_ao_estoque: voltou };
}

/** Depois do estorno feito na InfinitePay: o pedido vira "reembolsado" (dá para acertar o valor devolvido). Com
 * `voltou_ao_estoque`, o produto que o cliente devolveu entra de novo no saldo (repetir não devolve de novo). */
export async function confirmarReembolso(orderNsu: string, dados: Record<string, unknown>, email: string | null): Promise<Pedido> {
  const p = await pedido(orderNsu);
  if (p.situacao !== "reembolso_pendente") throw new ErroPedido("Este pedido não está esperando reembolso.", 409);
  const mudar: Record<string, unknown> = { situacao: "reembolsado", reembolsado_em: agora() };
  if (dados.valor_centavos !== undefined && dados.valor_centavos !== null && dados.valor_centavos !== "")
    mudar.reembolso_centavos = valorReembolso(dados.valor_centavos, valorPago(p));
  if (!(await alterar(orderNsu, mudar, ["reembolso_pendente"])))
    throw new ErroPedido("O pedido mudou enquanto isso. Atualize e tente de novo.", 409);
  if (dados.voltou_ao_estoque === true) await estoque.devolver(orderNsu, email);
  await registrar(email, "reembolso", `Reembolso confirmado: ${orderNsu.slice(0, 8)}`);
  return pedido(orderNsu);
}

export async function etiquetaLoggi(orderNsu: string): Promise<Uint8Array> {
  const p = await pedido(orderNsu);
  if (!p.loggi_key) throw new ErroPedido("Crie o envio na Loggi antes de gerar a etiqueta.", 409);
  try {
    return await loggi.etiqueta(p.loggi_key);
  } catch (erro) {
    if (erro instanceof loggi.ErroFrete) throw new ErroPedido(erro.message, 502);
    throw erro;
  }
}

export async function cancelarEnvioLoggi(orderNsu: string, email: string | null): Promise<Pedido & { aviso_loggi: string | null }> {
  const p = await pedido(orderNsu);
  if (!p.loggi_key) throw new ErroPedido("Este pedido não tem envio na Loggi.", 409);
  let aviso: string | null;
  try {
    aviso = await loggi.cancelarEnvio(p.loggi_key);
  } catch (erro) {
    if (!(erro instanceof loggi.ErroFrete)) throw erro;
    if (!(await loggi.jaCancelado(p.codigo_rastreio))) throw new ErroPedido(erro.message, 502);
    aviso = "Este envio já estava cancelado na Loggi. Agora dá para criar um envio novo.";
  }
  await alterar(orderNsu, {
    loggi_key: null, envio_criado_em: null, codigo_rastreio: null, situacao: p.situacao === "enviado" ? "pago" : p.situacao,
  });
  await registrar(email, "pedido", `Envio na Loggi cancelado: ${orderNsu.slice(0, 8)}`);
  return { ...(await pedido(orderNsu)), aviso_loggi: aviso };
}
