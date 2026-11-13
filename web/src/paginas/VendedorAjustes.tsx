import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { chamar, formatarCep, reais, type OpcaoFrete } from "../api";
import { EdicaoDeFoto, SugestaoDeTextos, type EstadoIA } from "./VendedorProdutos";

// As abas "Produto e preços" e "Integrações" da área do vendedor. O que muda aqui vale na hora na loja.

type OfertaAjuste = {
  id: string;
  titulo: string;
  kits: number;
  preco_centavos: number;
  selo: string;
  ativa: boolean;
};
type Catalogo = {
  produto: {
    refis: number;
    laminas_por_refil: number;
    aparelhos: number;
    nome: string;
    chamada: string;
    descricao: string;
    peso_g: number;
    comprimento_cm: number;
    largura_cm: number;
    altura_cm: number;
  };
  ofertas: OfertaAjuste[];
  foto: string;
  foto_enviada: boolean;
  montar: { ativo: boolean; minimo: number; maximo: number; preco_kit_centavos: number };
  frete_gratis_a_partir: number;
};

const paraReais = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
const paraCentavos = (texto: string) => {
  const limpo = texto.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const valor = Number.parseFloat(limpo);
  return Number.isFinite(valor) ? Math.round(valor * 100) : NaN;
};

export function AbaProduto({ senha }: { senha: string }) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [refis, setRefis] = useState("");
  const [laminas, setLaminas] = useState("");
  const [ofertas, setOfertas] = useState<(OfertaAjuste & { preco: string })[]>([]);
  const [montarAtivo, setMontarAtivo] = useState(true);
  const [montarMaximo, setMontarMaximo] = useState("");
  const [montarPreco, setMontarPreco] = useState("");
  const [freteGratis, setFreteGratis] = useState("");
  const [textos, setTextos] = useState({ nome: "", chamada: "", descricao: "" });
  const [medidas, setMedidas] = useState({ peso_g: "", comprimento_cm: "", largura_cm: "", altura_cm: "" });
  const [ia, setIa] = useState<EstadoIA | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  function preencher(c: Catalogo) {
    setCatalogo(c);
    setRefis(String(c.produto.refis));
    setLaminas(String(c.produto.laminas_por_refil));
    setTextos({ nome: c.produto.nome, chamada: c.produto.chamada ?? "", descricao: c.produto.descricao ?? "" });
    setMedidas({
      peso_g: String(c.produto.peso_g),
      comprimento_cm: String(c.produto.comprimento_cm),
      largura_cm: String(c.produto.largura_cm),
      altura_cm: String(c.produto.altura_cm),
    });
    setOfertas(c.ofertas.map((o) => ({ ...o, preco: paraReais(o.preco_centavos) })));
    setMontarAtivo(c.montar.ativo);
    setMontarMaximo(String(c.montar.maximo));
    setMontarPreco(paraReais(c.montar.preco_kit_centavos));
    setFreteGratis(String(c.frete_gratis_a_partir));
  }

  useEffect(() => {
    chamar<EstadoIA>("/api/vendedor/ia", { senha })
      .then(setIa)
      .catch(() => setIa({ disponivel: false, estilos: [] }));
  }, [senha]);

  useEffect(() => {
    chamar<Catalogo>("/api/vendedor/catalogo", { senha })
      .then(preencher)
      .catch((e: Error) => setAviso({ ok: false, texto: e.message }));
  }, [senha]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const invalida = ofertas.find((o) => !(paraCentavos(o.preco) >= 100));
    if (invalida) {
      setAviso({ ok: false, texto: `Preço inválido em ${invalida.titulo}.` });
      return;
    }
    if (!(paraCentavos(montarPreco) >= 100)) {
      setAviso({ ok: false, texto: "Preço por kit inválido no “Monte o seu kit”." });
      return;
    }
    setSalvando(true);
    setAviso(null);
    try {
      const c = await chamar<Catalogo>("/api/vendedor/catalogo", {
        metodo: "PUT",
        senha,
        corpo: {
          refis: Number(refis),
          laminas_por_refil: Number(laminas),
          ...textos,
          peso_g: Number(medidas.peso_g),
          comprimento_cm: Number(medidas.comprimento_cm),
          largura_cm: Number(medidas.largura_cm),
          altura_cm: Number(medidas.altura_cm),
          ofertas: Object.fromEntries(
            ofertas.map((o) => [o.id, { preco_centavos: paraCentavos(o.preco), selo: o.selo, ativa: o.ativa }]),
          ),
          montar: { ativo: montarAtivo, maximo: Number(montarMaximo), preco_kit_centavos: paraCentavos(montarPreco) },
          frete_gratis_a_partir: Number(freteGratis || 0),
        },
      });
      preencher(c);
      setAviso({ ok: true, texto: "Salvo. A loja e o checkout já mostram os valores novos." });
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function enviarFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (arquivo) await subirFoto(arquivo);
  }

  async function subirFoto(arquivo: Blob) {
    setAviso(null);
    try {
      const r = await fetch("/api/vendedor/foto", {
        method: "PUT",
        headers: { "Content-Type": arquivo.type, Authorization: `Bearer ${senha}` },
        body: arquivo,
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro ?? dados.detail ?? "Não consegui enviar a foto.");
      preencher(dados as Catalogo);
      setAviso({ ok: true, texto: "Foto trocada na loja e no checkout." });
    } catch (erro) {
      setAviso({ ok: false, texto: (erro as Error).message });
    }
  }

  async function fotoPadrao() {
    try {
      preencher(await chamar<Catalogo>("/api/vendedor/foto", { metodo: "DELETE", senha }));
      setAviso({ ok: true, texto: "Voltou a foto padrão." });
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    }
  }

  if (!catalogo) return <p className="mt-6 text-suave">{aviso?.texto ?? "Carregando…"}</p>;
  const nRefis = Number(refis) || 0;

  return (
    <form onSubmit={salvar} className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="grid gap-5">
        <Cartao titulo="Nome e textos">
          <div className="grid gap-4">
            <Campo rotulo="Nome" dica="Aparece no checkout, nos pedidos, na vitrine e para a Loggi.">
              <input className="campo" required minLength={3} maxLength={80} value={textos.nome} onChange={(e) => setTextos((t) => ({ ...t, nome: e.target.value }))} />
            </Campo>
            <Campo rotulo="Chamada (opcional)" dica="A frase curta do kit na vitrine (/produtos).">
              <input className="campo" maxLength={140} value={textos.chamada} onChange={(e) => setTextos((t) => ({ ...t, chamada: e.target.value }))} />
            </Campo>
            <Campo rotulo="Descrição (opcional)" dica="Texto do kit para a vitrine e as próximas páginas. A landing page continua com os textos dela.">
              <textarea
                className="campo min-h-28"
                maxLength={4000}
                value={textos.descricao}
                onChange={(e) => setTextos((t) => ({ ...t, descricao: e.target.value }))}
              />
            </Campo>
            <SugestaoDeTextos
              senha={senha}
              ia={ia}
              produto={{ slug: "kit-laminas", foto_enviada: true }}
              formulario={{
                ...textos,
                unidade: "kit",
                conteudo: `${catalogo.produto.aparelhos} aparelho + ${refis} refis de ${laminas} lâminas`,
              }}
              aoUsar={(campos) => setTextos((t) => ({ ...t, ...campos }))}
            />
          </div>
        </Cartao>

        <Cartao titulo="O kit">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Refis por kit" dica="Aparece no selo, nas ofertas e no simulador de rendimento.">
              <input className="campo font-mono" inputMode="numeric" value={refis} onChange={(e) => setRefis(e.target.value.replace(/\D/g, ""))} />
            </Campo>
            <Campo rotulo="Lâminas por refil">
              <input className="campo font-mono" inputMode="numeric" value={laminas} onChange={(e) => setLaminas(e.target.value.replace(/\D/g, ""))} />
            </Campo>
          </div>
        </Cartao>

        <Cartao titulo="Embalagem de 1 kit (para a Loggi)">
          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ["peso_g", "Peso (g)"],
                ["comprimento_cm", "Comprimento (cm)"],
                ["largura_cm", "Largura (cm)"],
                ["altura_cm", "Altura (cm)"],
              ] as const
            ).map(([chave, rotulo]) => (
              <Campo key={chave} rotulo={rotulo}>
                <input
                  className="campo font-mono"
                  inputMode="numeric"
                  required
                  value={medidas[chave]}
                  onChange={(e) => setMedidas((m) => ({ ...m, [chave]: e.target.value.replace(/\D/g, "") }))}
                />
              </Campo>
            ))}
          </div>
          <p className="mt-2 text-xs text-suave">Vários kits vão empilhados na mesma caixa (altura × quantidade).</p>
        </Cartao>

        <Cartao titulo="Ofertas e preços">
          <div className="grid gap-3">
            {ofertas.map((o, i) => {
              const centavos = paraCentavos(o.preco);
              const porRefil = nRefis && centavos ? Math.round(centavos / (nRefis * o.kits)) : 0;
              const mudar = (campo: Partial<OfertaAjuste & { preco: string }>) =>
                setOfertas((lista) => lista.map((x, j) => (j === i ? { ...x, ...campo } : x)));
              return (
                <div key={o.id} className={`grid gap-3 rounded-2xl border p-4 sm:grid-cols-[130px_1fr_1fr] sm:items-end ${o.ativa ? "border-linha-2" : "border-linha opacity-60"}`}>
                  <label className="flex items-center gap-2 font-display text-2xl font-extrabold uppercase">
                    <input type="checkbox" checked={o.ativa} onChange={(e) => mudar({ ativa: e.target.checked })} className="size-4 accent-laranja" />
                    {o.titulo}
                  </label>
                  <Campo rotulo="Preço (R$)" dica={porRefil ? `${reais(porRefil)} por refil` : undefined}>
                    <input className="campo font-mono" inputMode="decimal" value={o.preco} onChange={(e) => mudar({ preco: e.target.value })} />
                  </Campo>
                  <Campo rotulo="Selo (opcional)">
                    <input className="campo" maxLength={40} value={o.selo} onChange={(e) => mudar({ selo: e.target.value })} />
                  </Campo>
                </div>
              );
            })}
          </div>
        </Cartao>

        <Cartao titulo="Monte o seu kit e frete grátis">
          {(() => {
            const minimo = catalogo.montar.minimo;
            const precoKit = paraCentavos(montarPreco);
            const avulso = paraCentavos(ofertas.find((o) => o.kits === 1)?.preco ?? "");
            const exemplo = minimo + 1;
            const limite = Number(freteGratis || 0);
            return (
              <div className="grid gap-4">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={montarAtivo} onChange={(e) => setMontarAtivo(e.target.checked)} className="mt-0.5 size-4 accent-laranja" />
                  <span>
                    <span className="font-semibold">Mostrar o “Monte o seu kit”</span>
                    <span className="block text-xs text-suave">
                      Um card com − e + no checkout e na página, de {minimo} kits até o máximo, cada kit pelo preço abaixo.
                    </span>
                  </span>
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo
                    rotulo={`Preço por kit (${minimo} ou mais)`}
                    dica={
                      precoKit >= 100
                        ? `${exemplo} kits = ${reais(precoKit * exemplo)}${avulso > precoKit ? ` (economiza ${reais((avulso - precoKit) * exemplo)})` : ""}`
                        : undefined
                    }
                  >
                    <input className="campo font-mono" inputMode="decimal" value={montarPreco} onChange={(e) => setMontarPreco(e.target.value)} />
                  </Campo>
                  <Campo rotulo="Máximo de kits" dica={`De ${minimo} a 30.`}>
                    <input
                      className="campo font-mono"
                      inputMode="numeric"
                      value={montarMaximo}
                      onChange={(e) => setMontarMaximo(e.target.value.replace(/\D/g, ""))}
                    />
                  </Campo>
                  <Campo
                    rotulo="Frete grátis a partir de (kits)"
                    dica={limite ? `De ${limite} kits para cima, a loja paga o frete na Loggi.` : "0: nenhum pedido tem frete grátis."}
                  >
                    <input
                      className="campo font-mono"
                      inputMode="numeric"
                      value={freteGratis}
                      onChange={(e) => setFreteGratis(e.target.value.replace(/\D/g, ""))}
                    />
                  </Campo>
                </div>
              </div>
            );
          })()}
        </Cartao>

        {aviso && (
          <p role="status" className={aviso.ok ? "text-ok" : "text-alerta"}>
            {aviso.texto}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={salvando} className="btn-laranja px-6 py-3 text-sm">
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          <a href="/" target="_blank" rel="noreferrer" className="rounded-full border border-linha-2 px-5 py-3 text-sm font-bold hover:border-laranja">
            Ver a loja
          </a>
        </div>
      </div>

      <Cartao titulo="Foto do kit">
        <img src={catalogo.foto} alt="Foto atual do kit" className="aspect-[4/5] w-full rounded-xl object-cover" />
        <p className="mt-2 text-xs text-suave">Aparece no topo da loja, na galeria, nas ofertas e no checkout. JPG, PNG ou WebP, até 8 MB.</p>
        <div className="mt-3 grid gap-2">
          <label className="btn-laranja cursor-pointer px-5 py-3 text-xs">
            Trocar foto
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void enviarFoto(e)} />
          </label>
          {catalogo.foto_enviada && (
            <button type="button" onClick={() => void fotoPadrao()} className="text-sm text-suave hover:text-tinta">
              Voltar à foto padrão
            </button>
          )}
          <EdicaoDeFoto
            senha={senha}
            ia={ia}
            produto={{ slug: "kit-laminas", foto: catalogo.foto, foto_enviada: true }}
            aoUsar={(blob) => subirFoto(blob)}
          />
        </div>
      </Cartao>
    </form>
  );
}

