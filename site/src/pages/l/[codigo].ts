// O link curto de uma campanha de afiliado: conta o clique e leva ao destino com ?ref= (e a campanha).
import type { APIRoute } from "astro";
import { visitarCampanha } from "../../servidor/afiliados";
import { limitar } from "../../servidor/http";

export const GET: APIRoute = async (ctx) => {
  let destino = "/";
  try {
    limitar(ctx, "clique", 60);
    destino = await visitarCampanha(ctx.params.codigo);
  } catch (erro) {
    console.warn("Link de campanha falhou", erro);
  }
  return new Response(null, { status: 302, headers: { Location: destino, "Cache-Control": "no-store" } });
};
