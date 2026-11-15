import { useEffect, useMemo, useState, type ReactNode } from "react";
import { chamar, reais } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { Cartao, SeletorPeriodo, dataCurta, periodoInicial, type Periodo } from "./VendedorPainel";
import { dataBr } from "./VendedorRepasses";

// O financeiro: do que o cliente pagou até o resultado do período (frete da Loggi, taxas da InfinitePay, comissões e,
// se informado, o custo dos produtos), por dia ou mês, por produto e por forma de pagamento, com planilha para o contador.

type Total = {
  produtos: number;
  cupom: number;
  pix: number;
  frete_cobrado: number;
  faturamento: number;
  reembolsos: number;
  receita: number;
  frete_loja: number;
  frete_gratis: number;
  taxas: number;
  comissoes: number;
  custo_produtos: number;
  custos: number;
  resultado: number;
  margem_pct: number | null;
  pedidos: number;
};
type LinhaPedido = {
  order_nsu: string;
  data: string;
  produto: string;
  quantidade: string;
  forma: string;
  parcelas: number;
  situacao: string;
  afiliado: string | null;
  faturamento: number;
  reembolsos: number;
  frete_loja: number;
  taxas: number;
  comissoes: number;
  custo_produtos: number;
  resultado: number;
  frete_gratis: boolean;
  sem_custo: boolean;
};
type Financeiro = {
  periodo: { de: string; ate: string; dias: number };
  total: Total;
  variacao: Record<"receita" | "custos" | "resultado" | "margem_pct" | "pedidos", number | null>;
  agrupamento: "dia" | "mes";
  serie: { chave: string; receita: number; resultado: number; pedidos: number }[];
  por_produto: { id: string; nome: string; pedidos: number; receita: number; custos: number; resultado: number; margem_pct: number | null; tem_custo: boolean }[];
  por_forma: { id: string; nome: string; taxa_pct: number; pedidos: number; valor: number; taxas: number }[];
  comissoes: { geradas: number; repassadas: number; a_pagar: number };
  pedidos: LinhaPedido[];
  taxas: { pix: number; cartao: number; parcelado: number; configuradas: boolean };
  custos_configurados: boolean;
  vendas_sem_custo: number;
};
type Custo = { id: string; nome: string; unidade: string; custo_centavos: number | null };

const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloSerie = (chave: string, agrupamento: "dia" | "mes") =>
  agrupamento === "mes" ? `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}` : dataCurta(chave);
const SITUACAO: Record<string, string> = { pago: "Pago", enviado: "Enviado", reembolso_pendente: "Reembolso pendente", reembolsado: "Reembolsado" };

export function AbaFinanceiro({ senha, aoIrPara }: { senha: string; aoIrPara: (aba: "configuracoes" | "repasses") => void }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  const [dados, setDados] = useState<Financeiro | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    setCarregando(true);
    setErro("");
    chamar<Financeiro>(`/api/vendedor/financeiro?${new URLSearchParams(periodo)}`, { senha })
      .then(setDados)
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [senha, periodo, versao]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Financeiro</h1>
          <p className="mt-1 text-sm text-suave">Do que os clientes pagaram até o que sobra para a loja, no período.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />
          {dados && (
            <button type="button" onClick={() => baixarDemonstrativo(dados)} className="rounded-xl border border-linha-2 bg-fundo-2 px-3 py-2 text-sm font-semibold hover:border-laranja">
              Baixar demonstrativo
            </button>
          )}
        </div>
      </div>

      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {!dados ? (
        <p className="text-suave">Carregando…</p>
      ) : (
        <div className={`grid grid-cols-[minmax(0,1fr)] gap-5 transition-opacity ${carregando ? "opacity-60" : ""}`}>
          {!dados.taxas.configuradas && (
            <Aviso>
              As <strong>taxas da InfinitePay</strong> estão em 0%: o resultado sai maior do que é. Veja as suas no app da InfinitePay (Taxas) e
              preencha em{" "}
              <button type="button" onClick={() => aoIrPara("configuracoes")} className="font-bold text-laranja-2 underline-offset-4 hover:underline">
                Configurações → Financeiro
              </button>
              .
            </Aviso>
          )}
          {dados.vendas_sem_custo > 0 && (
            <Aviso>
              {dados.vendas_sem_custo} {dados.vendas_sem_custo === 1 ? "venda" : "vendas"} sem o <strong>custo do produto</strong>: o resultado
              não desconta quanto a mercadoria custou. Informe em <strong>Custo dos produtos</strong>, no fim da página.
            </Aviso>
          )}

          <Indicadores dados={dados} />

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Demonstrativo dados={dados} />
            <Serie dados={dados} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <PorProduto dados={dados} />
            <div className="grid content-start gap-5">
              <PorForma dados={dados} aoIrPara={aoIrPara} />
              <Comissoes dados={dados} aoIrPara={aoIrPara} />
            </div>
          </div>

          <Painel titulo="Vendas do período" extra={<span className="font-mono text-[11px] text-suave">{dados.pedidos.length} pedidos pagos</span>}>
            <Tabela
              linhas={dados.pedidos}
              colunas={COLUNAS}
              chave={(l) => l.order_nsu}
              ordemInicial={{ coluna: "data", desc: true }}
              arquivo={`financeiro-vendas-${dados.periodo.de}-a-${dados.periodo.ate}`}
              vazio="Nenhuma venda paga no período."
              larguraMinima={1080}
            />
          </Painel>

          <CustosDosProdutos senha={senha} aoSalvar={() => setVersao((v) => v + 1)} />
        </div>
      )}
    </div>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <span aria-hidden className="mr-2">⚠</span>
      {children}
    </p>
  );
}

