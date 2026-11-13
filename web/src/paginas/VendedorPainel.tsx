import { useEffect, useMemo, useState, type ReactNode } from "react";
import { chamar, reais } from "../api";

// A visão geral da área do vendedor, no estilo de um painel de execução: os indicadores do período no topo, três
// colunas de barras que detalham ao clicar (produto → quantidade → afiliado), a trilha do recorte e os pedidos embaixo.

type Grupo = { id: string | number; nome: string; valor: number; pedidos: number; unidades: number; pct: number };
type Linha = {
  order_nsu: string;
  criado_em: string | null;
  cliente: string;
  cidade: string;
  produto: string;
  quantidade: string;
  afiliado: string | null;
  valor_centavos: number;
  frete_gratis: boolean;
  forma_pagamento: string | null;
  situacao: string;
  tem_envio: boolean;
};
type Indicadores = {
  vendas_centavos: number;
  produtos_centavos: number;
  frete_cobrado_centavos: number;
  frete_loja_centavos: number;
  fretes_gratis: number;
  fretes_gratis_centavos: number;
  liquida_centavos: number;
  pedidos: number;
  ticket_medio_centavos: number;
  aguardando: number;
  aguardando_centavos: number;
  unidades: number;
};
type Painel = {
  periodo: { de: string; ate: string; dias: number };
  visao: Visao;
  indicadores: Indicadores;
  variacao: Record<keyof Indicadores, number | null>;
  por_produto: Grupo[];
  produto: string | null;
  produto_nome: string | null;
  por_quantidade: Grupo[];
  quantidade: number | null;
  por_afiliado: Grupo[];
  pedidos: Linha[];
  pedidos_total: number;
  pedidos_valor_centavos: number;
};
type Visao = "vendas" | "liquida" | "pedidos";

export const SITUACOES: Record<string, { rotulo: string; cor: string }> = {
  pago: { rotulo: "Pago", cor: "bg-ok/15 text-ok" },
  aguardando_pagamento: { rotulo: "Aguardando", cor: "bg-amber-400/15 text-amber-300" },
  enviado: { rotulo: "Enviado", cor: "bg-sky-400/15 text-sky-300" },
  cancelado: { rotulo: "Cancelado", cor: "bg-white/10 text-suave" },
  pagamento_divergente: { rotulo: "Divergente", cor: "bg-red-400/15 text-red-300" },
};

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "vendas", rotulo: "Vendas" },
  { id: "liquida", rotulo: "Receita líquida" },
  { id: "pedidos", rotulo: "Pedidos" },
];

// ───────── Período ─────────

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function atalho(id: string): { de: string; ate: string } {
  const hoje = new Date();
  const de = new Date(hoje);
  if (id === "hoje") return { de: iso(hoje), ate: iso(hoje) };
  if (id === "7d") de.setDate(hoje.getDate() - 6);
  if (id === "30d") de.setDate(hoje.getDate() - 29);
  if (id === "mes") de.setDate(1);
  if (id === "ano") de.setMonth(0, 1);
  return { de: iso(de), ate: iso(hoje) };
}
const ATALHOS = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes", rotulo: "Este mês" },
  { id: "ano", rotulo: "Este ano" },
];
const dataCurta = (texto: string) => {
  const [a, m, d] = texto.split("-");
  return `${d}/${m}${a !== String(new Date().getFullYear()) ? `/${a.slice(2)}` : ""}`;
};

// ───────── A tela ─────────

