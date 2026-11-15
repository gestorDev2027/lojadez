// O catálogo do kit de lâminas que o vendedor muda pela área do vendedor, sem republicar o site.
// Os padrões vêm da configuração; o que o vendedor grava fica na tabela `ajustes` e vale sobre eles:
// - nome, textos, refis por kit, lâminas por refil e medidas do pacote;
// - preço e selo de cada oferta (1, 2 e 3 kits) e se ela aparece;
// - o "monte o seu kit" (de 4 kits até o máximo, pelo preço por kit da faixa "4 ou mais");
// - a partir de quantos kits o frete é grátis (a loja paga a Loggi);
// - destaque, categoria e selo na vitrine, e as categorias da loja;
// - a foto do kit (tabela `fotos`).
// Cada instância guarda os ajustes por CACHE_MS; quem grava limpa na hora.
import { agora, banco, gravarAjustes, lerAjustes, uma } from "./banco";
import { cfg } from "./config";
import { ErroLoja } from "./erros";

export class ErroCatalogo extends ErroLoja {}

const CACHE_MS = 30_000;
let cache: { quando: number; ajustes: Record<string, any> } | null = null;

async function ajustes(): Promise<Record<string, any>> {
  if (cache && Date.now() - cache.quando < CACHE_MS) return cache.ajustes;
  cache = { quando: Date.now(), ajustes: await lerAjustes() };
  return cache.ajustes;
}

export function limparCache(): void {
  cache = null;
  fotoCache = null;
}

// As ofertas padrão do kit (o vendedor muda preço, selo e se aparece).
export const OFERTAS_PADRAO = [
  { id: "kit1", titulo: "1 Kit", kits: 1, preco_centavos: 2390, selo: "" },
  { id: "kit2", titulo: "2 Kits", kits: 2, preco_centavos: 4490, selo: "Recomendado" },
  { id: "kit3", titulo: "3 Kits", kits: 3, preco_centavos: 6290, selo: "Menor preço por refil" },
];
export const OFERTA_PADRAO = "kit2";
export const MONTAR_MINIMO = 4;
const MONTAR_PADRAO = { ativo: true, maximo: 10, preco_kit_centavos: 1990 };
const FRETE_GRATIS_PADRAO = 4;
export const CATEGORIAS_PADRAO = ["Barbear", "Cabelo", "Barba", "Kits"];

export const TIPOS_FOTO: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};
export const FOTO_MAXIMA = 8 * 1024 * 1024;
const FOTO_KIT = "kit";
export const FOTO_KIT_PADRAO = "/assets/img/kit-foto.jpg";

const TEXTOS_KIT: Record<string, number> = { nome: 80, chamada: 140, descricao: 4000 };
const MEDIDAS_KIT: Record<string, [string, number, number]> = {
  peso_g: ["Peso de 1 kit embalado (g)", 1, 30000],
  comprimento_cm: ["Comprimento (cm)", 1, 100],
  largura_cm: ["Largura (cm)", 1, 100],
  altura_cm: ["Altura (cm)", 1, 100],
};

export type Oferta = {
  id: string;
  titulo: string;
  kits: number;
  preco_centavos: number;
  selo: string;
  ativa: boolean;
  frete_gratis: boolean;
  montada?: boolean;
};

export type Montar = { ativo: boolean; minimo: number; maximo: number; preco_kit_centavos: number };

/** O kit de lâminas: os padrões com o que o vendedor mudou (nome, textos, refis, medidas). */
export async function produto() {
  const c = await cfg();
  const a = await ajustes();
  const p: Record<string, any> = { ...c.PRODUTO, chamada: "", descricao: "" };
  for (const chave of ["refis", "laminas_por_refil", ...Object.keys(MEDIDAS_KIT)]) if (chave in a) p[chave] = Math.trunc(Number(a[chave]));
  for (const chave of Object.keys(TEXTOS_KIT)) if (a[chave]) p[chave] = String(a[chave]);
  return p as typeof c.PRODUTO & { chamada: string; descricao: string };
}

export async function categorias(): Promise<string[]> {
  const a = await ajustes();
  return [...(a.categorias?.length ? a.categorias : CATEGORIAS_PADRAO)];
}

/** Destaque, categoria e selo do kit na vitrine. */
export async function vitrineKit() {
  const a = await ajustes();
  return { destaque: Boolean(a.destaque ?? true), categoria: (a.categoria as string) || "Barbear", selo: (a.selo as string) || "" };
}

export async function freteGratisAPartir(): Promise<number> {
  const a = await ajustes();
  return Math.trunc(Number(a.frete_gratis_a_partir ?? FRETE_GRATIS_PADRAO));
}

async function freteGratis(kits: number): Promise<boolean> {
  const limite = await freteGratisAPartir();
  return Boolean(limite) && kits >= limite;
}

