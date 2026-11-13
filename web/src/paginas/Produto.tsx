import { useEffect, useState } from "react";
import { chamar, reais, vitrineDoProduto, type ItemVitrine, type Loja, type ProdutoPublico } from "../api";
import { PaginaCheckout } from "./Checkout";

// Os produtos do catálogo: a vitrine (/produtos), a página de cada um (/p/<slug>) e o checkout dele
// (/checkout?produto=<slug>). O kit de lâminas tem a landing page própria (/).

function useProduto(slug: string) {
  const [produto, setProduto] = useState<ProdutoPublico | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    chamar<ProdutoPublico>(`/api/produtos/${encodeURIComponent(slug)}`)
      .then(setProduto)
      .catch((e: Error) => setErro(e.message));
  }, [slug]);
  return { produto, erro };
}

export function CheckoutDoProduto({ loja, slug }: { loja: Loja; slug: string }) {
  const { produto, erro } = useProduto(slug);
  useEffect(() => {
    if (produto) document.title = `${produto.nome} · ${loja.nome}`;
  }, [produto, loja.nome]);
  if (erro) return <NaoAchou mensagem={erro} />;
  if (!produto) return <p className="p-6 text-center text-suave">Carregando…</p>;
  return <PaginaCheckout loja={loja} vitrine={vitrineDoProduto(produto)} />;
}

