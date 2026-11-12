import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { chamar, ErroApi, formatarCep, formatarTelefone, reais, type Cotacao, type Loja } from "../api";

const FOTOS = [
  { src: "/produto/frente.jpg", alt: "Embalagem do kit: aparelho com cabo e cargas de reposição" },
  { src: "/produto/verso.jpg", alt: "Verso da embalagem com as especificações e a garantia" },
];

const DESTAQUES = ["Lâminas múltiplas", "Tira lubrificante com aloe", "Lavável", "Garantia de 90 dias"];

export function PaginaLoja({ loja }: { loja: Loja }) {
  const { produto } = loja;
  const [foto, setFoto] = useState(0);
  const [quantidade, setQuantidade] = useState(1);
  const [cep, setCep] = useState("");
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const [freteTipo, setFreteTipo] = useState("");
  const [cotando, setCotando] = useState(false);
  const [erroFrete, setErroFrete] = useState("");
  const checkout = useRef<HTMLDivElement>(null);

  async function cotar(qtd = quantidade, cepUsado = cep) {
    if (cepUsado.replace(/\D/g, "").length !== 8) {
      setErroFrete("Digite o CEP com 8 números.");
      return;
    }
    setCotando(true);
    setErroFrete("");
    try {
      const c = await chamar<Cotacao>("/api/frete", { corpo: { cep: cepUsado, quantidade: qtd } });
      setCotacao(c);
      setFreteTipo((atual) => (c.opcoes.some((o) => o.tipo === atual) ? atual : c.opcoes[0].tipo));
    } catch (e) {
      setCotacao(null);
      setErroFrete((e as Error).message);
    } finally {
      setCotando(false);
    }
  }

  function mudarQuantidade(nova: number) {
    const q = Math.min(Math.max(nova, 1), loja.quantidade_maxima);
    setQuantidade(q);
    if (cotacao) void cotar(q); // o frete muda com o peso
  }

  const opcao = cotacao?.opcoes.find((o) => o.tipo === freteTipo) ?? null;

  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:grid-cols-2 md:py-10">
        {/* Fotos */}
        <div>
          <div className="overflow-hidden rounded-2xl border border-linha bg-cartao">
            <img src={FOTOS[foto].src} alt={FOTOS[foto].alt} className="aspect-[4/5] w-full object-cover" />
          </div>
          <div className="mt-3 flex gap-3">
            {FOTOS.map((f, i) => (
              <button
                key={f.src}
                type="button"
                onClick={() => setFoto(i)}
                aria-label={`Ver foto ${i + 1}`}
                aria-pressed={i === foto}
                className={`overflow-hidden rounded-xl border-2 ${i === foto ? "border-salvia-forte" : "border-linha"}`}
              >
                <img src={f.src} alt="" className="size-20 object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* Compra */}
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-salvia-forte">Barbear</p>
            <h1 className="mt-1 text-3xl font-bold leading-tight text-balance">{produto.nome}</h1>
            <p className="mt-2 text-suave">{produto.resumo}</p>
          </div>

          <p className="text-4xl font-bold">{reais(produto.preco_centavos)}</p>

          <ul className="flex flex-wrap gap-2">
            {DESTAQUES.map((d) => (
              <li key={d} className="rounded-full bg-salvia/30 px-3 py-1 text-sm font-medium text-salvia-forte">
                {d}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4">
            <span className="text-sm font-medium" id="rotulo-qtd">
              Quantidade
            </span>
            <div role="group" aria-labelledby="rotulo-qtd" className="flex items-center rounded-xl border border-linha bg-cartao">
              <BotaoQtd rotulo="Diminuir" onClick={() => mudarQuantidade(quantidade - 1)} desligado={quantidade <= 1}>
                −
              </BotaoQtd>
              <span className="w-10 text-center font-semibold" aria-live="polite">
                {quantidade}
              </span>
              <BotaoQtd
                rotulo="Aumentar"
                onClick={() => mudarQuantidade(quantidade + 1)}
                desligado={quantidade >= loja.quantidade_maxima}
              >
                +
              </BotaoQtd>
            </div>
          </div>

          {/* Frete */}
          <div className="rounded-2xl border border-linha bg-cartao p-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void cotar();
              }}
            >
              <label className="sr-only" htmlFor="cep-frete">
                CEP de entrega
              </label>
              <input
                id="cep-frete"
                className="campo"
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="CEP de entrega"
                value={cep}
                onChange={(e) => setCep(formatarCep(e.target.value))}
              />
              <button
                type="submit"
                disabled={cotando}
                className="shrink-0 rounded-xl bg-escuro px-4 font-semibold text-fundo disabled:opacity-60"
              >
                {cotando ? "Calculando…" : "Calcular frete"}
              </button>
            </form>
            {erroFrete && (
              <p role="alert" className="mt-2 text-sm text-alerta">
                {erroFrete}
              </p>
            )}
            {cotacao && (
              <fieldset className="mt-3">
                <legend className="mb-2 text-sm text-suave">
                  Entrega em {cotacao.endereco.cidade}/{cotacao.endereco.uf} pela Loggi
                </legend>
                <div className="grid gap-2">
                  {cotacao.opcoes.map((o) => (
                    <label
                      key={o.tipo}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 ${
                        o.tipo === freteTipo ? "border-salvia-forte bg-salvia/15" : "border-linha"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="frete"
                          value={o.tipo}
                          checked={o.tipo === freteTipo}
                          onChange={() => setFreteTipo(o.tipo)}
                          className="accent-salvia-forte"
                        />
                        <span>
                          <span className="block font-semibold">{o.nome}</span>
                          <span className="block text-sm text-suave">
                            até {o.prazo_dias} {o.prazo_dias === 1 ? "dia útil" : "dias úteis"}
                          </span>
                        </span>
                      </span>
                      <span className="font-semibold">{reais(o.centavos)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          <button
            type="button"
            disabled={!opcao}
            onClick={() => checkout.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-full bg-salvia px-6 py-4 text-lg font-bold text-escuro disabled:cursor-not-allowed disabled:opacity-50 dark:text-fundo"
          >
            {opcao ? `Comprar · ${reais(opcao.total_centavos)}` : "Calcule o frete para comprar"}
          </button>
        </div>
      </section>

      {cotacao && opcao && (
        <div ref={checkout} className="scroll-mt-4">
          <Checkout loja={loja} quantidade={quantidade} cotacao={cotacao} freteTipo={freteTipo} aoMudarFrete={() => cotar()} />
        </div>
      )}

      <Especificacoes ean={produto.ean} sku={produto.sku} />
    </>
  );
}

function BotaoQtd({ rotulo, onClick, desligado, children }: { rotulo: string; onClick: () => void; desligado: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      disabled={desligado}
      className="size-11 text-xl font-semibold disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Checkout({
  loja,
  quantidade,
  cotacao,
  freteTipo,
  aoMudarFrete,
}: {
  loja: Loja;
  quantidade: number;
  cotacao: Cotacao;
  freteTipo: string;
  aoMudarFrete: () => void;
}) {
  const opcao = cotacao.opcoes.find((o) => o.tipo === freteTipo)!;
  const [dados, setDados] = useState({
    nome: "",
    email: "",
    telefone: "",
    rua: cotacao.endereco.rua,
    numero: "",
    complemento: "",
    bairro: cotacao.endereco.bairro,
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const mudar = (campo: keyof typeof dados) => (e: { target: { value: string } }) =>
    setDados((d) => ({ ...d, [campo]: campo === "telefone" ? formatarTelefone(e.target.value) : e.target.value }));

  async function pagar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      const r = await chamar<{ link_pagamento: string }>("/api/pedidos", {
        corpo: { ...dados, quantidade, cep: cotacao.endereco.cep, frete_tipo: freteTipo },
      });
      window.location.href = r.link_pagamento;
    } catch (e) {
      setErro((e as Error).message);
      if (e instanceof ErroApi && e.status === 409) aoMudarFrete();
      setEnviando(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 pb-4" aria-labelledby="titulo-checkout">
      <form onSubmit={pagar} className="grid gap-6 rounded-2xl border border-linha bg-cartao p-5 md:grid-cols-[1fr_340px] md:p-8">
        <div className="grid gap-4">
          <h2 id="titulo-checkout" className="text-2xl font-bold">
            Seus dados para a entrega
          </h2>
          <Campo rotulo="Nome completo">
            <input className="campo" required autoComplete="name" value={dados.nome} onChange={mudar("nome")} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="E-mail">
              <input className="campo" required type="email" autoComplete="email" value={dados.email} onChange={mudar("email")} />
            </Campo>
            <Campo rotulo="Celular com DDD">
              <input
                className="campo"
                required
                inputMode="tel"
                autoComplete="tel-national"
                value={dados.telefone}
                onChange={mudar("telefone")}
              />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
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
          <p className="text-sm text-suave">
            CEP {formatarCep(cotacao.endereco.cep)} · {cotacao.endereco.cidade}/{cotacao.endereco.uf}. Para mudar o CEP, calcule o
            frete de novo lá em cima.
          </p>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl bg-fundo p-4">
          <h3 className="font-bold">Resumo</h3>
          <Linha rotulo={`${quantidade} × ${loja.produto.nome}`} valor={reais(cotacao.produto_centavos)} />
          <Linha rotulo={`Frete ${opcao.nome} (até ${opcao.prazo_dias} dias úteis)`} valor={reais(opcao.centavos)} />
          <div className="border-t border-linha pt-3">
            <Linha rotulo={<strong>Total</strong>} valor={<strong className="text-xl">{reais(opcao.total_centavos)}</strong>} />
          </div>
          {erro && (
            <p role="alert" className="text-sm text-alerta">
              {erro}
            </p>
          )}
          <button
            type="submit"
            disabled={enviando}
            className="mt-1 rounded-full bg-escuro px-6 py-4 font-bold text-fundo disabled:opacity-60"
          >
            {enviando ? "Abrindo o pagamento…" : "Ir para o pagamento"}
          </button>
          <p className="text-center text-xs text-suave">Pix ou cartão de crédito, na página segura da InfinitePay.</p>
        </aside>
      </form>
    </section>
  );
}

function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className}`}>
      {rotulo}
      {children}
    </label>
  );
}

function Linha({ rotulo, valor }: { rotulo: ReactNode; valor: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-suave">{rotulo}</span>
      <span className="shrink-0 text-right">{valor}</span>
    </div>
  );
}

function Especificacoes({ ean, sku }: { ean: string; sku: string }) {
  const itens = [
    ["Material", "Plástico PP e aço carbono."],
    ["Tira lubrificante", "Com aloe, para hidratar a pele e deixar o barbear mais suave."],
    ["Limpeza", "Desenho simples, fácil de enxaguar: lave com água e deixe secar depois do uso."],
    ["Conteúdo", "Aparelho com cabo e cargas de reposição."],
    ["Garantia", "90 dias do fabricante contra defeito de fabricação, a partir da compra."],
    ["Cuidado", "Lâminas muito afiadas. Guarde fora do alcance de crianças."],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-8" aria-labelledby="titulo-specs">
      <h2 id="titulo-specs" className="text-2xl font-bold">
        Especificações
      </h2>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-linha bg-linha sm:grid-cols-2">
        {itens.map(([t, d]) => (
          <div key={t} className="bg-cartao p-4">
            <dt className="font-semibold">{t}</dt>
            <dd className="mt-1 text-suave">{d}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-suave">
        Código {sku} · EAN {ean}
      </p>
    </section>
  );
}