export async function ofertas(soAtivas = true): Promise<Oferta[]> {
  const a = ((await ajustes()).ofertas ?? {}) as Record<string, any>;
  const saida: Oferta[] = [];
  for (const padrao of OFERTAS_PADRAO) {
    const mudou = a[padrao.id] ?? {};
    const o: Oferta = { ...padrao, ativa: true, frete_gratis: false };
    for (const k of ["preco_centavos", "selo", "ativa"] as const) if (k in mudou) (o as any)[k] = mudou[k];
    o.frete_gratis = await freteGratis(o.kits);
    if (o.ativa || !soAtivas) saida.push(o);
  }
  return saida;
}

/** O "monte o seu kit": {ativo, minimo, maximo, preco_kit_centavos}. */
export async function montar(): Promise<Montar> {
  const m = { ...MONTAR_PADRAO, ...((await ajustes()).montar ?? {}) };
  return { ativo: Boolean(m.ativo), minimo: MONTAR_MINIMO, maximo: Math.trunc(Number(m.maximo)), preco_kit_centavos: Math.trunc(Number(m.preco_kit_centavos)) };
}

/** A oferta de N kits do "monte o seu" (id "kitN"), ou null se não vale. */
async function ofertaMontada(kits: number): Promise<Oferta | null> {
  const m = await montar();
  if (!m.ativo || kits < m.minimo || kits > m.maximo) return null;
  return {
    id: `kit${kits}`, titulo: `${kits} Kits`, kits, preco_centavos: kits * m.preco_kit_centavos, selo: "", ativa: true,
    montada: true, frete_gratis: await freteGratis(kits),
  };
}

export async function oferta(ofertaId: string): Promise<Oferta | null> {
  const fixa = (await ofertas()).find((o) => o.id === ofertaId);
  if (fixa) return fixa;
  if (/^kit\d{1,2}$/.test(ofertaId ?? "")) return ofertaMontada(parseInt(ofertaId.slice(3), 10));
  return null;
}

export async function ofertaPadrao(): Promise<string> {
  const ativas = (await ofertas()).map((o) => o.id);
  return ativas.includes(OFERTA_PADRAO) ? OFERTA_PADRAO : (ativas[0] ?? "");
}

/** "Kit Barbeador 3 Lâminas - 2 Kits (2 aparelhos + 38 refis)": a descrição do pedido. */
export async function descricaoOferta(o: Pick<Oferta, "titulo" | "kits">): Promise<string> {
  const p = await produto();
  const aparelhos = p.aparelhos * o.kits;
  const refis = p.refis * o.kits;
  return `${p.nome} - ${o.titulo} (${aparelhos} ${aparelhos > 1 ? "aparelhos" : "aparelho"} + ${refis} refis)`;
}

// ───────── A foto do kit ─────────

let fotoCache: { quando: number; foto: { tipo: string; dados: Uint8Array; versao: number } | null } | null = null;

export async function lerFoto(nome: string): Promise<{ tipo: string; dados: Uint8Array; atualizado_em: Date } | null> {
  return uma("select tipo, dados, atualizado_em from loja.fotos where nome = $1", [nome]) as any;
}

export async function gravarFoto(nome: string, tipo: string | null, dados: Uint8Array | null): Promise<void> {
  await banco().transacao(async (b) => {
    await b.consulta("delete from loja.fotos where nome = $1", [nome]);
    if (dados && tipo)
      await b.consulta("insert into loja.fotos (nome, tipo, dados, atualizado_em) values ($1, $2, $3, $4)", [nome, tipo, dados, agora()]);
  });
}

/** A foto enviada do kit (com a versão, para o cache do navegador), ou null (usa a padrão). */
export async function foto() {
  if (fotoCache && Date.now() - fotoCache.quando < CACHE_MS) return fotoCache.foto;
  const f = await lerFoto(FOTO_KIT);
  const valor = f ? { tipo: f.tipo, dados: f.dados, versao: Math.floor(new Date(f.atualizado_em).getTime() / 1000) } : null;
  fotoCache = { quando: Date.now(), foto: valor };
  return valor;
}

export async function urlFoto(): Promise<string> {
  const f = await foto();
  return f ? `/produto/foto?v=${f.versao}` : FOTO_KIT_PADRAO;
}

export function conferirFoto(tipo: string, dados: Uint8Array, Erro: new (m: string) => ErroLoja): string {
  const t = (tipo ?? "").split(";")[0].trim().toLowerCase();
  const assinatura = TIPOS_FOTO[t];
  if (!assinatura || !assinatura.every((b, i) => dados[i] === b)) throw new Erro("Envie uma foto JPG, PNG ou WebP.");
  if (dados.length > FOTO_MAXIMA) throw new Erro("A foto tem até 8 MB.");
  return t;
}

export async function salvarFoto(tipo: string, dados: Uint8Array): Promise<void> {
  await gravarFoto(FOTO_KIT, conferirFoto(tipo, dados, ErroCatalogo), dados);
  limparCache();
}

