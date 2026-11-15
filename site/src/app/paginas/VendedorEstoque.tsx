import { useCallback, useEffect, useState, type FormEvent } from "react";
import { chamar, reais } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { Campo } from "./VendedorAjustes";
import { Cartao } from "./VendedorPainel";

// A aba "Estoque": o saldo de cada item (o kit e os produtos), com o que está reservado por pedidos ainda não pagos, o
// disponível para vender, o mínimo e o custo médio. Toda mudança é um lançamento com motivo (entrada, ajuste, perda,
// devolução, inventário) e fica no histórico. Item sem controle vende sem olhar o saldo.

type Situacao = "ok" | "baixo" | "esgotado" | "sem_controle";
type Item = {
  produto_id: string;
  nome: string;
  sku: string | null;
  ativo: boolean;
  controlar: boolean;
  minimo: number;
  fisico: number;
  reservado: number;
  disponivel: number;
  custo_medio_centavos: number;
  valor_centavos: number;
  situacao: Situacao;
};
type Painel = {
  itens: Item[];
  resumo: { valor_centavos: number; unidades: number; esgotados: number; baixos: number; reservado: number };
};
type Movimento = {
  id: number;
  tipo: string;
  quantidade: number;
  custo_unitario_centavos: number | null;
  saldo_depois: number;
  pedido_nsu: string | null;
  fornecedor: string | null;
  nota: string | null;
  motivo: string | null;
  email: string | null;
  quando: string;
};
type TipoLancamento = "entrada" | "ajuste" | "perda" | "devolucao" | "inventario";

const SITUACAO: Record<Situacao, { rotulo: string; cor: string }> = {
  ok: { rotulo: "Em estoque", cor: "bg-ok/15 text-ok" },
  baixo: { rotulo: "Baixo", cor: "bg-amber-400/15 text-amber-300" },
  esgotado: { rotulo: "Esgotado", cor: "bg-red-400/15 text-red-300" },
  sem_controle: { rotulo: "Sem controle", cor: "bg-white/10 text-suave" },
};
const TIPOS: { id: TipoLancamento; rotulo: string; dica: string }[] = [
  { id: "entrada", rotulo: "Entrada", dica: "Chegou mercadoria: soma ao saldo e, com o custo, atualiza o custo médio." },
  { id: "inventario", rotulo: "Inventário", dica: "Contou o estoque: o saldo passa a ser o número contado." },
  { id: "ajuste", rotulo: "Ajuste", dica: "Corrige o saldo para mais (+) ou para menos (−), com o motivo." },
  { id: "perda", rotulo: "Perda", dica: "Quebrou, venceu, sumiu: tira do saldo, com o motivo." },
  { id: "devolucao", rotulo: "Devolução", dica: "Voltou para o estoque (troca, devolução fora de um pedido da loja)." },
];
const ROTULO_MOVIMENTO: Record<string, string> = {
  entrada: "Entrada", venda: "Venda", devolucao: "Devolução", ajuste: "Ajuste", perda: "Perda",
};

