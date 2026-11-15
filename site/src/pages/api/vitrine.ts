// A vitrine com as categorias da loja (só as que têm produto) e os itens.
import * as catalogo from "../../servidor/catalogo";
import { fotoOtimizada } from "../../servidor/cdn";
import { rotaPublica } from "../../servidor/http";
import { vitrine } from "../../servidor/produtos";

export const GET = rotaPublica(async () => {
  const itens = await vitrine();
  const usadas = new Set(itens.map((i) => i.categoria));
  return {
    categorias: (await catalogo.categorias()).filter((c) => usadas.has(c)),
    itens: itens.map((i) => ({ ...i, foto: fotoOtimizada(i.foto, 640) })),
  };
});