function Painel({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-linha bg-fundo-2/90 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">{titulo}</h2>
        {extra}
      </header>
      {children}
    </section>
  );
}

// ───────── Indicadores ─────────

function Indicadores({ dados }: { dados: Financeiro }) {
  const t = dados.total;
  const v = dados.variacao;
  const variacao = (n: number | null, pontos = false) =>
    n === null ? "sem base anterior" : `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${pontos ? " p.p." : "%"} vs. anterior`;
  const tom = (n: number | null, bomSubir = true) => (n === null ? "neutro" : (n >= 0) === bomSubir ? "ok" : "alerta");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Cartao rotulo="Receita" valor={reais(t.receita)} selo={variacao(v.receita)} tom={tom(v.receita)}>
        pago pelos clientes ({reais(t.faturamento)}) − reembolsos ({reais(t.reembolsos)}) · {t.pedidos} {t.pedidos === 1 ? "pedido" : "pedidos"}
      </Cartao>
      <Cartao rotulo="Custos" valor={reais(t.custos)} selo={t.receita ? `${pct(Math.round((t.custos / t.receita) * 1000) / 10)} da receita` : "—"} tom="destaque">
        frete {reais(t.frete_loja)} · taxas {reais(t.taxas)} · comissões {reais(t.comissoes)}
        {t.custo_produtos > 0 && ` · produtos ${reais(t.custo_produtos)}`}
      </Cartao>
      <Cartao rotulo="Resultado" valor={reais(t.resultado)} selo={variacao(v.resultado)} tom={t.resultado < 0 ? "alerta" : tom(v.resultado)}>
        o que sobra para a loja {dados.custos_configurados ? "depois do custo dos produtos" : "(sem o custo dos produtos)"}
      </Cartao>
      <Cartao rotulo="Margem" valor={pct(t.margem_pct)} selo={variacao(v.margem_pct, true)} tom={tom(v.margem_pct)}>
        resultado ÷ receita
      </Cartao>
    </div>
  );
}

// ───────── O demonstrativo ─────────

function linhasDemonstrativo(t: Total, custos: boolean): { rotulo: string; valor: number; tipo: "mais" | "menos" | "total" | "detalhe" }[] {
  return [
    { rotulo: "Vendas de produtos", valor: t.produtos, tipo: "mais" },
    { rotulo: "Descontos de cupons", valor: -t.cupom, tipo: "menos" },
    { rotulo: "Desconto no Pix", valor: -t.pix, tipo: "menos" },
    { rotulo: "Frete cobrado dos clientes", valor: t.frete_cobrado, tipo: "mais" },
    { rotulo: "Pago pelos clientes", valor: t.faturamento, tipo: "total" },
    { rotulo: "Reembolsos", valor: -t.reembolsos, tipo: "menos" },
    { rotulo: "Receita", valor: t.receita, tipo: "total" },
    { rotulo: "Frete pago à Loggi", valor: -t.frete_loja, tipo: "menos" },
    { rotulo: "dos fretes grátis", valor: -t.frete_gratis, tipo: "detalhe" },
    { rotulo: "Taxas da InfinitePay", valor: -t.taxas, tipo: "menos" },
    { rotulo: "Comissões dos afiliados", valor: -t.comissoes, tipo: "menos" },
    ...(custos ? [{ rotulo: "Custo dos produtos", valor: -t.custo_produtos, tipo: "menos" as const }] : []),
    { rotulo: "Resultado", valor: t.resultado, tipo: "total" },
  ];
}

