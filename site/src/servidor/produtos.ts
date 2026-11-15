// Os produtos do catálogo, além do kit de lâminas.
// O kit continua com a página própria (/), os ajustes em catalogo.ts e o id KIT. Os outros ficam na tabela `produtos`,
// cada um com a página /p/<slug>, o checkout (/checkout?produto=<slug>) e o mesmo jeito de vender do kit: ofertas por
// quantidade, o "monte o seu" (da maior oferta + 1 até o máximo, pelo preço por unidade) e o frete grátis a partir de
// N unidades. O id de cada oferta é "q<quantidade>" (q1, q2, q5...).
// Excluir não mexe nos pedidos antigos, mas é recusado enquanto houver pedido pago e ainda não enviado.
import { agora, banco, registrar, uma } from "./banco";
import * as catalogo from "./catalogo";
import type { Montar, Oferta } from "./catalogo";
import { ErroLoja } from "./erros";

export const KIT = "kit-laminas";
const MAXIMO_UNIDADES = 30;
const MAXIMO_OFERTAS = 4;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FOTO_PADRAO = "/assets/img/produto.svg";

export class ErroProduto extends ErroLoja {}

export type OfertaProduto = { quantidade: number; preco_centavos: number; selo?: string };

export type ProdutoBanco = {
  slug: string;
  nome: string;
  chamada: string | null;
  descricao: string | null;
  sku: string | null;
  ativo: boolean;
  ordem: number;
  unidade: string;
  unidade_plural: string;
  conteudo: string | null;
  peso_g: number;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  ofertas: OfertaProduto[];
  montar: { ativo?: boolean; maximo?: number; preco_unidade_centavos?: number };
  frete_gratis_a_partir: number;
  destaque: boolean | null;
  categoria: string | null;
  selo: string | null;
  criado_em: Date;
  atualizado_em: Date;
};

const nomeFoto = (slug: string) => `produto:${slug}`;

export function gerarSlug(nome: string): string {
  const texto = (nome ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  return texto.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/^-+|-+$/g, "");
}

// ───────── Leitura ─────────

export async function listar(soAtivos = true): Promise<ProdutoBanco[]> {
  return banco().consulta<ProdutoBanco>(
    `select * from loja.produtos ${soAtivos ? "where ativo is true" : ""} order by ordem, nome`,
  );
}

export async function buscar(slug: string, soAtivo = false): Promise<ProdutoBanco | null> {
  if (!slug || slug.length > 30) return null;
  const p = await uma<ProdutoBanco>("select * from loja.produtos where slug = $1", [slug]);
  if (!p || (soAtivo && !p.ativo)) return null;
  return p;
}

export function titulo(p: Pick<ProdutoBanco, "unidade" | "unidade_plural">, quantidade: number): string {
  const nome = quantidade === 1 ? p.unidade : p.unidade_plural;
  return `${quantidade} ${nome.charAt(0).toUpperCase()}${nome.slice(1)}`;
}

function freteGratis(p: ProdutoBanco, quantidade: number): boolean {
  const limite = Number(p.frete_gratis_a_partir || 0);
  return Boolean(limite) && quantidade >= limite;
}

/** As ofertas fixas (por quantidade), da menor para a maior. */
export function ofertas(p: ProdutoBanco): Oferta[] {
  return [...(p.ofertas ?? [])]
    .sort((a, b) => a.quantidade - b.quantidade)
    .map((o) => {
      const q = Math.trunc(o.quantidade);
      return { id: `q${q}`, titulo: titulo(p, q), kits: q, preco_centavos: Math.trunc(o.preco_centavos), selo: o.selo || "", ativa: true, frete_gratis: freteGratis(p, q) };
    });
}

/** O "monte o seu": da maior oferta + 1 até o máximo, cada unidade por preco_kit_centavos. */
export function montar(p: ProdutoBanco): Montar {
  const m = p.montar ?? {};
  const minimo = Math.max(0, ...(p.ofertas ?? []).map((o) => Math.trunc(o.quantidade))) + 1;
  const maximo = Math.trunc(Number(m.maximo || 0));
  return { ativo: Boolean(m.ativo) && maximo >= minimo, minimo, maximo, preco_kit_centavos: Math.trunc(Number(m.preco_unidade_centavos || 0)) };
}

/** A oferta "q<n>": uma fixa, ou a do "monte o seu" se n estiver dentro dos limites. */
export function oferta(p: ProdutoBanco, ofertaId: string): Oferta | null {
  const fixa = ofertas(p).find((o) => o.id === ofertaId);
  if (fixa) return fixa;
  if (!/^q\d{1,2}$/.test(ofertaId ?? "")) return null;
  const n = parseInt(ofertaId.slice(1), 10);
  const m = montar(p);
  if (!m.ativo || n < m.minimo || n > m.maximo) return null;
  return { id: `q${n}`, titulo: titulo(p, n), kits: n, preco_centavos: n * m.preco_kit_centavos, selo: "", ativa: true, montada: true, frete_gratis: freteGratis(p, n) };
}

