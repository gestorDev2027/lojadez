// Cancela o envio na Loggi (o pedido enviado volta a "pago", para criar outro envio).
import { rota, vendedor } from "../../../../../../servidor/http";
import { cancelarEnvioLoggi, nsu, paraTela } from "../../../../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  const email = await vendedor(ctx);
  const { aviso_loggi, ...pedido } = await cancelarEnvioLoggi(nsu(ctx.params.nsu), email);
  return { ...paraTela(pedido as any), aviso_loggi };
});
