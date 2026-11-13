import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  chamar,
  ErroApi,
  formatarCep,
  formatarCpf,
  formatarTelefone,
  kitsMontadosDaUrl,
  ofertaMontada,
  reais,
  refGuardado,
  campanhaGuardada,
  type Cotacao,
  type Loja,
  type Oferta,
  type Vitrine,
} from "../api";

// O checkout: 1) o kit, 2) o frete pelo CEP (Loggi), 3) os dados de entrega. O servidor recalcula preço e frete na hora de
// criar o pedido e devolve o link de pagamento da InfinitePay.
export function PaginaCheckout({ loja, vitrine: v }: { loja: Loja; vitrine: Vitrine }) {
  const daUrl = new URLSearchParams(window.location.search).get("oferta");
  const montadosDaUrl = v.ofertas.some((o) => o.id === daUrl) ? null : kitsMontadosDaUrl(v, daUrl);
  const [ofertaId, setOfertaId] = useState(
    v.ofertas.some((o) => o.id === daUrl) || montadosDaUrl ? daUrl! : v.oferta_padrao || v.ofertas[0].id,
  );
  const [kitsMontados, setKitsMontados] = useState(montadosDaUrl ?? v.montar.minimo);
  const [cep, setCep] = useState(() => lerCliente().cep ?? "");
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const [freteTipo, setFreteTipo] = useState("");
  const [cotando, setCotando] = useState(false);
  const [erroFrete, setErroFrete] = useState("");
  const lembrados = lerCliente();
  const [dados, setDados] = useState({ nome: "", cpf: "", email: "", telefone: "", rua: "", numero: "", complemento: "", bairro: "", ...lembrados.dados });
  const [lembrar, setLembrar] = useState(true);
  const [alterarRua, setAlterarRua] = useState(false);
  const [cupomTexto, setCupomTexto] = useState("");
  const [cupom, setCupom] = useState<CupomAplicado | null>(null);
  const [erroCupom, setErroCupom] = useState("");
  const [validandoCupom, setValidandoCupom] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const oferta = v.ofertas.find((o) => o.id === ofertaId) ?? ofertaMontada(v, kitsMontados);
  const opcao = cotacao?.opcoes.find((o) => o.tipo === freteTipo) ?? null;

  async function cotar(id = ofertaId, cepUsado = cep, codigoCupom = cupom?.codigo) {
    if (cepUsado.replace(/\D/g, "").length !== 8) {
      setErroFrete("Digite o CEP com 8 números.");
      return;
    }
    setCotando(true);
    setErroFrete("");
    try {
      const c = await chamar<Cotacao>("/api/frete", { corpo: { cep: cepUsado, oferta: id, produto: v.produto, cupom: codigoCupom } });
      setCotacao(c);
      setFreteTipo((atual) => (c.opcoes.some((o) => o.tipo === atual) ? atual : c.opcoes[0].tipo));
      // A rua e o bairro do CEP, sem apagar o que a pessoa já escreveu.
      setDados((d) =>
        d.rua && cepUsado.replace(/\D/g, "") === (lembrados.cep ?? "").replace(/\D/g, "")
          ? { ...d, rua: d.rua || c.endereco.rua, bairro: d.bairro || c.endereco.bairro }
          : { ...d, rua: c.endereco.rua, bairro: c.endereco.bairro },
      );
      if (!c.endereco.rua || !c.endereco.bairro) setAlterarRua(true); // CEP geral da cidade: a pessoa escreve a rua
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
    if (cupom) void aplicarCupom(cupom.codigo, id);
  }

  async function aplicarCupom(codigo = cupomTexto, id = ofertaId) {
    const limpo = codigo.trim().toUpperCase();
    if (!limpo) return;
    setValidandoCupom(true);
    setErroCupom("");
    try {
      const c = await chamar<CupomAplicado>("/api/cupons/validar", { corpo: { cupom: limpo, oferta: id, produto: v.produto } });
      setCupom(c);
      setCupomTexto(c.codigo);
      if (cotacao && c.frete_gratis !== cupom?.frete_gratis) void cotar(id, cep, c.codigo);
    } catch (e) {
      setCupom(null);
      setErroCupom((e as Error).message);
      if (cotacao && cupom?.frete_gratis) void cotar(id, cep, undefined);
    } finally {
      setValidandoCupom(false);
    }
  }

  function tirarCupom() {
    const tinhaFrete = cupom?.frete_gratis;
    setCupom(null);
    setCupomTexto("");
    setErroCupom("");
    if (cotacao && tinhaFrete) void cotar(ofertaId, cep, undefined);
  }

  // Quem já comprou neste aparelho: o frete é calculado sozinho para o CEP lembrado.
  useEffect(() => {
    if (lembrados.cep && (lembrados.cep.replace(/\D/g, "").length === 8)) void cotar(ofertaId, lembrados.cep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        corpo: { ...dados, oferta: ofertaId, produto: v.produto, cep: cotacao.endereco.cep, frete_tipo: freteTipo, ref: refGuardado(), campanha: campanhaGuardada(), cupom: cupom?.codigo },
      });
      guardarCliente(lembrar ? { dados, cep: cotacao.endereco.cep } : null);
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
        <Etapa numero="01" titulo={v.etapa}>
          {v.produto && <p className="-mt-2 mb-3 font-semibold text-tinta-2">{v.nome}</p>}
          <div
            role="radiogroup"
            aria-label="Quantidade"
            className={`grid gap-3 sm:grid-cols-2 ${v.ofertas.length + (v.montar.ativo ? 1 : 0) >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}
          >
            {v.ofertas.map((o) => (
              <CartaoOferta key={o.id} oferta={o} vitrine={v} ativa={o.id === ofertaId} onClick={() => escolherOferta(o.id)} />
            ))}
            {v.montar.ativo && (
              <CartaoMontar
                vitrine={v}
                kits={kitsMontados}
                ativa={!v.ofertas.some((o) => o.id === ofertaId)}
                aoEscolher={(kits) => {
                  setKitsMontados(kits);
                  escolherOferta(`${v.prefixo}${kits}`);
                }}
              />
            )}
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
                        aria-label={`${o.nome}, até ${o.prazo_dias} dias úteis, ${o.gratis ? "frete grátis" : reais(o.centavos)}`}
                      />
                      <span>
                        <span className="block font-bold">{o.nome}</span>
                        <span className="block font-mono text-xs text-suave">
                          até {o.prazo_dias} {o.prazo_dias === 1 ? "dia útil" : "dias úteis"}
                        </span>
                      </span>
                    </span>
                    {o.gratis ? (
                      <span className="text-right">
                        <span className="block font-mono font-bold text-ok">Grátis</span>
                        <s className="block font-mono text-xs text-suave">{reais(o.custo_centavos)}</s>
                      </span>
                    ) : (
                      <span className="font-mono font-bold">{reais(o.centavos)}</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {cotacao && (
            <div className="mt-4 grid gap-3 rounded-2xl border border-linha-2 p-4">
              <p className="text-sm">
                <span className="text-suave">Entregar em </span>
                <strong>
                  {dados.rua || "rua não encontrada"}
                  {dados.bairro ? `, ${dados.bairro}` : ""}
                </strong>
                <span className="text-suave">
                  {" "}
                  · {cotacao.endereco.cidade}/{cotacao.endereco.uf} · CEP {formatarCep(cotacao.endereco.cep)}
                </span>{" "}
                {!alterarRua && (
                  <button type="button" onClick={() => setAlterarRua(true)} className="text-laranja-2 underline-offset-4 hover:underline">
                    alterar
                  </button>
                )}
              </p>
              {alterarRua && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo rotulo="Rua">
                    <input className="campo" required autoComplete="address-line1" value={dados.rua} onChange={mudar("rua")} />
                  </Campo>
                  <Campo rotulo="Bairro">
                    <input className="campo" required autoComplete="address-level3" value={dados.bairro} onChange={mudar("bairro")} />
                  </Campo>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <Campo rotulo="Número">
                  <input className="campo" required inputMode="numeric" value={dados.numero} onChange={mudar("numero")} />
                </Campo>
                <Campo rotulo="Complemento (opcional)">
                  <input className="campo" autoComplete="address-line2" placeholder="Apto, bloco, casa…" value={dados.complemento} onChange={mudar("complemento")} />
                </Campo>
              </div>
            </div>
          )}
        </Etapa>

        {/* 3. Os dados */}
        <Etapa numero="03" titulo="Seus dados">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome completo" dica="De quem vai receber.">
                <input className="campo" required autoComplete="name" value={dados.nome} onChange={mudar("nome")} />
              </Campo>
              <Campo rotulo="CPF" dica="A Loggi pede o CPF de quem recebe.">
                <input className="campo font-mono" required inputMode="numeric" autoComplete="off" value={dados.cpf} onChange={mudar("cpf")} />
              </Campo>
              <Campo rotulo="Celular (WhatsApp)" dica="Para a entrega e o rastreio.">
                <input className="campo font-mono" required inputMode="tel" autoComplete="tel-national" value={dados.telefone} onChange={mudar("telefone")} />
              </Campo>
              <Campo rotulo="E-mail (opcional)">
                <input className="campo" type="email" autoComplete="email" value={dados.email} onChange={mudar("email")} />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm text-tinta-2">
              <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="size-4 accent-laranja" />
              Lembrar meus dados neste aparelho para a próxima compra
            </label>
          </div>
        </Etapa>
      </div>

      {/* Resumo */}
      <aside className="lg:sticky lg:top-24">
        <div className="overflow-hidden rounded-[22px] border border-linha-2 bg-cartao">
          <div className="flex items-center gap-4 border-b border-linha p-4">
            <img src={v.foto} alt="" className="size-20 rounded-xl object-cover" />
            <div>
              <p className="font-display text-2xl leading-none font-extrabold uppercase">{oferta.titulo}</p>
              <p className="mt-1 text-sm text-tinta-2">{v.resumo(oferta.kits)}</p>
            </div>
          </div>
          <dl className="grid gap-2 p-4 text-sm">
            <Linha rotulo={v.rotulo} valor={reais(oferta.preco_centavos)} />
            {cupom && cupom.desconto_centavos > 0 && (
              <Linha rotulo={`Cupom ${cupom.codigo}`} valor={`− ${reais(cupom.desconto_centavos)}`} />
            )}
            <Linha rotulo={opcao ? `Frete ${opcao.nome}` : "Frete"} valor={opcao ? (opcao.gratis ? "Grátis" : reais(opcao.centavos)) : oferta.frete_gratis ? "Grátis · calcule o prazo" : "Calcule pelo CEP"} />
            <div className="mt-1">
              {cupom ? (
                <p className="flex items-center justify-between gap-2 rounded-xl bg-ok/10 px-3 py-2 text-ok">
                  <span>
                    <strong className="font-mono">{cupom.codigo}</strong> · {cupom.descricao}
                  </span>
                  <button type="button" onClick={tirarCupom} className="text-xs text-suave hover:text-tinta">
                    tirar
                  </button>
                </p>
              ) : (
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor="cupom">
                    Cupom de desconto
                  </label>
                  <input
                    id="cupom"
                    className="campo py-2 font-mono text-sm uppercase"
                    placeholder="Cupom de desconto"
                    value={cupomTexto}
                    onChange={(e) => setCupomTexto(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void aplicarCupom();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={validandoCupom || !cupomTexto}
                    onClick={() => void aplicarCupom()}
                    className="shrink-0 rounded-[14px] border border-linha-2 px-4 text-sm font-bold hover:border-laranja disabled:opacity-40"
                  >
                    {validandoCupom ? "…" : "Aplicar"}
                  </button>
                </div>
              )}
              {erroCupom && <p role="alert" className="mt-1 text-xs text-alerta">{erroCupom}</p>}
            </div>
            <div className="mt-2 flex items-end justify-between border-t border-linha pt-3">
              <dt className="font-bold">Total</dt>
              <dd className="font-display text-4xl leading-none font-extrabold">
                {reais(oferta.preco_centavos - (cupom?.desconto_centavos ?? 0) + (opcao?.centavos ?? 0))}
              </dd>
            </div>
            {loja.desconto_pix > 0 && (
              <div className="flex justify-between gap-3 rounded-xl bg-ok/10 px-3 py-2 text-ok">
                <dt>No Pix ({loja.desconto_pix.toLocaleString("pt-BR")}% off)</dt>
                <dd className="font-bold">
                  {reais(Math.round((oferta.preco_centavos - (cupom?.desconto_centavos ?? 0) + (opcao?.centavos ?? 0)) * (1 - loja.desconto_pix / 100)))}
                </dd>
              </div>
            )}
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
              <li>
                ✓ Pix{loja.desconto_pix > 0 ? ` com ${loja.desconto_pix.toLocaleString("pt-BR")}% off` : ""} ou cartão de crédito, na página
                segura da InfinitePay (você escolhe lá)
              </li>
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

// "Monte o seu": da maior oferta + 1 até o máximo, com − e +. O preço é o da faixa (o servidor recalcula).
function CartaoMontar({ vitrine: v, kits, ativa, aoEscolher }: { vitrine: Vitrine; kits: number; ativa: boolean; aoEscolher: (kits: number) => void }) {
  const o = ofertaMontada(v, kits);
  const avulso = v.ofertas.find((x) => x.kits === 1)?.preco_centavos ?? 0;
  const economia = avulso * kits - o.preco_centavos;
  const { minimo, maximo } = v.montar;
  return (
    <div
      role="radio"
      aria-checked={ativa}
      aria-label={`Monte o seu: ${o.titulo}, ${reais(o.preco_centavos)}`}
      tabIndex={0}
      onClick={() => aoEscolher(kits)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          aoEscolher(kits);
        }
      }}
      className={`relative flex cursor-pointer flex-col items-start gap-1 rounded-2xl border p-4 text-left transition ${
        ativa ? "border-laranja bg-laranja/10 shadow-[0_10px_30px_-12px_rgba(255,106,19,.6)]" : "border-dashed border-linha-2 hover:bg-white/[.03]"
      }`}
    >
      <span className="font-display text-2xl leading-none font-extrabold uppercase">Monte o seu</span>
      <span className="mt-1 flex items-center gap-2">
        <button
          type="button"
          aria-label="Menos um"
          disabled={kits <= minimo}
          onClick={(e) => {
            e.stopPropagation();
            aoEscolher(kits - 1);
          }}
          className="grid size-8 place-items-center rounded-full border border-linha-2 font-bold disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-14 text-center font-mono text-sm font-bold" aria-live="polite">
          {o.titulo.toLowerCase()}
        </span>
        <button
          type="button"
          aria-label="Mais um"
          disabled={kits >= maximo}
          onClick={(e) => {
            e.stopPropagation();
            aoEscolher(kits + 1);
          }}
          className="grid size-8 place-items-center rounded-full border border-linha-2 font-bold disabled:opacity-40"
        >
          +
        </button>
      </span>
      <span className="text-xs text-tinta-2">{v.detalhe(kits)}</span>
      <span className="mt-2 font-mono text-lg font-bold">{reais(o.preco_centavos)}</span>
      <span className="font-mono text-[11px] text-suave">{v.porUnidade(kits, o.preco_centavos)}</span>
      {economia > 0 && <span className="font-mono text-[11px] text-tinta-2">Economize {reais(economia)}</span>}
      {o.frete_gratis && <span className="mt-1 font-mono text-[11px] font-bold uppercase text-ok">Frete grátis</span>}
    </div>
  );
}

function CartaoOferta({ oferta: o, vitrine: v, ativa, onClick }: { oferta: Oferta; vitrine: Vitrine; ativa: boolean; onClick: () => void }) {
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
      <span className="text-xs text-tinta-2">{v.detalhe(o.kits)}</span>
      <span className="mt-2 font-mono text-lg font-bold">{reais(o.preco_centavos)}</span>
      <span className="font-mono text-[11px] text-suave">{v.porUnidade(o.kits, o.preco_centavos)}</span>
      {o.frete_gratis && <span className="mt-1 font-mono text-[11px] font-bold uppercase text-ok">Frete grátis</span>}
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

type CupomAplicado = { codigo: string; descricao: string; desconto_centavos: number; frete_gratis: boolean };
type Lembrados = {
  dados?: Partial<{ nome: string; cpf: string; email: string; telefone: string; rua: string; numero: string; complemento: string; bairro: string }>;
  cep?: string;
};

// Os dados do cliente ficam só neste aparelho (localStorage), se ele deixar marcado "lembrar".
const CHAVE_CLIENTE = "loja-cliente";
function lerCliente(): Lembrados {
  try {
    return (JSON.parse(localStorage.getItem(CHAVE_CLIENTE) ?? "null") as Lembrados | null) ?? {};
  } catch {
    return {};
  }
}
function guardarCliente(valor: Lembrados | null) {
  try {
    if (valor) localStorage.setItem(CHAVE_CLIENTE, JSON.stringify(valor));
    else localStorage.removeItem(CHAVE_CLIENTE);
  } catch {
    /* sem armazenamento: não lembra */
  }
}
