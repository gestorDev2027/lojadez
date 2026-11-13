import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { chamar, ErroApi, formatarCep, formatarCpf, formatarTelefone, reais, type PedidoVendedor } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { rotuloPagamento, Selo, VisaoGeral } from "./VendedorPainel";
import { AbaIntegracoes, AbaProduto } from "./VendedorAjustes";
import { AbaAfiliados } from "./VendedorAfiliados";
import { AbaConfiguracoes } from "./VendedorConfiguracoes";
import { AbaCupons } from "./VendedorCupons";
import { AbaProdutos } from "./VendedorProdutos";

// A área do vendedor: entra com e-mail e senha; a sessão (um token, vale 12 horas) fica só nesta aba do navegador.
// As telas usam o token no lugar da antiga senha única (a prop continua se chamando "senha").
const CHAVE = "loja-sessao-vendedor";

const FILTROS: { valor: string; rotulo: string; situacoes: string[] }[] = [
  { valor: "pago", rotulo: "Para enviar", situacoes: ["pago"] },
  { valor: "aguardando_pagamento", rotulo: "Aguardando", situacoes: ["aguardando_pagamento", "pagamento_divergente"] },
  { valor: "enviado", rotulo: "Enviados", situacoes: ["enviado"] },
  { valor: "reembolsos", rotulo: "Reembolsos", situacoes: ["reembolso_pendente", "reembolsado"] },
  { valor: "", rotulo: "Todos", situacoes: [] },
];

const SITUACOES: Record<string, { rotulo: string; cor: string }> = {
  pago: { rotulo: "Pago", cor: "bg-ok/15 text-ok" },
  aguardando_pagamento: { rotulo: "Aguardando pagamento", cor: "bg-amber-400/15 text-amber-300" },
  enviado: { rotulo: "Enviado", cor: "bg-sky-400/15 text-sky-300" },
  cancelado: { rotulo: "Cancelado", cor: "bg-white/10 text-suave" },
  pagamento_divergente: { rotulo: "Valor divergente", cor: "bg-red-400/15 text-red-300" },
  reembolso_pendente: { rotulo: "Reembolso pendente", cor: "bg-amber-400/15 text-amber-300" },
  reembolsado: { rotulo: "Reembolsado", cor: "bg-white/10 text-tinta-2" },
};

function lerSenha() {
  try {
    return sessionStorage.getItem(CHAVE) ?? "";
  } catch {
    return "";
  }
}

type Aba = "visao" | "pedidos" | "produto" | "produtos" | "afiliados" | "cupons" | "integracoes" | "configuracoes";

