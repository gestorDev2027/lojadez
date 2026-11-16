// O comprovante de mentira do simulador.
import type { APIRoute } from "astro";
import { cfg } from "../../../servidor/config";
import { ErroPedido, nsu } from "../../../servidor/pedidos";
import { comprovante } from "../../../servidor/simulador";

export const GET: APIRoute = async ({ params }) => {
  if ((await cfg()).INFINITEPAY_AMBIENTE !== "simulado") return new Response("Não encontrado.", { status: 404 });
  let texto: string | null = null;
  try {
    texto = await comprovante(nsu(params.nsu));
  } catch (erro) {
    if (!(erro instanceof ErroPedido)) throw erro;
  }
  if (!texto) return new Response("Não encontrado.", { status: 404 });
  return new Response(texto, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
};
