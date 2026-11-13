import { useEffect, useMemo, useState, type ReactNode } from "react";

// A tabela padrão da área do vendedor: busca em todas as colunas (sem acento), ordenar clicando no cabeçalho,
// páginas de 25/50/100, cabeçalho fixo com rolagem e "Exportar planilha" (CSV do que está filtrado, na ordem da tela).

export type ColunaTabela<T> = {
  id: string;
  rotulo: string;
  valor: (linha: T) => string | number | null | undefined; // o que a busca, a ordem e a planilha usam
  render?: (linha: T) => ReactNode; // o que a tela mostra (sem ele, o valor)
  direita?: boolean;
  ordenavel?: boolean; // padrão: sim
  naPlanilha?: boolean; // padrão: sim
  classe?: string;
};

const TAMANHOS = [25, 50, 100];
const sem = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function Tabela<T>({
  linhas,
  colunas,
  chave,
  aoClicar,
  selecionada,
  ordemInicial,
  buscaDica = "Buscar em todas as colunas",
  arquivo = "planilha",
  vazio = "Nada por aqui.",
  larguraMinima = 760,
  extras,
}: {
  linhas: T[];
  colunas: ColunaTabela<T>[];
  chave: (linha: T) => string;
  aoClicar?: (linha: T) => void;
  selecionada?: string | null;
  ordemInicial?: { coluna: string; desc: boolean };
  buscaDica?: string;
  arquivo?: string;
  vazio?: string;
  larguraMinima?: number;
  extras?: ReactNode; // filtros da tela, ao lado da busca
}) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState(ordemInicial ?? null);
  const [tamanho, setTamanho] = useState(25);
  const [pagina, setPagina] = useState(0);

  const filtradas = useMemo(() => {
    const termos = sem(busca).split(/\s+/).filter(Boolean);
    let lista = termos.length
      ? linhas.filter((l) => {
          const texto = sem(colunas.map((c) => String(c.valor(l) ?? "")).join(" "));
          const digitos = texto.replace(/\D/g, "");
          return termos.every((t) => texto.includes(t) || (/^\d{3,}$/.test(t.replace(/\D/g, "")) && digitos.includes(t.replace(/\D/g, ""))));
        })
      : linhas;
    const col = ordem && colunas.find((c) => c.id === ordem.coluna);
    if (col) {
      lista = [...lista].sort((a, b) => {
        const va = col.valor(a);
        const vb = col.valor(b);
        const r =
          typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR", { numeric: true });
        return ordem!.desc ? -r : r;
      });
    }
    return lista;
  }, [linhas, colunas, busca, ordem]);

  const paginas = Math.max(1, Math.ceil(filtradas.length / tamanho));
  useEffect(() => setPagina(0), [busca, tamanho, linhas]);
  const atual = Math.min(pagina, paginas - 1);
  const visiveis = filtradas.slice(atual * tamanho, (atual + 1) * tamanho);

  function exportar() {
    const cols = colunas.filter((c) => c.naPlanilha !== false);
    const celula = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const texto = [cols.map((c) => celula(c.rotulo)).join(";"), ...filtradas.map((l) => cols.map((c) => celula(c.valor(l))).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${arquivo}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl border border-linha bg-fundo-2/90 p-2 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {extras}
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{buscaDica}</span>
          <input className="campo py-2.5 pl-10 text-sm" placeholder={buscaDica} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-suave" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </label>
        <button
          type="button"
          onClick={exportar}
          disabled={!filtradas.length}
          className="rounded-xl border border-linha-2 bg-fundo px-3 py-2.5 text-sm font-semibold hover:border-laranja disabled:opacity-40"
          title="Baixa o que está filtrado, em CSV (abre no Excel e no Google Planilhas)"
        >
          Exportar planilha
        </button>
      </div>

      {filtradas.length === 0 ? (
        <p className="p-8 text-center text-suave">{busca ? "Nada com essa busca." : vazio}</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-linha">
          <table className="w-full text-sm" style={{ minWidth: larguraMinima }}>
            <thead className="sticky top-0 z-10 bg-fundo-2">
              <tr className="text-left font-mono text-[11px] tracking-[.12em] text-suave uppercase">
                {colunas.map((c) => {
                  const ativa = ordem?.coluna === c.id;
                  return (
                    <th key={c.id} className={`border-b border-linha px-3 py-2.5 font-semibold ${c.direita ? "text-right" : ""}`} aria-sort={ativa ? (ordem!.desc ? "descending" : "ascending") : undefined}>
                      {c.ordenavel === false ? (
                        c.rotulo
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOrdem(ativa ? { coluna: c.id, desc: !ordem!.desc } : { coluna: c.id, desc: false })}
                          className={`inline-flex items-center gap-1 uppercase hover:text-tinta ${ativa ? "text-laranja-2" : ""}`}
                        >
                          {c.rotulo}
                          <span aria-hidden className="text-[9px]">{ativa ? (ordem!.desc ? "▼" : "▲") : "↕"}</span>
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const k = chave(l);
                return (
                  <tr
                    key={k}
                    onClick={aoClicar ? () => aoClicar(l) : undefined}
                    aria-selected={selecionada === k || undefined}
                    className={`border-t border-linha first:border-t-0 ${aoClicar ? "cursor-pointer" : ""} ${selecionada === k ? "bg-laranja/10" : aoClicar ? "hover:bg-white/[.03]" : ""}`}
                  >
                    {colunas.map((c) => (
                      <td key={c.id} className={`px-3 py-2.5 align-top ${c.direita ? "text-right" : ""} ${c.classe ?? ""}`}>
                        {c.render ? c.render(l) : String(c.valor(l) ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-suave">
        <span>
          {filtradas.length === linhas.length ? `${linhas.length}` : `${filtradas.length} de ${linhas.length}`} {linhas.length === 1 ? "linha" : "linhas"}
          {filtradas.length > tamanho && ` · página ${atual + 1} de ${paginas}`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="sr-only">Linhas por página</span>
            <select value={tamanho} onChange={(e) => setTamanho(Number(e.target.value))} className="rounded-lg border border-linha-2 bg-fundo px-2 py-1 text-tinta">
              {TAMANHOS.map((t) => (
                <option key={t} value={t}>
                  {t} por página
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={atual === 0} onClick={() => setPagina(0)} className="rounded-lg border border-linha-2 px-2 py-1 disabled:opacity-30" aria-label="Primeira página">
            «
          </button>
          <button type="button" disabled={atual === 0} onClick={() => setPagina(atual - 1)} className="rounded-lg border border-linha-2 px-2.5 py-1 disabled:opacity-30">
            Anterior
          </button>
          <button type="button" disabled={atual >= paginas - 1} onClick={() => setPagina(atual + 1)} className="rounded-lg border border-linha-2 px-2.5 py-1 disabled:opacity-30">
            Próxima
          </button>
          <button
            type="button"
            disabled={atual >= paginas - 1}
            onClick={() => setPagina(paginas - 1)}
            className="rounded-lg border border-linha-2 px-2 py-1 disabled:opacity-30"
            aria-label="Última página"
          >
            »
          </button>
        </div>
      </div>
    </section>
  );
}
