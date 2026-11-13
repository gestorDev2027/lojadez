import { useEffect, useState } from "react";
import { chamar, reais, type Loja, type PedidoPublico, type Rastreio } from "../api";

// A volta da InfinitePay: o endereço traz order_nsu, transaction_nsu, slug e receipt_url. O servidor confere o pagamento
// na InfinitePay (nunca confia só no endereço); enquanto não confirma, tenta de novo a cada 3 segundos por 1 minuto.
export function PaginaObrigado({ loja }: { loja: Loja }) {
  const parametros = new URLSearchParams(window.location.search);
  const nsu = parametros.get("order_nsu") ?? "";
  const [pedido, setPedido] = useState<PedidoPublico | null>(null);
  const [erro, setErro] = useState("");
  const [desistiu, setDesistiu] = useState(false);

  useEffect(() => {
    if (!nsu) {
      setErro("Não achamos o número do pedido neste endereço.");
      return;
    }
    let vezes = 0;
    let parar = false;
    let espera: number | undefined;
    const corpo = {
      transaction_nsu: parametros.get("transaction_nsu") ?? "",
      slug: parametros.get("slug") ?? "",
      receipt_url: parametros.get("receipt_url") ?? "",
    };
    async function conferir() {
      try {
        const p = await chamar<PedidoPublico>(`/api/pedidos/${encodeURIComponent(nsu)}/conferir`, { corpo });
        if (parar) return;
        setPedido(p);
        if (p.situacao === "aguardando_pagamento" && ++vezes < 20) espera = window.setTimeout(conferir, 3000);
        else if (p.situacao === "aguardando_pagamento") setDesistiu(true);
      } catch (e) {
        if (!parar) setErro((e as Error).message);
      }
    }
    void conferir();
    return () => {
      parar = true;
      window.clearTimeout(espera);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nsu]);

  if (erro) return <Caixa titulo="Algo não deu certo" texto={erro} />;
  if (!pedido) return <Caixa titulo="Conferindo seu pagamento…" texto="Só um instante." />;

  const pago = pedido.situacao === "pago" || pedido.situacao === "enviado";
  return (
    <section className="mx-auto max-w-xl px-4 py-10">
      <div className="rounded-[22px] border border-linha-2 bg-cartao p-6">
        {pago ? (
          <>
            <Selo ok />
            <h1 className="mt-4 font-display text-4xl leading-none font-extrabold uppercase">Pagamento confirmado, {pedido.primeiro_nome}!</h1>
            <p className="mt-2 text-suave">
              Seu pedido vai para {pedido.cidade}/{pedido.uf}. Guarde o link desta página: quando o pedido sair, o código de
              rastreio da Loggi aparece aqui.
            </p>
          </>
        ) : pedido.situacao === "aguardando_pagamento" ? (
          <>
            <Selo />
            <h1 className="mt-4 font-display text-4xl leading-none font-extrabold uppercase">{desistiu ? "Ainda não recebemos o pagamento" : "Confirmando o pagamento…"}</h1>
            <p className="mt-2 text-suave">
              {desistiu
                ? "Se você já pagou, ele aparece aqui em alguns minutos: pode recarregar a página. Se não terminou, volte ao pagamento."
                : "Isso leva poucos segundos."}
            </p>
            {desistiu && pedido.link_pagamento && (
              <a href={pedido.link_pagamento} className="mt-4 inline-block btn-laranja px-5 py-3 text-sm">
                Voltar ao pagamento
              </a>
            )}
          </>
        ) : (
          <>
            <Selo />
            <h1 className="mt-4 font-display text-4xl leading-none font-extrabold uppercase">Precisamos conferir este pedido</h1>
            <p className="mt-2 text-suave">
              {pedido.situacao === "cancelado"
                ? "Este pedido foi cancelado."
                : pedido.situacao === "reembolso_pendente"
                  ? "Este pedido foi cancelado e o reembolso está em andamento pela InfinitePay."
                  : pedido.situacao === "reembolsado"
                    ? "Este pedido foi cancelado e o valor foi devolvido pela InfinitePay."
                    : "O valor pago não bateu com o do pedido. Vamos falar com você pelo e-mail informado."}
            </p>
          </>
        )}

        <dl className="mt-6 grid gap-2 border-t border-linha pt-4 text-sm">
          <Linha rotulo={pedido.produto} valor={reais(pedido.preco_centavos)} />
          <Linha rotulo={pedido.frete_descricao} valor={reais(pedido.frete_centavos)} />
          <Linha rotulo="Total" valor={reais(pedido.total_centavos)} forte />
          {pedido.valor_pago_centavos != null && pedido.valor_pago_centavos < pedido.total_centavos && (
            <Linha rotulo={`Pago com desconto no Pix${pedido.desconto_pix ? ` (${pedido.desconto_pix}% off)` : ""}`} valor={reais(pedido.valor_pago_centavos)} />
          )}
          {pedido.forma_pagamento && (
            <Linha rotulo="Forma de pagamento" valor={pedido.forma_pagamento === "pix" ? "Pix" : "Cartão de crédito"} />
          )}
          {pedido.codigo_rastreio && <Linha rotulo="Rastreio Loggi" valor={pedido.codigo_rastreio} />}
        </dl>
        {pedido.tem_envio_loggi && <BlocoRastreio nsu={pedido.order_nsu} />}
        <div className="mt-6 flex flex-wrap gap-3">
          {pedido.recibo_url && (
            <a href={pedido.recibo_url} target="_blank" rel="noreferrer" className="rounded-full border border-linha-2 px-5 py-2.5 font-medium hover:border-laranja">
              Ver comprovante
            </a>
          )}
          {loja.whatsapp && (
            <a
              href={`https://wa.me/${loja.whatsapp}?text=${encodeURIComponent(`Olá! Sobre o meu pedido ${pedido.order_nsu}.`)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-linha-2 px-5 py-2.5 font-medium hover:border-laranja"
            >
              Falar no WhatsApp
            </a>
          )}
          <a href="/" className="rounded-full px-5 py-2.5 font-medium text-laranja-2">
            Voltar à loja
          </a>
        </div>
        <p className="mt-4 text-xs text-suave">Pedido {pedido.order_nsu}</p>
      </div>
    </section>
  );
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

function BlocoRastreio({ nsu }: { nsu: string }) {
  const [dados, setDados] = useState<Rastreio | null>(null);
  useEffect(() => {
    chamar<Rastreio>(`/api/pedidos/${encodeURIComponent(nsu)}/rastreio`)
      .then(setDados)
      .catch(() => setDados(null));
  }, [nsu]);
  const r = dados?.rastreio;
  if (!r) return null;
  return (
    <section aria-label="Rastreio da entrega" className="mt-5 rounded-2xl border border-linha-2 p-4">
      <p className="font-mono text-xs tracking-widest text-laranja-2">ENTREGA LOGGI</p>
      <p className="mt-1 font-bold">{r.descricao}</p>
      <p className="text-xs text-suave">
        {[r.local, quando(r.atualizado_em)].filter(Boolean).join(" · ")}
        {r.previsao ? ` · previsão ${new Date(r.previsao).toLocaleDateString("pt-BR")}` : ""}
      </p>
      {r.historico.length > 1 && (
        <ol className="mt-3 grid gap-2 border-l border-linha-2 pl-3 text-sm">
          {[...r.historico].reverse().map((h, i) => (
            <li key={i}>
              <span className="block">{h.descricao}</span>
              <span className="text-xs text-suave">{[h.local, quando(h.quando)].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Caixa({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-10">
      <div className="rounded-[22px] border border-linha-2 bg-cartao p-6">
        <h1 className="font-display text-4xl leading-none font-extrabold uppercase">{titulo}</h1>
        <p className="mt-2 text-suave">{texto}</p>
        <a href="/" className="mt-4 inline-block font-medium text-laranja-2">
          Voltar à loja
        </a>
      </div>
    </section>
  );
}

function Selo({ ok = false }: { ok?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-12 place-items-center rounded-full text-2xl ${ok ? "bg-ok/15 text-ok" : "bg-amber-400/15 text-amber-300"}`}
    >
      {ok ? "✓" : "…"}
    </span>
  );
}

function Linha({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${forte ? "font-bold text-base" : ""}`}>
      <dt className={forte ? "" : "text-suave"}>{rotulo}</dt>
      <dd className="text-right">{valor}</dd>
    </div>
  );
}
