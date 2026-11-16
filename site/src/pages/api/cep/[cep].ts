// O endereço pelo CEP (ViaCEP), para o checkout preencher a rua e o bairro.
import { limitar, rota } from "../../../servidor/http";
import { enderecoDoCep } from "../../../servidor/loggi";

export const GET = rota(async (ctx) => {
  limitar(ctx, "cep", 30);
  return enderecoDoCep(ctx.params.cep ?? "");
});
