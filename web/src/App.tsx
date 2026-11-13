import { useEffect, useState } from "react";
import { chamar, guardarRefDaUrl, vitrineDoKit, type Loja } from "./api";
import { PaginaCheckout } from "./paginas/Checkout";
import { PaginaObrigado } from "./paginas/Obrigado";
import { CheckoutDoProduto, PaginaProduto, PaginaVitrine } from "./paginas/Produto";
import { PaginaVendedor } from "./paginas/Vendedor";

// O app React cuida do checkout (/checkout, do kit ou de um produto com ?produto=), da volta do pagamento (/obrigado), do
// vendedor (/vendedor), da vitrine (/produtos) e da página de cada produto (/p/<slug>).
// A landing page do kit de lâminas (/) é estática: public/loja.html.
export function App() {
  const [loja, setLoja] = useState<Loja | null>(null);
  const [erro, setErro] = useState("");
  const caminho = window.location.pathname.replace(/\/+$/, "") || "/";
  const produtoDoCheckout = new URLSearchParams(window.location.search).get("produto");
  const slugDaPagina = caminho.startsWith("/p/") ? decodeURIComponent(caminho.slice(3)) : "";

  useEffect(() => {
    if (caminho !== "/vendedor") guardarRefDaUrl(); // quem chegou pelo link de um afiliado
  }, [caminho]);

  useEffect(() => {
    chamar<Loja>("/api/loja")
      .then((l) => {
        setLoja(l);
        const titulo = { "/vendedor": "Pedidos", "/obrigado": "Seu pedido" }[caminho] ?? "Finalizar compra";
        document.title = `${titulo} · ${l.nome}`;
      })
      .catch((e: Error) => setErro(e.message));
  }, [caminho]);

  if (erro) return <p className="p-6 text-center text-suave">{erro}</p>;
  if (!loja) return <p className="p-6 text-center text-suave">Carregando…</p>;

  return (
    <div className="grao flex min-h-dvh flex-col">
      <Cabecalho loja={loja} />
      <main className="flex-1">
        {caminho === "/obrigado" ? (
          <PaginaObrigado loja={loja} />
        ) : caminho === "/vendedor" ? (
          <PaginaVendedor />
        ) : caminho === "/produtos" ? (
          <PaginaVitrine loja={loja} />
        ) : slugDaPagina ? (
          <PaginaProduto loja={loja} slug={slugDaPagina} />
        ) : produtoDoCheckout && produtoDoCheckout !== "kit-laminas" ? (
          <CheckoutDoProduto loja={loja} slug={produtoDoCheckout} />
        ) : (
          <PaginaCheckout loja={loja} vitrine={vitrineDoKit(loja)} />
        )}
      </main>
      <footer className="border-t border-linha">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-suave">
          <span>
            © {new Date().getFullYear()} {loja.nome}
          </span>
          <span>Seus dados são usados só para entregar o pedido e falar com você sobre ele.</span>
        </div>
      </footer>
    </div>
  );
}

export function Marca({ nome }: { nome: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="grid size-9 place-items-center rounded-[10px] border border-linha-2 bg-fundo-2">
        <span className="flex w-5 flex-col gap-[3px]">
          <i className="block h-[5px] rounded-sm bg-laranja" />
          <i className="block h-[2px] bg-aco" />
          <i className="block h-[2px] bg-aco" />
        </span>
      </span>
      <span className="font-display text-2xl font-extrabold uppercase tracking-wide">{nome}</span>
    </span>
  );
}

function Cabecalho({ loja }: { loja: Loja }) {
  return (
    <header className="sticky top-0 z-20 border-b border-linha bg-fundo/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="/" aria-label={`Voltar para a página da ${loja.nome}`}>
          <Marca nome={loja.nome} />
        </a>
        <div className="flex items-center gap-3">
          {loja.testes && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-xs font-bold text-amber-300">
              AMBIENTE DE TESTES
            </span>
          )}
          <span className="hidden items-center gap-1.5 font-mono text-xs text-suave sm:flex">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            COMPRA SEGURA
          </span>
        </div>
      </div>
    </header>
  );
}
