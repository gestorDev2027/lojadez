// O SKU interno de cada produto, gerado pela loja: <PREFIXO>-<CATEGORIA>-<NOME>-<Nº>, ex.: WLF-CAB-POMA-001.
// - PREFIXO: Configurações → SKU (padrão WLF);
// - CATEGORIA: as 3 primeiras letras da categoria (GER sem categoria);
// - NOME: as 4 primeiras letras da primeira palavra que conta do nome (sem "de", "kit"...);
// - Nº: o próximo livre com esse começo.
// O vendedor pode trocar à mão; o código do fornecedor e o EAN ficam em campos à parte.
import { banco } from "./banco";

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "com", "para", "o", "a", "os", "as", "kit", "the"]);

export const SKU_VALIDO = /^[A-Z0-9][A-Z0-9-]{1,59}$/;

/** Só letras e números, sem acento, em maiúsculas. */
export function limpar(texto: string): string {
  return (texto ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** O começo do SKU (sem o número): WLF-CAB-POMA. */
export function base(nome: string, categoria: string | null | undefined, prefixo = "WLF"): string {
  const pre = limpar(prefixo).replace(/ /g, "").slice(0, 6) || "WLF";
  const cat = (limpar(categoria ?? "").replace(/ /g, "").slice(0, 3) || "GER").padEnd(3, "X");
  const palavras = limpar(nome).split(" ").filter(Boolean);
  const palavra = palavras.find((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p.toLowerCase())) ?? palavras[0] ?? "PROD";
  return `${pre}-${cat}-${palavra.slice(0, 4).padEnd(4, "X")}`;
}

/** O próximo SKU livre com esse começo (WLF-CAB-POMA-001, -002...). `ignorar`: o SKU atual do próprio produto. */
export async function proximo(nome: string, categoria: string | null | undefined, prefixo = "WLF"): Promise<string> {
  const comeco = base(nome, categoria, prefixo);
  const linhas = await banco().consulta<{ sku: string }>("select sku from loja.produtos where sku like $1", [`${comeco}-%`]);
  const usados = linhas.map((l) => Number(l.sku.slice(comeco.length + 1))).filter((n) => Number.isInteger(n) && n > 0);
  const n = (usados.length ? Math.max(...usados) : 0) + 1;
  return `${comeco}-${String(n).padStart(3, "0")}`;
}

/** O SKU digitado pelo vendedor, no formato (maiúsculas, hífens no lugar de espaços). Vazio: null. */
export function normalizar(texto: string | null | undefined): string | null {
  const t = limpar(String(texto ?? "").replace(/-/g, " ")).replace(/ +/g, "-");
  return t || null;
}