export function VisaoGeral({ senha, aoAbrirPedido }: { senha: string; aoAbrirPedido: (nsu: string) => void }) {
  const [periodoId, setPeriodoId] = useState("mes");
  const [periodo, setPeriodo] = useState(atalho("mes"));
  const [visao, setVisao] = useState<Visao>("vendas");
  const [produto, setProduto] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState<number | null>(null);
  const [dados, setDados] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams({ de: periodo.de, ate: periodo.ate, visao });
    if (produto) q.set("produto", produto);
    if (quantidade !== null) q.set("quantidade", String(quantidade));
    setCarregando(true);
    setErro("");
    chamar<Painel>(`/api/vendedor/painel?${q}`, { senha })
      .then(setDados)
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [senha, periodo, visao, produto, quantidade]);

  const formatar = (valor: number) => (visao === "pedidos" ? String(valor) : reais(valor));

  function voltarUmNivel() {
    if (quantidade !== null) setQuantidade(null);
    else setProduto(null);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {/* Título, período e visão */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Visão geral</h1>
          <p className="mt-1 text-sm text-suave">Clique numa barra para detalhar: produto → quantidade → afiliado → pedidos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl border border-linha-2 bg-fundo-2 p-1" role="group" aria-label="Período">
            {ATALHOS.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={periodoId === a.id}
                onClick={() => {
                  setPeriodoId(a.id);
                  setPeriodo(atalho(a.id));
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${periodoId === a.id ? "bg-white/10 text-tinta" : "text-suave hover:text-tinta"}`}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-linha-2 bg-fundo-2 px-2 py-1 text-sm">
            <input
              type="date"
              aria-label="De"
              value={periodo.de}
              max={periodo.ate}
              onChange={(e) => {
                setPeriodoId("");
                setPeriodo((p) => ({ ...p, de: e.target.value || p.de }));
              }}
              className="bg-transparent font-mono text-xs text-tinta [color-scheme:dark]"
            />
            <span className="text-suave">–</span>
            <input
              type="date"
              aria-label="Até"
              value={periodo.ate}
              min={periodo.de}
              onChange={(e) => {
                setPeriodoId("");
                setPeriodo((p) => ({ ...p, ate: e.target.value || p.ate }));
              }}
              className="bg-transparent font-mono text-xs text-tinta [color-scheme:dark]"
            />
          </div>
          <div className="flex rounded-xl border border-linha-2 bg-fundo-2 p-1" role="group" aria-label="Medir por">
            {VISOES.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={visao === v.id}
                onClick={() => setVisao(v.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold ${visao === v.id ? "bg-laranja text-black" : "text-tinta-2 hover:text-tinta"}`}
              >
                {v.rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Trilha do recorte */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Recorte" className="flex flex-wrap items-center gap-2 text-sm">
          <Migalha ativa={!produto} onClick={() => (setProduto(null), setQuantidade(null))}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
            </svg>
            Loja
          </Migalha>
          <Seta />
          <Migalha ativa={false} onClick={() => (setProduto(null), setQuantidade(null))}>
            {dados ? `${dataCurta(dados.periodo.de)} – ${dataCurta(dados.periodo.ate)}` : "Período"}
          </Migalha>
          {produto && dados?.produto_nome && (
            <>
              <Seta />
              <Migalha ativa={quantidade === null} onClick={() => setQuantidade(null)}>
                {dados.produto_nome}
              </Migalha>
            </>
          )}
          {quantidade !== null && dados && (
            <>
              <Seta />
              <Migalha ativa onClick={() => undefined}>
                {dados.por_quantidade.find((g) => g.id === quantidade)?.nome ?? `${quantidade}`}
              </Migalha>
            </>
          )}
        </nav>
        {produto && (
          <button type="button" onClick={voltarUmNivel} className="rounded-xl border border-linha-2 bg-fundo-2 px-3 py-1.5 text-sm font-semibold hover:border-laranja">
            ← Voltar um nível
          </button>
        )}
      </div>

      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {!dados ? (
        <p className="text-suave">Carregando…</p>
      ) : (
        <div className={`grid grid-cols-[minmax(0,1fr)] gap-5 transition-opacity ${carregando ? "opacity-60" : ""}`}>
          <Indicadores dados={dados} />

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-3">
            <Coluna
              numero={1}
              titulo="Por produto"
              total={formatar(dados.por_produto.reduce((s, g) => s + g.valor, 0))}
              grupos={dados.por_produto}
              escolhido={produto ?? null}
              formatar={formatar}
              vazio="Nenhuma venda no período."
              aoEscolher={(id) => {
                setProduto(String(id));
                setQuantidade(null);
              }}
              liga
            />
            <Coluna
              numero={2}
              titulo={`${dados.produto_nome ?? "Produto"} · por quantidade`}
              total={formatar(dados.por_quantidade.reduce((s, g) => s + g.valor, 0))}
              grupos={dados.por_quantidade}
              escolhido={quantidade}
              formatar={formatar}
              vazio="Escolha um produto na coluna 1."
              aoEscolher={(id) => {
                if (!produto && dados.produto) setProduto(dados.produto);
                setQuantidade(Number(id));
              }}
              liga
            />
            <Coluna
              numero={3}
              titulo={`${quantidade !== null ? dados.por_quantidade.find((g) => g.id === quantidade)?.nome ?? "" : produto ? dados.produto_nome : "Todas as vendas"} · por afiliado`}
              total={formatar(dados.por_afiliado.reduce((s, g) => s + g.valor, 0))}
              grupos={dados.por_afiliado}
              escolhido={null}
              formatar={formatar}
              vazio="Sem vendas neste recorte."
              aoEscolher={() => undefined}
              rodape={<p className="mt-3 text-xs text-suave">Os afiliados entram na próxima etapa: por enquanto toda venda é direta.</p>}
            />
          </div>

          <TabelaRecorte dados={dados} aoAbrirPedido={aoAbrirPedido} />
        </div>
      )}
    </div>
  );
}

function Migalha({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-semibold ${
        ativa ? "border-laranja/70 bg-laranja/10 text-laranja-2" : "border-linha-2 bg-fundo-2 text-tinta-2 hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}

const Seta = () => <span className="text-suave" aria-hidden>›</span>;

// ───────── Indicadores ─────────

function Indicadores({ dados }: { dados: Painel }) {
  const i = dados.indicadores;
  const v = dados.variacao;
  const pct = (parte: number, todo: number) => (todo ? `${((parte / todo) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
  const variacao = (n: number | null) =>
    n === null ? "sem base anterior" : `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Cartao rotulo="Vendas" valor={reais(i.vendas_centavos)} selo={variacao(v.vendas_centavos)} tom={v.vendas_centavos === null ? "neutro" : v.vendas_centavos >= 0 ? "ok" : "alerta"}>
        {i.unidades} {i.unidades === 1 ? "unidade vendida" : "unidades vendidas"}
      </Cartao>
      <Cartao rotulo="Receita líquida" valor={reais(i.liquida_centavos)} selo={`${pct(i.liquida_centavos, i.vendas_centavos)} das vendas`} tom="ok">
        vendas − frete pago à Loggi
      </Cartao>
      <Cartao
        rotulo="Frete pago pela loja"
        valor={reais(i.frete_loja_centavos)}
        selo={`${i.fretes_gratis} ${i.fretes_gratis === 1 ? "frete grátis" : "fretes grátis"} · ${reais(i.fretes_gratis_centavos)}`}
        tom="destaque"
      >
        cobrado dos clientes: {reais(i.frete_cobrado_centavos)}
      </Cartao>
      <Cartao rotulo="Pedidos pagos" valor={String(i.pedidos)} selo={`ticket médio ${reais(i.ticket_medio_centavos)}`} tom="neutro">
        {i.aguardando} aguardando pagamento ({reais(i.aguardando_centavos)})
      </Cartao>
    </div>
  );
}

function Cartao({ rotulo, valor, selo, tom, children }: { rotulo: string; valor: string; selo: string; tom: "ok" | "alerta" | "destaque" | "neutro"; children: ReactNode }) {
  const cor = { ok: "bg-ok/15 text-ok", alerta: "bg-red-400/15 text-red-300", destaque: "bg-laranja/15 text-laranja-2", neutro: "bg-white/10 text-tinta-2" }[tom];
  return (
    <section className="rounded-2xl border border-linha bg-fundo-2/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
      <p className="font-mono text-[11px] font-bold tracking-[.14em] text-suave uppercase">{rotulo}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <p className="text-3xl leading-none font-extrabold tracking-tight">{valor}</p>
        <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-bold ${cor}`}>{selo}</span>
      </div>
      <p className="mt-2 text-xs text-suave">{children}</p>
    </section>
  );
}

// ───────── Colunas de barras ─────────

function Coluna({
  numero,
  titulo,
  total,
  grupos,
  escolhido,
  formatar,
  vazio,
  aoEscolher,
  liga = false,
  rodape,
}: {
  numero: number;
  titulo: string;
  total: string;
  grupos: Grupo[];
  escolhido: string | number | null;
  formatar: (valor: number) => string;
  vazio: string;
  aoEscolher: (id: string | number) => void;
  liga?: boolean;
  rodape?: ReactNode;
}) {
  const maior = useMemo(() => Math.max(1, ...grupos.map((g) => g.valor)), [grupos]);
  return (
    <section className="relative rounded-2xl border border-linha bg-fundo-2/90 p-4">
      {liga && (
        <span aria-hidden className="absolute top-12 -right-5 z-10 hidden h-0 w-5 border-t-2 border-dashed border-laranja/70 xl:block" />
      )}
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-laranja font-sans text-xs text-black">{numero}</span>
          <span className="truncate">{titulo}</span>
        </h2>
        <span className="shrink-0 font-mono text-[11px] text-suave">total {total}</span>
      </header>
      {grupos.length === 0 ? (
        <p className="py-6 text-center text-sm text-suave">{vazio}</p>
      ) : (
        <ul className="grid gap-1">
          {grupos.map((g) => {
            const ativo = escolhido !== null && String(g.id) === String(escolhido);
            return (
              <li key={String(g.id)}>
                <button
                  type="button"
                  onClick={() => aoEscolher(g.id)}
                  aria-pressed={ativo}
                  title={`${g.pedidos} ${g.pedidos === 1 ? "pedido" : "pedidos"} · ${g.unidades} un.`}
                  className={`grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_3.2rem] items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm ${
                    ativo ? "border-laranja/70 bg-laranja/10" : "border-transparent hover:bg-white/[.04]"
                  }`}
                >
                  <span className={`truncate ${ativo ? "font-bold text-tinta" : "text-tinta-2"}`}>{g.nome}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-white/[.06]">
                    <span
                      className={`block h-full rounded-full ${ativo ? "bg-gradient-to-r from-laranja-3 to-laranja-2" : "bg-gradient-to-r from-zinc-500 to-zinc-400"}`}
                      style={{ width: `${Math.max(4, (g.valor / maior) * 100)}%` }}
                    />
                  </span>
                  <span className="font-mono font-bold">{formatar(g.valor)}</span>
                  <span className="text-right font-mono text-[11px] text-suave">{g.pct.toLocaleString("pt-BR")}%</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rodape}
    </section>
  );
}

// ───────── Tabela do recorte ─────────

function TabelaRecorte({ dados, aoAbrirPedido }: { dados: Painel; aoAbrirPedido: (nsu: string) => void }) {
  const recorte = dados.quantidade !== null
    ? `${dados.produto_nome} · ${dados.por_quantidade.find((g) => g.id === dados.quantidade)?.nome ?? ""}`
    : dados.produto && dados.produto_nome
      ? dados.produto_nome
      : "todos os pedidos do período";
  const resto = dados.pedidos_total - dados.pedidos.length;
  return (
    <section className="rounded-2xl border border-linha bg-fundo-2/90 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">
          <span className="grid size-6 place-items-center rounded-full bg-laranja font-sans text-xs text-black">4</span>
          Maiores pedidos · {recorte}
        </h2>
        <span className="font-mono text-[11px] text-suave">
          {reais(dados.pedidos_valor_centavos)} · {dados.pedidos_total} {dados.pedidos_total === 1 ? "pedido" : "pedidos"}
        </span>
      </header>
      {dados.pedidos.length === 0 ? (
        <p className="py-6 text-center text-sm text-suave">Nenhum pedido neste recorte.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] tracking-[.12em] text-suave uppercase">
                <th className="px-2 py-2 font-semibold">Data</th>
                <th className="px-2 py-2 font-semibold">Cliente</th>
                <th className="px-2 py-2 font-semibold">Produto</th>
                <th className="px-2 py-2 font-semibold">Quantidade</th>
                <th className="px-2 py-2 font-semibold">Afiliado</th>
                <th className="px-2 py-2 font-semibold">Pagamento</th>
                <th className="px-2 py-2 text-right font-semibold">Valor</th>
                <th className="px-2 py-2 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {dados.pedidos.map((l) => (
                <tr
                  key={l.order_nsu}
                  onClick={() => aoAbrirPedido(l.order_nsu)}
                  className="cursor-pointer border-t border-linha hover:bg-white/[.03]"
                  title="Abrir o pedido"
                >
                  <td className="px-2 py-2.5 font-mono text-xs text-tinta-2">{l.criado_em ? new Date(l.criado_em).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-2 py-2.5">
                    <span className="font-semibold">{l.cliente}</span> <span className="text-xs text-suave">{l.cidade}</span>
                  </td>
                  <td className="px-2 py-2.5 text-tinta-2">{l.produto}</td>
                  <td className="px-2 py-2.5">
                    {l.quantidade}
                    {l.frete_gratis && <span className="ml-2 font-mono text-[10px] font-bold text-ok">FRETE GRÁTIS</span>}
                  </td>
                  <td className="px-2 py-2.5 text-tinta-2">{l.afiliado ?? "Direta"}</td>
                  <td className="px-2 py-2.5 text-tinta-2">{rotuloPagamento(l.forma_pagamento)}</td>
                  <td className="px-2 py-2.5 text-right font-mono font-bold">{reais(l.valor_centavos)}</td>
                  <td className="px-2 py-2.5">
                    <Selo situacao={l.situacao} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resto > 0 && <p className="mt-2 px-2 text-xs text-suave">+ {resto} {resto === 1 ? "pedido menor" : "pedidos menores"}</p>}
        </div>
      )}
    </section>
  );
}

export function rotuloPagamento(forma: string | null) {
  return forma === "pix" ? "Pix" : forma === "credit_card" ? "Cartão" : forma ? forma : "—";
}

export function Selo({ situacao }: { situacao: string }) {
  const s = SITUACOES[situacao] ?? { rotulo: situacao, cor: "bg-white/10 text-suave" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${s.cor}`}>{s.rotulo}</span>;
}