export function PaginaProduto({ loja, slug }: { loja: Loja; slug: string }) {
  const { produto, erro } = useProduto(slug);
  useEffect(() => {
    if (produto) document.title = `${produto.nome} · ${loja.nome}`;
  }, [produto, loja.nome]);
  if (erro) return <NaoAchou mensagem={erro} />;
  if (!produto) return <p className="p-6 text-center text-suave">Carregando…</p>;

  const menor = Math.min(...produto.ofertas.map((o) => o.preco_centavos));
  const comprar = (oferta: string) => `/checkout?produto=${encodeURIComponent(produto.id)}&oferta=${oferta}`;
  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-2 md:py-14">
      <img src={produto.foto} alt={produto.nome} className="aspect-square w-full rounded-[22px] border border-linha object-cover" />
      <div className="grid content-start gap-5">
        <div>
          <a href="/produtos" className="font-mono text-xs tracking-widest text-laranja-2 hover:underline">
            ← TODOS OS PRODUTOS
          </a>
          <h1 className="mt-2 font-display text-5xl leading-none font-extrabold uppercase md:text-6xl">{produto.nome}</h1>
          {produto.chamada && <p className="mt-3 text-lg text-tinta-2">{produto.chamada}</p>}
        </div>
        <p className="font-display text-4xl font-extrabold">
          <span className="mr-2 align-middle font-mono text-sm font-normal text-suave">a partir de</span>
          {reais(menor)}
        </p>
        <div className="grid gap-2">
          {produto.ofertas.map((o) => (
            <a
              key={o.id}
              href={comprar(o.id)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-linha-2 px-4 py-3 hover:border-laranja"
            >
              <span>
                <span className="font-bold">{o.titulo}</span>
                {o.selo && <span className="ml-2 rounded-full bg-laranja px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-black">{o.selo}</span>}
                {o.frete_gratis && <span className="ml-2 font-mono text-[11px] font-bold uppercase text-ok">Frete grátis</span>}
              </span>
              <span className="font-mono font-bold">{reais(o.preco_centavos)}</span>
            </a>
          ))}
          {produto.montar.ativo && (
            <a
              href={comprar(`q${produto.montar.minimo}`)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-linha-2 px-4 py-3 hover:border-laranja"
            >
              <span className="font-bold">
                Monte o seu: de {produto.montar.minimo} a {produto.montar.maximo} {produto.unidade_plural}
              </span>
              <span className="font-mono font-bold">{reais(produto.montar.preco_kit_centavos)} cada</span>
            </a>
          )}
        </div>
        <a href={comprar(produto.oferta_padrao)} className="btn-laranja px-6 py-4 text-center text-base">
          Comprar
        </a>
        {produto.frete_gratis_a_partir > 0 && (
          <p className="text-sm text-ok">
            Frete grátis a partir de {produto.frete_gratis_a_partir} {produto.unidade_plural}.
          </p>
        )}
        {produto.conteudo && <p className="text-sm text-suave">Cada {produto.unidade}: {produto.conteudo}.</p>}
        {produto.descricao && (
          <div className="grid gap-3 border-t border-linha pt-5 text-tinta-2">
            {produto.descricao.split(/\n{2,}|\n/).map((paragrafo, i) => (
              <p key={i}>{paragrafo}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type Ordem = "destaques" | "vendidos" | "menor" | "maior";
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "destaques", rotulo: "Destaques" },
  { id: "vendidos", rotulo: "Mais vendidos" },
  { id: "menor", rotulo: "Menor preço" },
  { id: "maior", rotulo: "Maior preço" },
];

export function PaginaVitrine({ loja }: { loja: Loja }) {
  const [dados, setDados] = useState<{ categorias: string[]; itens: ItemVitrine[] } | null>(null);
  const [erro, setErro] = useState("");
  const [categoria, setCategoria] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("destaques");
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    document.title = `Produtos · ${loja.nome}`;
    chamar<{ categorias: string[]; itens: ItemVitrine[] }>("/api/vitrine")
      .then(setDados)
      .catch((e: Error) => setErro(e.message));
  }, [loja.nome]);

  const destaques = (dados?.itens ?? []).filter((i) => i.destaque);
  const banner = destaques.length ? destaques : (dados?.itens ?? []).slice(0, 1);
  useEffect(() => {
    if (banner.length < 2) return;
    const t = window.setInterval(() => setSlide((n) => (n + 1) % banner.length), 6000);
    return () => window.clearInterval(t);
  }, [banner.length]);

  const maisVendidos = [...(dados?.itens ?? [])].filter((i) => i.vendidos > 0).sort((a, b) => b.vendidos - a.vendidos).slice(0, 4);
  const lista = (dados?.itens ?? [])
    .filter((i) => !categoria || i.categoria === categoria)
    .sort((a, b) =>
      ordem === "vendidos"
        ? b.vendidos - a.vendidos
        : ordem === "menor"
          ? a.a_partir_de_centavos - b.a_partir_de_centavos
          : ordem === "maior"
            ? b.a_partir_de_centavos - a.a_partir_de_centavos
            : Number(b.destaque) - Number(a.destaque),
    );

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <p className="font-mono text-xs tracking-widest text-laranja-2">CUIDADO MASCULINO</p>
      <h1 className="mt-1 font-display text-5xl leading-none font-extrabold uppercase md:text-6xl">
        Produtos<span className="text-laranja">.</span>
      </h1>
      {erro && <p className="mt-6 text-alerta">{erro}</p>}
      {!dados ? (
        <p className="mt-6 text-suave">Carregando…</p>
      ) : (
        <>
          {/* Destaques: banner grande (troca sozinho quando há mais de um) */}
          {banner.length > 0 && (
            <div className="relative mt-8 overflow-hidden rounded-[26px] border border-linha bg-cartao">
              {banner.map((i, n) => (
                <article
                  key={i.id}
                  aria-hidden={n !== slide % banner.length}
                  className={`grid gap-6 p-5 transition-opacity duration-700 md:grid-cols-[1.1fr_1fr] md:items-center md:p-8 ${
                    n === slide % banner.length ? "relative opacity-100" : "pointer-events-none absolute inset-0 opacity-0"
                  }`}
                >
                  <img src={i.foto} alt={i.nome} className="aspect-[4/3] w-full rounded-2xl object-cover md:aspect-square" />
                  <div className="grid content-center gap-3">
                    <p className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-laranja px-3 py-1 font-mono text-[11px] font-bold text-black uppercase">Destaque</span>
                      {i.selo && <span className="rounded-full border border-laranja/60 px-3 py-1 font-mono text-[11px] font-bold text-laranja-2 uppercase">{i.selo}</span>}
                    </p>
                    <h2 className="font-display text-4xl leading-none font-extrabold uppercase md:text-5xl">{i.nome}</h2>
                    {i.chamada && <p className="text-lg text-tinta-2">{i.chamada}</p>}
                    <p className="font-display text-4xl font-extrabold">
                      <span className="mr-2 align-middle font-mono text-sm font-normal text-suave">a partir de</span>
                      {reais(i.a_partir_de_centavos)}
                    </p>
                    {i.frete_gratis_a_partir > 0 && (
                      <p className="text-sm font-semibold text-ok">
                        Frete grátis a partir de {i.frete_gratis_a_partir} {i.frete_gratis_a_partir > 1 ? `${i.unidade}s` : i.unidade}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3">
                      <a href={i.comprar} className="btn-laranja px-6 py-3.5 text-sm">
                        Comprar
                      </a>
                      <a href={i.url} className="rounded-full border border-linha-2 px-6 py-3.5 text-sm font-bold hover:border-laranja">
                        Ver detalhes
                      </a>
                    </div>
                  </div>
                </article>
              ))}
              {banner.length > 1 && (
                <div className="absolute right-5 bottom-4 flex gap-2">
                  {banner.map((i, n) => (
                    <button
                      key={i.id}
                      type="button"
                      aria-label={`Destaque ${n + 1}: ${i.nome}`}
                      onClick={() => setSlide(n)}
                      className={`h-2 rounded-full transition-all ${n === slide % banner.length ? "w-6 bg-laranja" : "w-2 bg-white/30"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mais vendidos (aparece quando há vendas) */}
          {maisVendidos.length >= 2 && (
            <div className="mt-10">
              <h2 className="font-display text-3xl leading-none font-extrabold uppercase">Mais vendidos</h2>
              <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {maisVendidos.map((i, n) => (
                  <li key={i.id}>
                    <a href={i.url} className="flex items-center gap-3 rounded-2xl border border-linha bg-cartao p-2 hover:border-laranja">
                      <span className="relative shrink-0">
                        <img src={i.foto} alt="" className="size-16 rounded-xl object-cover" loading="lazy" />
                        <span className="absolute -top-2 -left-2 grid size-6 place-items-center rounded-full bg-laranja font-mono text-xs font-bold text-black">
                          {n + 1}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm font-semibold">{i.nome}</span>
                        <span className="font-mono text-xs text-suave">{reais(i.a_partir_de_centavos)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Abas de categoria e ordem */}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Categorias" className="flex gap-1 overflow-x-auto rounded-xl border border-linha-2 bg-fundo-2 p-1 [scrollbar-width:none]">
              {["", ...dados.categorias].map((c) => (
                <button
                  key={c || "todos"}
                  role="tab"
                  aria-selected={categoria === c}
                  type="button"
                  onClick={() => setCategoria(c)}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${categoria === c ? "bg-laranja text-black" : "text-tinta-2 hover:text-tinta"}`}
                >
                  {c || "Todos"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-suave">
              Ordenar por
              <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="rounded-lg border border-linha-2 bg-fundo-2 px-3 py-2 text-tinta">
                {ORDENS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {lista.map((i) => (
              <li key={i.id}>
                <article className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-linha bg-cartao transition hover:border-laranja">
                  <a href={i.url} className="relative block overflow-hidden">
                    <img src={i.foto} alt={i.nome} className="aspect-square w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                    {i.selo && (
                      <span className="absolute top-3 left-3 rounded-full bg-laranja px-2.5 py-1 font-mono text-[10px] font-bold text-black uppercase">{i.selo}</span>
                    )}
                  </a>
                  <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
                    {i.categoria && <p className="font-mono text-[10px] tracking-widest text-suave uppercase">{i.categoria}</p>}
                    <a href={i.url} className="line-clamp-2 text-base leading-tight font-bold hover:text-laranja-2 sm:text-lg">
                      {i.nome}
                    </a>
                    {i.chamada && <p className="line-clamp-2 text-xs text-tinta-2 sm:text-sm">{i.chamada}</p>}
                    <div className="mt-auto pt-2">
                      <p className="font-mono text-lg font-bold">
                        <span className="mr-1 text-[11px] font-normal text-suave">a partir de</span>
                        {reais(i.a_partir_de_centavos)}
                      </p>
                      <p className="font-mono text-[11px] text-suave">
                        {reais(i.por_unidade_centavos)} por {i.unidade}
                        {i.frete_gratis_a_partir > 0 && <span className="text-ok"> · frete grátis a partir de {i.frete_gratis_a_partir}</span>}
                      </p>
                      <a href={i.comprar} className="btn-laranja mt-3 block px-4 py-2.5 text-center text-xs">
                        Comprar
                      </a>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          {lista.length === 0 && <p className="mt-6 text-suave">Nenhum produto nesta categoria.</p>}
        </>
      )}
    </section>
  );
}

function NaoAchou({ mensagem }: { mensagem: string }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-lg">{mensagem}</p>
      <a href="/produtos" className="mt-4 inline-block text-laranja-2 hover:underline">
        Ver os produtos
      </a>
    </section>
  );
}