function Demonstrativo({ dados }: { dados: Financeiro }) {
  const linhas = linhasDemonstrativo(dados.total, dados.custos_configurados);
  return (
    <Painel titulo="Demonstrativo" extra={<span className="font-mono text-[11px] text-suave">{dataBr(dados.periodo.de)} – {dataBr(dados.periodo.ate)}</span>}>
      <dl className="grid text-sm">
        {linhas.map((l) => (
          <div
            key={l.rotulo}
            className={`flex items-center justify-between gap-3 py-1.5 ${
              l.tipo === "total" ? "mt-1 border-t border-linha-2 pt-2 font-bold" : l.tipo === "detalhe" ? "pl-5 text-xs text-suave" : ""
            }`}
          >
            <dt className={l.tipo === "total" ? "text-tinta" : "text-tinta-2"}>
              {l.tipo === "menos" ? "− " : l.tipo === "mais" ? "+ " : l.tipo === "detalhe" ? "↳ " : "= "}
              {l.rotulo}
            </dt>
            <dd className={`font-mono ${l.tipo === "total" ? (l.valor < 0 ? "text-red-300" : "text-tinta") : l.valor < 0 ? "text-tinta-2" : ""}`}>
              {reais(Math.abs(l.valor))}
            </dd>
          </div>
        ))}
      </dl>
    </Painel>
  );
}

// ───────── Por dia ou mês ─────────

