// A etiqueta do envio na Loggi, em PDF.
import { rota, vendedor } from "../../../../../../servidor/http";
import { etiquetaLoggi, nsu } from "../../../../../../servidor/pedidos";

export const GET = rota(async (ctx) => {
  await vendedor(ctx);
  const id = nsu(ctx.params.nsu);
  const pdf = await etiquetaLoggi(id);
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta-loggi-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
