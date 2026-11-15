// A vitrine com as categorias da loja (só as que têm produto) e os itens.
import * as catalogo from "../../servidor/catalogo";
import { rota } from "../../servidor/http";
import { vitrine } from "../../servidor/produtos";

export const GET = rota(async () => {
  const itens = await vitrine();
  const usadas = new Set(itens.map((i) => i.categoria));
  return { categorias: (await catalogo.categorias()).filter((c) => usadas.has(c)), itens };
});