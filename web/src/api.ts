// As chamadas à API da loja (servidor Python). Os preços estão sempre em centavos.

export type Produto = { sku: string; ean: string; nome: string; aparelhos: number; refis: number; laminas_por_refil: number };
export type Oferta = {
  id: string;
  titulo: string;
  kits: number;
  preco_centavos: number;
  selo: string;
  descricao: string;
  frete_gratis: boolean;
};
export type Loja = {
  nome: string;
  whatsapp: string;
  testes: boolean;
  produto: Produto;
  foto: string;
  ofertas: Oferta[];
  oferta_padrao: string;
  desconto_pix: number;
  montar: Montar;
  frete_gratis_a_partir: number; // 0: sem frete grátis
};
// "Monte o seu kit": de `minimo` a `maximo` kits, cada um por preco_kit_centavos (o servidor recalcula).
export type Montar = { ativo: boolean; minimo: number; maximo: number; preco_kit_centavos: number };

// O produto que o checkout vende: o kit de lâminas (produto null) ou um produto do catálogo (/p/<slug>).
export type Vitrine = {
  produto: string | null;
  nome: string;
  foto: string;
  prefixo: string; // o id das ofertas: "kit3" no kit, "q3" nos produtos
  plural: string; // "Kits", "Potes": o título do "monte o seu" ("5 Potes")
  etapa: string; // "Escolha o kit"
  rotulo: string; // a linha do preço no resumo
  ofertas: Oferta[];
  montar: Montar;
  frete_gratis_a_partir: number;
  oferta_padrao: string;
  detalhe: (n: number) => string; // "2 aparelhos + 38 refis"
  resumo: (n: number) => string; // a linha embaixo do título no resumo
  porUnidade: (n: number, centavos: number) => string; // "R$ 1,13 por refil"
};

export type ProdutoPublico = {
  id: string;
  nome: string;
  chamada: string;
  descricao: string;
  foto: string;
  unidade: string;
  unidade_plural: string;
  conteudo: string;
  ofertas: Oferta[];
  montar: Montar;
  frete_gratis_a_partir: number;
  oferta_padrao: string;
};

export type ItemVitrine = { id: string; nome: string; chamada: string; foto: string; url: string; a_partir_de_centavos: number };

export function vitrineDoKit(loja: Loja): Vitrine {
  const p = loja.produto;
  const detalhe = (n: number) => `${n * p.aparelhos} ${n * p.aparelhos > 1 ? "aparelhos" : "aparelho"} + ${n * p.refis} refis`;
  return {
    produto: null,
    nome: p.nome,
    foto: loja.foto,
    prefixo: "kit",
    plural: "Kits",
    etapa: "Escolha o kit",
    rotulo: "Kit",
    ofertas: loja.ofertas,
    montar: loja.montar,
    frete_gratis_a_partir: loja.frete_gratis_a_partir,
    oferta_padrao: loja.oferta_padrao,
    detalhe,
    resumo: (n) => `${detalhe(n)} de ${p.laminas_por_refil} lâminas`,
    porUnidade: (n, centavos) => `${reais(Math.round(centavos / (n * p.refis)))} por refil`,
  };
}

export function vitrineDoProduto(p: ProdutoPublico): Vitrine {
  const nomeUnidade = (n: number) => (n === 1 ? p.unidade : p.unidade_plural);
  return {
    produto: p.id,
    nome: p.nome,
    foto: p.foto,
    prefixo: "q",
    plural: p.unidade_plural.charAt(0).toUpperCase() + p.unidade_plural.slice(1),
    etapa: "Escolha a quantidade",
    rotulo: "Produto",
    ofertas: p.ofertas,
    montar: p.montar,
    frete_gratis_a_partir: p.frete_gratis_a_partir,
    oferta_padrao: p.oferta_padrao,
    detalhe: (n) => (p.conteudo ? (n === 1 ? p.conteudo : `${n} × ${p.conteudo}`) : `${n} ${nomeUnidade(n)}`),
    resumo: (n) => `${p.nome}${p.conteudo ? ` · ${n} × ${p.conteudo}` : ""}`,
    porUnidade: (n, centavos) => `${reais(Math.round(centavos / n))} por ${p.unidade}`,
  };
}

/** A oferta de N unidades do "monte o seu" (id "kitN" ou "qN"), igual à que o servidor monta. */
export function ofertaMontada(v: Vitrine, n: number): Oferta {
  const limite = v.frete_gratis_a_partir;
  return {
    id: `${v.prefixo}${n}`,
    titulo: `${n} ${v.plural}`,
    kits: n,
    preco_centavos: n * v.montar.preco_kit_centavos,
    selo: "",
    descricao: "",
    frete_gratis: limite > 0 && n >= limite,
  };
}