type Integracoes = {
  loggi: { ambiente: string; client_id: boolean; client_secret: boolean; company_id: boolean; servicos: number; origem_cep: string; envio_automatico: boolean };
  infinitepay: { ambiente: string; handle: boolean; api_key: boolean; site_url: string; webhook: boolean; desconto_pix: number; desconto_pix_vale: number };
  problemas: string[];
};

export function AbaIntegracoes({ senha }: { senha: string }) {
  const [dados, setDados] = useState<Integracoes | null>(null);
  const [erro, setErro] = useState("");
  const [cep, setCep] = useState("");
  const [teste, setTeste] = useState<{ ok: boolean; detalhe?: string; opcoes?: OpcaoFrete[]; ms?: number; ambiente: string } | null>(null);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    chamar<Integracoes>("/api/vendedor/integracoes", { senha })
      .then(setDados)
      .catch((e: Error) => setErro(e.message));
  }, [senha]);

  async function testarLoggi() {
    setTestando(true);
    setTeste(null);
    try {
      setTeste(await chamar("/api/vendedor/integracoes/loggi/testar", { senha, corpo: { cep } }));
    } catch (e) {
      setTeste({ ok: false, detalhe: (e as Error).message, ambiente: "" });
    } finally {
      setTestando(false);
    }
  }

  if (!dados) return <p className="mt-6 text-suave">{erro || "Carregando…"}</p>;
  const { loggi, infinitepay } = dados;

  return (
    <div className="mt-6 grid gap-5">
      <p className="text-sm text-tinta-2">
        As chaves e os dados de envio mudam na aba <strong>Configurações</strong> (as chaves ficam no Vault do Supabase e nunca aparecem
        aqui). O que não foi salvo lá vem do <code className="font-mono">.env</code>.
      </p>
      {dados.problemas.length > 0 && (
        <ul className="grid gap-1 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
          {dados.problemas.map((p) => (
            <li key={p}>⚠ {p}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Cartao titulo="InfinitePay · pagamento">
          <Estado rotulo="Modo" valor={infinitepay.ambiente === "real" ? "Real: cobra de verdade" : "Simulado: nada é cobrado"} ok={infinitepay.ambiente === "real"} />
          <Estado rotulo="InfiniteTag (INFINITEPAY_HANDLE)" valor={infinitepay.handle ? "Configurada" : "Falta"} ok={infinitepay.handle} />
          <Estado rotulo="API Key (INFINITEPAY_API_KEY)" valor={infinitepay.api_key ? "Configurada" : "Falta (opcional)"} ok={infinitepay.api_key} />
          <Estado
            rotulo="Aviso automático de pagamento"
            valor={infinitepay.webhook ? `Ligado em ${infinitepay.site_url}` : "Desligado: o site precisa estar publicado com https"}
            ok={infinitepay.webhook}
          />
          <Estado
            rotulo="Desconto no Pix"
            valor={infinitepay.desconto_pix ? (infinitepay.desconto_pix_vale ? `${infinitepay.desconto_pix}% off` : `${infinitepay.desconto_pix}%: precisa da API Key`) : "Sem desconto"}
            ok={!infinitepay.desconto_pix || infinitepay.desconto_pix_vale > 0}
          />
          <p className="mt-3 text-xs text-suave">
            Para cobrar de verdade: em Configurações, InfinitePay no modo real e a InfiniteTag. O primeiro teste é uma compra pequena paga
            por você.
          </p>
        </Cartao>

        <Cartao titulo="Loggi · frete">
          <Estado rotulo="Modo" valor={{ simulado: "Simulado: frete calculado aqui", staging: "Homologação (staging)", producao: "Produção" }[loggi.ambiente] ?? loggi.ambiente} ok={loggi.ambiente !== "simulado"} />
          <Estado rotulo="client_id e client_secret" valor={loggi.client_id && loggi.client_secret ? "Configurados" : "Faltam"} ok={loggi.client_id && loggi.client_secret} />
          <Estado rotulo="Código da empresa (LOGGI_COMPANY_ID)" valor={loggi.company_id ? "Configurado" : "Falta"} ok={loggi.company_id} />
          <Estado rotulo="Códigos de serviço (LOGGI_SERVICOS)" valor={loggi.servicos ? `${loggi.servicos} configurado(s)` : "Falta"} ok={loggi.servicos > 0} />
          <Estado rotulo="CEP de origem" valor={formatarCep(loggi.origem_cep)} ok={loggi.origem_cep.length === 8} />
          <Estado rotulo="Envio automático após o pagamento (LOGGI_ENVIO_AUTOMATICO)" valor={loggi.envio_automatico ? "Ligado" : "Desligado: crie cada envio à mão"} ok />
          <div className="mt-4 flex gap-2">
            <label className="sr-only" htmlFor="cep-teste">
              CEP para testar
            </label>
            <input id="cep-teste" className="campo font-mono" placeholder="CEP para testar" inputMode="numeric" value={cep} onChange={(e) => setCep(formatarCep(e.target.value))} />
            <button type="button" disabled={testando} onClick={() => void testarLoggi()} className="shrink-0 rounded-[14px] border border-linha-2 px-4 text-sm font-bold hover:border-laranja disabled:opacity-50">
              {testando ? "Testando…" : "Testar cotação"}
            </button>
          </div>
          {teste && (
            <div role="status" className={`mt-3 rounded-xl p-3 text-sm ${teste.ok ? "bg-ok/10 text-ok" : "bg-red-400/10 text-alerta"}`}>
              {teste.ok ? (
                <>
                  <p className="font-bold">
                    Cotação OK ({teste.ambiente}
                    {teste.ms ? `, ${teste.ms} ms` : ""})
                  </p>
                  <ul className="mt-1 text-tinta-2">
                    {teste.opcoes?.map((o) => (
                      <li key={o.tipo}>
                        {o.nome}: {reais(o.centavos)}, até {o.prazo_dias} dias úteis
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                teste.detalhe
              )}
            </div>
          )}
        </Cartao>
      </div>
    </div>
  );
}

export function Cartao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-linha bg-fundo-2/80 p-5">
      <h2 className="mb-4 font-display text-2xl leading-none font-extrabold uppercase">{titulo}</h2>
      {children}
    </section>
  );
}

export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {rotulo}
      {children}
      {dica && <span className="font-mono text-xs font-normal text-suave">{dica}</span>}
    </label>
  );
}

function Estado({ rotulo, valor, ok }: { rotulo: string; valor: string; ok: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-linha py-2 text-sm last:border-0">
      <span className="text-tinta-2">{rotulo}</span>
      <span className={`text-right font-mono text-xs ${ok ? "text-ok" : "text-amber-300"}`}>
        {ok ? "✓ " : "• "}
        {valor}
      </span>
    </div>
  );
}
