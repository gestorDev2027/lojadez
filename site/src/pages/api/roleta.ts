// A roleta da página inicial: o servidor sorteia e devolve o cupom (servidor/roleta.ts). O cookie guarda o código, para
// o mesmo navegador receber o mesmo cupom enquanto ele valer.
import { cfg } from "../../servidor/config";
import { json, limitar, rota } from "../../servidor/http";
import { COOKIE_ROLETA, girar } from "../../servidor/roleta";

function lerCookie(request: Request): string | null {
  const achado = (request.headers.get("cookie") ?? "").split(";").map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_ROLETA}=`));
  return achado ? decodeURIComponent(achado.slice(COOKIE_ROLETA.length + 1)) : null;
}

export const POST = rota(async (ctx) => {
  limitar(ctx, "roleta", 5);
  const premio = await girar(lerCookie(ctx.request));
  const dias = (await cfg()).ROLETA.dias;
  const seguro = new URL(ctx.request.url).protocol === "https:" ? "; Secure" : "";
  return json(premio, 200, {
    "Set-Cookie": `${COOKIE_ROLETA}=${encodeURIComponent(premio.codigo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${dias * 86_400}${seguro}`,
  });
});
