import { useEffect, useState } from "react";
import { chamar, reais } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { Cartao } from "./VendedorPainel";

// A aba "Repasses": todo pagamento entra na conta da loja; aqui a loja controla quanto deve a cada afiliado e
// registra os Pix feitos (fora da loja). Comissão: a liberar (prazo de devolução) → disponível → paga.

type Somas = { a_liberar: number; disponivel: number; paga: number; cancelada: number };
export type LinhaComissao = {
  order_nsu: string;
  criado_em: string;
  cliente: string;
  produto: string;
  valor_centavos: number;
  comissao_centavos: number;
  comissao_pct: number | null;
  situacao: "a_liberar" | "disponivel" | "paga" | "cancelada";
  situacao_rotulo: string;
  liberada_em: string;
  repasse_id: number | null;
  reembolsado_depois: boolean;
};
type AfiliadoSaldo = {
  id: number;
  nome: string;
  codigo: string;
  chave_pix: string | null;
  ativo: boolean;
  somas: Somas;
  vendas: number;
  ultimo_repasse: string | null;
  proxima_liberacao: string | null;
  disponiveis: LinhaComissao[];
  reembolsados_depois: number;
};
export type Repasse = {
  id: number;
  afiliado_id: number;
  afiliado_nome: string;
  afiliado_codigo: string;
  valor_centavos: number;
  pedidos: string[];
  vendas: number;
  pago_em: string;
  chave_pix: string | null;
  observacao: string | null;
  criado_por: string | null;
};
type Resumo = {
  dias_liberacao: number;
  totais: Somas & { pago_mes: number; repasses: number };
  afiliados: AfiliadoSaldo[];
  historico: Repasse[];
};

export const dataBr = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR") : "—");
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const CORES_SITUACAO: Record<string, string> = {
  a_liberar: "bg-sky-400/15 text-sky-300",
  disponivel: "bg-ok/15 text-ok",
  paga: "bg-white/10 text-tinta-2",
  cancelada: "bg-red-400/15 text-red-300",
};

