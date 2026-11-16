import { ErroHttp, rotaPublica } from "../../../servidor/http";
import { buscar, publico } from "../../../servidor/produtos";

export const GET = rotaPublica(async ({ params }) => {
  const produto = await buscar(params.slug ?? "", true);
  if (!produto) throw new ErroHttp("Produto não encontrado.", 404);
  return publico(produto);
});