export function descricaoPedido(p: ProdutoBanco, o: Oferta): string {
  return `${p.nome} - ${o.titulo}${p.conteudo ? ` (${p.conteudo} cada)` : ""}`;
}

export function medidas(p: ProdutoBanco) {
  return { peso_g: p.peso_g, comprimento_cm: p.comprimento_cm, largura_cm: p.largura_cm, altura_cm: p.altura_cm };
}

/** As versões das fotos enviadas: {nome: segundos}. Uma consulta para a vitrine inteira. */
async function versoesDasFotos(): Promise<Map<string, number>> {
  const linhas = await banco().consulta<{ nome: string; atualizado_em: Date }>(
    "select nome, atualizado_em from loja.fotos where nome like 'produto:%'",
  );
  return new Map(linhas.map((l) => [l.nome, Math.floor(new Date(l.atualizado_em).getTime() / 1000)]));
}

function urlDaFoto(slug: string, versoes: Map<string, number>): string {
  const v = versoes.get(nomeFoto(slug));
  return v ? `/produtos/${slug}/foto?v=${v}` : FOTO_PADRAO;
}

export async function urlFoto(p: Pick<ProdutoBanco, "slug">): Promise<string> {
  const f = await uma<{ atualizado_em: Date }>("select atualizado_em from loja.fotos where nome = $1", [nomeFoto(p.slug)]);
  return f ? `/produtos/${p.slug}/foto?v=${Math.floor(new Date(f.atualizado_em).getTime() / 1000)}` : FOTO_PADRAO;
}

export async function foto(slug: string) {
  return catalogo.lerFoto(nomeFoto(slug));
}

export type ProdutoPublico = Awaited<ReturnType<typeof publico>>;

/** O que a página do produto e o checkout recebem. */
export async function publico(p: ProdutoBanco) {
  const lista = ofertas(p);
  return {
    id: p.slug,
    nome: p.nome,
    chamada: p.chamada || "",
    descricao: p.descricao || "",
    foto: await urlFoto(p),
    unidade: p.unidade,
    unidade_plural: p.unidade_plural,
    conteudo: p.conteudo || "",
    ofertas: lista,
    montar: montar(p),
    frete_gratis_a_partir: Number(p.frete_gratis_a_partir || 0),
    oferta_padrao: lista[0]?.id ?? "",
    categoria: p.categoria || "",
    selo: p.selo || "",
  };
}

/** Unidades vendidas (pedidos pagos ou enviados) por produto: o kit de lâminas fica sem produto_id. */
async function vendidos(): Promise<Map<string, number>> {
  const linhas = await banco().consulta<{ produto_id: string | null; n: string | number | null }>(
    "select produto_id, sum(kits) as n from loja.pedidos where situacao in ('pago', 'enviado') group by produto_id",
  );
  return new Map(linhas.map((l) => [l.produto_id || KIT, Number(l.n || 0)]));
}

export type ItemVitrine = {
  id: string;
  nome: string;
  chamada: string;
  foto: string;
  url: string;
  comprar: string;
  a_partir_de_centavos: number;
  por_unidade_centavos: number;
  unidade: string;
  destaque: boolean;
  categoria: string;
  selo: string;
  vendidos: number;
  frete_gratis_a_partir: number;
};

function item(
  id: string, nome: string, chamada: string, fotoUrl: string, url: string, lista: Oferta[], unidade: string,
  destaque: boolean, categoria: string | null, selo: string | null, nVendidos: number, freteAPartir: number, comprar: string,
): ItemVitrine {
  const menor = lista.reduce<Oferta | null>((m, o) => (!m || o.preco_centavos < m.preco_centavos ? o : m), null);
  const porUnidade = lista.length ? Math.min(...lista.map((o) => Math.round(o.preco_centavos / o.kits))) : 0;
  return {
    id, nome, chamada, foto: fotoUrl, url, comprar, a_partir_de_centavos: menor?.preco_centavos ?? 0, por_unidade_centavos: porUnidade,
    unidade, destaque, categoria: categoria || "", selo: selo || "", vendidos: nVendidos, frete_gratis_a_partir: freteAPartir,
  };
}

