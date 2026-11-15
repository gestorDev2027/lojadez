import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { chamar, reais } from "../api";
import { Tabela, type ColunaTabela } from "./Tabela";
import { Campo, Cartao } from "./VendedorAjustes";

// A aba "Produtos": os produtos novos (pomada, óleo, balm...). Cada um ganha a página /p/<endereço> e o checkout próprio.
// O kit de lâminas continua na aba "Produto e preços", com a landing page dele.

type OfertaProduto = { quantidade: number; preco_centavos: number; selo: string };
type ProdutoVendedor = {
  slug: string;
  nome: string;
  chamada: string | null;
  descricao: string | null;
  sku: string | null;
  ativo: boolean;
  ordem: number;
  unidade: string;
  unidade_plural: string;
  conteudo: string | null;
  peso_g: number;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  ofertas: OfertaProduto[];
  montar: { ativo: boolean; maximo: number; preco_unidade_centavos: number };
  frete_gratis_a_partir: number;
  destaque: boolean | null;
  categoria: string | null;
  selo: string | null;
  foto: string;
  foto_enviada: boolean;
  url: string;
};

// O formulário guarda tudo como texto (o que a pessoa digita) e converte ao salvar.
type Formulario = {
  nome: string;
  chamada: string;
  descricao: string;
  sku: string;
  ativo: boolean;
  ordem: string;
  unidade: string;
  unidade_plural: string;
  conteudo: string;
  peso_g: string;
  comprimento_cm: string;
  largura_cm: string;
  altura_cm: string;
  ofertas: { quantidade: string; preco: string; selo: string }[];
  montar_ativo: boolean;
  montar_maximo: string;
  montar_preco: string;
  frete_gratis_a_partir: string;
  destaque: boolean;
  categoria: string;
  selo: string;
};

const paraReais = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
const paraCentavos = (texto: string) => {
  const limpo = texto.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const valor = Number.parseFloat(limpo);
  return Number.isFinite(valor) ? Math.round(valor * 100) : NaN;
};
const digitos = (texto: string) => texto.replace(/\D/g, "");

const VAZIO: Formulario = {
  nome: "",
  chamada: "",
  descricao: "",
  sku: "",
  ativo: true,
  ordem: "0",
  unidade: "unidade",
  unidade_plural: "unidades",
  conteudo: "",
  peso_g: "",
  comprimento_cm: "",
  largura_cm: "",
  altura_cm: "",
  ofertas: [
    { quantidade: "1", preco: "", selo: "" },
    { quantidade: "2", preco: "", selo: "" },
    { quantidade: "3", preco: "", selo: "" },
  ],
  montar_ativo: false,
  montar_maximo: "10",
  montar_preco: "",
  frete_gratis_a_partir: "0",
  destaque: false,
  categoria: "",
  selo: "",
};

function doProduto(p: ProdutoVendedor): Formulario {
  return {
    nome: p.nome,
    chamada: p.chamada ?? "",
    descricao: p.descricao ?? "",
    sku: p.sku ?? "",
    ativo: p.ativo,
    ordem: String(p.ordem),
    unidade: p.unidade,
    unidade_plural: p.unidade_plural,
    conteudo: p.conteudo ?? "",
    peso_g: String(p.peso_g),
    comprimento_cm: String(p.comprimento_cm),
    largura_cm: String(p.largura_cm),
    altura_cm: String(p.altura_cm),
    ofertas: p.ofertas.map((o) => ({ quantidade: String(o.quantidade), preco: paraReais(o.preco_centavos), selo: o.selo })),
    montar_ativo: p.montar.ativo,
    montar_maximo: String(p.montar.maximo || 10),
    montar_preco: p.montar.preco_unidade_centavos ? paraReais(p.montar.preco_unidade_centavos) : "",
    frete_gratis_a_partir: String(p.frete_gratis_a_partir),
    destaque: Boolean(p.destaque),
    categoria: p.categoria ?? "",
    selo: p.selo ?? "",
  };
}

