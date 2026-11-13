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

export function PaginaVitrine({ loja }: { loja: Loja }) {
  const [itens, setItens] = useState<ItemVitrine[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    document.title = `Produtos · ${loja.nome}`;
    chamar<ItemVitrine[]>("/api/produtos")
      .then(setItens)
      .catch((e: Error) => setErro(e.message));
  }, [loja.nome]);
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 md:py-14">
      <p className="font-mono text-xs tracking-widest text-laranja-2">CUIDADO MASCULINO</p>
      <h1 className="mt-1 font-display text-5xl leading-none font-extrabold uppercase md:text-6xl">
        Produtos<span className="text-laranja">.</span>
      </h1>
      {erro && <p className="mt-6 text-alerta">{erro}</p>}
      {!itens ? (
        <p className="mt-6 text-suave">Carregando…</p>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((p) => (
            <li key={p.id}>
              <a href={p.url} className="group grid gap-3 rounded-[22px] border border-linha bg-cartao p-3 hover:border-laranja">
                <img src={p.foto} alt="" className="aspect-square w-full rounded-2xl object-cover" loading="lazy" />
                <span className="px-1">
                  <span className="block font-display text-2xl leading-tight font-extrabold uppercase">{p.nome}</span>
                  {p.chamada && <span className="mt-1 block text-sm text-tinta-2">{p.chamada}</span>}
                  <span className="mt-2 block font-mono font-bold">
                    <span className="mr-1 text-xs font-normal text-suave">a partir de</span>
                    {reais(p.a_partir_de_centavos)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
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