export function AbaRepasses({ senha }: { senha: string }) {
  const [dados, setDados] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [pagando, setPagando] = useState<AfiliadoSaldo | null>(null);
  const [comprovante, setComprovante] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");

  async function carregar() {
    try {
      setDados(await chamar<Resumo>("/api/vendedor/repasses", { senha }));
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senha]);

  async function desfazer(r: Repasse) {
    if (!window.confirm(`Desfazer o repasse de ${reais(r.valor_centavos)} para ${r.afiliado_nome}? As comissões voltam a ficar disponíveis.`)) return;
    try {
      await chamar(`/api/vendedor/repasses/${r.id}`, { metodo: "DELETE", senha });
      setAviso("Repasse desfeito.");
      void carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const colunasAfiliados: ColunaTabela<AfiliadoSaldo>[] = [
    {
      id: "afiliado",
      rotulo: "Afiliado",
      valor: (a) => `${a.nome} ${a.codigo}`,
      render: (a) => (
        <>
          <span className="block font-semibold">{a.nome}</span>
          <span className="font-mono text-xs text-suave">{a.codigo}</span>
        </>
      ),
    },
    {
      id: "pix",
      rotulo: "Chave Pix",
      valor: (a) => a.chave_pix ?? "",
      render: (a) => (a.chave_pix ? <span className="font-mono text-xs">{a.chave_pix}</span> : <span className="text-xs text-amber-300">sem chave</span>),
    },
    {
      id: "a_liberar",
      rotulo: "A liberar",
      direita: true,
      valor: (a) => a.somas.a_liberar / 100,
      render: (a) => (
        <span className="font-mono text-sky-300">
          {reais(a.somas.a_liberar)}
          {a.proxima_liberacao && <span className="block text-[10px] text-suave">libera {dataBr(a.proxima_liberacao)}</span>}
        </span>
      ),
    },
    {
      id: "disponivel",
      rotulo: "Disponível",
      direita: true,
      valor: (a) => a.somas.disponivel / 100,
      render: (a) => <span className="font-mono font-bold text-ok">{reais(a.somas.disponivel)}</span>,
    },
    { id: "paga", rotulo: "Já pago", direita: true, valor: (a) => a.somas.paga / 100, render: (a) => <span className="font-mono">{reais(a.somas.paga)}</span> },
    { id: "ultimo", rotulo: "Último repasse", valor: (a) => a.ultimo_repasse ?? "", render: (a) => <span className="font-mono text-xs">{dataBr(a.ultimo_repasse)}</span> },
    {
      id: "acao",
      rotulo: "",
      ordenavel: false,
      naPlanilha: false,
      valor: () => "",
      render: (a) => (
        <span className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={a.somas.disponivel <= 0}
            onClick={(e) => {
              e.stopPropagation();
              setPagando(a);
            }}
            className="btn-laranja px-4 py-2 text-xs disabled:opacity-30"
          >
            Pagar
          </button>
          {a.reembolsados_depois > 0 && <span className="text-[10px] text-amber-300">{a.reembolsados_depois} reembolsada(s) depois de paga</span>}
        </span>
      ),
    },
  ];

  const colunasHistorico: ColunaTabela<Repasse>[] = [
    { id: "data", rotulo: "Data do Pix", valor: (r) => r.pago_em, render: (r) => <span className="font-mono text-xs">{dataBr(r.pago_em)}</span> },
    { id: "afiliado", rotulo: "Afiliado", valor: (r) => `${r.afiliado_nome} ${r.afiliado_codigo}` },
    { id: "valor", rotulo: "Valor", direita: true, valor: (r) => r.valor_centavos / 100, render: (r) => <span className="font-mono font-bold">{reais(r.valor_centavos)}</span> },
    { id: "vendas", rotulo: "Vendas", direita: true, valor: (r) => r.vendas },
    { id: "pix", rotulo: "Chave Pix", valor: (r) => r.chave_pix ?? "", render: (r) => <span className="font-mono text-xs">{r.chave_pix ?? "—"}</span> },
    { id: "obs", rotulo: "Observação", valor: (r) => r.observacao ?? "", render: (r) => <span className="text-xs text-tinta-2">{r.observacao ?? "—"}</span> },
    { id: "por", rotulo: "Registrado por", valor: (r) => r.criado_por ?? "", render: (r) => <span className="font-mono text-[11px] text-suave">{r.criado_por ?? "—"}</span> },
    {
      id: "acoes",
      rotulo: "",
      ordenavel: false,
      naPlanilha: false,
      valor: () => "",
      render: (r) => (
        <span className="flex justify-end gap-2">
          <button type="button" onClick={() => setComprovante(r.id)} className="rounded-lg border border-linha-2 px-2.5 py-1 text-xs font-semibold">
            Comprovante
          </button>
          <button type="button" onClick={() => void desfazer(r)} className="rounded-lg px-2 py-1 text-xs text-suave hover:text-alerta">
            Desfazer
          </button>
        </span>
      ),
    },
  ];

  const t = dados?.totais;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Repasses aos afiliados</h1>
        <p className="mt-1 text-sm text-suave">
          Todo pagamento entra na conta da loja. A comissão fica “a liberar” por {dados?.dias_liberacao ?? 7} dias (o prazo de devolução) e depois
          fica disponível. Você faz o Pix no app do banco e registra aqui.
        </p>
      </div>
      {aviso && <p role="status" className="text-ok">{aviso}</p>}
      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {!dados || !t ? (
        <p className="text-suave">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao rotulo="Disponível para pagar" valor={reais(t.disponivel)} selo={`${dados.afiliados.filter((a) => a.somas.disponivel > 0).length} afiliado(s)`} tom="ok">
              já passou do prazo de devolução
            </Cartao>
            <Cartao rotulo="A liberar" valor={reais(t.a_liberar)} selo={`prazo de ${dados.dias_liberacao} dias`} tom="neutro">
              vendas pagas ainda no prazo de devolução
            </Cartao>
            <Cartao rotulo="Pago no mês" valor={reais(t.pago_mes)} selo={`${t.repasses} repasse(s) no total`} tom="destaque">
              registrado nesta tela
            </Cartao>
            <Cartao rotulo="Total já pago" valor={reais(t.paga)} selo={`${reais(t.cancelada)} cancelado`} tom="neutro">
              comissões canceladas por reembolso não entram
            </Cartao>
          </div>

          <h2 className="mt-2 font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">Saldo por afiliado</h2>
          <Tabela
            linhas={dados.afiliados}
            colunas={colunasAfiliados}
            chave={(a) => String(a.id)}
            ordemInicial={{ coluna: "disponivel", desc: true }}
            buscaDica="Buscar afiliado ou chave Pix"
            arquivo="repasses-saldos"
            vazio="Nenhum afiliado ainda."
            larguraMinima={900}
          />

          <h2 className="mt-2 font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">Histórico de repasses</h2>
          <Tabela
            linhas={dados.historico}
            colunas={colunasHistorico}
            chave={(r) => String(r.id)}
            ordemInicial={{ coluna: "data", desc: true }}
            buscaDica="Buscar no histórico"
            arquivo="repasses"
            vazio="Nenhum repasse registrado ainda."
            larguraMinima={900}
          />
        </>
      )}
      {pagando && (
        <JanelaPagar
          senha={senha}
          afiliado={pagando}
          aoFechar={(feito) => {
            setPagando(null);
            if (feito) {
              setAviso(`Repasse registrado para ${pagando.nome}.`);
              setComprovante(feito);
              void carregar();
            }
          }}
        />
      )}
      {comprovante !== null && <Comprovante senha={senha} id={comprovante} aoFechar={() => setComprovante(null)} />}
    </div>
  );
}

function JanelaPagar({ senha, afiliado, aoFechar }: { senha: string; afiliado: AfiliadoSaldo; aoFechar: (repasseId?: number) => void }) {
  const [escolhidas, setEscolhidas] = useState<string[]>(afiliado.disponiveis.map((d) => d.order_nsu));
  const [pagoEm, setPagoEm] = useState(hoje());
  const [observacao, setObservacao] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const total = afiliado.disponiveis.filter((d) => escolhidas.includes(d.order_nsu)).reduce((s, d) => s + d.comissao_centavos, 0);

  async function registrar() {
    setErro("");
    setSalvando(true);
    try {
      const r = await chamar<Repasse>("/api/vendedor/repasses", {
        senha,
        corpo: { afiliado_id: afiliado.id, pedidos: escolhidas, pago_em: pagoEm, observacao },
      });
      aoFechar(r.id);
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => aoFechar()}>
      <div role="dialog" aria-modal="true" aria-label="Pagar afiliado" className="grid max-h-[90vh] w-full max-w-lg gap-4 overflow-y-auto rounded-2xl border border-linha-2 bg-fundo p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] text-suave uppercase">Repasse</p>
          <h2 className="text-xl font-bold">{afiliado.nome}</h2>
        </div>
        <div className="rounded-xl border border-ok/40 bg-ok/[.06] p-4">
          <p className="text-sm text-tinta-2">Valor a pagar</p>
          <p className="text-3xl font-extrabold text-ok">{reais(total)}</p>
          <p className="mt-2 text-sm text-tinta-2">Chave Pix</p>
          {afiliado.chave_pix ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-fundo-2 px-2 py-1.5 font-mono text-sm">{afiliado.chave_pix}</code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(afiliado.chave_pix ?? "").catch(() => undefined);
                  setCopiado(true);
                  window.setTimeout(() => setCopiado(false), 2000);
                }}
                className="rounded-lg border border-laranja/60 px-3 py-1.5 text-xs font-bold text-laranja-2"
              >
                {copiado ? "Copiada" : "Copiar"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-amber-300">Este afiliado não tem chave Pix. Cadastre na ficha dele antes de pagar.</p>
          )}
        </div>
        <ol className="ml-4 list-decimal space-y-1 text-sm text-tinta-2">
          <li>No app do banco da Shefa, faça um Pix de {reais(total)} para a chave acima.</li>
          <li>Volte aqui e clique em “Marcar como pago”.</li>
        </ol>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-semibold">Vendas incluídas</legend>
          {afiliado.disponiveis.map((d) => (
            <label key={d.order_nsu} className="flex items-center justify-between gap-2 rounded-lg border border-linha-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={escolhidas.includes(d.order_nsu)}
                  onChange={(e) => setEscolhidas(e.target.checked ? [...escolhidas, d.order_nsu] : escolhidas.filter((x) => x !== d.order_nsu))}
                  className="size-4 accent-laranja"
                />
                <span>
                  {dataBr(d.criado_em)} · {d.cliente} · <span className="text-suave">{d.produto}</span>
                </span>
              </span>
              <span className="font-mono font-bold">{reais(d.comissao_centavos)}</span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">
            Data do Pix
            <input type="date" className="campo [color-scheme:dark]" max={hoje()} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Observação (opcional)
            <input className="campo" maxLength={300} placeholder="ex.: Pix pelo app do banco" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </label>
        </div>
        {erro && <p role="alert" className="text-sm text-alerta">{erro}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={salvando || !escolhidas.length} onClick={() => void registrar()} className="btn-laranja flex-1 px-5 py-3 text-sm">
            {salvando ? "Registrando…" : "Marcar como pago"}
          </button>
          <button type="button" onClick={() => aoFechar()} className="rounded-full border border-linha-2 px-5 py-3 text-sm">
            Cancelar
          </button>
        </div>
        <p className="text-xs text-suave">A loja não envia dinheiro: ela só registra o Pix que você fez.</p>
      </div>
    </div>
  );
}

type DadosComprovante = {
  repasse: Repasse;
  loja: string;
  empresa: { razaoSocial: string; cnpj: string; email: string };
  vendas: LinhaComissao[];
};

export function Comprovante({ senha, id, aoFechar }: { senha: string; id: number; aoFechar: () => void }) {
  const [dados, setDados] = useState<DadosComprovante | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    chamar<DadosComprovante>(`/api/vendedor/repasses/${id}`, { senha })
      .then(setDados)
      .catch((e: Error) => setErro(e.message));
  }, [senha, id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 print:static print:block print:bg-white print:p-0" onClick={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Comprovante de repasse"
        className="comprovante grid max-h-[90vh] w-full max-w-xl gap-4 overflow-y-auto rounded-2xl bg-white p-6 text-zinc-900 print:max-h-none print:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        {!dados ? (
          <p>{erro || "Carregando…"}</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">Comprovante de repasse de comissão</p>
                <h2 className="text-2xl font-extrabold">{dados.loja}</h2>
                {(dados.empresa.razaoSocial || dados.empresa.cnpj) && (
                  <p className="text-sm text-zinc-600">
                    {dados.empresa.razaoSocial} {dados.empresa.cnpj && `· CNPJ ${dados.empresa.cnpj}`}
                  </p>
                )}
              </div>
              <p className="font-mono text-sm text-zinc-500">Nº {String(dados.repasse.id).padStart(5, "0")}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-zinc-200 p-4 text-sm">
              <dt className="text-zinc-500">Afiliado</dt>
              <dd className="font-semibold">{dados.repasse.afiliado_nome}</dd>
              <dt className="text-zinc-500">Chave Pix</dt>
              <dd className="font-mono">{dados.repasse.chave_pix ?? "—"}</dd>
              <dt className="text-zinc-500">Data do Pix</dt>
              <dd>{dataBr(dados.repasse.pago_em)}</dd>
              <dt className="text-zinc-500">Valor</dt>
              <dd className="text-lg font-extrabold">{reais(dados.repasse.valor_centavos)}</dd>
              {dados.repasse.observacao && (
                <>
                  <dt className="text-zinc-500">Observação</dt>
                  <dd>{dados.repasse.observacao}</dd>
                </>
              )}
            </dl>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-xs text-zinc-500 uppercase">
                  <th className="py-1.5">Venda</th>
                  <th className="py-1.5">Produto</th>
                  <th className="py-1.5 text-right">Valor</th>
                  <th className="py-1.5 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {dados.vendas.map((v) => (
                  <tr key={v.order_nsu} className="border-b border-zinc-100">
                    <td className="py-1.5">
                      {dataBr(v.criado_em)} · {v.cliente}
                    </td>
                    <td className="py-1.5 text-zinc-600">{v.produto}</td>
                    <td className="py-1.5 text-right">{reais(v.valor_centavos)}</td>
                    <td className="py-1.5 text-right font-semibold">
                      {reais(v.comissao_centavos)} {v.comissao_pct ? <span className="text-xs text-zinc-500">({v.comissao_pct}%)</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-zinc-500">Comissão calculada sobre os produtos, sem o frete. Documento gerado pela área do vendedor.</p>
            <div className="flex gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="flex-1 rounded-full bg-zinc-900 px-5 py-3 text-sm font-bold text-white">
                Imprimir ou salvar PDF
              </button>
              <button type="button" onClick={aoFechar} className="rounded-full border border-zinc-300 px-5 py-3 text-sm">
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
