import { useEffect, useState } from "react";
import { chamar, vitrineDoProduto, type Loja, type ProdutoPublico } from "../api";
import { PaginaCheckout } from "./Checkout";

// O checkout de um produto do catálogo (/checkout?produto=<slug>). A vitrine (/produtos) e a página de cada produto
// (/p/<slug>) são páginas Astro (src/pages); o kit de lâminas tem a landing page própria (/).

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