/** A quantidade montada que está na URL (?oferta=kit6 ou q6), se valer. */
export function kitsMontadosDaUrl(v: Vitrine, id: string | null): number | null {
  const texto = id ?? "";
  if (!texto.startsWith(v.prefixo)) return null;
  const n = Number(texto.slice(v.prefixo.length));
  const m = v.montar;
  return m.ativo && /^\d+$/.test(texto.slice(v.prefixo.length)) && n >= m.minimo && n <= m.maximo ? n : null;
}
export type Endereco = { cep: string; rua: string; bairro: string; cidade: string; uf: string };
export type OpcaoFrete = {
  tipo: string;
  nome: string;
  centavos: number; // o que o comprador paga (0 no frete grátis)
  custo_centavos: number; // o que a Loggi cobra da loja
  gratis: boolean;
  prazo_dias: number;
  total_centavos: number;
};
export type Cotacao = { endereco: Endereco; opcoes: OpcaoFrete[]; produto_centavos: number };

export type PedidoPublico = {
  order_nsu: string;
  situacao: "aguardando_pagamento" | "pago" | "enviado" | "cancelado" | "pagamento_divergente" | "reembolso_pendente" | "reembolsado";
  primeiro_nome: string;
  produto: string;
  kits: number;
  preco_centavos: number;
  frete_descricao: string;
  frete_centavos: number;
  total_centavos: number;
  cidade: string;
  uf: string;
  forma_pagamento: string | null;
  recibo_url: string | null;
  codigo_rastreio: string | null;
  link_pagamento: string | null;
  tem_envio_loggi: boolean;
  valor_pago_centavos: number | null;
  desconto_pix: number | null;
};

export type CampoConfig = {
  chave: string;
  rotulo: string;
  grupo: string;
  tipo: string;
  ajuda: string;
  opcoes: string[];
  origem: "banco" | "vault" | "env" | "padrao";
  valor?: string;
  configurado?: boolean;
};

export type EstadoConfig = {
  grupos: Record<string, string>;
  campos: CampoConfig[];
  cofre: "vault" | "local" | "indisponivel";
  no_env: string[];
  mudancas: { quando: string | null; email: string | null; acao: string; detalhe: string | null }[];
};

export type PedidoVendedor = Omit<PedidoPublico, "primeiro_nome" | "situacao"> & {
  situacao: PedidoPublico["situacao"];
  criado_em: string;
  pago_em: string | null;
  enviado_em: string | null;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  parcelas: number | null;
  valor_pago_centavos: number | null;
  frete_prazo_dias: number | null;
  loggi_key: string | null;
  envio_criado_em: string | null;
  envio_erro: string | null;
  frete_custo_centavos: number | null; // o que a Loggi cobra da loja
  transaction_nsu: string | null;
  afiliado_codigo: string | null;
  comissao_centavos: number | null;
  reembolso_motivo: string | null;
  reembolso_centavos: number | null;
  reembolso_pedido_em: string | null;
  reembolsado_em: string | null;
};

export type Rastreio = {
  codigo: string | null;
  rastreio: {
    descricao: string;
    situacao: string | null;
    atualizado_em: string | null;
    previsao: string | null;
    local?: string | null;
    historico: { descricao: string; quando: string | null; local: string | null }[];
  } | null;
};

export class ErroApi extends Error {
  constructor(
    mensagem: string,
    public status: number,
  ) {
    super(mensagem);
  }
}

export async function chamar<T>(caminho: string, opcoes: { metodo?: string; corpo?: unknown; senha?: string } = {}): Promise<T> {
  const cabecalhos: Record<string, string> = {};
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  if (opcoes.senha) cabecalhos.Authorization = `Bearer ${opcoes.senha}`;
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: opcoes.metodo ?? (opcoes.corpo !== undefined ? "POST" : "GET"),
      headers: cabecalhos,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    });
  } catch {
    throw new ErroApi("Sem conexão. Confira a internet e tente de novo.", 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroApi(dados.erro ?? dados.detail ?? "Algo deu errado. Tente de novo.", resposta.status);
  return dados as T;
}

export const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const formatarCep = (cep: string) => {
  const d = cep.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

export const formatarCpf = (cpf: string) => {
  const d = cpf.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};

export const formatarTelefone = (tel: string) => {
  const d = tel.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// ───────── Afiliados: o ?ref= do link fica guardado neste navegador por 30 dias (vale o último link) ─────────

const CHAVE_REF = "loja-ref";
const DIAS_REF = 30;

/** Guarda o ?ref= da URL (se houver) e conta o clique uma vez por sessão. */
export function guardarRefDaUrl() {
  const codigo = (new URLSearchParams(window.location.search).get("ref") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
  if (codigo.length < 2) return;
  try {
    localStorage.setItem(CHAVE_REF, JSON.stringify({ codigo, ate: Date.now() + DIAS_REF * 86_400_000 }));
    const marca = `loja-ref-clique-${codigo}`;
    if (sessionStorage.getItem(marca)) return;
    sessionStorage.setItem(marca, "1");
  } catch {
    /* sem armazenamento: o ref vale só nesta página */
  }
  void fetch("/api/afiliados/clique", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: codigo }) }).catch(
    () => undefined,
  );
}

/** O código do afiliado guardado, se ainda valer (ou o ?ref= da URL atual). */
export function refGuardado(): string | null {
  const daUrl = new URLSearchParams(window.location.search).get("ref");
  if (daUrl) return daUrl.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) || null;
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_REF) ?? "null") as { codigo: string; ate: number } | null;
    return salvo && salvo.ate > Date.now() ? salvo.codigo : null;
  } catch {
    return null;
  }
}
