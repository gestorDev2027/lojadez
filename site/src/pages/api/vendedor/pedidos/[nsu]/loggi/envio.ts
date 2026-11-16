// Cria o envio na Loggi (de verdade, fora do modo simulado): só pedidos pagos, uma vez.
import { registrar } from "../../../../../../servidor/banco";
import { rota, vendedor } from "../../../../../../servidor/http";
import { criarEnvioLoggi, nsu, paraTela } from "../../../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  const pedido = await criarEnvioLoggi(nsu(ctx.params.nsu));
  await registrar(email, "pedido", `Envio criado na Loggi: ${pedido.order_nsu.slice(0, 8)}`);
  return paraTela(pedido);
});
