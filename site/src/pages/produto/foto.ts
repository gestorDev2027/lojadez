// A foto do kit enviada pelo vendedor (sem ela, a foto padrão). O endereço leva a versão (?v=): o cache pode ser eterno.
import * as catalogo from "../../servidor/catalogo";

export const GET = async () => {
  const f = await catalogo.foto();
  if (!f) return new Response(null, { status: 302, headers: { Location: catalogo.FOTO_KIT_PADRAO } });
  return new Response(new Uint8Array(f.dados), { headers: { "Content-Type": f.tipo, "Cache-Control": "public, max-age=31536000, immutable" } });
};
