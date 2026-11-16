import { FOTO_PADRAO, buscar, foto } from "../../../servidor/produtos";
import { cabecalhosFoto } from "../../../servidor/cdn";

export const GET = async ({ params }: { params: { slug?: string } }) => {
  const slug = params.slug ?? "";
  const f = (await buscar(slug)) ? await foto(slug) : null;
  if (!f) return new Response(null, { status: 302, headers: { Location: FOTO_PADRAO } });
  return new Response(new Uint8Array(f.dados), { headers: cabecalhosFoto(f.tipo) });
};