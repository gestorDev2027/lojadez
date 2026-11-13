import { useEffect, useState, type FormEvent } from "react";
import { chamar, formatarCpf, formatarTelefone, reais } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { Campo } from "./VendedorAjustes";
import { Cartao, Coluna, Selo, SeletorPeriodo, periodoInicial, rotuloPagamento, type Periodo } from "./VendedorPainel";

// A aba "Afiliados": a lista com os números do período, a ficha de cada afiliado (links prontos, desempenho e vendas)
// e o cadastro. A venda conta para o afiliado quando o cliente chega pelo link dele (?ref=) e compra em até 30 dias.

type Link = { produto: string; nome: string; url: string };
type Afiliado = {
  id: number;
  codigo: string;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  chave_pix: string | null;
  comissao_pct: number;
  todos_produtos: boolean;
  produtos: string[];
  ativo: boolean;
  observacoes: string | null;
  links: Link[];
};
type Numeros = {
  vendas_centavos: number;
  produtos_centavos: number;
  pedidos: number;
  comissao_centavos: number;
  cliques: number;
  conversao_pct: number | null;
  ticket_medio_centavos: number;
};
type Resumo = {
  periodo: Periodo;
  afiliados: (Afiliado & Numeros)[];
  totais: Numeros & { vendas_loja_centavos: number; ativos: number };
};
type Venda = {
  order_nsu: string;
  criado_em: string | null;
  cliente: string;
  cidade: string;
  produto: string;
  quantidade: string;
  valor_centavos: number;
  comissao_centavos: number;
  forma_pagamento: string | null;
  situacao: string;
};
type Ficha = {
  periodo: Periodo;
  afiliado: Afiliado;
  numeros: Numeros;
  por_produto: { id: string; nome: string; valor: number; pedidos: number; unidades: number; pct: number }[];
  vendas: Venda[];
  vendas_total: number;
};
type ProdutoOpcao = { id: string; nome: string };