/** A vitrine: o kit de lâminas e os produtos ativos, com destaque, categoria, selo e vendas. */
export async function vitrine(): Promise<ItemVitrine[]> {
  const [nVendidos, versoes, kit, ofertasKit, v, produtos] = await Promise.all([
    vendidos(), versoesDasFotos(), catalogo.produto(), catalogo.ofertas(), catalogo.vitrineKit(), listar(),
  ]);
  const itens = [
    item(KIT, kit.nome, kit.chamada || `${kit.aparelhos} aparelho + ${kit.refis} refis por kit`, await catalogo.urlFoto(), "/",
      ofertasKit, "kit", v.destaque, v.categoria, v.selo, nVendidos.get(KIT) ?? 0, await catalogo.freteGratisAPartir(),
      `/checkout?oferta=${await catalogo.ofertaPadrao()}`),
  ];
  for (const p of produtos) {
    const lista = ofertas(p);
    itens.push(item(p.slug, p.nome, p.chamada || "", urlDaFoto(p.slug, versoes), `/p/${p.slug}`, lista, p.unidade,
      Boolean(p.destaque), p.categoria, p.selo, nVendidos.get(p.slug) ?? 0, Number(p.frete_gratis_a_partir || 0),
      `/checkout?produto=${p.slug}` + (lista.length ? `&oferta=${lista[0].id}` : "")));
  }
  return itens;
}

// ───────── Gravação (área do vendedor) ─────────

function texto(dados: Record<string, any>, chave: string, rotulo: string, minimo = 0, maximo = 200): string {
  const valor = chave === "descricao" ? String(dados[chave] ?? "").trim() : String(dados[chave] ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (valor.length < minimo) throw new ErroProduto(minimo <= 1 ? `Preencha ${rotulo}.` : `${rotulo}: pelo menos ${minimo} letras.`);
  if (valor.length > maximo) throw new ErroProduto(`${rotulo}: até ${maximo} caracteres.`);
  return valor;
}

function inteiro(valor: unknown, rotulo: string, minimo: number, maximo: number): number {
  const ok = typeof valor === "number" ? Number.isFinite(valor) : /^[+-]?\d+$/.test(String(valor ?? "").trim());
  if (!ok) throw new ErroProduto(`${rotulo}: use um número inteiro.`);
  const numero = Math.trunc(Number(valor));
  if (numero < minimo || numero > maximo) throw new ErroProduto(`${rotulo}: de ${minimo} a ${maximo}.`);
  return numero;
}

function conferir(dados: Record<string, any>) {
  const valores = {
    nome: texto(dados, "nome", "o nome", 3, 80),
    chamada: texto(dados, "chamada", "A chamada", 0, 140) || null,
    descricao: texto(dados, "descricao", "A descrição", 0, 4000) || null,
    sku: texto(dados, "sku", "O SKU", 0, 60) || null,
    ativo: Boolean(dados.ativo ?? true),
    ordem: inteiro(dados.ordem ?? 0, "A ordem", 0, 999),
    unidade: texto(dados, "unidade", "a unidade (ex.: frasco)", 2, 30).toLowerCase(),
    unidade_plural: texto(dados, "unidade_plural", "o plural da unidade (ex.: frascos)", 2, 30).toLowerCase(),
    conteudo: texto(dados, "conteudo", "O conteúdo", 0, 120) || null,
    peso_g: inteiro(dados.peso_g, "Peso de 1 unidade embalada (g)", 1, 30000),
    comprimento_cm: inteiro(dados.comprimento_cm, "Comprimento (cm)", 1, 100),
    largura_cm: inteiro(dados.largura_cm, "Largura (cm)", 1, 100),
    altura_cm: inteiro(dados.altura_cm, "Altura (cm)", 1, 100),
    frete_gratis_a_partir: inteiro(dados.frete_gratis_a_partir ?? 0, "Frete grátis a partir de", 0, 100),
    destaque: Boolean(dados.destaque ?? false),
    categoria: texto(dados, "categoria", "A categoria", 0, 40) || null,
    selo: texto(dados, "selo", "O selo", 0, 40) || null,
    ofertas: [] as OfertaProduto[],
    montar: {} as Record<string, unknown>,
  };
  const lista = dados.ofertas;
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAXIMO_OFERTAS)
    throw new ErroProduto(`Cadastre de 1 a ${MAXIMO_OFERTAS} ofertas (1 unidade, 2 unidades...).`);
  const vistas = new Set<number>();
  for (const o of lista) {
    if (!o || typeof o !== "object") throw new ErroProduto("Oferta inválida.");
    const q = inteiro(o.quantidade, "Quantidade da oferta", 1, MAXIMO_UNIDADES);
    if (vistas.has(q)) throw new ErroProduto(`Duas ofertas com ${q} unidades.`);
    vistas.add(q);
    valores.ofertas.push({
      quantidade: q,
      preco_centavos: inteiro(o.preco_centavos, `Preço da oferta de ${q}`, 100, 10_000_000),
      selo: String(o.selo ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 40),
    });
  }
  valores.ofertas.sort((a, b) => a.quantidade - b.quantidade);
  const m = dados.montar && typeof dados.montar === "object" ? dados.montar : {};
  const ativo = Boolean(m.ativo);
  const minimo = valores.ofertas[valores.ofertas.length - 1].quantidade + 1;
  valores.montar = {
    ativo,
    maximo: ativo ? inteiro(m.maximo, "Máximo do “monte o seu”", minimo, MAXIMO_UNIDADES) : Math.trunc(Number(m.maximo || 0)),
    preco_unidade_centavos: ativo
      ? inteiro(m.preco_unidade_centavos, "Preço por unidade do “monte o seu”", 100, 1_000_000)
      : Math.trunc(Number(m.preco_unidade_centavos || 0)),
  };
  return valores;
}

