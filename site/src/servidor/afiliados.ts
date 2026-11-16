// Os afiliados: quem divulga a loja por um link (?ref=<código>) e ganha comissão nas vendas que trouxe.
//
// - O visitante que chega por um link fica marcado por DIAS_ATRIBUICAO dias (no navegador dele); se comprar nesse tempo,
//   a venda é do afiliado. Vale o último link clicado.
// - A venda só conta para o afiliado ativo e liberado para aquele produto.
// - A comissão é fixada quando o pedido é criado: comissao_pct do afiliado sobre o preço dos produtos, sem o frete.
//   Só conta como comissão gerada quando o pedido é pago. O pagamento ao afiliado é feito fora da loja (Pix).
// - Os cliques são só contados por dia: nada do visitante é guardado.
// - O link curto de campanha (/l/<código>) conta o clique e leva ao destino com ?ref= e a campanha.
import { banco, uma } from "./banco";
import { hojeNoBrasil } from "./cupons";
import { KIT } from "./produtos";

export const DIAS_ATRIBUICAO = 30;

export type Afiliado = {
  id: number;
  codigo: string;
  nome: string;
  comissao_pct: number;
  todos_produtos: boolean;
  produtos: string[] | null;
  comissoes_produto: Record<string, number> | null;
  ativo: boolean;
};

export type Campanha = {
  id: number;
  codigo: string;
  afiliado_id: number;
  nome: string;
  destino: "principal" | "produto" | "checkout";
  produto_id: string | null;
  oferta: string | null;
  cliques: number;
  ativo: boolean;
};

const limpo = (codigo: unknown) => String(codigo ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);

export const buscar = (id: number) => uma<Afiliado>("select * from loja.afiliados where id = $1", [id]);

export async function buscarCodigo(codigo: unknown): Promise<Afiliado | null> {
  const c = limpo(codigo);
  return c ? uma<Afiliado>("select * from loja.afiliados where codigo = $1", [c]) : null;
}

export function podeVender(a: Afiliado, produtoId: string | null): boolean {
  return Boolean(a.ativo) && (a.todos_produtos || (a.produtos ?? []).includes(produtoId || KIT));
}

/** O afiliado do código, se estiver ativo e liberado para o produto; senão null (a venda fica direta). */
export async function atribuir(codigo: unknown, produtoId: string | null): Promise<Afiliado | null> {
  const a = codigo ? await buscarCodigo(codigo) : null;
  return a && podeVender(a, produtoId) ? a : null;
}

/** A comissão (%) do afiliado para o produto: a do produto, se houver, senão a geral. */
export function comissaoPct(a: Afiliado, produtoId: string | null = null): number {
  const propria = (a.comissoes_produto ?? {})[produtoId || KIT];
  return Number(propria ?? a.comissao_pct);
}

export const comissao = (a: Afiliado, precoCentavos: number, produtoId: string | null = null) =>
  Math.round((precoCentavos * comissaoPct(a, produtoId)) / 100);

/** Conta uma visita pelo link do afiliado no dia (só o número). */
export async function registrarClique(codigo: unknown, dia = hojeNoBrasil()): Promise<boolean> {
  const a = await buscarCodigo(codigo);
  if (!a || !a.ativo) return false;
  await banco().consulta(
    `insert into loja.afiliado_cliques (afiliado_id, dia, cliques) values ($1, $2, 1)
     on conflict (afiliado_id, dia) do update set cliques = loja.afiliado_cliques.cliques + 1`,
    [a.id, dia],
  );
  return true;
}

export async function buscarCampanha(codigo: unknown): Promise<Campanha | null> {
  const c = String(codigo ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return c ? uma<Campanha>("select * from loja.campanhas where codigo = $1", [c]) : null;
}

/** O caminho para onde o link curto leva (sem o domínio). */
export function caminhoDestino(c: Campanha): string {
  if (c.destino === "principal" || !c.produto_id) return "/";
  if (c.produto_id === KIT) return c.destino === "checkout" && c.oferta ? `/checkout?oferta=${c.oferta}` : "/";
  if (c.destino === "checkout") return `/checkout?produto=${c.produto_id}` + (c.oferta ? `&oferta=${c.oferta}` : "");
  return `/p/${c.produto_id}`;
}

/** O clique no link curto: conta (no link e no afiliado) e devolve o endereço de destino com ?ref= e a campanha. */
export async function visitarCampanha(codigo: unknown, dia = hojeNoBrasil()): Promise<string> {
  const c = await buscarCampanha(codigo);
  const a = c ? await buscar(c.afiliado_id) : null;
  if (!c || !c.ativo || !a || !a.ativo) return "/";
  await banco().consulta("update loja.campanhas set cliques = cliques + 1 where id = $1", [c.id]);
  await registrarClique(a.codigo, dia);
  const caminho = caminhoDestino(c);
  // rc=1: o clique já foi contado aqui (a página não conta de novo)
  return `${caminho}${caminho.includes("?") ? "&" : "?"}ref=${a.codigo}&cp=${c.codigo}&rc=1`;
}
