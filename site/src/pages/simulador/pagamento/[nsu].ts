// A página de pagamento de mentira (só com INFINITEPAY_AMBIENTE=simulado).
import type { APIRoute } from "astro";
import { cfg } from "../../../servidor/config";
import { ErroPedido, nsu } from "../../../servidor/pedidos";
import { pagina } from "../../../servidor/simulador";

const html = (texto: string, status = 200) =>
  new Response(texto, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export const GET: APIRoute = async ({ params }) => {
  const c = await cfg();
  if (c.INFINITEPAY_AMBIENTE !== "simulado") return new Response("Não encontrado.", { status: 404 });
  try {
    const texto = await pagina(c, nsu(params.nsu));
    return texto ? html(texto) : html("<p>Pedido não encontrado.</p>", 404);
  } catch (erro) {
    if (erro instanceof ErroPedido) return html("<p>Pedido não encontrado.</p>", 404);
    throw erro;
  }
};