export async function apagarFoto(): Promise<void> {
  await gravarFoto(FOTO_KIT, null, null);
  limparCache();
}

// ───────── Gravação (área do vendedor) ─────────

function inteiro(valor: unknown, nome: string, minimo: number, maximo: number): number {
  const texto = String(valor ?? "").trim();
  if (!/^[+-]?\d+$/.test(texto) && typeof valor !== "number") throw new ErroCatalogo(`${nome}: use um número inteiro.`);
  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero)) throw new ErroCatalogo(`${nome}: use um número inteiro.`);
  if (numero < minimo || numero > maximo) throw new ErroCatalogo(`${nome}: de ${minimo} a ${maximo}.`);
  return numero;
}

const umaLinha = (valor: unknown) => String(valor ?? "").split(/\s+/).filter(Boolean).join(" ");
const capitalizar = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Confere e grava o que veio da tela. Devolve o catálogo novo. */
export async function salvar(dados: Record<string, any>) {
  const novos: Record<string, unknown> = {};
  if ("refis" in dados) novos.refis = inteiro(dados.refis, "Refis por kit", 1, 200);
  if ("laminas_por_refil" in dados) novos.laminas_por_refil = inteiro(dados.laminas_por_refil, "Lâminas por refil", 1, 10);
  for (const [chave, maximo] of Object.entries(TEXTOS_KIT)) {
    if (!(chave in dados)) continue;
    const valor = chave === "descricao" ? String(dados[chave] ?? "").trim() : umaLinha(dados[chave]);
    if (chave === "nome" && valor.length > 0 && valor.length < 3) throw new ErroCatalogo("Nome do kit: pelo menos 3 letras.");
    if (valor.length > maximo) throw new ErroCatalogo(`${capitalizar(chave)} do kit: até ${maximo} caracteres.`);
    novos[chave] = valor || null;
  }
  for (const [chave, [rotulo, minimo, maximo]] of Object.entries(MEDIDAS_KIT))
    if (chave in dados) novos[chave] = inteiro(dados[chave], rotulo, minimo, maximo);
  if ("destaque" in dados) novos.destaque = Boolean(dados.destaque);
  if ("categoria" in dados) novos.categoria = String(dados.categoria ?? "").slice(0, 40) || null;
  if ("selo" in dados) novos.selo = umaLinha(dados.selo).slice(0, 40) || null;
  if ("categorias" in dados) {
    const lista: string[] = [];
    for (const bruto of dados.categorias ?? []) {
      const nome = umaLinha(bruto).slice(0, 40);
      if (nome && !lista.some((x) => x.toLowerCase() === nome.toLowerCase())) lista.push(nome);
    }
    if (!lista.length) throw new ErroCatalogo("Deixe pelo menos uma categoria.");
    if (lista.length > 12) throw new ErroCatalogo("Até 12 categorias.");
    novos.categorias = lista;
  }
  if ("ofertas" in dados) {
    const ids = new Set(OFERTAS_PADRAO.map((o) => o.id));
    const ofertasNovas: Record<string, unknown> = {};
    for (const [oid, valores] of Object.entries((dados.ofertas ?? {}) as Record<string, any>)) {
      if (!ids.has(oid) || !valores || typeof valores !== "object") throw new ErroCatalogo(`Oferta desconhecida: ${oid}.`);
      ofertasNovas[oid] = {
        preco_centavos: inteiro(valores.preco_centavos, `Preço de ${oid}`, 100, 10_000_000),
        selo: umaLinha(valores.selo).slice(0, 40),
        ativa: Boolean(valores.ativa ?? true),
      };
    }
    if (!Object.values(ofertasNovas).some((v: any) => v.ativa)) throw new ErroCatalogo("Deixe pelo menos uma oferta ativa.");
    novos.ofertas = ofertasNovas;
  }
  if ("frete_gratis_a_partir" in dados) novos.frete_gratis_a_partir = inteiro(dados.frete_gratis_a_partir, "Frete grátis a partir de", 0, 100);
  if ("montar" in dados) {
    const m = dados.montar && typeof dados.montar === "object" ? dados.montar : {};
    novos.montar = {
      ativo: Boolean(m.ativo ?? true),
      maximo: inteiro(m.maximo, "Máximo de kits", MONTAR_MINIMO, 30),
      preco_kit_centavos: inteiro(m.preco_kit_centavos, "Preço por kit (4 ou mais)", 100, 1_000_000),
    };
  }
  await gravarAjustes(novos);
  limparCache();
  return resumo();
}

export async function resumo() {
  return {
    produto: await produto(),
    ofertas: await ofertas(false),
    foto: await urlFoto(),
    foto_enviada: (await foto()) !== null,
    montar: await montar(),
    frete_gratis_a_partir: await freteGratisAPartir(),
    vitrine: await vitrineKit(),
    categorias: await categorias(),
  };
}
