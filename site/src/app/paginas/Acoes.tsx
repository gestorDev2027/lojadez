import { useEffect, useRef, useState, type ReactNode } from "react";

// Peças de ação do painel: o menu "⋯" de cada linha e a janela de confirmação (para excluir e outras ações que
// não voltam atrás).

export type Acao = { rotulo: string; aoEscolher: () => void; perigo?: boolean; desligada?: boolean };

/** O botão "⋯" com as ações de uma linha. O clique não abre a linha da tabela por baixo. */
export function MenuAcoes({ acoes, rotulo = "Ações" }: { acoes: Acao[]; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => caixa.current && !caixa.current.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="grid size-9 place-items-center rounded-lg text-lg leading-none text-tinta-2 hover:bg-white/[.07] hover:text-tinta focus-visible:outline-2 focus-visible:outline-laranja"
      >
        ⋯
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-44 overflow-hidden rounded-xl border border-linha-2 bg-fundo py-1 shadow-2xl shadow-black/50">
          {acoes.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              role="menuitem"
              disabled={a.desligada}
              onClick={() => {
                setAberto(false);
                a.aoEscolher();
              }}
              className={`block w-full px-4 py-2.5 text-left text-sm disabled:opacity-40 ${
                a.perigo ? "text-alerta hover:bg-alerta/10" : "text-tinta hover:bg-white/[.06]"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A janela de confirmação. `aoConfirmar` pode demorar: o botão espera e mostra o erro, se houver. */
export function Confirmar({
  titulo,
  children,
  botao,
  perigo = false,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  children: ReactNode;
  botao: string;
  perigo?: boolean;
  aoConfirmar: () => Promise<void> | void;
  aoCancelar: () => void;
}) {
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !indo && aoCancelar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [indo, aoCancelar]);

  async function confirmar() {
    setIndo(true);
    setErro("");
    try {
      await aoConfirmar();
    } catch (falha) {
      setErro((falha as Error).message);
      setIndo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-4" onClick={() => !indo && aoCancelar()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={titulo}
        className="grid w-full gap-4 rounded-t-2xl border border-linha-2 bg-fundo p-5 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{titulo}</h2>
        <div className="grid gap-2 text-sm text-tinta-2">{children}</div>
        {erro && <p role="alert" className="text-sm text-alerta">{erro}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={indo} onClick={aoCancelar} className="rounded-xl border border-linha-2 px-4 py-2.5 text-sm font-semibold">
            Cancelar
          </button>
          <button
            type="button"
            disabled={indo}
            onClick={() => void confirmar()}
            className={
              perigo
                ? "rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
                : "btn-laranja px-5 py-2.5 text-sm"
            }
          >
            {indo ? "Aguarde…" : botao}
          </button>
        </div>
      </div>
    </div>
  );
}