const COLUNAS = [
  "nome", "chamada", "descricao", "sku", "ativo", "ordem", "unidade", "unidade_plural", "conteudo", "peso_g",
  "comprimento_cm", "largura_cm", "altura_cm", "frete_gratis_a_partir", "destaque", "categoria", "selo", "ofertas", "montar",
] as const;
const JSONS = new Set(["ofertas", "montar"]);

/** Cria (slug null) ou altera um produto. Devolve o produto gravado. */
export async function salvar(dados: Record<string, any>, slug: string | null, email: string | null): Promise<ProdutoBanco> {
  const valores = conferir(dados) as Record<string, any>;
  const quando = agora();
  const params = COLUNAS.map((c) => (JSONS.has(c) ? JSON.stringify(valores[c]) : valores[c]));
  const tipos = (i: number) => (JSONS.has(COLUNAS[i]) ? "::json" : "");
  if (slug === null) {
    const novo = gerarSlug(String(dados.slug ?? "") || valores.nome);
    if (!novo || !SLUG.test(novo)) throw new ErroProduto("Endereço inválido: use letras, números e hífens.");
    if (novo === KIT || (await buscar(novo))) throw new ErroProduto(`Já existe um produto com o endereço /p/${novo}.`);
    await banco().consulta(
      `insert into loja.produtos (slug, criado_em, atualizado_em, ${COLUNAS.join(", ")})
       values ($1, $2, $2, ${COLUNAS.map((_, i) => `$${i + 3}${tipos(i)}`).join(", ")})`,
      [novo, quando, ...params],
    );
    await registrar(email, "produto", `Produto criado: ${novo}`);
    return (await buscar(novo))!;
  }
  if (!(await buscar(slug))) throw new ErroProduto("Produto não encontrado.");
  await banco().consulta(
    `update loja.produtos set atualizado_em = $2, ${COLUNAS.map((c, i) => `${c} = $${i + 3}${tipos(i)}`).join(", ")} where slug = $1`,
    [slug, quando, ...params],
  );
  await registrar(email, "produto", `Produto alterado: ${slug}`);
  return (await buscar(slug))!;
}

export async function excluir(slug: string, email: string | null): Promise<void> {
  if (!(await buscar(slug))) throw new ErroProduto("Produto não encontrado.");
  const abertos = Number(
    (await uma<{ n: string }>("select count(*) as n from loja.pedidos where produto_id = $1 and situacao = 'pago'", [slug]))?.n ?? 0,
  );
  if (abertos)
    throw new ErroProduto(`Este produto tem ${abertos} pedido(s) pago(s) esperando envio. Envie primeiro ou deixe o produto fora de venda.`);
  await banco().transacao(async (b) => {
    await b.consulta("delete from loja.produtos where slug = $1", [slug]);
    await b.consulta("delete from loja.fotos where nome = $1", [nomeFoto(slug)]);
  });
  await registrar(email, "produto", `Produto excluído: ${slug}`);
}

export async function salvarFoto(slug: string, tipo: string, dados: Uint8Array): Promise<void> {
  if (!(await buscar(slug))) throw new ErroProduto("Produto não encontrado.");
  await catalogo.gravarFoto(nomeFoto(slug), catalogo.conferirFoto(tipo, dados, ErroProduto), dados);
}

export async function apagarFoto(slug: string): Promise<void> {
  await catalogo.gravarFoto(nomeFoto(slug), null, null);
}

/** O produto como a área do vendedor edita (com a foto e o endereço da página). */
export async function paraVendedor(p: ProdutoBanco) {
  const { criado_em: _c, atualizado_em: _a, ...resto } = p;
  return { ...resto, foto: await urlFoto(p), foto_enviada: (await foto(p.slug)) !== null, url: `/p/${p.slug}`, montar_limites: montar(p) };
}