const COLUNAS_AFILIADOS: ColunaTabela<Afiliado & Numeros>[] = [
  {
    id: "afiliado",
    rotulo: "Afiliado",
    valor: (a) => `${a.nome} ${a.codigo} ${a.email ?? ""} ${a.telefone ?? ""} ${a.chave_pix ?? ""}`,
    render: (a) => (
      <>
        <span className="block font-semibold">{a.nome}</span>
        <span className="font-mono text-xs text-suave">?ref={a.codigo}</span>
      </>
    ),
  },
  { id: "comissao_pct", rotulo: "Comissão", valor: (a) => a.comissao_pct, render: (a) => <span className="font-mono">{pct(a.comissao_pct)}</span> },
  { id: "produtos", rotulo: "Produtos", valor: (a) => (a.todos_produtos ? "Todos" : `${a.produtos.length} liberado(s)`) },
  {
    id: "cliques",
    rotulo: "Cliques",
    direita: true,
    valor: (a) => a.cliques,
    render: (a) => (
      <span className="font-mono">
        {a.cliques}
        <span className="block text-[10px] text-suave">{pct(a.conversao_pct)}</span>
      </span>
    ),
  },
  { id: "pedidos", rotulo: "Pedidos", direita: true, valor: (a) => a.pedidos, render: (a) => <span className="font-mono">{a.pedidos}</span> },
  {
    id: "vendas",
    rotulo: "Vendas",
    direita: true,
    valor: (a) => a.vendas_centavos / 100,
    render: (a) => <span className="font-mono font-bold">{reais(a.vendas_centavos)}</span>,
  },
  {
    id: "comissao",
    rotulo: "Comissão gerada",
    direita: true,
    valor: (a) => a.comissao_centavos / 100,
    render: (a) => <span className="font-mono text-laranja-2">{reais(a.comissao_centavos)}</span>,
  },
  { id: "pix", rotulo: "Chave Pix", valor: (a) => a.chave_pix ?? "", render: (a) => <span className="text-xs text-tinta-2">{a.chave_pix ?? "—"}</span> },
  {
    id: "situacao",
    rotulo: "Situação",
    valor: (a) => (a.ativo ? "Ativo" : "Inativo"),
    render: (a) => (
      <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${a.ativo ? "bg-ok/15 text-ok" : "bg-white/10 text-suave"}`}>
        {a.ativo ? "Ativo" : "Inativo"}
      </span>
    ),
  },
];

const COLUNAS_VENDAS: ColunaTabela<Venda>[] = [
  {
    id: "data",
    rotulo: "Data",
    valor: (v) => v.criado_em ?? "",
    render: (v) => <span className="font-mono text-xs text-tinta-2">{v.criado_em ? new Date(v.criado_em).toLocaleDateString("pt-BR") : "—"}</span>,
  },
  {
    id: "cliente",
    rotulo: "Cliente",
    valor: (v) => `${v.cliente} ${v.cidade}`,
    render: (v) => (
      <>
        <span className="font-semibold">{v.cliente}</span> <span className="text-xs text-suave">{v.cidade}</span>
      </>
    ),
  },
  { id: "produto", rotulo: "Produto", valor: (v) => `${v.produto} · ${v.quantidade}`, render: (v) => <span className="text-tinta-2">{v.produto} · {v.quantidade}</span> },
  { id: "pagamento", rotulo: "Pagamento", valor: (v) => rotuloPagamento(v.forma_pagamento) },
  { id: "valor", rotulo: "Valor", direita: true, valor: (v) => v.valor_centavos / 100, render: (v) => <span className="font-mono font-bold">{reais(v.valor_centavos)}</span> },
  {
    id: "comissao",
    rotulo: "Comissão",
    direita: true,
    valor: (v) => v.comissao_centavos / 100,
    render: (v) => <span className="font-mono text-laranja-2">{reais(v.comissao_centavos)}</span>,
  },
  { id: "situacao", rotulo: "Situação", valor: (v) => v.situacao, render: (v) => <Selo situacao={v.situacao} /> },
];

const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

export function AbaAfiliados({ senha }: { senha: string }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  const [tela, setTela] = useState<{ tipo: "lista" } | { tipo: "ficha"; id: number } | { tipo: "editar"; afiliado: Afiliado | null }>({
    tipo: "lista",
  });
  const [aviso, setAviso] = useState("");

  if (tela.tipo === "editar")
    return (
      <EditorAfiliado
        senha={senha}
        afiliado={tela.afiliado}
        aoVoltar={() => setTela(tela.afiliado ? { tipo: "ficha", id: tela.afiliado.id } : { tipo: "lista" })}
        aoSalvar={(a) => {
          setAviso(`“${a.nome}” salvo.`);
          setTela({ tipo: "ficha", id: a.id });
        }}
      />
    );
  if (tela.tipo === "ficha")
    return (
      <FichaAfiliado
        senha={senha}
        id={tela.id}
        periodo={periodo}
        aoMudarPeriodo={setPeriodo}
        aviso={aviso}
        aoVoltar={() => (setAviso(""), setTela({ tipo: "lista" }))}
        aoEditar={(a) => (setAviso(""), setTela({ tipo: "editar", afiliado: a }))}
      />
    );
  return (
    <ListaAfiliados
      senha={senha}
      periodo={periodo}
      aoMudarPeriodo={setPeriodo}
      aoAbrir={(id) => setTela({ tipo: "ficha", id })}
      aoNovo={() => setTela({ tipo: "editar", afiliado: null })}
    />
  );
}

// ───────── Lista ─────────

function ListaAfiliados({
  senha,
  periodo,
  aoMudarPeriodo,
  aoAbrir,
  aoNovo,
}: {
  senha: string;
  periodo: Periodo;
  aoMudarPeriodo: (p: Periodo) => void;
  aoAbrir: (id: number) => void;
  aoNovo: () => void;
}) {
  const [dados, setDados] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setErro("");
    chamar<Resumo>(`/api/vendedor/afiliados?${new URLSearchParams(periodo)}`, { senha })
      .then(setDados)
      .catch((e: Error) => setErro(e.message));
  }, [senha, periodo]);

  const t = dados?.totais;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Afiliados</h1>
          <p className="mt-1 text-sm text-suave">Quem divulga a loja pelo próprio link e ganha comissão nas vendas que traz (vale por 30 dias).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo periodo={periodo} aoMudar={aoMudarPeriodo} />
          <button type="button" onClick={aoNovo} className="btn-laranja px-5 py-2.5 text-sm">
            Novo afiliado
          </button>
        </div>
      </div>

      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {!dados || !t ? (
        <p className="text-suave">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao
              rotulo="Vendas por afiliados"
              valor={reais(t.vendas_centavos)}
              selo={`${pct(t.vendas_loja_centavos ? (t.vendas_centavos / t.vendas_loja_centavos) * 100 : null)} das vendas`}
              tom="destaque"
            >
              {t.pedidos} {t.pedidos === 1 ? "pedido pago" : "pedidos pagos"} no período
            </Cartao>
            <Cartao rotulo="Comissões geradas" valor={reais(t.comissao_centavos)} selo="a pagar por Pix" tom="neutro">
              sobre {reais(t.produtos_centavos)} em produtos (sem frete)
            </Cartao>
            <Cartao rotulo="Cliques nos links" valor={String(t.cliques)} selo={`conversão ${pct(t.conversao_pct)}`} tom="ok">
              visitas que chegaram por um link de afiliado
            </Cartao>
            <Cartao rotulo="Afiliados ativos" valor={String(t.ativos)} selo={`${dados.afiliados.length} cadastrados`} tom="neutro">
              ticket médio das vendas deles: {reais(t.ticket_medio_centavos)}
            </Cartao>
          </div>

          {dados.afiliados.length === 0 ? (
            <section className="grid justify-items-center gap-3 rounded-2xl border border-linha bg-fundo-2/90 p-8 text-center">
              <p className="text-suave">Nenhum afiliado ainda.</p>
              <button type="button" onClick={aoNovo} className="btn-laranja px-5 py-2.5 text-sm">
                Cadastrar o primeiro
              </button>
            </section>
          ) : (
            <Tabela
              linhas={dados.afiliados}
              colunas={COLUNAS_AFILIADOS}
              chave={(a) => String(a.id)}
              aoClicar={(a) => aoAbrir(a.id)}
              ordemInicial={{ coluna: "vendas", desc: true }}
              buscaDica="Buscar por nome, código, e-mail, telefone ou chave Pix"
              arquivo="afiliados"
              larguraMinima={900}
            />
          )}
        </>
      )}
    </div>
  );
}

// ───────── Ficha ─────────

function FichaAfiliado({
  senha,
  id,
  periodo,
  aoMudarPeriodo,
  aviso,
  aoVoltar,
  aoEditar,
}: {
  senha: string;
  id: number;
  periodo: Periodo;
  aoMudarPeriodo: (p: Periodo) => void;
  aviso: string;
  aoVoltar: () => void;
  aoEditar: (a: Afiliado) => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");

  useEffect(() => {
    setErro("");
    chamar<Ficha>(`/api/vendedor/afiliados/${id}?${new URLSearchParams(periodo)}`, { senha })
      .then(setFicha)
      .catch((e: Error) => setErro(e.message));
  }, [senha, id, periodo]);

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
      window.setTimeout(() => setCopiado(""), 2000);
    } catch {
      setErro("Não deu para copiar: selecione o link.");
    }
  }

  if (!ficha) return <p className="text-suave">{erro || "Carregando…"}</p>;
  const a = ficha.afiliado;
  const n = ficha.numeros;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" onClick={aoVoltar} className="text-sm text-suave hover:text-laranja-2">
            ← Afiliados
          </button>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold md:text-3xl">
            {a.nome}
            <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${a.ativo ? "bg-ok/15 text-ok" : "bg-white/10 text-suave"}`}>
              {a.ativo ? "Ativo" : "Inativo"}
            </span>
          </h1>
          <p className="mt-1 font-mono text-xs text-suave">
            código {a.codigo} · comissão {pct(a.comissao_pct)} sobre os produtos (sem frete)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo periodo={periodo} aoMudar={aoMudarPeriodo} />
          <button type="button" onClick={() => aoEditar(a)} className="rounded-xl border border-linha-2 bg-fundo-2 px-4 py-2 text-sm font-semibold hover:border-laranja">
            Editar
          </button>
        </div>
      </div>
      {aviso && <p role="status" className="text-ok">{aviso}</p>}
      {erro && <p role="alert" className="text-alerta">{erro}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao rotulo="Vendas" valor={reais(n.vendas_centavos)} selo={`ticket ${reais(n.ticket_medio_centavos)}`} tom="destaque">
          {n.pedidos} {n.pedidos === 1 ? "pedido pago" : "pedidos pagos"}
        </Cartao>
        <Cartao rotulo="Comissão gerada" valor={reais(n.comissao_centavos)} selo={pct(a.comissao_pct)} tom="ok">
          sobre {reais(n.produtos_centavos)} em produtos
        </Cartao>
        <Cartao rotulo="Cliques" valor={String(n.cliques)} selo={`conversão ${pct(n.conversao_pct)}`} tom="neutro">
          visitas pelos links no período
        </Cartao>
        <Cartao rotulo="Pagamento da comissão" valor={a.chave_pix ? "Pix" : "—"} selo={a.chave_pix ? "chave cadastrada" : "sem chave Pix"} tom={a.chave_pix ? "neutro" : "alerta"}>
          {a.chave_pix ? <span className="font-mono">{a.chave_pix}</span> : "cadastre a chave em Editar"}
        </Cartao>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-linha bg-fundo-2/90 p-4">
          <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">
            <span className="grid size-6 place-items-center rounded-full bg-laranja font-sans text-xs text-black">1</span>
            Links para divulgar
          </h2>
          {a.links.length === 0 ? (
            <p className="text-sm text-suave">Nenhum produto liberado para este afiliado.</p>
          ) : (
            <ul className="grid gap-2">
              {a.links.map((l) => (
                <li key={l.produto} className="grid gap-1 rounded-xl border border-linha-2 p-3">
                  <span className="text-sm font-semibold">{l.nome}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-fundo px-2 py-1.5 font-mono text-xs text-tinta-2">{l.url}</code>
                    <button type="button" onClick={() => void copiar(l.url)} className="rounded-lg border border-laranja/60 px-3 py-1.5 text-xs font-bold text-laranja-2">
                      {copiado === l.url ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-suave">
            Quem entra por um destes links e compra em até 30 dias gera comissão. O endereço sai das Configurações (Endereço do site).
          </p>
        </section>
        <Coluna
          numero={2}
          titulo="Vendas por produto"
          total={reais(ficha.por_produto.reduce((s, g) => s + g.valor, 0))}
          grupos={ficha.por_produto}
          escolhido={null}
          formatar={reais}
          vazio="Nenhuma venda no período."
          aoEscolher={() => undefined}
        />
      </div>

      <section className="rounded-2xl border border-linha bg-fundo-2/90 p-4">
        <h2 className="mb-3 flex items-center justify-between gap-2 font-mono text-[11px] font-bold tracking-[.14em] text-tinta-2 uppercase">
          <span className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-laranja font-sans text-xs text-black">3</span>
            Vendas do afiliado
          </span>
          <span className="font-normal text-suave normal-case tracking-normal">{ficha.vendas_total} no período</span>
        </h2>
      </section>
      <Tabela
        linhas={ficha.vendas}
        colunas={COLUNAS_VENDAS}
        chave={(v) => v.order_nsu}
        ordemInicial={{ coluna: "data", desc: true }}
        buscaDica="Buscar nas vendas deste afiliado"
        arquivo={`vendas-${a.codigo}`}
        vazio="Nenhuma venda no período."
      />

      <section className="grid gap-1 rounded-2xl border border-linha bg-fundo-2/90 p-4 text-sm">
        <p className="font-mono text-[11px] font-bold tracking-[.14em] text-suave uppercase">Contato e documento</p>
        <p>
          {a.documento ? (a.documento.length === 11 ? `CPF ${formatarCpf(a.documento)}` : `CNPJ ${a.documento}`) : "Sem documento"}
          {a.email ? ` · ${a.email}` : ""}
          {a.telefone ? ` · ${formatarTelefone(a.telefone)}` : ""}
        </p>
        {a.observacoes && <p className="text-suave">{a.observacoes}</p>}
      </section>
    </div>
  );
}

// ───────── Cadastro ─────────

function EditorAfiliado({
  senha,
  afiliado,
  aoVoltar,
  aoSalvar,
}: {
  senha: string;
  afiliado: Afiliado | null;
  aoVoltar: () => void;
  aoSalvar: (a: Afiliado) => void;
}) {
  const [f, setF] = useState({
    nome: afiliado?.nome ?? "",
    codigo: afiliado?.codigo ?? "",
    documento: afiliado?.documento ?? "",
    email: afiliado?.email ?? "",
    telefone: afiliado?.telefone ? formatarTelefone(afiliado.telefone) : "",
    chave_pix: afiliado?.chave_pix ?? "",
    comissao_pct: afiliado ? String(afiliado.comissao_pct).replace(".", ",") : "10",
    todos_produtos: afiliado?.todos_produtos ?? true,
    produtos: afiliado?.produtos ?? [],
    ativo: afiliado?.ativo ?? true,
    observacoes: afiliado?.observacoes ?? "",
  });
  const [opcoes, setOpcoes] = useState<ProdutoOpcao[]>([{ id: "kit-laminas", nome: "Kit de lâminas" }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const mudar = <K extends keyof typeof f>(campo: K, valor: (typeof f)[K]) => setF((atual) => ({ ...atual, [campo]: valor }));

  useEffect(() => {
    chamar<{ slug: string; nome: string }[]>("/api/vendedor/produtos", { senha })
      .then((lista) => setOpcoes([{ id: "kit-laminas", nome: "Kit de lâminas" }, ...lista.map((p) => ({ id: p.slug, nome: p.nome }))]))
      .catch(() => undefined);
  }, [senha]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const salvo = await chamar<Afiliado>(afiliado ? `/api/vendedor/afiliados/${afiliado.id}` : "/api/vendedor/afiliados", {
        metodo: afiliado ? "PUT" : "POST",
        senha,
        corpo: { ...f, comissao_pct: f.comissao_pct.replace(",", ".") },
      });
      aoSalvar(salvo);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const exemplo = Number(f.comissao_pct.replace(",", ".")) || 0;
  return (
    <form onSubmit={salvar} className="grid max-w-3xl gap-5">
      <div>
        <button type="button" onClick={aoVoltar} className="text-sm text-suave hover:text-laranja-2">
          ← Voltar
        </button>
        <h1 className="mt-1 text-2xl font-bold md:text-3xl">{afiliado ? `Editar ${afiliado.nome}` : "Novo afiliado"}</h1>
      </div>
      <section className="grid gap-4 rounded-2xl border border-linha bg-fundo-2/90 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome">
            <input className="campo" required minLength={3} maxLength={80} value={f.nome} onChange={(e) => mudar("nome", e.target.value)} />
          </Campo>
          <Campo
            rotulo="Código do link"
            dica={afiliado ? "O código não muda (os links já divulgados continuam valendo)." : "Vazio: sai do nome. Letras minúsculas, números e hífens."}
          >
            <input
              className="campo font-mono"
              disabled={Boolean(afiliado)}
              maxLength={30}
              placeholder="ex.: joao"
              value={f.codigo}
              onChange={(e) => mudar("codigo", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
          </Campo>
          <Campo rotulo="Comissão (%)" dica={exemplo > 0 ? `Num kit de R$ 60,90 ela ganha ${reais(Math.round(6090 * (exemplo / 100)))}.` : "0: sem comissão."}>
            <input className="campo font-mono" inputMode="decimal" required value={f.comissao_pct} onChange={(e) => mudar("comissao_pct", e.target.value)} />
          </Campo>
          <Campo rotulo="Chave Pix (para pagar a comissão)">
            <input className="campo" maxLength={140} value={f.chave_pix} onChange={(e) => mudar("chave_pix", e.target.value)} />
          </Campo>
          <Campo rotulo="CPF ou CNPJ (opcional)">
            <input
              className="campo font-mono"
              inputMode="numeric"
              value={f.documento}
              onChange={(e) => mudar("documento", e.target.value.replace(/\D/g, "").slice(0, 14))}
            />
          </Campo>
          <Campo rotulo="E-mail (opcional)">
            <input className="campo" type="email" value={f.email} onChange={(e) => mudar("email", e.target.value)} />
          </Campo>
          <Campo rotulo="Celular com DDD (opcional)">
            <input className="campo" inputMode="tel" value={f.telefone} onChange={(e) => mudar("telefone", formatarTelefone(e.target.value))} />
          </Campo>
          <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
            <input type="checkbox" checked={f.ativo} onChange={(e) => mudar("ativo", e.target.checked)} className="size-4 accent-laranja" />
            Ativo (desligado, os links param de gerar comissão)
          </label>
        </div>

        <fieldset className="grid gap-2 rounded-xl border border-linha-2 p-4">
          <legend className="px-1 text-sm font-semibold">Produtos que pode divulgar</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.todos_produtos} onChange={(e) => mudar("todos_produtos", e.target.checked)} className="size-4 accent-laranja" />
            Todos os produtos (inclusive os que forem cadastrados depois)
          </label>
          {!f.todos_produtos && (
            <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
              {opcoes.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.produtos.includes(p.id)}
                    onChange={(e) =>
                      mudar("produtos", e.target.checked ? [...f.produtos, p.id] : f.produtos.filter((x) => x !== p.id))
                    }
                    className="size-4 accent-laranja"
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <Campo rotulo="Observações (opcional)" dica="Só você vê.">
          <textarea className="campo min-h-20" maxLength={500} value={f.observacoes} onChange={(e) => mudar("observacoes", e.target.value)} />
        </Campo>
      </section>
      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={salvando} className="btn-laranja px-6 py-3 text-sm">
          {salvando ? "Salvando…" : afiliado ? "Salvar" : "Criar afiliado"}
        </button>
        <button type="button" onClick={aoVoltar} className="rounded-full border border-linha-2 px-5 py-3 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}
