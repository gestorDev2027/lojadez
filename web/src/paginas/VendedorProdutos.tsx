import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { chamar, reais } from "../api";
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
  };
}

export function AbaProdutos({ senha }: { senha: string }) {
  const [lista, setLista] = useState<ProdutoVendedor[] | null>(null);
  const [editando, setEditando] = useState<ProdutoVendedor | "novo" | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

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
      {lista === null ? (
        <p className="text-suave">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-linha p-8 text-center text-suave">
          Nenhum produto ainda. Clique em “Novo produto”.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {lista.map((p) => (
            <li key={p.slug} className={`flex gap-4 rounded-2xl border bg-cartao p-4 ${p.ativo ? "border-linha" : "border-linha opacity-60"}`}>
              <img src={p.foto} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
              <div className="grid min-w-0 flex-1 content-start gap-1">
                <p className="font-bold">
                  {p.nome} {!p.ativo && <span className="ml-1 font-mono text-xs text-amber-300">INATIVO</span>}
                </p>
                <p className="font-mono text-xs text-suave">
                  {p.url} · a partir de {reais(Math.min(...p.ofertas.map((o) => o.preco_centavos)))}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEditando(p)} className="rounded-full border border-linha-2 px-3 py-1 text-sm font-bold">
                    Editar
                  </button>
                  {p.ativo && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1 text-sm text-suave hover:text-laranja-2">
                      Ver a página
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditorProduto({
  senha,
  produto,
  aoVoltar,
  aoTrocar,
}: {
  senha: string;
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

  async function enviarFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo || !produto) return;
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
      setAvisoFoto("Foto trocada.");
    } catch (falha) {
      setAvisoFoto((falha as Error).message);
    }
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
            <p className="text-xs text-suave">JPG, PNG ou WebP, até 3 MB. Quadrada fica melhor.</p>
            {avisoFoto && <p className="text-sm text-tinta-2">{avisoFoto}</p>}
          </div>
        ) : (
          <p className="text-sm text-suave">Crie o produto primeiro; depois você envia a foto aqui.</p>
        )}
      </Cartao>
    </form>
  );
}
