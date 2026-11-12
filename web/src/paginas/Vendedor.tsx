import { useCallback, useEffect, useState, type FormEvent } from "react";
import { chamar, ErroApi, formatarCep, formatarCpf, formatarTelefone, reais, type PedidoVendedor } from "../api";
import { AbaIntegracoes, AbaProduto } from "./VendedorAjustes";

// A área do vendedor: os pedidos, com os dados de entrega. A senha (VENDEDOR_SENHA) fica só nesta aba do navegador.
const CHAVE = "loja-senha-vendedor";

const FILTROS = [
  { valor: "pago", rotulo: "Para enviar" },
  { valor: "aguardando_pagamento", rotulo: "Aguardando pagamento" },
  { valor: "enviado", rotulo: "Enviados" },
  { valor: "", rotulo: "Todos" },
];

const SITUACOES: Record<string, { rotulo: string; cor: string }> = {
  pago: { rotulo: "Pago", cor: "bg-ok/15 text-ok" },
  aguardando_pagamento: { rotulo: "Aguardando pagamento", cor: "bg-amber-400/15 text-amber-300" },
  enviado: { rotulo: "Enviado", cor: "bg-sky-400/15 text-sky-300" },
  cancelado: { rotulo: "Cancelado", cor: "bg-white/10 text-suave" },
  pagamento_divergente: { rotulo: "Valor divergente", cor: "bg-red-400/15 text-red-300" },
};

function lerSenha() {
  try {
    return sessionStorage.getItem(CHAVE) ?? "";
  } catch {
    return "";
  }
}

export function PaginaVendedor() {
  const [senha, setSenha] = useState(lerSenha);
  const [aba, setAba] = useState<"pedidos" | "produto" | "integracoes">("pedidos");
  const [filtro, setFiltro] = useState("pago");
  const [lista, setLista] = useState<PedidoVendedor[] | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    if (!senha) return;
    setErro("");
    try {
      setLista(await chamar<PedidoVendedor[]>(`/api/vendedor/pedidos${filtro ? `?situacao=${filtro}` : ""}`, { senha }));
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) sair();
      setErro((e as Error).message);
    }
  }, [senha, filtro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function sair() {
    try {
      sessionStorage.removeItem(CHAVE);
    } catch {
      /* sem armazenamento: só esquece na memória */
    }
    setSenha("");
    setLista(null);
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

  const abas = [
    { id: "pedidos", rotulo: "Pedidos" },
    { id: "produto", rotulo: "Produto e preços" },
    { id: "integracoes", rotulo: "Integrações" },
  ] as const;

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Área do vendedor" className="flex gap-1 overflow-x-auto rounded-full border border-linha-2 bg-fundo-2 p-1">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-current={aba === a.id ? "page" : undefined}
              onClick={() => setAba(a.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${aba === a.id ? "bg-laranja text-black" : "text-tinta-2 hover:text-tinta"}`}
            >
              {a.rotulo}
            </button>
          ))}
        </nav>
        <div className="flex gap-2">
          {aba === "pedidos" && (
            <button type="button" onClick={() => void carregar()} className="rounded-full border border-linha-2 px-4 py-2 text-sm font-medium">
              Atualizar
            </button>
          )}
          <button type="button" onClick={sair} className="rounded-full px-4 py-2 text-sm font-medium text-suave">
            Sair
          </button>
        </div>
      </div>

      {aba === "produto" ? (
        <AbaProduto senha={senha} />
      ) : aba === "integracoes" ? (
        <AbaIntegracoes senha={senha} />
      ) : (
        <>
      <div role="tablist" aria-label="Filtrar pedidos" className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            role="tab"
            aria-selected={filtro === f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
              filtro === f.valor ? "bg-laranja text-black font-bold" : "border border-linha bg-cartao"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {erro && (
        <p role="alert" className="mt-4 text-alerta">
          {erro}
        </p>
      )}
      {lista === null ? (
        <p className="mt-6 text-suave">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-linha p-8 text-center text-suave">Nenhum pedido aqui.</p>
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {lista.map((p) => (
            <CartaoPedido key={p.order_nsu} pedido={p} senha={senha} aoMudar={() => void carregar()} />
          ))}
        </ul>
      )}
        </>
      )}
    </section>
  );
}

function Entrar({ erro, aoEntrar }: { erro: string; aoEntrar: (senha: string) => void }) {
  const [valor, setValor] = useState("");
  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <form
        className="grid gap-3 rounded-2xl border border-linha bg-cartao p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valor) aoEntrar(valor);
        }}
      >
        <h1 className="text-xl font-bold">Área do vendedor</h1>
        <label className="grid gap-1.5 text-sm font-medium">
          Senha
          <input className="campo" type="password" autoComplete="current-password" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        {erro && (
          <p role="alert" className="text-sm text-alerta">
            {erro}
          </p>
        )}
        <button type="submit" className="btn-laranja px-5 py-3 text-sm">
          Entrar
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
      <p className="text-xs text-suave">Pedido {p.order_nsu}</p>
    </li>
  );
}