const paraCentavos = (texto: string) => {
  const limpo = texto.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const valor = Number.parseFloat(limpo);
  return Number.isFinite(valor) ? Math.round(valor * 100) : NaN;
};
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Situacao({ s }: { s: Situacao }) {
  return <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-bold ${SITUACAO[s].cor}`}>{SITUACAO[s].rotulo}</span>;
}

const COLUNAS: ColunaTabela<Item>[] = [
  {
    id: "nome",
    rotulo: "Produto",
    valor: (i) => `${i.nome} ${i.sku ?? ""}`,
    render: (i) => (
      <>
        <span className="block font-bold">
          {i.nome}
          {!i.ativo && <span className="ml-2 font-mono text-[10px] text-suave uppercase">fora de venda</span>}
        </span>
        <span className="font-mono text-xs text-suave">{i.sku ?? "sem SKU"}</span>
      </>
    ),
  },
  { id: "situacao", rotulo: "Situação", valor: (i) => SITUACAO[i.situacao].rotulo, render: (i) => <Situacao s={i.situacao} /> },
  { id: "fisico", rotulo: "Em estoque", valor: (i) => i.fisico, direita: true },
  { id: "reservado", rotulo: "Reservado", valor: (i) => i.reservado, direita: true, render: (i) => <span className="text-tinta-2">{i.reservado}</span> },
  { id: "disponivel", rotulo: "Disponível", valor: (i) => i.disponivel, direita: true, render: (i) => <b>{i.controlar ? i.disponivel : "—"}</b> },
  { id: "minimo", rotulo: "Mínimo", valor: (i) => i.minimo, direita: true },
  { id: "custo", rotulo: "Custo médio", valor: (i) => i.custo_medio_centavos / 100, direita: true, render: (i) => (i.custo_medio_centavos ? reais(i.custo_medio_centavos) : "—") },
  { id: "valor", rotulo: "Valor em estoque", valor: (i) => i.valor_centavos / 100, direita: true, render: (i) => (i.valor_centavos ? reais(i.valor_centavos) : "—") },
];

export function AbaEstoque({ senha }: { senha: string }) {
  const [dados, setDados] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(await chamar<Painel>("/api/vendedor/estoque", { senha }));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para carregar o estoque.");
    }
  }, [senha]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const semSku = dados?.itens.filter((i) => !i.sku && i.produto_id !== "kit-laminas").length ?? 0;
  const item = dados?.itens.find((i) => i.produto_id === aberto) ?? null;

  async function gerarSkus() {
    try {
      const r = await chamar<{ gerados: number }>("/api/vendedor/estoque/sku", { senha, metodo: "POST", corpo: {} });
      setAviso(`SKU gerado para ${r.gerados} produto(s).`);
      carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para gerar os SKUs.");
    }
  }

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-none font-extrabold uppercase">Estoque</h1>
          <p className="mt-1 text-sm text-tinta-2">
            O saldo de cada produto, o que os pedidos ainda não pagos estão segurando e o custo médio. Tudo o que muda o saldo fica no histórico.
          </p>
        </div>
        {semSku > 0 && (
          <button type="button" onClick={gerarSkus} className="rounded-full border border-linha-2 px-4 py-2 text-sm font-bold hover:border-laranja">
            Gerar SKU para {semSku} produto(s)
          </button>
        )}
      </header>
      {erro && <p className="rounded-xl bg-red-400/10 px-4 py-3 text-sm text-red-300">{erro}</p>}
      {aviso && <p className="rounded-xl bg-ok/10 px-4 py-3 text-sm text-ok">{aviso}</p>}

      {dados && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao rotulo="Valor em estoque" valor={reais(dados.resumo.valor_centavos)} selo="custo médio" tom="neutro">
              Saldo × custo médio de cada produto.
            </Cartao>
            <Cartao rotulo="Unidades" valor={String(dados.resumo.unidades)} selo={`${dados.resumo.reservado} reservadas`} tom="neutro">
              Reservadas: pedidos criados esperando o pagamento.
            </Cartao>
            <Cartao rotulo="Esgotados" valor={String(dados.resumo.esgotados)} selo={dados.resumo.esgotados ? "não vendem" : "nenhum"} tom={dados.resumo.esgotados ? "alerta" : "ok"}>
              Aparecem como “Esgotado” na loja.
            </Cartao>
            <Cartao rotulo="Abaixo do mínimo" valor={String(dados.resumo.baixos)} selo={dados.resumo.baixos ? "repor" : "tudo certo"} tom={dados.resumo.baixos ? "destaque" : "ok"}>
              Disponível igual ou abaixo do mínimo.
            </Cartao>
          </div>

          {item ? (
            <DetalheItem senha={senha} item={item} aoVoltar={() => setAberto(null)} aoMudar={carregar} />
          ) : (
            <Tabela
              linhas={dados.itens}
              colunas={COLUNAS}
              chave={(i) => i.produto_id}
              aoClicar={(i) => {
                setAviso("");
                setAberto(i.produto_id);
              }}
              arquivo="estoque"
              buscaDica="Buscar por nome ou SKU"
            />
          )}
        </>
      )}
    </div>
  );
}

function DetalheItem({ senha, item, aoVoltar, aoMudar }: { senha: string; item: Item; aoVoltar: () => void; aoMudar: () => void }) {
  const caminho = `/api/vendedor/estoque/${encodeURIComponent(item.produto_id)}`;
  const [tipo, setTipo] = useState<TipoLancamento>("entrada");
  const [quantidade, setQuantidade] = useState("");
  const [sinal, setSinal] = useState<"+" | "-">("+");
  const [custo, setCusto] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState("");
  const [minimo, setMinimo] = useState(String(item.minimo));
  const [controlar, setControlar] = useState(item.controlar);
  const [historico, setHistorico] = useState<Movimento[]>([]);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregarHistorico = useCallback(async () => {
    try {
      setHistorico(await chamar<Movimento[]>(`${caminho}/movimentos`, { senha }));
    } catch {
      setHistorico([]);
    }
  }, [caminho, senha]);
  useEffect(() => {
    carregarHistorico();
  }, [carregarHistorico]);

  async function lancar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setOk("");
    const corpo: Record<string, unknown> = { tipo, motivo };
    const n = Number(quantidade);
    if (tipo === "inventario") corpo.contagem = n;
    else corpo.quantidade = tipo === "ajuste" && sinal === "-" ? -n : n;
    if (tipo === "entrada") {
      if (custo.trim()) {
        const c = paraCentavos(custo);
        if (Number.isNaN(c)) return setErro("Custo por unidade: use um valor em reais.");
        corpo.custo_unitario_centavos = c;
      }
      corpo.fornecedor = fornecedor;
      corpo.nota = nota;
    }
    setEnviando(true);
    try {
      const novo = await chamar<Item>(`${caminho}/movimentos`, { senha, corpo });
      setOk(`Lançado. Em estoque agora: ${novo.fisico}.`);
      setQuantidade("");
      setCusto("");
      setMotivo("");
      setNota("");
      aoMudar();
      carregarHistorico();
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não deu para lançar.");
    } finally {
      setEnviando(false);
    }
  }

  async function salvarConfig(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setOk("");
    try {
      await chamar<Item>(caminho, { senha, metodo: "PUT", corpo: { minimo: Number(minimo || 0), controlar } });
      setOk("Configuração salva.");
      aoMudar();
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não deu para salvar.");
    }
  }

  const tipoAtual = TIPOS.find((t) => t.id === tipo)!;
  return (
    <section className="grid gap-5 rounded-2xl border border-linha bg-fundo-2/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={aoVoltar} className="font-mono text-xs tracking-widest text-laranja-2 hover:underline">
            ← TODO O ESTOQUE
          </button>
          <h2 className="mt-1 text-2xl font-extrabold">{item.nome}</h2>
          <p className="font-mono text-xs text-suave">{item.sku ?? "sem SKU"}</p>
        </div>
        <Situacao s={item.situacao} />
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Em estoque", String(item.fisico)],
          ["Reservado", String(item.reservado)],
          ["Disponível", item.controlar ? String(item.disponivel) : "—"],
          ["Custo médio", item.custo_medio_centavos ? reais(item.custo_medio_centavos) : "—"],
          ["Valor", item.valor_centavos ? reais(item.valor_centavos) : "—"],
        ].map(([r, v]) => (
          <div key={r} className="rounded-xl border border-linha p-3">
            <dt className="font-mono text-[11px] tracking-widest text-suave uppercase">{r}</dt>
            <dd className="mt-1 text-xl font-extrabold">{v}</dd>
          </div>
        ))}
      </dl>

      {erro && <p className="rounded-xl bg-red-400/10 px-4 py-3 text-sm text-red-300">{erro}</p>}
      {ok && <p className="rounded-xl bg-ok/10 px-4 py-3 text-sm text-ok">{ok}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={lancar} className="grid content-start gap-4 rounded-xl border border-linha p-4">
          <p className="font-bold">Lançar</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de lançamento">
            {TIPOS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tipo === t.id}
                onClick={() => setTipo(t.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-bold ${tipo === t.id ? "bg-laranja text-black" : "border border-linha-2 hover:border-laranja"}`}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          <p className="text-sm text-tinta-2">{tipoAtual.dica}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo={tipo === "inventario" ? "Quantidade contada" : "Quantidade"}>
              <span className="flex gap-2">
                {tipo === "ajuste" && (
                  <select className="campo w-20" value={sinal} onChange={(e) => setSinal(e.target.value as "+" | "-")} aria-label="Para mais ou para menos">
                    <option value="+">+</option>
                    <option value="-">−</option>
                  </select>
                )}
                <input className="campo min-w-0 flex-1" required inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))} />
              </span>
            </Campo>
            {tipo === "entrada" && (
              <Campo rotulo="Custo por unidade (opcional)" dica="Em reais. Atualiza o custo médio.">
                <input className="campo" inputMode="decimal" placeholder="0,00" value={custo} onChange={(e) => setCusto(e.target.value)} />
              </Campo>
            )}
          </div>
          {tipo === "entrada" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Fornecedor (opcional)">
                <input className="campo" maxLength={120} value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
              </Campo>
              <Campo rotulo="Nota fiscal (opcional)">
                <input className="campo font-mono" maxLength={60} value={nota} onChange={(e) => setNota(e.target.value)} />
              </Campo>
            </div>
          )}
          <Campo rotulo={["ajuste", "perda"].includes(tipo) ? "Motivo" : "Observação (opcional)"}>
            <input className="campo" maxLength={300} required={["ajuste", "perda"].includes(tipo)} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <button type="submit" disabled={enviando || !quantidade} className="btn-laranja justify-self-start px-6 py-3 text-sm disabled:opacity-50">
            {enviando ? "Lançando…" : `Lançar ${tipoAtual.rotulo.toLowerCase()}`}
          </button>
        </form>

        <form onSubmit={salvarConfig} className="grid content-start gap-4 rounded-xl border border-linha p-4">
          <p className="font-bold">Controle</p>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-0.5 size-4 accent-laranja" checked={controlar} onChange={(e) => setControlar(e.target.checked)} />
            <span>
              Controlar o saldo
              <span className="block font-normal text-suave">Ligado: sem saldo, aparece “Esgotado” e não vende. Desligado: vende sem olhar o saldo.</span>
            </span>
          </label>
          <Campo rotulo="Estoque mínimo" dica="Com o disponível neste número ou abaixo, o item fica “Baixo”.">
            <input className="campo" inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value.replace(/\D/g, ""))} />
          </Campo>
          <button type="submit" className="justify-self-start rounded-full border border-linha-2 px-5 py-2.5 text-sm font-bold hover:border-laranja">
            Salvar
          </button>
        </form>
      </div>

      <div>
        <p className="mb-2 font-bold">Histórico</p>
        {historico.length === 0 ? (
          <p className="text-sm text-suave">Nenhum movimento ainda.</p>
        ) : (
          <ul className="divide-y divide-linha rounded-xl border border-linha">
            {historico.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <b>{ROTULO_MOVIMENTO[m.tipo] ?? m.tipo}</b>{" "}
                  <span className={m.quantidade > 0 ? "text-ok" : "text-red-300"}>
                    {m.quantidade > 0 ? "+" : ""}
                    {m.quantidade}
                  </span>
                  {m.custo_unitario_centavos != null && <span className="text-suave"> · {reais(m.custo_unitario_centavos)} cada</span>}
                  {m.pedido_nsu && <span className="font-mono text-xs text-suave"> · pedido {m.pedido_nsu}</span>}
                  {m.fornecedor && <span className="text-suave"> · {m.fornecedor}</span>}
                  {m.nota && <span className="font-mono text-xs text-suave"> · NF {m.nota}</span>}
                  {m.motivo && <span className="block text-xs text-tinta-2">{m.motivo}</span>}
                </span>
                <span className="text-right font-mono text-xs text-suave">
                  saldo {m.saldo_depois}
                  <span className="block">
                    {dataHora(m.quando)}
                    {m.email ? ` · ${m.email}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
