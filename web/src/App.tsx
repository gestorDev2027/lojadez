import { useEffect, useState } from "react";
import { chamar, type Loja } from "./api";
import { PaginaLoja } from "./paginas/Loja";
import { PaginaObrigado } from "./paginas/Obrigado";
import { PaginaVendedor } from "./paginas/Vendedor";

// Três páginas, escolhidas pelo endereço: a loja (/), a volta do pagamento (/obrigado) e o vendedor (/vendedor).
export function App() {
  const [loja, setLoja] = useState<Loja | null>(null);
  const [erro, setErro] = useState("");
  const caminho = window.location.pathname.replace(/\/+$/, "") || "/";

  useEffect(() => {
    chamar<Loja>("/api/loja")
      .then((l) => {
        setLoja(l);
        document.title = caminho === "/vendedor" ? `Pedidos · ${l.nome}` : `${l.produto.nome} · ${l.nome}`;
      })
      .catch((e: Error) => setErro(e.message));
  }, [caminho]);

  if (erro) return <p className="p-6 text-center text-suave">{erro}</p>;
  if (!loja) return <p className="p-6 text-center text-suave">Carregando…</p>;

  return (
    <div className="min-h-dvh flex flex-col">
      <Cabecalho loja={loja} />
      <main className="flex-1">
        {caminho === "/obrigado" ? (
          <PaginaObrigado />
        ) : caminho === "/vendedor" ? (
          <PaginaVendedor />
        ) : (
          <PaginaLoja loja={loja} />
        )}
      </main>
      <Rodape loja={loja} />
    </div>
  );
}

function Cabecalho({ loja }: { loja: Loja }) {
  return (
    <header className="border-b border-linha bg-cartao">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="/" className="flex items-center gap-2 font-bold text-lg text-tinta no-underline">
          <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-escuro text-fundo">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 8h12M6 12h12M6 16h12" />
            </svg>
          </span>
          {loja.nome}
        </a>
        {loja.testes && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Ambiente de testes</span>
        )}
      </div>
    </header>
  );
}

function Rodape({ loja }: { loja: Loja }) {
  return (
    <footer className="mt-12 border-t border-linha bg-cartao">
      <div className="mx-auto grid max-w-6xl gap-2 px-4 py-6 text-sm text-suave sm:grid-cols-2">
        <p>
          <strong className="text-tinta">{loja.nome}</strong> · Pagamento por Pix ou cartão pela InfinitePay · Entrega pela Loggi
        </p>
        <p className="sm:text-right">
          Usamos seus dados só para entregar o pedido e falar com você sobre ele.
        </p>
      </div>
    </footer>
  );
}
