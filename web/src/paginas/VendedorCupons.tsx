import { useEffect, useState, type FormEvent } from "react";
import { chamar, reais } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { Campo } from "./VendedorAjustes";

// A aba "Cupons": desconto em %, em R$ ou frete grátis, com validade, limite de usos, valor mínimo e produtos.
// O cupom pode ser de um afiliado: quem usa gera a venda e a comissão para ele.

type Cupom = {
  id: number;
  codigo: string;
  tipo: "percentual" | "valor" | "frete";
  valor: number;
  inicio: string | null;
  fim: string | null;
  limite_usos: number | null;
  minimo_centavos: number | null;
  todos_produtos: boolean;
  produtos: string[];
  afiliado_id: number | null;
  afiliado_nome: string | null;
  ativo: boolean;
  descricao_interna: string | null;
  descricao: string;
  usos: number;
  pedidos: number;
  vendas_centavos: number;
  desconto_dado_centavos: number;
};
type Opcao = { id: string; nome: string };
type AfiliadoOpcao = { id: number; nome: string; codigo: string };

const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const validade = (c: Cupom) => (c.inicio || c.fim ? `${c.inicio ? dataBr(c.inicio) : "já"} → ${c.fim ? dataBr(c.fim) : "sem fim"}` : "Sempre");
function situacao(c: Cupom) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (!c.ativo) return { rotulo: "Desligado", cor: "bg-white/10 text-suave" };
  if (c.fim && hoje > c.fim) return { rotulo: "Vencido", cor: "bg-white/10 text-suave" };
  if (c.inicio && hoje < c.inicio) return { rotulo: "Agendado", cor: "bg-sky-400/15 text-sky-300" };
  if (c.limite_usos && c.usos >= c.limite_usos) return { rotulo: "Esgotado", cor: "bg-amber-400/15 text-amber-300" };
  return { rotulo: "Valendo", cor: "bg-ok/15 text-ok" };
}