const MENU: { id: Aba | "financeiro"; rotulo: string; icone: string; breve?: boolean }[] = [
  { id: "visao", rotulo: "Visão geral", icone: "M4 13h6V4H4zM14 20h6V11h-6zM4 20h6v-3H4zM14 7h6V4h-6z" },
  { id: "pedidos", rotulo: "Pedidos", icone: "M6 3h12l2 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7zM4 7h16M9 11h6" },
  { id: "produto", rotulo: "Kit de lâminas", icone: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" },
  { id: "produtos", rotulo: "Produtos", icone: "M3 9h18l-2 11H5zM8 9V6a4 4 0 0 1 8 0v3" },
  { id: "afiliados", rotulo: "Afiliados", icone: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0" },
  { id: "cupons", rotulo: "Cupons", icone: "M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 0 0-4V4H3zM10 4v16" },
  { id: "financeiro", rotulo: "Financeiro", icone: "M4 19V5M4 19h16M8 15l4-4 3 3 5-6", breve: true },
  { id: "integracoes", rotulo: "Integrações", icone: "M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0zM12 17v4" },
  { id: "configuracoes", rotulo: "Configurações", icone: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4z" },
];

function Icone({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function PaginaVendedor() {
  const [senha, setSenha] = useState(lerSenha);
  const [aba, setAba] = useState<Aba>("visao");
  const [email, setEmail] = useState("");
  const [pedidoAberto, setPedidoAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!senha) return;
    chamar<{ email: string }>("/api/vendedor/eu", { senha })
      .then((r) => setEmail(r.email))
      .catch((e) => e instanceof ErroApi && e.status === 401 && sair());
  }, [senha]);

  function encerrar() {
    if (senha) void chamar("/api/vendedor/sair", { senha, corpo: {} }).catch(() => undefined);
    sair();
  }

  function sair() {
    try {
      sessionStorage.removeItem(CHAVE);
    } catch {
      /* sem armazenamento: só esquece na memória */
    }
    setSenha("");
    setEmail("");
    setErro("");
  }

  if (!senha)
    return (
      <Entrar
        erro={erro}
        aoEntrar={(s) => {
          try {
            sessionStorage.setItem(CHAVE, s);
          } catch {
            /* segue só na memória */
          }
          setSenha(s);
        }}
      />
    );

  return (
    <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-0 lg:grid-cols-[236px_minmax(0,1fr)]">
      {/* Menu lateral (no celular, uma faixa que rola) */}
      <aside className="min-w-0 border-b border-linha lg:sticky lg:top-[61px] lg:h-[calc(100dvh-61px)] lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col gap-4 p-3 lg:p-4">
          <p className="hidden px-2 font-mono text-[11px] font-bold tracking-[.16em] text-suave uppercase lg:block">Gestão da loja</p>
          <nav aria-label="Área do vendedor" className="flex gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:overflow-visible">
            {MENU.map((m) => {
              const ativo = aba === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={m.breve}
                  aria-current={ativo ? "page" : undefined}
                  onClick={() => !m.breve && setAba(m.id as Aba)}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    ativo
                      ? "bg-laranja text-black shadow-[0_8px_24px_-12px_rgba(255,106,19,.8)]"
                      : m.breve
                        ? "cursor-default text-suave/70"
                        : "text-tinta-2 hover:bg-white/[.05] hover:text-tinta"
                  }`}
                >
                  <Icone d={m.icone} />
                  <span className="whitespace-nowrap">{m.rotulo}</span>
                  {m.breve && <span className="ml-auto rounded-full bg-white/[.06] px-2 py-0.5 font-mono text-[10px] text-suave">em breve</span>}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto hidden border-t border-linha pt-4 lg:block">
            {email && <p className="truncate px-2 font-mono text-xs text-suave" title={email}>{email}</p>}
            <button type="button" onClick={encerrar} className="mt-2 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-tinta-2 hover:bg-white/[.05]">
              Sair
            </button>
          </div>
        </div>
      </aside>

      <section className="min-w-0 px-4 py-6 lg:px-8">
        <div className="mb-4 flex items-center justify-end gap-3 lg:hidden">
          {email && <span className="truncate font-mono text-xs text-suave">{email}</span>}
          <button type="button" onClick={encerrar} className="rounded-full px-3 py-1.5 text-sm text-suave">
            Sair
          </button>
        </div>
        {aba === "visao" ? (
          <VisaoGeral
            senha={senha}
            aoAbrirPedido={(nsu) => {
              setPedidoAberto(nsu);
              setAba("pedidos");
            }}
          />
        ) : aba === "pedidos" ? (
          <AbaPedidos senha={senha} aberto={pedidoAberto} aoAbrir={setPedidoAberto} aoSair={sair} />
        ) : aba === "produto" ? (
          <AbaProduto senha={senha} />
        ) : aba === "produtos" ? (
          <AbaProdutos senha={senha} />
        ) : aba === "afiliados" ? (
          <AbaAfiliados senha={senha} />
        ) : aba === "cupons" ? (
          <AbaCupons senha={senha} />
        ) : aba === "integracoes" ? (
          <AbaIntegracoes senha={senha} />
        ) : (
          <AbaConfiguracoes senha={senha} aoSair={sair} />
        )}
      </section>
    </div>
  );
}

// Os pedidos na tabela padrão (busca, ordem, páginas, planilha) e, ao clicar numa linha, o pedido completo ao lado.
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const COLUNAS_PEDIDOS: ColunaTabela<PedidoVendedor>[] = [
  {
    id: "data",
    rotulo: "Data",
    valor: (p) => p.criado_em,
    render: (p) => <span className="font-mono text-xs text-tinta-2">{dataHora(p.criado_em)}</span>,
  },
  {
    id: "cliente",
    rotulo: "Cliente",
    valor: (p) => `${p.nome} ${p.email} ${p.cpf} ${p.telefone} ${p.cidade}/${p.uf}`,
    render: (p) => (
      <>
        <span className="block font-semibold">{p.nome}</span>
        <span className="text-xs text-suave">
          {p.cidade}/{p.uf}
        </span>
      </>
    ),
  },
  {
    id: "produto",
    rotulo: "Produto",
    valor: (p) => p.produto,
    render: (p) => (
      <span className="block max-w-[300px] text-tinta-2">
        <span className="line-clamp-2">{p.produto}</span>
        {p.frete_centavos === 0 && <span className="font-mono text-[10px] font-bold text-ok">FRETE GRÁTIS</span>}
      </span>
    ),
  },
  { id: "afiliado", rotulo: "Afiliado", valor: (p) => p.afiliado_codigo ?? "", render: (p) => <span className="text-tinta-2">{p.afiliado_codigo ?? "—"}</span> },
  {
    id: "pagamento",
    rotulo: "Pagamento",
    valor: (p) => `${rotuloPagamento(p.forma_pagamento)}${p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x` : ""}`,
  },
  {
    id: "valor",
    rotulo: "Valor",
    direita: true,
    valor: (p) => p.total_centavos / 100,
    render: (p) => <span className="font-mono font-bold">{reais(p.total_centavos)}</span>,
  },
  { id: "situacao", rotulo: "Situação", valor: (p) => SITUACOES[p.situacao]?.rotulo ?? p.situacao, render: (p) => <Selo situacao={p.situacao} /> },
  {
    id: "envio",
    rotulo: "Envio",
    valor: (p) => p.codigo_rastreio ?? (p.situacao === "pago" ? (p.envio_erro ? "Envio falhou" : "Criar envio") : ""),
    render: (p) =>
      p.codigo_rastreio ? (
        <span className="font-mono text-xs">{p.codigo_rastreio}</span>
      ) : p.situacao === "pago" ? (
        <span className="text-xs text-amber-300">{p.envio_erro ? "Envio falhou" : "Criar envio"}</span>
      ) : (
        <span className="text-suave">—</span>
      ),
  },
  { id: "pedido", rotulo: "Pedido", valor: (p) => p.order_nsu, render: (p) => <span className="font-mono text-[11px] text-suave">{p.order_nsu.slice(0, 8)}</span> },
];

function AbaPedidos({
  senha,
  aberto,
  aoAbrir,
  aoSair,
}: {
  senha: string;
  aberto: string | null;
  aoAbrir: (nsu: string | null) => void;
  aoSair: () => void;
}) {
  const [filtro, setFiltro] = useState(aberto ? "" : "pago");
  const [lista, setLista] = useState<PedidoVendedor[] | null>(null);
  const [erro, setErro] = useState("");
  const sairRef = useRef(aoSair);
  sairRef.current = aoSair;

  const carregar = useCallback(async () => {
    setErro("");
    try {
      setLista(await chamar<PedidoVendedor[]>("/api/vendedor/pedidos", { senha }));
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) sairRef.current();
      setErro((e as Error).message);
    }
  }, [senha]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const contagem = (f: (typeof FILTROS)[number]) =>
    (lista ?? []).filter((p) => !f.situacoes.length || f.situacoes.includes(p.situacao)).length;
  const escolhido = FILTROS.find((f) => f.valor === filtro) ?? FILTROS[FILTROS.length - 1];
  const linhas = (lista ?? []).filter((p) => !escolhido.situacoes.length || escolhido.situacoes.includes(p.situacao));
  const selecionado = (lista ?? []).find((p) => p.order_nsu === aberto) ?? null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Pedidos</h1>
          <p className="mt-1 text-sm text-suave">Clique num pedido para ver o endereço, criar o envio na Loggi, marcar como enviado ou cancelar e reembolsar.</p>
        </div>
        <button type="button" onClick={() => void carregar()} className="rounded-xl border border-linha-2 bg-fundo-2 px-4 py-2 text-sm font-semibold hover:border-laranja">
          Atualizar
        </button>
      </div>

      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {lista === null ? (
        <p className="text-suave">Carregando…</p>
      ) : (
        <Tabela
          linhas={linhas}
          colunas={COLUNAS_PEDIDOS}
          chave={(p) => p.order_nsu}
          aoClicar={(p) => aoAbrir(p.order_nsu)}
          selecionada={aberto}
          ordemInicial={{ coluna: "data", desc: true }}
          buscaDica="Buscar por nome, e-mail, CPF, telefone, cidade, produto, afiliado ou pedido"
          arquivo="pedidos"
          vazio="Nenhum pedido aqui."
          larguraMinima={980}
          extras={
            <div role="tablist" aria-label="Filtrar pedidos" className="flex gap-1 overflow-x-auto rounded-xl border border-linha-2 bg-fundo p-1 [scrollbar-width:none]">
              {FILTROS.map((f) => (
                <button
                  key={f.valor}
                  role="tab"
                  aria-selected={filtro === f.valor}
                  type="button"
                  onClick={() => setFiltro(f.valor)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${filtro === f.valor ? "bg-laranja text-black" : "text-tinta-2 hover:text-tinta"}`}
                >
                  {f.rotulo} <span className="font-mono text-[11px] opacity-70">{contagem(f)}</span>
                </button>
              ))}
            </div>
          }
        />
      )}

      {/* O pedido aberto, num painel à direita */}
      {aberto && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={() => aoAbrir(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pedido"
            className="h-full w-full max-w-[540px] overflow-y-auto border-l border-linha-2 bg-fundo p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[11px] font-bold tracking-[.14em] text-suave uppercase">Pedido</p>
              <button type="button" onClick={() => aoAbrir(null)} className="rounded-xl border border-linha-2 px-3 py-1.5 text-sm font-semibold" autoFocus>
                Fechar
              </button>
            </div>
            {selecionado ? (
              <ul>
                <CartaoPedido pedido={selecionado} senha={senha} aoMudar={() => void carregar()} />
              </ul>
            ) : (
              <p className="text-suave">{lista === null ? "Carregando…" : "Pedido não encontrado."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Cancelar um pedido pago: o estorno é feito na InfinitePay (a API dela não estorna); aqui fica o motivo e o valor,
// o envio na Loggi é cancelado (se ainda der) e, feito o estorno, o pedido é marcado como reembolsado.
const MOTIVOS = [
  { id: "arrependimento", rotulo: "Cliente desistiu da compra" },
  { id: "sem_estoque", rotulo: "Sem estoque" },
  { id: "endereco", rotulo: "Endereço errado ou entrega não feita" },
  { id: "defeito", rotulo: "Produto com defeito" },
  { id: "outro", rotulo: "Outro motivo" },
];
const paraReais = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
const paraCentavos = (texto: string) => {
  const v = Number.parseFloat(texto.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
};

function Reembolso({ pedido: p, senha, aoMudar }: { pedido: PedidoVendedor; senha: string; aoMudar: () => void }) {
  const pago = p.valor_pago_centavos && p.forma_pagamento === "pix" ? p.valor_pago_centavos : p.total_centavos;
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("arrependimento");
  const [detalhe, setDetalhe] = useState("");
  const [valor, setValor] = useState(paraReais(p.reembolso_centavos ?? pago));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [copiado, setCopiado] = useState(false);

  async function enviar(caminho: string, corpo: object) {
    setErro("");
    setOcupado(true);
    try {
      const r = await chamar<{ aviso_loggi?: string | null }>(`/api/vendedor/pedidos/${p.order_nsu}/${caminho}`, { senha, corpo });
      if (r.aviso_loggi) setAviso(r.aviso_loggi);
      setAberto(false);
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (p.situacao === "reembolsado")
    return (
      <div className="grid gap-1 rounded-xl border border-linha-2 p-3 text-sm">
        <p className="font-bold">Reembolsado: {reais(p.reembolso_centavos ?? 0)}</p>
        <p className="text-suave">{p.reembolso_motivo}</p>
        {p.reembolsado_em && <p className="text-xs text-suave">Confirmado em {new Date(p.reembolsado_em).toLocaleString("pt-BR")}</p>}
      </div>
    );

  if (p.situacao === "reembolso_pendente")
    return (
      <div className="grid gap-2 rounded-xl border border-amber-400/40 bg-amber-400/[.06] p-3 text-sm">
        <p className="font-bold text-amber-300">Reembolso pendente: {reais(p.reembolso_centavos ?? 0)}</p>
        <p className="text-tinta-2">{p.reembolso_motivo}</p>
        {aviso && <p className="text-tinta-2">{aviso}</p>}
        <ol className="ml-4 list-decimal space-y-1 text-tinta-2">
          <li>Abra o app (ou o site) da InfinitePay, em Vendas, e ache esta venda pelo código abaixo ou pelo valor.</li>
          <li>Faça o estorno de {reais(p.reembolso_centavos ?? 0)}.</li>
          <li>Volte aqui e clique em “Marcar como reembolsado”.</li>
        </ol>
        {p.transaction_nsu && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-fundo px-2 py-1.5 font-mono text-xs">{p.transaction_nsu}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(p.transaction_nsu ?? "").catch(() => undefined);
                setCopiado(true);
                window.setTimeout(() => setCopiado(false), 2000);
              }}
              className="rounded-lg border border-laranja/60 px-3 py-1.5 text-xs font-bold text-laranja-2"
            >
              {copiado ? "Copiado" : "Copiar código"}
            </button>
          </div>
        )}
        {p.recibo_url && (
          <a href={p.recibo_url} target="_blank" rel="noreferrer" className="text-xs text-laranja-2 hover:underline">
            Ver o recibo da InfinitePay
          </a>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            Valor devolvido (R$)
            <input className="campo w-32 py-2 font-mono text-sm" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void enviar("reembolsado", { valor_centavos: paraCentavos(valor) })}
            className="btn-laranja px-4 py-2.5 text-xs"
          >
            {ocupado ? "Salvando…" : "Marcar como reembolsado"}
          </button>
        </div>
        {erro && <p role="alert" className="text-alerta">{erro}</p>}
      </div>
    );

  if (p.situacao !== "pago" && p.situacao !== "enviado") return null;
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className="justify-self-start text-sm font-medium text-red-300 hover:underline">
        Cancelar e reembolsar
      </button>
    );
  return (
    <div className="grid gap-3 rounded-xl border border-red-400/40 bg-red-400/[.05] p-3 text-sm">
      <p className="font-bold">Cancelar e reembolsar</p>
      <p className="text-tinta-2">
        O dinheiro volta pela InfinitePay (no app dela). Aqui o pedido fica como “Reembolso pendente”, a comissão do afiliado sai e
        {p.loggi_key ? " o envio na Loggi é cancelado (se ainda der)." : " ele deixa de contar como venda."}
      </p>
      <label className="grid gap-1">
        Motivo
        <select className="campo py-2" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          {MOTIVOS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        Detalhe (opcional)
        <input className="campo py-2" maxLength={300} value={detalhe} onChange={(e) => setDetalhe(e.target.value)} />
      </label>
      <label className="grid gap-1">
        Valor a devolver (R$) · pago {reais(pago)}
        <input className="campo w-40 py-2 font-mono" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            if (window.confirm(`Cancelar este pedido e reembolsar ${reais(paraCentavos(valor) || 0)}?`))
              void enviar("reembolso", { motivo, detalhe, valor_centavos: paraCentavos(valor) });
          }}
          className="rounded-full bg-red-500/90 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-500"
        >
          {ocupado ? "Cancelando…" : "Cancelar o pedido"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="rounded-full px-4 py-2 text-xs text-suave">
          Voltar
        </button>
      </div>
      {erro && <p role="alert" className="text-alerta">{erro}</p>}
    </div>
  );
}

function Entrar({ erro: erroDeFora, aoEntrar }: { erro: string; aoEntrar: (token: string) => void }) {
  const [primeiro, setPrimeiro] = useState<boolean | null>(null);

  useEffect(() => {
    chamar<{ disponivel: boolean }>("/api/vendedor/primeiro-acesso")
      .then((r) => setPrimeiro(r.disponivel))
      .catch(() => setPrimeiro(false));
  }, []);

  if (primeiro === null) return <p className="mx-auto max-w-sm px-4 py-12 text-suave">Carregando…</p>;
  if (primeiro) return <PrimeiroAcesso aoEntrar={aoEntrar} aoDesistir={() => setPrimeiro(false)} />;
  return <FormEntrar erro={erroDeFora} aoEntrar={aoEntrar} />;
}

// Sem nenhum acesso criado: o primeiro é criado aqui, com o código de uso único que a loja mostra no terminal (no
// Render, nos logs) quando liga. Criado o primeiro, esta tela some.
function PrimeiroAcesso({ aoEntrar, aoDesistir }: { aoEntrar: (token: string) => void; aoDesistir: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 10) return setErro("A senha precisa ter pelo menos 10 caracteres.");
    if (senha !== repetir) return setErro("As duas senhas estão diferentes.");
    setCriando(true);
    try {
      const r = await chamar<{ token: string }>("/api/vendedor/primeiro-acesso", { corpo: { codigo, email, senha } });
      setSenha("");
      setRepetir("");
      aoEntrar(r.token);
    } catch (falha) {
      if ((falha as { status?: number }).status === 409) return aoDesistir();
      setErro((falha as Error).message);
    } finally {
      setCriando(false);
    }
  }

  const tipo = ver ? "text" : "password";
  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <form className="grid gap-3 rounded-2xl border border-linha bg-cartao p-6" onSubmit={(e) => void enviar(e)}>
        <h1 className="text-xl font-bold">Criar o primeiro acesso</h1>
        <p className="text-sm text-tinta-2">
          A loja ainda não tem acesso à área do vendedor. Use o código de 8 números que aparece no terminal onde a loja
          está rodando (no Render, nos Logs). Ele vale uma vez só.
        </p>
        <label className="grid gap-1.5 text-sm font-medium">
          Código do terminal
          <input
            className="campo font-mono tracking-widest"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="0000-0000"
            maxLength={9}
            required
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Seu e-mail
          <input className="campo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Senha (pelo menos 10 caracteres)
          <input className="campo" type={tipo} autoComplete="new-password" required minLength={10} value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Repita a senha
          <input className="campo" type={tipo} autoComplete="new-password" required value={repetir} onChange={(e) => setRepetir(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-tinta-2">
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
          Mostrar a senha
        </label>
        {erro && (
          <p role="alert" className="text-sm text-alerta">
            {erro}
          </p>
        )}
        <button type="submit" disabled={criando} className="btn-laranja px-5 py-3 text-sm">
          {criando ? "Criando…" : "Criar acesso e entrar"}
        </button>
      </form>
    </section>
  );
}

function FormEntrar({ erro: erroDeFora, aoEntrar }: { erro: string; aoEntrar: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      const r = await chamar<{ token: string }>("/api/vendedor/entrar", { corpo: { email, senha } });
      setSenha("");
      aoEntrar(r.token);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEntrando(false);
    }
  }

  const mensagem = erro || erroDeFora;
  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <form className="grid gap-3 rounded-2xl border border-linha bg-cartao p-6" onSubmit={(e) => void enviar(e)}>
        <h1 className="text-xl font-bold">Área do vendedor</h1>
        <label className="grid gap-1.5 text-sm font-medium">
          E-mail
          <input className="campo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Senha
          <input className="campo" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {mensagem && (
          <p role="alert" className="text-sm text-alerta">
            {mensagem}
          </p>
        )}
        <button type="submit" disabled={entrando} className="btn-laranja px-5 py-3 text-sm">
          {entrando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </section>
  );
}

function CartaoPedido({ pedido: p, senha, aoMudar }: { pedido: PedidoVendedor; senha: string; aoMudar: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const situacao = SITUACOES[p.situacao] ?? { rotulo: p.situacao, cor: "bg-white/10" };
  const endereco = [
    p.nome,
    `${p.rua}, ${p.numero}${p.complemento ? ` - ${p.complemento}` : ""}`,
    `${p.bairro} - ${p.cidade}/${p.uf}`,
    `CEP ${formatarCep(p.cep)}`,
  ];

  async function acao(caminho: string, corpo?: unknown) {
    setErro("");
    try {
      await chamar(`/api/vendedor/pedidos/${p.order_nsu}/${caminho}`, { metodo: "POST", corpo, senha });
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function comOcupado(fazer: () => Promise<void>) {
    setOcupado(true);
    try {
      await fazer();
    } finally {
      setOcupado(false);
    }
  }

  async function baixarEtiqueta() {
    setErro("");
    try {
      const r = await fetch(`/api/vendedor/pedidos/${p.order_nsu}/loggi/etiqueta`, { headers: { Authorization: `Bearer ${senha}` } });
      if (!r.ok) {
        const dados = await r.json().catch(() => ({}));
        throw new Error(dados.erro ?? dados.detail ?? "Não consegui gerar a etiqueta.");
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiqueta-loggi-${p.order_nsu.slice(0, 8)}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(endereco.join("\n"));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("Não deu para copiar: selecione o texto.");
    }
  }

  return (
    <li className="grid gap-3 rounded-2xl border border-linha bg-cartao p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${situacao.cor}`}>{situacao.rotulo}</span>
        <span className="text-xs text-suave">{new Date(p.criado_em).toLocaleString("pt-BR")}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="font-semibold">
            {p.produto}
          </p>
          <p className="text-sm text-suave">{p.frete_descricao}</p>
          {p.frete_centavos === 0 && p.frete_custo_centavos ? (
            <p className="text-xs text-suave">Frete pago pela loja na Loggi: {reais(p.frete_custo_centavos)}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{reais(p.total_centavos)}</p>
          {p.forma_pagamento && (
            <p className="text-xs text-suave">
              {p.forma_pagamento === "pix" ? "Pix" : `Cartão${p.parcelas && p.parcelas > 1 ? ` em ${p.parcelas}x` : ""}`}
            </p>
          )}
        </div>
      </div>
      <div className="rounded-xl bg-fundo-2 p-3 text-sm">
        <address className="not-italic">
          {endereco.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </address>
        <p className="mt-2 text-suave">
          {p.email} · {formatarTelefone(p.telefone)} · CPF {formatarCpf(p.cpf)}
        </p>
        <button type="button" onClick={() => void copiar()} className="mt-2 text-sm font-medium text-laranja-2">
          {copiado ? "Endereço copiado" : "Copiar endereço"}
        </button>
      </div>
      {(p.situacao === "pago" || p.situacao === "enviado") && (
        <div className="grid gap-2 rounded-xl border border-linha-2 p-3">
          <p className="flex items-center justify-between gap-2 text-sm">
            <span className="font-bold">Loggi</span>
            <span className="font-mono text-xs text-suave">
              {p.loggi_key ? `Envio criado · rastreio ${p.codigo_rastreio || "—"}` : "Sem envio"}
            </span>
          </p>
          {!p.loggi_key && p.envio_erro && (
            <p role="alert" className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              O envio automático falhou: {p.envio_erro} Confira e crie o envio à mão.
            </p>
          )}
          {!p.loggi_key ? (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                if (window.confirm("Criar o envio na Loggi? Ele aparece no painel da Loggi e pode gerar cobrança do frete."))
                  void comOcupado(() => acao("loggi/envio"));
              }}
              className="btn-laranja px-4 py-2.5 text-xs"
            >
              {ocupado ? "Criando…" : "Criar envio na Loggi"}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void comOcupado(baixarEtiqueta)}
                className="btn-laranja px-4 py-2.5 text-xs"
              >
                {ocupado ? "Gerando…" : "Etiqueta (PDF)"}
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => {
                  if (window.confirm("Cancelar o envio na Loggi? Se o pacote já estiver em rota, o cancelamento pode não valer."))
                    void comOcupado(() => acao("loggi/cancelar"));
                }}
                className="rounded-full px-3 text-xs font-medium text-alerta"
              >
                Cancelar envio
              </button>
            </div>
          )}
        </div>
      )}
      {p.situacao === "pago" && (
        <form
          className="flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void acao("enviado", { codigo_rastreio: codigo });
          }}
        >
          <label className="sr-only" htmlFor={`rastreio-${p.order_nsu}`}>
            Código de rastreio
          </label>
          <input
            id={`rastreio-${p.order_nsu}`}
            className="campo"
            placeholder={p.codigo_rastreio ? `Rastreio ${p.codigo_rastreio}` : "Código de rastreio"}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <button type="submit" className="btn-laranja shrink-0 rounded-[14px] px-4 text-xs" title="Depois de deixar o pacote no ponto Loggi">
            Marcar enviado
          </button>
        </form>
      )}
      {p.situacao === "enviado" && p.codigo_rastreio && <p className="text-sm">Enviado · rastreio {p.codigo_rastreio}</p>}
      {(p.situacao === "aguardando_pagamento" || p.situacao === "pagamento_divergente") && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Cancelar este pedido?")) void acao("cancelar");
          }}
          className="justify-self-start text-sm font-medium text-alerta"
        >
          Cancelar pedido
        </button>
      )}
      {erro && (
        <p role="alert" className="text-sm text-alerta">
          {erro}
        </p>
      )}
      <Reembolso pedido={p} senha={senha} aoMudar={aoMudar} />
      <p className="text-xs text-suave">Pedido {p.order_nsu}</p>
    </li>
  );
}