function Serie({ dados }: { dados: Financeiro }) {
  const maior = useMemo(() => Math.max(1, ...dados.serie.map((s) => Math.max(s.receita, Math.abs(s.resultado)))), [dados.serie]);
  const pulo = Math.max(1, Math.ceil(dados.serie.length / 12));
  return (
    <Painel
      titulo={dados.agrupamento === "mes" ? "Por mês" : "Por dia"}
      extra={
        <span className="flex items-center gap-3 font-mono text-[11px] text-suave">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-zinc-500" /> receita
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-laranja" /> resultado
          </span>
        </span>
      }
    >
      <div className="flex h-56 items-end gap-[3px] border-b border-linha-2" role="img" aria-label="Receita e resultado no período">
        {dados.serie.map((s) => (
          <div
            key={s.chave}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
            title={`${rotuloSerie(s.chave, dados.agrupamento)} · receita ${reais(s.receita)} · resultado ${reais(s.resultado)} · ${s.pedidos} pedido(s)`}
          >
            <span className="absolute bottom-0 w-full rounded-t bg-zinc-600/80 group-hover:bg-zinc-500" style={{ height: `${(s.receita / maior) * 100}%` }} />
            <span
              className={`absolute bottom-0 w-[55%] rounded-t ${s.resultado < 0 ? "bg-red-400" : "bg-gradient-to-t from-laranja-3 to-laranja-2"}`}
              style={{ height: `${s.resultado ? Math.max(1.5, (Math.abs(s.resultado) / maior) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {dados.serie.map((s, i) => (
          <span key={s.chave} className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-suave">
            {i % pulo === 0 ? rotuloSerie(s.chave, dados.agrupamento) : ""}
          </span>
        ))}
      </div>
    </Painel>
  );
}

// ───────── Por produto, forma de pagamento e comissões ─────────

function PorProduto({ dados }: { dados: Financeiro }) {
  return (
    <Painel titulo="Por produto">
      {dados.por_produto.length === 0 ? (
        <p className="py-6 text-center text-sm text-suave">Nenhuma venda no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] tracking-wider text-suave uppercase">
                <th className="py-2 font-semibold">Produto</th>
                <th className="py-2 text-right font-semibold">Pedidos</th>
                <th className="py-2 text-right font-semibold">Receita</th>
                <th className="py-2 text-right font-semibold">Custos</th>
                <th className="py-2 text-right font-semibold">Resultado</th>
                <th className="py-2 text-right font-semibold">Margem</th>
              </tr>
            </thead>
            <tbody>
              {dados.por_produto.map((p) => (
                <tr key={p.id} className="border-t border-linha">
                  <td className="py-2.5 pr-3">
                    {p.nome}
                    {!p.tem_custo && <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 font-mono text-[10px] text-amber-300">sem custo</span>}
                  </td>
                  <td className="py-2.5 text-right font-mono">{p.pedidos}</td>
                  <td className="py-2.5 text-right font-mono">{reais(p.receita)}</td>
                  <td className="py-2.5 text-right font-mono text-tinta-2">{reais(p.custos)}</td>
                  <td className={`py-2.5 text-right font-mono font-bold ${p.resultado < 0 ? "text-red-300" : ""}`}>{reais(p.resultado)}</td>
                  <td className="py-2.5 text-right font-mono">{pct(p.margem_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}

function PorForma({ dados, aoIrPara }: { dados: Financeiro; aoIrPara: (aba: "configuracoes") => void }) {
  return (
    <Painel
      titulo="Por forma de pagamento"
      extra={
        <button type="button" onClick={() => aoIrPara("configuracoes")} className="text-xs text-laranja-2 underline-offset-4 hover:underline">
          mudar as taxas
        </button>
      }
    >
      {dados.por_forma.length === 0 ? (
        <p className="py-4 text-center text-sm text-suave">Nenhuma venda no período.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {dados.por_forma.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[.03] px-3 py-2">
              <span>
                <strong>{f.nome}</strong>
                <span className="block font-mono text-[11px] text-suave">
                  {f.pedidos} {f.pedidos === 1 ? "pedido" : "pedidos"} · taxa {pct(f.taxa_pct)}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono font-bold">{reais(f.valor)}</span>
                <span className="block font-mono text-[11px] text-suave">− {reais(f.taxas)} de taxa</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
}

function Comissoes({ dados, aoIrPara }: { dados: Financeiro; aoIrPara: (aba: "repasses") => void }) {
  const c = dados.comissoes;
  return (
    <Painel
      titulo="Comissões dos afiliados"
      extra={
        <button type="button" onClick={() => aoIrPara("repasses")} className="text-xs text-laranja-2 underline-offset-4 hover:underline">
          ir para Repasses
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { rotulo: "Geradas", valor: c.geradas, cor: "" },
          { rotulo: "Repassadas", valor: c.repassadas, cor: "text-ok" },
          { rotulo: "A pagar", valor: c.a_pagar, cor: c.a_pagar ? "text-laranja-2" : "" },
        ].map((x) => (
          <div key={x.rotulo} className="rounded-xl bg-white/[.03] px-2 py-3">
            <p className="font-mono text-[10px] tracking-wider text-suave uppercase">{x.rotulo}</p>
            <p className={`mt-1 font-mono font-bold ${x.cor}`}>{reais(x.valor)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-suave">Das vendas do período. Os pagamentos entram na conta da loja; o repasse é feito por Pix.</p>
    </Painel>
  );
}

// ───────── A tabela das vendas ─────────

const dinheiro = (rotulo: string, id: keyof LinhaPedido, negativo = false): ColunaTabela<LinhaPedido> => ({
  id,
  rotulo,
  direita: true,
  valor: (l) => ((l[id] as number) / 100) * (negativo ? -1 : 1),
  render: (l) => <span className="font-mono">{(l[id] as number) ? `${negativo ? "− " : ""}${reais(l[id] as number)}` : "—"}</span>,
});

const COLUNAS: ColunaTabela<LinhaPedido>[] = [
  { id: "data", rotulo: "Data", valor: (l) => l.data, render: (l) => <span className="font-mono">{dataBr(l.data)}</span> },
  { id: "pedido", rotulo: "Pedido", valor: (l) => l.order_nsu.slice(0, 8), render: (l) => <span className="font-mono text-suave">{l.order_nsu.slice(0, 8)}</span> },
  { id: "produto", rotulo: "Produto", valor: (l) => `${l.produto} · ${l.quantidade}` },
  { id: "forma", rotulo: "Pagamento", valor: (l) => (l.parcelas > 1 ? `${l.forma} (${l.parcelas}x)` : l.forma) },
  { id: "situacao", rotulo: "Situação", valor: (l) => SITUACAO[l.situacao] ?? l.situacao },
  dinheiro("Pago", "faturamento"),
  dinheiro("Reembolso", "reembolsos", true),
  dinheiro("Frete Loggi", "frete_loja", true),
  dinheiro("Taxa", "taxas", true),
  dinheiro("Comissão", "comissoes", true),
  dinheiro("Custo", "custo_produtos", true),
  {
    id: "resultado",
    rotulo: "Resultado",
    direita: true,
    valor: (l) => l.resultado / 100,
    render: (l) => <span className={`font-mono font-bold ${l.resultado < 0 ? "text-red-300" : ""}`}>{reais(l.resultado)}</span>,
  },
];

// A planilha do demonstrativo (as linhas e os totais por produto), para o contador.
function baixarDemonstrativo(d: Financeiro) {
  const celula = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const numero = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
  const linhas: unknown[][] = [
    ["Demonstrativo", `${dataBr(d.periodo.de)} a ${dataBr(d.periodo.ate)}`],
    [],
    ["Linha", "Valor (R$)"],
    ...linhasDemonstrativo(d.total, d.custos_configurados).map((l) => [l.tipo === "detalhe" ? `  ${l.rotulo}` : l.rotulo, numero(l.valor)]),
    ["Margem (%)", d.total.margem_pct === null ? "" : String(d.total.margem_pct).replace(".", ",")],
    [],
    ["Taxas usadas (%)", `Pix ${d.taxas.pix} · cartão ${d.taxas.cartao} · parcelado ${d.taxas.parcelado}`],
    [],
    ["Produto", "Pedidos", "Receita (R$)", "Custos (R$)", "Resultado (R$)", "Margem (%)"],
    ...d.por_produto.map((p) => [p.nome, p.pedidos, numero(p.receita), numero(p.custos), numero(p.resultado), p.margem_pct ?? ""]),
  ];
  const texto = linhas.map((l) => l.map(celula).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `demonstrativo-${d.periodo.de}-a-${d.periodo.ate}.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ───────── Custo dos produtos ─────────

const paraCentavos = (texto: string) => {
  const v = Number.parseFloat(texto.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

function CustosDosProdutos({ senha, aoSalvar }: { senha: string; aoSalvar: () => void }) {
  const [custos, setCustos] = useState<Custo[] | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");

  function carregar(lista: Custo[]) {
    setCustos(lista);
    setTextos(Object.fromEntries(lista.map((c) => [c.id, c.custo_centavos === null ? "" : (c.custo_centavos / 100).toFixed(2).replace(".", ",")])));
  }

  useEffect(() => {
    chamar<{ custos: Custo[] }>("/api/vendedor/financeiro/custos", { senha })
      .then((r) => carregar(r.custos))
      .catch((e: Error) => setErro(e.message));
  }, [senha]);

  async function salvar() {
    if (!custos) return;
    const valores: Record<string, number | null> = {};
    for (const c of custos) {
      const texto = (textos[c.id] ?? "").trim();
      const centavos = texto ? paraCentavos(texto) : null;
      if (texto && centavos === null) {
        setErro(`Custo inválido em ${c.nome}.`);
        return;
      }
      valores[c.id] = centavos;
    }
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const r = await chamar<{ custos: Custo[] }>("/api/vendedor/financeiro/custos", { senha, metodo: "PUT", corpo: { custos: valores } });
      carregar(r.custos);
      setMensagem("Custos salvos.");
      aoSalvar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Painel titulo="Custo dos produtos (opcional)">
      <p className="mb-3 text-sm text-suave">
        Quanto cada unidade custa para a loja (mercadoria e embalagem). Com ele, o resultado mostra o lucro de verdade. Vazio: o produto fica
        sem custo.
      </p>
      {!custos ? (
        <p className="text-sm text-suave">{erro || "Carregando…"}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {custos.map((c) => (
              <label key={c.id} className="grid gap-1.5 text-sm font-semibold">
                <span className="truncate">
                  {c.nome} <span className="font-normal text-suave">· por {c.unidade}</span>
                </span>
                <span className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-mono text-sm text-suave">R$</span>
                  <input
                    className="campo pl-11 font-mono"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={textos[c.id] ?? ""}
                    onChange={(e) => setTextos((t) => ({ ...t, [c.id]: e.target.value }))}
                  />
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void salvar()} disabled={salvando} className="btn-laranja px-5 py-2.5 text-sm">
              {salvando ? "Salvando…" : "Salvar custos"}
            </button>
            {mensagem && <span className="text-sm text-ok">{mensagem}</span>}
            {erro && <span role="alert" className="text-sm text-alerta">{erro}</span>}
          </div>
        </>
      )}
    </Painel>
  );
}