const COLUNAS: ColunaTabela<Cupom>[] = [
  {
    id: "codigo",
    rotulo: "Cupom",
    valor: (c) => `${c.codigo} ${c.descricao_interna ?? ""}`,
    render: (c) => (
      <>
        <span className="block font-mono font-bold">{c.codigo}</span>
        {c.descricao_interna && <span className="text-xs text-suave">{c.descricao_interna}</span>}
      </>
    ),
  },
  { id: "desconto", rotulo: "Desconto", valor: (c) => c.descricao },
  { id: "afiliado", rotulo: "Afiliado", valor: (c) => c.afiliado_nome ?? "", render: (c) => <span className="text-tinta-2">{c.afiliado_nome ?? "—"}</span> },
  {
    id: "usos",
    rotulo: "Usos",
    direita: true,
    valor: (c) => c.usos,
    render: (c) => <span className="font-mono">{c.limite_usos ? `${c.usos}/${c.limite_usos}` : c.usos}</span>,
  },
  { id: "vendas", rotulo: "Vendas", direita: true, valor: (c) => c.vendas_centavos / 100, render: (c) => <span className="font-mono font-bold">{reais(c.vendas_centavos)}</span> },
  {
    id: "desconto_dado",
    rotulo: "Desconto dado",
    direita: true,
    valor: (c) => c.desconto_dado_centavos / 100,
    render: (c) => <span className="font-mono text-laranja-2">{reais(c.desconto_dado_centavos)}</span>,
  },
  { id: "validade", rotulo: "Validade", valor: (c) => validade(c), render: (c) => <span className="font-mono text-xs text-tinta-2">{validade(c)}</span> },
  {
    id: "situacao",
    rotulo: "Situação",
    valor: (c) => situacao(c).rotulo,
    render: (c) => <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${situacao(c).cor}`}>{situacao(c).rotulo}</span>,
  },
];

export function AbaCupons({ senha }: { senha: string }) {
  const [lista, setLista] = useState<Cupom[] | null>(null);
  const [editando, setEditando] = useState<Cupom | "novo" | null>(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");

  async function carregar() {
    try {
      setLista((await chamar<{ cupons: Cupom[] }>("/api/vendedor/cupons", { senha })).cupons);
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senha]);

  if (editando)
    return (
      <EditorCupom
        senha={senha}
        cupom={editando === "novo" ? null : editando}
        aoVoltar={(texto) => {
          setEditando(null);
          setAviso(texto ?? "");
          void carregar();
        }}
      />
    );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Cupons</h1>
          <p className="mt-1 text-sm text-suave">Desconto em %, em R$ ou frete grátis. O cupom de um afiliado gera a venda e a comissão para ele.</p>
        </div>
        <button type="button" onClick={() => setEditando("novo")} className="btn-laranja px-5 py-2.5 text-sm">
          Novo cupom
        </button>
      </div>
      {aviso && <p role="status" className="text-ok">{aviso}</p>}
      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {lista === null ? (
        <p className="text-suave">Carregando…</p>
      ) : lista.length === 0 ? (
        <section className="grid justify-items-center gap-3 rounded-2xl border border-linha bg-fundo-2/90 p-8 text-center">
          <p className="text-suave">Nenhum cupom ainda.</p>
          <button type="button" onClick={() => setEditando("novo")} className="btn-laranja px-5 py-2.5 text-sm">
            Criar o primeiro
          </button>
        </section>
      ) : (
        <Tabela
          linhas={lista}
          colunas={COLUNAS}
          chave={(c) => String(c.id)}
          aoClicar={(c) => setEditando(c)}
          ordemInicial={{ coluna: "vendas", desc: true }}
          buscaDica="Buscar por código, afiliado ou anotação"
          arquivo="cupons"
          larguraMinima={900}
        />
      )}
    </div>
  );
}

function EditorCupom({ senha, cupom, aoVoltar }: { senha: string; cupom: Cupom | null; aoVoltar: (aviso?: string) => void }) {
  const [f, setF] = useState({
    codigo: cupom?.codigo ?? "",
    tipo: cupom?.tipo ?? "percentual",
    valor: cupom ? (cupom.tipo === "valor" ? (cupom.valor / 100).toFixed(2).replace(".", ",") : String(cupom.valor).replace(".", ",")) : "10",
    inicio: cupom?.inicio ?? "",
    fim: cupom?.fim ?? "",
    limite_usos: cupom?.limite_usos ? String(cupom.limite_usos) : "",
    minimo: cupom?.minimo_centavos ? (cupom.minimo_centavos / 100).toFixed(2).replace(".", ",") : "",
    todos_produtos: cupom?.todos_produtos ?? true,
    produtos: cupom?.produtos ?? [],
    afiliado_id: cupom?.afiliado_id ? String(cupom.afiliado_id) : "",
    ativo: cupom?.ativo ?? true,
    descricao_interna: cupom?.descricao_interna ?? "",
  });
  const [produtos, setProdutos] = useState<Opcao[]>([{ id: "kit-laminas", nome: "Kit de lâminas" }]);
  const [afiliados, setAfiliados] = useState<AfiliadoOpcao[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const mudar = <K extends keyof typeof f>(campo: K, valor: (typeof f)[K]) => setF((atual) => ({ ...atual, [campo]: valor }));
  const centavos = (texto: string) => Math.round(Number.parseFloat(texto.replace(/\./g, "").replace(",", ".")) * 100) || 0;

  useEffect(() => {
    chamar<{ slug: string; nome: string }[]>("/api/vendedor/produtos", { senha })
      .then((l) => setProdutos([{ id: "kit-laminas", nome: "Kit de lâminas" }, ...l.map((p) => ({ id: p.slug, nome: p.nome }))]))
      .catch(() => undefined);
    chamar<{ afiliados: AfiliadoOpcao[] }>("/api/vendedor/afiliados", { senha })
      .then((r) => setAfiliados(r.afiliados))
      .catch(() => undefined);
  }, [senha]);

  async function gerar() {
    const afiliado = afiliados.find((a) => String(a.id) === f.afiliado_id);
    try {
      const r = await chamar<{ codigo: string }>(`/api/vendedor/cupons/codigo?prefixo=${encodeURIComponent(afiliado?.codigo ?? "WOLF")}`, { senha });
      mudar("codigo", r.codigo);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    const valor = f.tipo === "valor" ? centavos(f.valor) : f.tipo === "frete" ? 0 : Number(f.valor.replace(",", "."));
    try {
      const salvo = await chamar<Cupom>(cupom ? `/api/vendedor/cupons/${cupom.id}` : "/api/vendedor/cupons", {
        metodo: cupom ? "PUT" : "POST",
        senha,
        corpo: { ...f, valor, minimo_centavos: f.minimo ? centavos(f.minimo) : 0, limite_usos: f.limite_usos || null, afiliado_id: f.afiliado_id || null },
      });
      aoVoltar(`Cupom ${salvo.codigo} salvo.`);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="grid max-w-3xl gap-5">
      <div>
        <button type="button" onClick={() => aoVoltar()} className="text-sm text-suave hover:text-laranja-2">
          ← Cupons
        </button>
        <h1 className="mt-1 text-2xl font-bold md:text-3xl">{cupom ? `Cupom ${cupom.codigo}` : "Novo cupom"}</h1>
        {cupom && (
          <p className="mt-1 font-mono text-xs text-suave">
            {cupom.usos} uso(s) · {cupom.pedidos} venda(s) paga(s) · {reais(cupom.vendas_centavos)} · desconto dado {reais(cupom.desconto_dado_centavos)}
          </p>
        )}
      </div>
      <section className="grid gap-4 rounded-2xl border border-linha bg-fundo-2/90 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Código" dica={cupom ? "O código não muda." : "Vazio: a loja gera um. Letras, números e hífens."}>
            <div className="flex gap-2">
              <input
                className="campo font-mono uppercase"
                disabled={Boolean(cupom)}
                maxLength={30}
                placeholder="ex.: JOAO10"
                value={f.codigo}
                onChange={(e) => mudar("codigo", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              />
              {!cupom && (
                <button type="button" onClick={() => void gerar()} className="shrink-0 rounded-[14px] border border-linha-2 px-3 text-sm font-semibold">
                  Gerar
                </button>
              )}
            </div>
          </Campo>
          <Campo rotulo="Afiliado (opcional)" dica="Quem usar o cupom gera a venda e a comissão para ele.">
            <select className="campo" value={f.afiliado_id} onChange={(e) => mudar("afiliado_id", e.target.value)}>
              <option value="">Nenhum (cupom da loja)</option>
              {afiliados.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome} ({a.codigo})
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Tipo">
            <select className="campo" value={f.tipo} onChange={(e) => mudar("tipo", e.target.value as Cupom["tipo"])}>
              <option value="percentual">Desconto em %</option>
              <option value="valor">Desconto em R$</option>
              <option value="frete">Frete grátis</option>
            </select>
          </Campo>
          {f.tipo !== "frete" ? (
            <Campo rotulo={f.tipo === "percentual" ? "Desconto (%)" : "Desconto (R$)"} dica="Vale sobre os produtos, não sobre o frete.">
              <input className="campo font-mono" inputMode="decimal" required value={f.valor} onChange={(e) => mudar("valor", e.target.value)} />
            </Campo>
          ) : (
            <p className="self-end pb-3 text-sm text-suave">A entrega mais barata sai de graça; a loja paga a Loggi.</p>
          )}
          <Campo rotulo="Começa em (opcional)">
            <input className="campo [color-scheme:dark]" type="date" value={f.inicio} onChange={(e) => mudar("inicio", e.target.value)} />
          </Campo>
          <Campo rotulo="Vence em (opcional)">
            <input className="campo [color-scheme:dark]" type="date" value={f.fim} onChange={(e) => mudar("fim", e.target.value)} />
          </Campo>
          <Campo rotulo="Limite de usos (opcional)" dica="Vazio: sem limite.">
            <input className="campo font-mono" inputMode="numeric" value={f.limite_usos} onChange={(e) => mudar("limite_usos", e.target.value.replace(/\D/g, ""))} />
          </Campo>
          <Campo rotulo="Compra mínima em produtos (R$, opcional)">
            <input className="campo font-mono" inputMode="decimal" value={f.minimo} onChange={(e) => mudar("minimo", e.target.value)} />
          </Campo>
        </div>
        <fieldset className="grid gap-2 rounded-xl border border-linha-2 p-4">
          <legend className="px-1 text-sm font-semibold">Vale para</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.todos_produtos} onChange={(e) => mudar("todos_produtos", e.target.checked)} className="size-4 accent-laranja" />
            Todos os produtos
          </label>
          {!f.todos_produtos && (
            <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
              {produtos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.produtos.includes(p.id)}
                    onChange={(e) => mudar("produtos", e.target.checked ? [...f.produtos, p.id] : f.produtos.filter((x) => x !== p.id))}
                    className="size-4 accent-laranja"
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <Campo rotulo="Anotação (opcional)" dica="Só você vê. Ex.: campanha do Instagram.">
          <input className="campo" maxLength={200} value={f.descricao_interna} onChange={(e) => mudar("descricao_interna", e.target.value)} />
        </Campo>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.ativo} onChange={(e) => mudar("ativo", e.target.checked)} className="size-4 accent-laranja" />
          Ligado
        </label>
      </section>
      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={salvando} className="btn-laranja px-6 py-3 text-sm">
          {salvando ? "Salvando…" : cupom ? "Salvar" : "Criar cupom"}
        </button>
        <button type="button" onClick={() => aoVoltar()} className="rounded-full border border-linha-2 px-5 py-3 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}
