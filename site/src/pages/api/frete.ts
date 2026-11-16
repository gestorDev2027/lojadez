// A cotação do frete para o CEP e a oferta (com o frete grátis da quantidade ou do cupom).
import { corpo, limitar, rota } from "../../servidor/http";
import { cotarFrete } from "../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  limitar(ctx, "frete", 20);
  const d = await corpo(ctx.request);
  return cotarFrete(d.cep, d.oferta, d.produto, d.cupom);
});
