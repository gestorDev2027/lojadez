// As chamadas à API da loja (servidor Python). Os preços estão sempre em centavos.

export type Produto = { sku: string; ean: string; nome: string; aparelhos: number; refis: number; laminas_por_refil: number };
export type Oferta = { id: string; titulo: string; kits: number; preco_centavos: number; selo: string; descricao: string };
export type Loja = {
  nome: string;
  whatsapp: string;
  testes: boolean;
  produto: Produto;
  foto: string;
  ofertas: Oferta[];
  oferta_padrao: string;
  desconto_pix: number;
};
export type Endereco = { cep: string; rua: string; bairro: string; cidade: string; uf: string };
export type OpcaoFrete = {
  tipo: string;
  nome: string;
  centavos: number;
  prazo_dias: number;
  total_centavos: number;
};
export type Cotacao = { endereco: Endereco; opcoes: OpcaoFrete[]; produto_centavos: number };

export type PedidoPublico = {
  order_nsu: string;
  situacao: "aguardando_pagamento" | "pago" | "enviado" | "cancelado" | "pagamento_divergente";
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
