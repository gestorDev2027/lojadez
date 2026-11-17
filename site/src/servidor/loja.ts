// O que as páginas da loja recebem do servidor: o resumo da loja (/api/loja, usado pelo checkout) e a configuração da
// landing do kit (antes o /lp-config.js; agora vai junto com a página, sem uma ida a mais ao servidor).
import * as catalogo from "./catalogo";
import { cfg, descontoPix } from "./config";
import * as produtos from "./produtos";

export async function ofertasComDescricao() {
  const lista = await catalogo.ofertas();
  return Promise.all(lista.map(async (o) => ({ ...o, descricao: await catalogo.descricaoOferta(o) })));
}

/** GET /api/loja: o que o checkout precisa do kit e da loja. */
export async function resumoDaLoja() {
  const [c, p] = await Promise.all([cfg(), catalogo.produto()]);
  return {
    nome: c.LOJA_NOME,
    whatsapp: c.LOJA_WHATSAPP,
    testes: c.LOGGI_AMBIENTE === "simulado" || c.INFINITEPAY_AMBIENTE === "simulado",
    produto: { sku: p.sku, ean: p.ean, nome: p.nome, aparelhos: p.aparelhos, refis: p.refis, laminas_por_refil: p.laminas_por_refil },
    foto: await catalogo.urlFoto(),
    ofertas: await ofertasComDescricao(),
    oferta_padrao: await catalogo.ofertaPadrao(),
    desconto_pix: descontoPix(c),
    montar: await catalogo.montar(),
    frete_gratis_a_partir: await catalogo.freteGratisAPartir(),
  };
}

/** A configuração da landing do kit (window.LP_CONFIG, lida por public/assets/js/main.js). */
export async function configDaLanding() {
  const [c, p, lista, montar, vitrine] = await Promise.all([
    cfg(), catalogo.produto(), catalogo.ofertas(), catalogo.montar(), produtos.vitrine(),
  ]);
  const outros = [...vitrine].sort((a, b) => Number(b.destaque) - Number(a.destaque)).filter((i) => i.id !== produtos.KIT);
  return {
    fotoKit: await catalogo.urlFoto(),
    marca: c.LOJA_NOME,
    produto: { nome: p.nome, aparelhos: p.aparelhos, refis: p.refis, laminasPorRefil: p.laminas_por_refil },
    pagamentoNaEntrega: false,
    descontoPix: descontoPix(c),
    whatsapp: { numero: c.LOJA_WHATSAPP, mensagem: "Olá! Tenho interesse no {kit} ({preco})." },
    checkout: { repassarParametros: true, abrirEmNovaAba: false },
    ofertas: lista.map((o) => ({
      id: o.id, titulo: o.titulo, quantidade: o.kits, preco: o.preco_centavos / 100, precoDe: null, selo: o.selo,
      freteGratis: Boolean(o.frete_gratis), checkoutUrl: `/checkout?oferta=${o.id}`,
    })),
    ofertaPadrao: await catalogo.ofertaPadrao(),
    produtos: outros.map((i) => ({ nome: i.nome, chamada: i.chamada, foto: i.foto, url: i.url, aPartirDe: i.a_partir_de_centavos / 100, selo: i.selo })),
    montar: { ...montar, precoKit: montar.preco_kit_centavos / 100 },
    freteGratisAPartir: await catalogo.freteGratisAPartir(),
    calculadora: { barbeadasPorSemana: 5, usosPorRefil: 5 },
    contagem: { ativo: Boolean(c.LOJA_PROMO_ATE), terminaEm: c.LOJA_PROMO_ATE, titulo: "Preço promocional válido por" },
    depoimentos: [], // só depoimentos reais
    empresa: c.EMPRESA,
    rastreamento: c.RASTREAMENTO,
    // A roleta (o sorteio é no servidor: aqui só os valores para desenhar a roda)
    roleta: { ativa: c.ROLETA.ativa, valores: c.ROLETA.valores_centavos.map((v) => v / 100), minimo: c.ROLETA.minimo_centavos / 100 },
  };
}

/** Um <script> com JSON seguro dentro do HTML (sem fechar a tag por engano). */
export const jsonNoHtml = (dados: unknown) => JSON.stringify(dados).replace(/</g, "\\u003c");
