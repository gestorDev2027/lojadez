// O aviso da InfinitePay (não é assinado: só dispara a conferência na API dela).
// Responde 200 quando terminou (ou o aviso não é nosso) e 400 para a InfinitePay tentar de novo.
import { corpo, depois, json, rota } from "../../../servidor/http";
import { ErroLoja } from "../../../servidor/erros";
import { processarWebhook } from "../../../servidor/pedidos";

export const POST = rota(async (ctx) => {
  try {
    const r = await processarWebhook(await corpo(ctx.request));
    await depois(ctx, r.envio);
  } catch (erro) {
    if (!(erro instanceof ErroLoja) || erro.status >= 500) {
      if (!(erro instanceof ErroLoja)) console.error("Webhook da InfinitePay falhou", erro);
      return json({ ok: false }, 400);
    }
    console.info(`Webhook ignorado: ${erro.message}`);
  }
  return { ok: true };
});