function paraEnviar(f: Formulario) {
  return {
    nome: f.nome,
    chamada: f.chamada,
    descricao: f.descricao,
    sku: f.sku,
    ativo: f.ativo,
    ordem: Number(f.ordem || 0),
    unidade: f.unidade,
    unidade_plural: f.unidade_plural,
    conteudo: f.conteudo,
    peso_g: Number(f.peso_g),
    comprimento_cm: Number(f.comprimento_cm),
    largura_cm: Number(f.largura_cm),
    altura_cm: Number(f.altura_cm),
    ofertas: f.ofertas
      .filter((o) => o.quantidade || o.preco)
      .map((o) => ({ quantidade: Number(o.quantidade), preco_centavos: paraCentavos(o.preco), selo: o.selo })),
    montar: { ativo: f.montar_ativo, maximo: Number(f.montar_maximo || 0), preco_unidade_centavos: paraCentavos(f.montar_preco) || 0 },
    frete_gratis_a_partir: Number(f.frete_gratis_a_partir || 0),
    destaque: f.destaque,
    categoria: f.categoria,
    selo: f.selo,
  };
}

const menorPreco = (p: ProdutoVendedor) => Math.min(...p.ofertas.map((o) => o.preco_centavos));
const COLUNAS_PRODUTOS: ColunaTabela<ProdutoVendedor>[] = [
  {
    id: "produto",
    rotulo: "Produto",
    valor: (p) => `${p.nome} ${p.chamada ?? ""} ${p.sku ?? ""}`,
    render: (p) => (
      <span className="flex items-center gap-3">
        <img src={p.foto} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
        <span className="min-w-0">
          <span className="block font-semibold">{p.nome}</span>
          {p.chamada && <span className="line-clamp-1 text-xs text-suave">{p.chamada}</span>}
        </span>
      </span>
    ),
  },
  { id: "sku", rotulo: "SKU", valor: (p) => p.sku ?? "", render: (p) => <span className="font-mono text-xs text-tinta-2">{p.sku ?? "—"}</span> },
  {
    id: "url",
    rotulo: "Página",
    valor: (p) => p.url,
    render: (p) => (
      <a href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-laranja-2 hover:underline">
        {p.url}
      </a>
    ),
  },
  {
    id: "preco",
    rotulo: "A partir de",
    direita: true,
    valor: (p) => menorPreco(p) / 100,
    render: (p) => <span className="font-mono font-bold">{reais(menorPreco(p))}</span>,
  },
  { id: "ofertas", rotulo: "Ofertas", valor: (p) => p.ofertas.map((o) => o.quantidade).join(", ") + (p.montar.ativo ? ` + monte o seu até ${p.montar.maximo}` : "") },
  { id: "ordem", rotulo: "Ordem", direita: true, valor: (p) => p.ordem },
  {
    id: "situacao",
    rotulo: "Situação",
    valor: (p) => (p.ativo ? "À venda" : "Fora de venda"),
    render: (p) => (
      <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${p.ativo ? "bg-ok/15 text-ok" : "bg-white/10 text-suave"}`}>
        {p.ativo ? "À venda" : "Fora de venda"}
      </span>
    ),
  },
];

export function AbaProdutos({ senha }: { senha: string }) {
  const [lista, setLista] = useState<ProdutoVendedor[] | null>(null);
  const [editando, setEditando] = useState<ProdutoVendedor | "novo" | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ia, setIa] = useState<EstadoIA | null>(null);

  useEffect(() => {
    chamar<EstadoIA>("/api/vendedor/ia", { senha })
      .then(setIa)
      .catch(() => setIa({ disponivel: false, estilos: [] }));
  }, [senha]);

  async function carregar() {
    try {
      setLista(await chamar<ProdutoVendedor[]>("/api/vendedor/produtos", { senha }));
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senha]);

  if (editando)
    return (
      <EditorProduto
        senha={senha}
        ia={ia}
        produto={editando === "novo" ? null : editando}
        aoVoltar={(texto) => {
          setEditando(null);
          if (texto) setAviso({ ok: true, texto });
          void carregar();
        }}
        aoTrocar={(p) => setEditando(p)}
      />
    );

  return (
    <div className="mt-6 grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-2">
          Cada produto ganha uma página (<code className="font-mono">/p/endereço</code>) e o checkout próprio, e aparece em{" "}
          <a href="/produtos" target="_blank" rel="noreferrer" className="text-laranja-2 hover:underline">
            /produtos
          </a>
          . O kit de lâminas fica na aba “Kit de lâminas”.
        </p>
        <button type="button" onClick={() => setEditando("novo")} className="btn-laranja px-5 py-3 text-sm">
          Novo produto
        </button>
      </div>
      {aviso && (
        <p role="status" className={aviso.ok ? "text-ok" : "text-alerta"}>
          {aviso.texto}
        </p>
      )}
      <Categorias senha={senha} />
      {lista === null ? (
        <p className="text-suave">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-linha p-8 text-center text-suave">
          Nenhum produto ainda. Clique em “Novo produto”.
        </p>
      ) : (
        <Tabela
          linhas={lista}
          colunas={COLUNAS_PRODUTOS}
          chave={(p) => p.slug}
          aoClicar={(p) => setEditando(p)}
          ordemInicial={{ coluna: "ordem", desc: false }}
          buscaDica="Buscar por nome, SKU, endereço ou chamada"
          arquivo="produtos"
          larguraMinima={760}
        />
      )}
    </div>
  );
}

function EditorProduto({
  senha,
  ia,
  produto,
  aoVoltar,
  aoTrocar,
}: {
  senha: string;
  ia: EstadoIA | null;
  produto: ProdutoVendedor | null;
  aoVoltar: (aviso?: string) => void;
  aoTrocar: (p: ProdutoVendedor) => void;
}) {
  const [f, setF] = useState<Formulario>(produto ? doProduto(produto) : VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [avisoFoto, setAvisoFoto] = useState("");
  const mudar = <K extends keyof Formulario>(campo: K, valor: Formulario[K]) => setF((atual) => ({ ...atual, [campo]: valor }));
  const mudarOferta = (i: number, campo: "quantidade" | "preco" | "selo", valor: string) =>
    setF((atual) => ({ ...atual, ofertas: atual.ofertas.map((o, j) => (j === i ? { ...o, [campo]: valor } : o)) }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    const corpo = paraEnviar(f);
    const ruim = corpo.ofertas.find((o) => !(o.quantidade >= 1) || !(o.preco_centavos >= 100));
    if (ruim) return setErro("Confira as ofertas: quantidade e preço (a partir de R$ 1,00) em cada uma.");
    setSalvando(true);
    try {
      const salvo = await chamar<ProdutoVendedor>(produto ? `/api/vendedor/produtos/${produto.slug}` : "/api/vendedor/produtos", {
        metodo: produto ? "PUT" : "POST",
        senha,
        corpo,
      });
      if (produto) aoVoltar(`“${salvo.nome}” salvo. Já vale na loja.`);
      else aoTrocar(salvo); // segue no editor para enviar a foto
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!produto) return;
    const ok = window.confirm(
      `Excluir “${produto.nome}”? A página /p/${produto.slug} sai do ar e o produto some da loja. Os pedidos antigos continuam no painel. Não dá para desfazer.`,
    );
    if (!ok) return;
    setErro("");
    setSalvando(true);
    try {
      await chamar(`/api/vendedor/produtos/${produto.slug}`, { metodo: "DELETE", senha });
      aoVoltar(`“${produto.nome}” foi excluído.`);
    } catch (falha) {
      setErro((falha as Error).message);
      setSalvando(false);
    }
  }

  async function subirFoto(arquivo: Blob, aviso = "Foto trocada.") {
    if (!produto) return;
    setAvisoFoto("");
    try {
      const r = await fetch(`/api/vendedor/produtos/${produto.slug}/foto`, {
        method: "PUT",
        headers: { "Content-Type": arquivo.type, Authorization: `Bearer ${senha}` },
        body: arquivo,
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro ?? dados.detail ?? "Não consegui enviar a foto.");
      aoTrocar(dados as ProdutoVendedor);
      setAvisoFoto(aviso);
    } catch (falha) {
      setAvisoFoto((falha as Error).message);
    }
  }

  async function enviarFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (arquivo) await subirFoto(arquivo);
  }

  const unidade = f.unidade || "unidade";
  const plural = f.unidade_plural || "unidades";
  const minimoMontar = Math.max(0, ...f.ofertas.map((o) => Number(o.quantidade) || 0)) + 1;
  const precoUm = paraCentavos(f.ofertas.find((o) => o.quantidade === "1")?.preco ?? "");

  return (
    <form onSubmit={salvar} className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => aoVoltar()} className="text-sm text-suave hover:text-laranja-2">
            ← Voltar aos produtos
          </button>
          {produto && (
            <a href={produto.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-laranja-2 hover:underline">
              {produto.url}
            </a>
          )}
        </div>

        <Cartao titulo={produto ? "Editar produto" : "Novo produto"}>
          <div className="grid gap-4">
            <Campo rotulo="Nome" dica={produto ? undefined : "O endereço da página sai do nome (ex.: /p/pomada-modeladora)."}>
              <input className="campo" required minLength={3} maxLength={80} value={f.nome} onChange={(e) => mudar("nome", e.target.value)} />
            </Campo>
            <Campo rotulo="Chamada (opcional)" dica="Uma frase curta embaixo do nome.">
              <input className="campo" maxLength={140} value={f.chamada} onChange={(e) => mudar("chamada", e.target.value)} />
            </Campo>
            <Campo rotulo="Descrição (opcional)" dica="O texto da página do produto. Cada linha vira um parágrafo.">
              <textarea className="campo min-h-32" maxLength={4000} value={f.descricao} onChange={(e) => mudar("descricao", e.target.value)} />
            </Campo>
            <SugestaoDeTextos
              senha={senha}
              ia={ia}
              produto={produto}
              formulario={f}
              aoUsar={(campos) => setF((atual) => ({ ...atual, ...campos }))}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Unidade" dica="ex.: pote, frasco, kit">
                <input className="campo" required value={f.unidade} onChange={(e) => mudar("unidade", e.target.value)} />
              </Campo>
              <Campo rotulo="Plural" dica="ex.: potes, frascos">
                <input className="campo" required value={f.unidade_plural} onChange={(e) => mudar("unidade_plural", e.target.value)} />
              </Campo>
              <Campo rotulo="SKU (opcional)">
                <input className="campo font-mono" maxLength={60} value={f.sku} onChange={(e) => mudar("sku", e.target.value)} />
              </Campo>
            </div>
            <Campo rotulo={`O que vem em 1 ${unidade} (opcional)`} dica="ex.: 1 pote de 120 g. Aparece no checkout e no pedido.">
              <input className="campo" maxLength={120} value={f.conteudo} onChange={(e) => mudar("conteudo", e.target.value)} />
            </Campo>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={f.ativo} onChange={(e) => mudar("ativo", e.target.checked)} className="size-4 accent-laranja" />
                À venda (desligado, o produto some da loja)
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                Ordem na vitrine
                <input className="campo w-20 font-mono" inputMode="numeric" value={f.ordem} onChange={(e) => mudar("ordem", digitos(e.target.value))} />
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Na vitrine">
          <NaVitrine
            senha={senha}
            valor={{ destaque: f.destaque, categoria: f.categoria, selo: f.selo }}
            aoMudar={(campos) => setF((atual) => ({ ...atual, ...campos }))}
          />
        </Cartao>

        <Cartao titulo="Ofertas e preços">
          <div className="grid gap-3">
            {f.ofertas.map((o, i) => {
              const q = Number(o.quantidade) || 0;
              const centavos = paraCentavos(o.preco);
              const economia = q > 1 && precoUm > 0 && centavos > 0 ? precoUm * q - centavos : 0;
              return (
                <div key={i} className="grid gap-3 rounded-2xl border border-linha-2 p-4 sm:grid-cols-[100px_1fr_1fr_auto] sm:items-end">
                  <Campo rotulo="Quantidade">
                    <input className="campo font-mono" inputMode="numeric" value={o.quantidade} onChange={(e) => mudarOferta(i, "quantidade", digitos(e.target.value))} />
                  </Campo>
                  <Campo
                    rotulo="Preço (R$)"
                    dica={centavos > 0 && q > 0 ? `${reais(Math.round(centavos / q))} por ${unidade}${economia > 0 ? ` · economiza ${reais(economia)}` : ""}` : undefined}
                  >
                    <input className="campo font-mono" inputMode="decimal" value={o.preco} onChange={(e) => mudarOferta(i, "preco", e.target.value)} />
                  </Campo>
                  <Campo rotulo="Selo (opcional)">
                    <input className="campo" maxLength={40} value={o.selo} onChange={(e) => mudarOferta(i, "selo", e.target.value)} />
                  </Campo>
                  <button
                    type="button"
                    disabled={f.ofertas.length <= 1}
                    onClick={() => setF((atual) => ({ ...atual, ofertas: atual.ofertas.filter((_, j) => j !== i) }))}
                    className="rounded-full px-3 py-2 text-sm text-suave hover:text-alerta disabled:opacity-30"
                  >
                    Tirar
                  </button>
                </div>
              );
            })}
            {f.ofertas.length < 4 && (
              <button
                type="button"
                onClick={() => setF((atual) => ({ ...atual, ofertas: [...atual.ofertas, { quantidade: String(minimoMontar), preco: "", selo: "" }] }))}
                className="justify-self-start rounded-full border border-linha-2 px-4 py-2 text-sm font-bold"
              >
                + Oferta
              </button>
            )}
          </div>
        </Cartao>

        <Cartao titulo="Monte o seu e frete grátis">
          <div className="grid gap-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={f.montar_ativo} onChange={(e) => mudar("montar_ativo", e.target.checked)} className="mt-0.5 size-4 accent-laranja" />
              <span>
                <span className="font-semibold">Mostrar o “Monte o seu”</span>
                <span className="block text-xs text-suave">
                  De {minimoMontar} {plural} até o máximo, cada {unidade} pelo preço abaixo.
                </span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo={`Preço por ${unidade} (${minimoMontar} ou mais)`}>
                <input className="campo font-mono" inputMode="decimal" value={f.montar_preco} onChange={(e) => mudar("montar_preco", e.target.value)} />
              </Campo>
              <Campo rotulo="Máximo" dica={`De ${minimoMontar} a 30.`}>
                <input className="campo font-mono" inputMode="numeric" value={f.montar_maximo} onChange={(e) => mudar("montar_maximo", digitos(e.target.value))} />
              </Campo>
              <Campo rotulo={`Frete grátis a partir de (${plural})`} dica="0: sem frete grátis.">
                <input
                  className="campo font-mono"
                  inputMode="numeric"
                  value={f.frete_gratis_a_partir}
                  onChange={(e) => mudar("frete_gratis_a_partir", digitos(e.target.value))}
                />
              </Campo>
            </div>
          </div>
        </Cartao>

        <Cartao titulo={`Embalagem de 1 ${unidade} (para a Loggi)`}>
          <div className="grid gap-4 sm:grid-cols-4">
            <Campo rotulo="Peso (g)">
              <input className="campo font-mono" inputMode="numeric" required value={f.peso_g} onChange={(e) => mudar("peso_g", digitos(e.target.value))} />
            </Campo>
            <Campo rotulo="Comprimento (cm)">
              <input className="campo font-mono" inputMode="numeric" required value={f.comprimento_cm} onChange={(e) => mudar("comprimento_cm", digitos(e.target.value))} />
            </Campo>
            <Campo rotulo="Largura (cm)">
              <input className="campo font-mono" inputMode="numeric" required value={f.largura_cm} onChange={(e) => mudar("largura_cm", digitos(e.target.value))} />
            </Campo>
            <Campo rotulo="Altura (cm)" dica="Várias unidades vão empilhadas.">
              <input className="campo font-mono" inputMode="numeric" required value={f.altura_cm} onChange={(e) => mudar("altura_cm", digitos(e.target.value))} />
            </Campo>
          </div>
        </Cartao>

        {erro && (
          <p role="alert" className="text-alerta">
            {erro}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={salvando} className="btn-laranja px-6 py-3 text-sm">
            {salvando ? "Salvando…" : produto ? "Salvar" : "Criar produto"}
          </button>
          <button type="button" onClick={() => aoVoltar()} className="rounded-full border border-linha-2 px-5 py-3 text-sm font-bold">
            Cancelar
          </button>
          {produto && (
            <button
              type="button"
              disabled={salvando}
              onClick={() => void excluir()}
              className="ml-auto rounded-full border border-red-400/40 px-5 py-3 text-sm font-bold text-red-300 hover:bg-red-400/10"
            >
              Excluir produto
            </button>
          )}
        </div>
      </div>

      <Cartao titulo="Foto">
        {produto ? (
          <div className="grid gap-3">
            <img src={produto.foto} alt="" className="aspect-square w-full rounded-2xl border border-linha object-cover" />
            <label className="btn-laranja cursor-pointer px-5 py-3 text-center text-sm">
              Trocar a foto
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void enviarFoto(e)} />
            </label>
            <p className="text-xs text-suave">JPG, PNG ou WebP, até 8 MB. Quadrada fica melhor.</p>
            {avisoFoto && <p className="text-sm text-tinta-2">{avisoFoto}</p>}
            <EdicaoDeFoto
              senha={senha}
              ia={ia}
              produto={produto}
              aoUsar={(blob) => subirFoto(blob, "Foto da IA aplicada. Ela já aparece na loja.")}
            />
          </div>
        ) : (
          <p className="text-sm text-suave">Crie o produto primeiro; depois você envia a foto aqui.</p>
        )}
      </Cartao>
    </form>
  );
}

// ───────── IA (Gemini) ─────────

export type EstadoIA = { disponivel: boolean; estilos: { id: string; rotulo: string }[] };
type Textos = { nome: string; chamada: string; descricao: string };

function Faisca() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5 15l.7 1.6L7.3 17.3l-1.6.7L5 19.6l-.7-1.6-1.6-.7 1.6-.7z" />
    </svg>
  );
}

function SemIA({ ia }: { ia: EstadoIA | null }) {
  if (!ia || ia.disponivel) return null;
  return <p className="text-xs text-suave">A IA está desligada: ponha a chave do Gemini em Configurações → IA.</p>;
}

// Servem ao editor dos produtos e ao do kit de lâminas (por isso os tipos são só o que elas usam).
type InfoTextos = { nome: string; unidade: string; conteudo: string; chamada: string; descricao: string };
type FotoDoProduto = { slug: string; foto: string; foto_enviada: boolean };

export function SugestaoDeTextos({
  senha,
  ia,
  produto,
  formulario: f,
  aoUsar,
}: {
  senha: string;
  ia: EstadoIA | null;
  produto: Pick<FotoDoProduto, "slug" | "foto_enviada"> | null;
  formulario: InfoTextos;
  aoUsar: (campos: Partial<Textos>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState("");
  const [sugestao, setSugestao] = useState<Textos | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  async function gerar() {
    setGerando(true);
    setErro("");
    try {
      setSugestao(
        await chamar<Textos>("/api/vendedor/ia/textos", {
          senha,
          corpo: {
            produto: produto?.slug,
            nome: f.nome,
            unidade: f.unidade,
            conteudo: f.conteudo,
            chamada: f.chamada,
            descricao: f.descricao,
            observacoes: destaque,
          },
        }),
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  if (!aberto)
    return (
      <div className="grid gap-1">
        <button
          type="button"
          disabled={!ia?.disponivel}
          onClick={() => setAberto(true)}
          className="flex items-center gap-2 justify-self-start rounded-full border border-laranja/60 bg-laranja/10 px-4 py-2 text-sm font-bold text-laranja-2 disabled:opacity-40"
        >
          <Faisca /> Sugerir nome, chamada e descrição com IA
        </button>
        <SemIA ia={ia} />
      </div>
    );

  return (
    <section className="grid gap-3 rounded-2xl border border-laranja/40 bg-laranja/[.06] p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-laranja-2">
        <Faisca /> Textos com IA (Gemini)
      </p>
      <Campo
        rotulo="O que destacar (opcional)"
        dica={produto?.foto_enviada ? "A IA também olha a foto do produto." : "Com a foto enviada, a IA também olha a foto."}
      >
        <input
          className="campo"
          maxLength={300}
          placeholder="ex.: fixação forte, efeito seco, cheiro de madeira"
          value={destaque}
          onChange={(e) => setDestaque(e.target.value)}
        />
      </Campo>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={gerando} onClick={() => void gerar()} className="btn-laranja px-5 py-2.5 text-sm">
          {gerando ? "Escrevendo…" : sugestao ? "Gerar outra" : "Gerar sugestão"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="rounded-full px-4 py-2 text-sm text-suave">
          Fechar
        </button>
      </div>
      {erro && <p role="alert" className="text-sm text-alerta">{erro}</p>}
      {sugestao && (
        <div className="grid gap-3 rounded-xl border border-linha-2 bg-fundo p-3 text-sm">
          {(["nome", "chamada", "descricao"] as const).map((campo) => (
            <div key={campo} className="grid gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold tracking-widest text-suave uppercase">
                  {campo === "descricao" ? "Descrição" : campo === "nome" ? "Nome" : "Chamada"}
                </span>
                <button type="button" onClick={() => aoUsar({ [campo]: sugestao[campo] })} className="text-xs font-bold text-laranja-2 hover:underline">
                  Usar
                </button>
              </div>
              <p className="whitespace-pre-line text-tinta">{sugestao[campo]}</p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => aoUsar({ nome: sugestao.nome, chamada: sugestao.chamada, descricao: sugestao.descricao })}
            className="justify-self-start rounded-full border border-laranja px-4 py-2 text-sm font-bold text-laranja-2"
          >
            Usar tudo
          </button>
          <p className="text-xs text-suave">Confira antes de salvar: a IA pode errar. Nada muda na loja até você clicar em “Salvar”.</p>
        </div>
      )}
    </section>
  );
}

export function EdicaoDeFoto({
  senha,
  ia,
  produto,
  aoUsar,
}: {
  senha: string;
  ia: EstadoIA | null;
  produto: FotoDoProduto;
  aoUsar: (foto: Blob) => Promise<void>;
}) {
  const [estilo, setEstilo] = useState("estudio");
  const [instrucao, setInstrucao] = useState("");
  const [gerada, setGerada] = useState<{ url: string; blob: Blob } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [usando, setUsando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => () => {
    if (gerada) URL.revokeObjectURL(gerada.url);
  }, [gerada]);

  async function gerar() {
    setGerando(true);
    setErro("");
    try {
      const r = await chamar<{ tipo: string; dados: string }>("/api/vendedor/ia/foto", {
        senha,
        corpo: { produto: produto.slug, estilo, instrucao },
      });
      const bytes = Uint8Array.from(atob(r.dados), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: r.tipo });
      setGerada({ url: URL.createObjectURL(blob), blob });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  if (!produto.foto_enviada)
    return <p className="text-xs text-suave">Envie uma foto (mesmo de celular) para a IA poder deixá-la com cara de loja.</p>;

  return (
    <section className="grid gap-3 rounded-2xl border border-laranja/40 bg-laranja/[.06] p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-laranja-2">
        <Faisca /> Editar a foto com IA
      </p>
      <SemIA ia={ia} />
      <div className="grid gap-1.5">
        {(ia?.estilos ?? []).map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="estilo-foto" checked={estilo === e.id} onChange={() => setEstilo(e.id)} className="accent-laranja" />
            {e.rotulo}
          </label>
        ))}
      </div>
      <input
        className="campo text-sm"
        maxLength={300}
        placeholder={estilo === "livre" ? "Descreva o que mudar na foto" : "Algum detalhe a mais? (opcional)"}
        value={instrucao}
        onChange={(e) => setInstrucao(e.target.value)}
      />
      <button type="button" disabled={gerando || !ia?.disponivel} onClick={() => void gerar()} className="btn-laranja px-4 py-2.5 text-sm">
        {gerando ? "Gerando a foto… (uns 15 s)" : gerada ? "Gerar outra" : "Gerar foto"}
      </button>
      {erro && <p role="alert" className="text-sm text-alerta">{erro}</p>}
      {gerada && (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2 text-center font-mono text-[10px] text-suave uppercase">
            <figure className="grid gap-1">
              <img src={produto.foto} alt="Foto atual" className="aspect-square w-full rounded-xl border border-linha object-cover" />
              <figcaption>Atual</figcaption>
            </figure>
            <figure className="grid gap-1">
              <img src={gerada.url} alt="Foto gerada pela IA" className="aspect-square w-full rounded-xl border border-laranja/60 object-cover" />
              <figcaption>Nova</figcaption>
            </figure>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={usando}
              onClick={async () => {
                setUsando(true);
                await aoUsar(gerada.blob);
                setUsando(false);
                setGerada(null);
              }}
              className="btn-laranja flex-1 px-4 py-2.5 text-sm"
            >
              {usando ? "Aplicando…" : "Usar esta foto"}
            </button>
            <button type="button" onClick={() => setGerada(null)} className="rounded-full border border-linha-2 px-4 py-2 text-sm">
              Descartar
            </button>
          </div>
          <p className="text-xs text-suave">Confira se o rótulo saiu certo: a IA pode trocar letras.</p>
        </div>
      )}
    </section>
  );
}

// ───────── Vitrine: destaque, categoria e selo (produtos e kit) e as categorias da loja ─────────

const SELOS = ["Novo", "Mais vendido", "Promoção", "Edição limitada", "Kit econômico"];

function useCategorias(senha: string) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const carregar = () =>
    chamar<{ categorias: string[] }>("/api/vendedor/catalogo", { senha })
      .then((c) => setCategorias(c.categorias))
      .catch(() => undefined);
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senha]);
  return { categorias, setCategorias, carregar };
}

export function NaVitrine({
  senha,
  valor,
  aoMudar,
}: {
  senha: string;
  valor: { destaque: boolean; categoria: string; selo: string };
  aoMudar: (campos: Partial<{ destaque: boolean; categoria: string; selo: string }>) => void;
}) {
  const { categorias } = useCategorias(senha);
  return (
    <div className="grid gap-4">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={valor.destaque} onChange={(e) => aoMudar({ destaque: e.target.checked })} className="mt-0.5 size-4 accent-laranja" />
        <span>
          <span className="font-semibold">Destaque na vitrine</span>
          <span className="block text-xs text-suave">Aparece no banner do topo da vitrine (/produtos) e primeiro na página principal.</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Categoria" dica="As categorias viram abas na vitrine. Crie e renomeie em Produtos.">
          <select className="campo" value={valor.categoria} onChange={(e) => aoMudar({ categoria: e.target.value })}>
            <option value="">Sem categoria</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {valor.categoria && !categorias.includes(valor.categoria) && <option value={valor.categoria}>{valor.categoria}</option>}
          </select>
        </Campo>
        <Campo rotulo="Selo (opcional)" dica="Aparece no canto do cartão.">
          <input className="campo" list="selos-vitrine" maxLength={40} value={valor.selo} onChange={(e) => aoMudar({ selo: e.target.value })} />
          <datalist id="selos-vitrine">
            {SELOS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Campo>
      </div>
    </div>
  );
}

function Categorias({ senha }: { senha: string }) {
  const { categorias, setCategorias, carregar } = useCategorias(senha);
  const [nova, setNova] = useState("");
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(lista: string[]) {
    setErro("");
    try {
      const r = await chamar<{ categorias: string[] }>("/api/vendedor/catalogo", { metodo: "PUT", senha, corpo: { categorias: lista } });
      setCategorias(r.categorias);
      setNova("");
    } catch (e) {
      setErro((e as Error).message);
      void carregar();
    }
  }

  return (
    <section className="rounded-2xl border border-linha bg-fundo-2/90 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">Categorias da vitrine:</span> <span className="text-tinta-2">{categorias.join(" · ") || "—"}</span>
        </p>
        <button type="button" onClick={() => setAberto(!aberto)} className="rounded-full border border-linha-2 px-3 py-1 text-sm font-semibold">
          {aberto ? "Fechar" : "Editar categorias"}
        </button>
      </div>
      {aberto && (
        <div className="mt-3 grid gap-3">
          <ul className="flex flex-wrap gap-2">
            {categorias.map((c, i) => (
              <li key={c} className="flex items-center gap-1 rounded-full border border-linha-2 py-1 pr-1 pl-3 text-sm">
                {c}
                <button type="button" disabled={i === 0} onClick={() => void salvar([...categorias.slice(0, i - 1), c, categorias[i - 1], ...categorias.slice(i + 1)])} className="px-1 text-suave disabled:opacity-30" aria-label={`Mover ${c} para a esquerda`}>
                  ←
                </button>
                <button type="button" onClick={() => void salvar(categorias.filter((x) => x !== c))} className="px-1 text-suave hover:text-alerta" aria-label={`Tirar ${c}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (nova.trim()) void salvar([...categorias, nova.trim()]);
            }}
          >
            <input className="campo py-2" maxLength={40} placeholder="Nova categoria (ex.: Pele)" value={nova} onChange={(e) => setNova(e.target.value)} />
            <button type="submit" className="btn-laranja shrink-0 px-4 py-2 text-sm">
              Adicionar
            </button>
          </form>
          <p className="text-xs text-suave">Tirar uma categoria não muda os produtos: os que estavam nela ficam em “Todos”.</p>
          {erro && <p role="alert" className="text-sm text-alerta">{erro}</p>}
        </div>
      )}
    </section>
  );
}
