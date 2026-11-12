import { useState, type FormEvent, type ReactNode } from "react";
import {
  chamar,
  ErroApi,
  formatarCep,
  formatarCpf,
  formatarTelefone,
  reais,
  type Cotacao,
  type Loja,
  type Oferta,
} from "../api";

// O checkout: 1) o kit, 2) o frete pelo CEP (Loggi), 3) os dados de entrega. O servidor recalcula preço e frete na hora de
// criar o pedido e devolve o link de pagamento da InfinitePay.
export function PaginaCheckout({ loja }: { loja: Loja }) {
  const daUrl = new URLSearchParams(window.location.search).get("oferta");
  const [ofertaId, setOfertaId] = useState(
    loja.ofertas.some((o) => o.id === daUrl) ? daUrl! : loja.oferta_padrao || loja.ofertas[0].id,
  );
  const [cep, setCep] = useState("");
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const [freteTipo, setFreteTipo] = useState("");
  const [cotando, setCotando] = useState(false);
  const [erroFrete, setErroFrete] = useState("");
  const [dados, setDados] = useState({ nome: "", cpf: "", email: "", telefone: "", rua: "", numero: "", complemento: "", bairro: "" });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const oferta = loja.ofertas.find((o) => o.id === ofertaId)!;
  const opcao = cotacao?.opcoes.find((o) => o.tipo === freteTipo) ?? null;

  async function cotar(id = ofertaId, cepUsado = cep) {
    if (cepUsado.replace(/\D/g, "").length !== 8) {
      setErroFrete("Digite o CEP com 8 números.");
      return;
    }
    setCotando(true);
    setErroFrete("");
    try {
      const c = await chamar<Cotacao>("/api/frete", { corpo: { cep: cepUsado, oferta: id } });
      setCotacao(c);
      setFreteTipo((atual) => (c.opcoes.some((o) => o.tipo === atual) ? atual : c.opcoes[0].tipo));
      // A rua e o bairro do CEP, sem apagar o que a pessoa já escreveu.
      setDados((d) => ({ ...d, rua: d.rua || c.endereco.rua, bairro: d.bairro || c.endereco.bairro }));
    } catch (e) {
      setCotacao(null);
      setErroFrete((e as Error).message);
    } finally {
      setCotando(false);
    }
  }

  function escolherOferta(id: string) {
    setOfertaId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("oferta", id);
    window.history.replaceState(null, "", url);
    if (cotacao) void cotar(id); // o frete muda com o peso
  }

  const mudar = (campo: keyof typeof dados) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setDados((d) => ({
      ...d,
      [campo]: campo === "telefone" ? formatarTelefone(v) : campo === "cpf" ? formatarCpf(v) : v,
    }));
  };

  async function pagar(e: FormEvent) {
    e.preventDefault();
    if (!cotacao || !opcao) {
      setErro("Calcule o frete antes de pagar.");
      return;
    }
    setEnviando(true);
    setErro("");
    try {
      const r = await chamar<{ link_pagamento: string }>("/api/pedidos", {
        corpo: { ...dados, oferta: ofertaId, cep: cotacao.endereco.cep, frete_tipo: freteTipo },
      });
      window.location.href = r.link_pagamento;
    } catch (e) {
      setErro((e as Error).message);
      if (e instanceof ErroApi && e.status === 409) void cotar();
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={pagar} className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:py-10 lg:grid-cols-[1fr_380px] lg:items-start">
      <div className="grid gap-5">
        <div>
          <p className="font-mono text-xs tracking-widest text-laranja-2">FINALIZAR COMPRA</p>
          <h1 className="mt-1 font-display text-5xl leading-none font-extrabold uppercase md:text-6xl">
            Falta pouco<span className="text-laranja">.</span>
          </h1>
        </div>

        {/* 1. O kit */}
        <Etapa numero="01" titulo="Escolha o kit">
          <div role="radiogroup" aria-label="Kits" className="grid gap-3 sm:grid-cols-3">
            {loja.ofertas.map((o) => (
              <CartaoOferta key={o.id} oferta={o} loja={loja} ativa={o.id === ofertaId} onClick={() => escolherOferta(o.id)} />
            ))}
          </div>
        </Etapa>

        {/* 2. O frete */}
        <Etapa numero="02" titulo="Entrega">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="cep">
              CEP de entrega
            </label>
            <input
              id="cep"
              className="campo font-mono"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              value={cep}
              onChange={(e) => setCep(formatarCep(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void cotar();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void cotar()}
              disabled={cotando}
              className="shrink-0 rounded-[14px] border border-linha-2 px-5 font-bold transition hover:border-laranja hover:text-laranja-2 disabled:opacity-50"
            >
              {cotando ? "Calculando…" : "Calcular"}
            </button>
          </div>
          <a
            href="https://buscacepinter.correios.com.br/app/endereco/index.php"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm text-suave underline-offset-4 hover:underline"
          >
            Não sei meu CEP
          </a>
          {erroFrete && (
            <p role="alert" className="mt-2 text-sm text-alerta">
              {erroFrete}
            </p>
          )}
          {cotacao && (
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm text-suave">
                Entrega em <strong className="text-tinta">{cotacao.endereco.cidade}/{cotacao.endereco.uf}</strong> pela Loggi
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {cotacao.opcoes.map((o) => (
                  <label
                    key={o.tipo}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-4 transition ${
                      o.tipo === freteTipo ? "border-laranja bg-laranja/10" : "border-linha-2 hover:border-linha-2 hover:bg-white/[.03]"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="frete"
                        value={o.tipo}
                        checked={o.tipo === freteTipo}
                        onChange={() => setFreteTipo(o.tipo)}
                        className="size-4 accent-laranja"
                        aria-label={`${o.nome}, até ${o.prazo_dias} dias úteis, ${reais(o.centavos)}`}
                      />
                      <span>
                        <span className="block font-bold">{o.nome}</span>
                        <span className="block font-mono text-xs text-suave">
                          até {o.prazo_dias} {o.prazo_dias === 1 ? "dia útil" : "dias úteis"}
                        </span>
                      </span>
                    </span>
                    <span className="font-mono font-bold">{reais(o.centavos)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </Etapa>

        {/* 3. Os dados */}
        <Etapa numero="03" titulo="Seus dados" apagada={!cotacao}>
          <fieldset disabled={!cotacao} className="grid gap-4">
            {!cotacao && <p className="text-sm text-suave">Calcule o frete para preencher o endereço.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome completo">
                <input className="campo" required autoComplete="name" value={dados.nome} onChange={mudar("nome")} />
              </Campo>
              <Campo rotulo="CPF" dica="A Loggi pede o CPF de quem recebe.">
                <input className="campo font-mono" required inputMode="numeric" value={dados.cpf} onChange={mudar("cpf")} />
              </Campo>
              <Campo rotulo="E-mail">
                <input className="campo" required type="email" autoComplete="email" value={dados.email} onChange={mudar("email")} />
              </Campo>
              <Campo rotulo="Celular com DDD">
                <input className="campo font-mono" required inputMode="tel" autoComplete="tel-national" value={dados.telefone} onChange={mudar("telefone")} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
              <Campo rotulo="Rua">
                <input className="campo" required autoComplete="address-line1" value={dados.rua} onChange={mudar("rua")} />
              </Campo>
              <Campo rotulo="Número">
                <input className="campo" required value={dados.numero} onChange={mudar("numero")} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Complemento (opcional)">
                <input className="campo" autoComplete="address-line2" value={dados.complemento} onChange={mudar("complemento")} />
              </Campo>
              <Campo rotulo="Bairro">
                <input className="campo" required value={dados.bairro} onChange={mudar("bairro")} />
              </Campo>
            </div>
            {cotacao && (
              <p className="font-mono text-xs text-suave">
                CEP {formatarCep(cotacao.endereco.cep)} · {cotacao.endereco.cidade}/{cotacao.endereco.uf}
              </p>
            )}
          </fieldset>
        </Etapa>
      </div>

      {/* Resumo */}
      <aside className="lg:sticky lg:top-24">
        <div className="overflow-hidden rounded-[22px] border border-linha-2 bg-cartao">
          <div className="flex items-center gap-4 border-b border-linha p-4">
            <img src={loja.foto} alt="" className="size-20 rounded-xl object-cover" />
            <div>
              <p className="font-display text-2xl leading-none font-extrabold uppercase">{oferta.titulo}</p>
              <p className="mt-1 text-sm text-tinta-2">
                {oferta.kits * loja.produto.aparelhos} {oferta.kits > 1 ? "aparelhos" : "aparelho"} + {oferta.kits * loja.produto.refis}{" "}
                refis de {loja.produto.laminas_por_refil} lâminas
              </p>
            </div>
          </div>
          <dl className="grid gap-2 p-4 text-sm">
            <Linha rotulo="Kit" valor={reais(oferta.preco_centavos)} />
            <Linha rotulo={opcao ? `Frete ${opcao.nome}` : "Frete"} valor={opcao ? reais(opcao.centavos) : "Calcule pelo CEP"} />
            <div className="mt-2 flex items-end justify-between border-t border-linha pt-3">
              <dt className="font-bold">Total</dt>
              <dd className="font-display text-4xl leading-none font-extrabold">
                {reais(oferta.preco_centavos + (opcao?.centavos ?? 0))}
              </dd>
            </div>
          </dl>
          <div className="grid gap-3 p-4 pt-0">
            {erro && (
              <p role="alert" className="text-sm text-alerta">
                {erro}
              </p>
            )}
            <button type="submit" disabled={enviando || !opcao} className="btn-laranja px-6 py-4 text-base">
              {enviando ? "Abrindo o pagamento…" : opcao ? "Ir para o pagamento" : "Calcule o frete"}
              {!enviando && opcao && (
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
            <ul className="grid gap-1 font-mono text-xs text-suave">
              <li>✓ Pix ou cartão de crédito, na página segura da InfinitePay</li>
              <li>✓ Entrega pela Loggi com rastreio</li>
              <li>✓ 7 dias para devolução</li>
            </ul>
          </div>
        </div>
        {loja.whatsapp && (
          <a
            href={`https://wa.me/${loja.whatsapp}?text=${encodeURIComponent("Olá! Tenho uma dúvida sobre a compra.")}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block text-center text-sm text-suave hover:text-laranja-2"
          >
            Dúvidas? Fale com a gente no WhatsApp
          </a>
        )}
      </aside>
    </form>
  );
}

function Etapa({ numero, titulo, apagada = false, children }: { numero: string; titulo: string; apagada?: boolean; children: ReactNode }) {
  return (
    <section className={`rounded-[22px] border border-linha bg-fundo-2/80 p-5 transition md:p-6 ${apagada ? "opacity-60" : ""}`}>
      <h2 className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-sm text-laranja">{numero}</span>
        <span className="font-display text-3xl leading-none font-extrabold uppercase">{titulo}</span>
      </h2>
      {children}
    </section>
  );
}

function CartaoOferta({ oferta: o, loja, ativa, onClick }: { oferta: Oferta; loja: Loja; ativa: boolean; onClick: () => void }) {
  const refis = o.kits * loja.produto.refis;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={onClick}
      className={`relative flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition ${
        ativa ? "border-laranja bg-laranja/10 shadow-[0_10px_30px_-12px_rgba(255,106,19,.6)]" : "border-linha-2 hover:bg-white/[.03]"
      }`}
    >
      {o.selo && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-laranja px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-black">
          {o.selo}
        </span>
      )}
      <span className="font-display text-2xl leading-none font-extrabold uppercase">{o.titulo}</span>
      <span className="text-xs text-tinta-2">
        {o.kits * loja.produto.aparelhos} {o.kits > 1 ? "aparelhos" : "aparelho"} + {refis} refis
      </span>
      <span className="mt-2 font-mono text-lg font-bold">{reais(o.preco_centavos)}</span>
      <span className="font-mono text-[11px] text-suave">{reais(Math.round(o.preco_centavos / refis))} por refil</span>
    </button>
  );
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {rotulo}
      {children}
      {dica && <span className="text-xs font-normal text-suave">{dica}</span>}
    </label>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-tinta-2">{rotulo}</dt>
      <dd className="text-right font-mono">{valor}</dd>
    </div>
  );
}
