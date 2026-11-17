// A roleta de cupons (17/11/2026).
//
// - Página inicial: quem raspa a espuma gira a roleta. O SERVIDOR sorteia o prêmio (ROLETA_VALORES) e cria um cupom de
//   valor, de uso único, que vence em ROLETA_DIAS e vale a partir de ROLETA_MINIMO. O navegador só anima o resultado.
// - O mesmo navegador recebe o mesmo cupom enquanto ele valer (cookie loja_roleta), e cada CPF usa no máximo um cupom da
//   roleta (cupons.aplicar confere na hora do pedido): limpar o navegador não rende desconto novo.
// - Página de obrigado: quem pagou gira de novo e ganha um cupom para a PRÓXIMA compra, preso ao CPF do pedido (um por
//   pedido). Esse não conta no limite de um por CPF da roleta.
// - Os cupons gerados aqui têm `origem` e não aparecem na aba Cupons do vendedor.
import { randomInt } from "node:crypto";
import { agora, uma } from "./banco";
import { cfg, type Config } from "./config";
import { buscarCodigo, hojeNoBrasil, usos, type Cupom } from "./cupons";
import { ErroLoja } from "./erros";

export class ErroRoleta extends ErroLoja {}

export const COOKIE_ROLETA = "loja_roleta";

export type Premio = {
  codigo: string;
  valor_centavos: number;
  fim: string | null; // AAAA-MM-DD
  minimo_centavos: number;
  origem: "roleta" | "volta";
};

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I, que se confundem

function novoCodigo(prefixo: string): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += LETRAS[randomInt(LETRAS.length)];
  return `${prefixo}-${s}`;
}

/** O sorteio: o primeiro valor sai mais vezes (pesos n, n-1, ..., 1). Com 2, 3 e 4: 50%, 33% e 17%. */
export function sortear(valores: number[], aleatorio: (max: number) => number = randomInt): number {
  const n = valores.length;
  let r = aleatorio((n * (n + 1)) / 2);
  for (let i = 0; i < n; i++) {
    const peso = n - i;
    if (r < peso) return valores[i];
    r -= peso;
  }
  return valores[0];
}

const premio = (c: Cupom): Premio => ({
  codigo: c.codigo,
  valor_centavos: Math.round(Number(c.valor)),
  fim: c.fim,
  minimo_centavos: c.minimo_centavos ?? 0,
  origem: c.origem === "volta" ? "volta" : "roleta",
});

/** O cupom ainda serve: ativo, no prazo e sem uso. */
async function aindaVale(c: Cupom | null): Promise<boolean> {
  return Boolean(c && c.ativo && (!c.fim || hojeNoBrasil() <= c.fim) && (await usos(c.codigo)) < (c.limite_usos ?? 1));
}

function ligada(c: Config) {
  if (!c.ROLETA.ativa) throw new ErroRoleta("A roleta está desligada.", 404);
}

async function criarCupom(
  c: Config,
  dados: { prefixo: string; origem: "roleta" | "volta"; descricao: string; cpf?: string | null; pedido_nsu?: string | null },
): Promise<Cupom> {
  const valor = sortear(c.ROLETA.valores_centavos);
  const fim = hojeNoBrasil(new Date(Date.now() + c.ROLETA.dias * 86_400_000));
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = novoCodigo(dados.prefixo);
    if (await buscarCodigo(codigo)) continue;
    const quando = agora();
    const linha = await uma<Cupom>(
      `insert into loja.cupons (codigo, tipo, valor, inicio, fim, limite_usos, minimo_centavos, todos_produtos, produtos,
         afiliado_id, ativo, descricao_interna, criado_em, atualizado_em, origem, cpf, pedido_nsu)
       values ($1, 'valor', $2, null, $3, 1, $4, true, '[]', null, true, $5, $6, $6, $7, $8, $9)
       returning *`,
      [codigo, valor, fim, c.ROLETA.minimo_centavos || null, dados.descricao, quando, dados.origem, dados.cpf ?? null, dados.pedido_nsu ?? null],
    );
    if (linha) return linha;
  }
  throw new ErroRoleta("Não deu para gerar o cupom agora. Tente de novo.", 503);
}

/** A roleta da página inicial. Quem já tem um cupom válido (o cookie) recebe o mesmo. */
export async function girar(codigoDoCookie: string | null): Promise<Premio> {
  const c = await cfg();
  ligada(c);
  if (codigoDoCookie) {
    const ja = await buscarCodigo(codigoDoCookie);
    if (ja?.origem === "roleta" && (await aindaVale(ja))) return premio(ja);
  }
  return premio(await criarCupom(c, { prefixo: "LOBO", origem: "roleta", descricao: "Roleta da página inicial" }));
}

type PedidoDaRoleta = { cpf: string; situacao: string };

async function pedidoPago(orderNsu: string): Promise<PedidoDaRoleta> {
  const p = await uma<PedidoDaRoleta>("select cpf, situacao from loja.pedidos where order_nsu = $1", [orderNsu]);
  if (!p) throw new ErroRoleta("Pedido não encontrado.", 404);
  if (!["pago", "enviado"].includes(p.situacao)) throw new ErroRoleta("A roleta da próxima compra abre depois do pagamento.", 409);
  return p;
}

/** O cupom da próxima compra que este pedido já ganhou (null: ainda não girou). */
export async function premioDoPedido(orderNsu: string): Promise<{ ativa: boolean; premio: Premio | null }> {
  const c = await cfg();
  const ja = await uma<Cupom>("select * from loja.cupons where pedido_nsu = $1", [orderNsu]);
  if (ja) return { ativa: true, premio: premio(ja) };
  return { ativa: c.ROLETA.ativa, premio: null };
}

/** A roleta da página de obrigado: um cupom por pedido pago, preso ao CPF de quem comprou. */
export async function girarDoPedido(orderNsu: string): Promise<Premio> {
  const c = await cfg();
  const p = await pedidoPago(orderNsu);
  const ja = await uma<Cupom>("select * from loja.cupons where pedido_nsu = $1", [orderNsu]);
  if (ja) return premio(ja);
  ligada(c);
  return premio(
    await criarCupom(c, { prefixo: "VOLTA", origem: "volta", descricao: "Próxima compra (roleta do obrigado)", cpf: p.cpf, pedido_nsu: orderNsu }),
  );
}
