// A aba Configurações: ler, conferir e gravar o que antes ficava no .env.
// Os valores comuns vão para a tabela `configuracoes`; os segredos (tipo "segredo") vão para o Vault (cofre.ts).
// Toda mudança fica na `auditoria`, só com os nomes dos campos (nunca os valores).
import { agora, banco, registrar, ultimasMudancas } from "./banco";
import * as cofre from "./cofre";
import { CAMPOS, GRUPOS, POR_CHAVE, doAmbiente, esquecer, type Campo } from "./config";

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;

export class ErroConfiguracao extends Error {}

async function lerTabela(): Promise<Record<string, string>> {
  const linhas = await banco().consulta<{ chave: string; valor: string }>("select chave, valor from loja.configuracoes");
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

/** O que foi salvo pela tela: os valores comuns e os segredos. */
export async function lerSalvos(): Promise<Record<string, string>> {
  const valores: Record<string, string> = {};
  for (const [k, v] of Object.entries(await lerTabela())) if (k in POR_CHAVE) valores[k] = v;
  try {
    for (const [k, v] of Object.entries(await cofre.lerTodos())) if (k in POR_CHAVE) valores[k] = v;
  } catch (erro) {
    console.error("Não deu para ler os segredos do Vault.", erro); // sem o Vault a loja ainda funciona com o ambiente
  }
  return valores;
}

const numeroCurto = (n: number) => String(Number(n.toPrecision(6)));

function conferirCampo(campo: Campo, bruto: unknown): string {
  const texto = String(bruto ?? "");
  let valor = campo.tipo === "segredo" ? texto.trim() : texto.split(/\s+/).filter(Boolean).join(" ");
  const nome = campo.rotulo;
  if (campo.tipo === "segredo") {
    if (valor.length > 1000) throw new ErroConfiguracao(`${nome}: grande demais.`);
    return valor;
  }
  if (valor.length > 300) throw new ErroConfiguracao(`${nome}: até 300 caracteres.`);
  if (!valor) {
    if (["escolha", "sim_nao", "inteiro", "decimal", "dimensoes", "url"].includes(campo.tipo) || campo.chave === "LOJA_ORIGEM_CEP")
      throw new ErroConfiguracao(`Preencha ${nome}.`);
    return "";
  }
  if (campo.tipo === "escolha" && !campo.opcoes.includes(valor.toLowerCase()))
    throw new ErroConfiguracao(`${nome}: use ${campo.opcoes.join(", ")}.`);
  if (campo.tipo === "sim_nao") {
    if (!["sim", "nao"].includes(valor.toLowerCase())) throw new ErroConfiguracao(`${nome}: sim ou nao.`);
    return valor.toLowerCase();
  }
  if (campo.tipo === "escolha") return valor.toLowerCase();
  if (campo.tipo === "digitos") {
    const digitos = valor.replace(/\D/g, "");
    if (!campo.tamanhos.includes(digitos.length)) {
      const t = [...campo.tamanhos].sort((a, b) => a - b);
      const texto = t.length <= 3 ? t.join(" ou ") : `${t[0]} a ${t[t.length - 1]}`;
      throw new ErroConfiguracao(`${nome}: ${texto} números.`);
    }
    return digitos;
  }
  if (campo.tipo === "inteiro" || campo.tipo === "decimal") {
    const limpo = campo.tipo === "decimal" ? valor.replace(",", ".") : valor;
    const ok = campo.tipo === "decimal" ? /^[+-]?(\d+\.?\d*|\.\d+)$/.test(limpo) : /^[+-]?\d+$/.test(limpo);
    if (!ok) throw new ErroConfiguracao(`${nome}: use um número${campo.tipo === "inteiro" ? " inteiro" : ""}.`);
    const numero = Number(limpo);
    if ((campo.minimo !== undefined && numero < campo.minimo) || (campo.maximo !== undefined && numero > campo.maximo))
      throw new ErroConfiguracao(`${nome}: de ${campo.minimo} a ${campo.maximo}.`);
    return campo.tipo === "decimal" ? numeroCurto(numero) : String(numero);
  }
  if (campo.tipo === "dimensoes") {
    const partes = valor.toLowerCase().replace(/ /g, "").split("x");
    if (partes.length !== 3 || !partes.every((p) => /^\d+$/.test(p) && +p >= 1 && +p <= 200))
      throw new ErroConfiguracao(`${nome}: comprimento x largura x altura em cm, ex.: 25x15x2.`);
    return partes.map((p) => String(+p)).join("x");
  }
  if (campo.tipo === "url") {
    if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(valor))
      throw new ErroConfiguracao(`${nome}: comece com https:// (ex.: https://sualoja.com.br).`);
    return valor.replace(/\/+$/, "");
  }
  if (campo.tipo === "email") {
    if (!EMAIL.test(valor)) throw new ErroConfiguracao(`${nome}: e-mail inválido.`);
    return valor.toLowerCase();
  }
  if (campo.tipo === "data") {
    if (!/^\d{4}-\d{2}-\d{2}/.test(valor) || Number.isNaN(Date.parse(valor)))
      throw new ErroConfiguracao(`${nome}: use o formato 2026-11-30T23:59:59-03:00.`);
    return valor;
  }
  if (campo.chave === "INFINITEPAY_HANDLE") {
    valor = valor.replace(/^\$+/, "");
    if (!/^[a-z0-9._-]{2,60}$/i.test(valor))
      throw new ErroConfiguracao(`${nome}: só letras, números, ponto, hífen e sublinhado (sem o $).`);
  }
  return valor;
}

/** Confere tudo antes de gravar qualquer coisa. Segredo vazio = não muda; para tirar, use `apagarSegredos`. */
export async function salvar(valores: unknown, apagarSegredos: unknown, email: string) {
  if (!valores || typeof valores !== "object" || Array.isArray(valores)) throw new ErroConfiguracao("Nada para salvar.");
  const comuns: Record<string, string> = {};
  const segredos: Record<string, string> = {};
  for (const [chave, bruto] of Object.entries(valores)) {
    const campo = POR_CHAVE[chave];
    if (!campo) throw new ErroConfiguracao(`Campo desconhecido: ${chave}.`);
    const valor = conferirCampo(campo, bruto);
    if (campo.tipo === "segredo") {
      if (valor) segredos[chave] = valor;
    } else comuns[chave] = valor;
  }
  const apagar = (Array.isArray(apagarSegredos) ? apagarSegredos : []).filter(
    (c): c is string => typeof c === "string" && POR_CHAVE[c]?.tipo === "segredo",
  );
  if ((Object.keys(segredos).length || apagar.length) && (await cofre.tipo()) === "indisponivel")
    throw new ErroConfiguracao("Este banco não tem o Vault do Supabase: as chaves ficam nas variáveis de ambiente.");

  await banco().transacao(async (b) => {
    for (const [chave, valor] of Object.entries(comuns)) {
      await b.consulta("delete from loja.configuracoes where chave = $1", [chave]);
      await b.consulta(
        "insert into loja.configuracoes (chave, valor, atualizado_em, atualizado_por) values ($1, $2, $3, $4)",
        [chave, valor, agora(), email],
      );
    }
  });
  for (const [chave, valor] of Object.entries(segredos)) await cofre.gravar(chave, valor);
  for (const chave of apagar) await cofre.apagar(chave);

  const mudou = [...new Set([...Object.keys(comuns), ...Object.keys(segredos), ...apagar])].sort();
  if (mudou.length) await registrar(email, "configuracao", "Mudou: " + mudou.join(", "));
  esquecer();
  return estado();
}

/** Leva para o banco (e os segredos para o Vault) o que está no ambiente e ainda não foi salvo pela tela. */
export async function importarDoAmbiente(email: string) {
  const salvos = await lerSalvos();
  const valores: Record<string, string> = {};
  for (const campo of CAMPOS) {
    const doEnv = doAmbiente(campo.chave);
    if (doEnv && !(campo.chave in salvos)) valores[campo.chave] = doEnv;
  }
  if (!Object.keys(valores).length) return estado();
  try {
    return await salvar(valores, null, email);
  } catch (erro) {
    if (erro instanceof ErroConfiguracao) throw new ErroConfiguracao(`Não importei nada: ${erro.message}`);
    throw erro;
  }
}

/** Para a tela: cada campo com o valor que vale e de onde ele vem. Segredos: só se estão configurados. */
export async function estado() {
  const salvos = await lerSalvos();
  const modoCofre = await cofre.tipo();
  const campos = CAMPOS.map((campo) => {
    let origem: string;
    let valor: string;
    if (campo.chave in salvos) {
      origem = campo.tipo === "segredo" && modoCofre === "vault" ? "vault" : "banco";
      valor = salvos[campo.chave];
    } else if (doAmbiente(campo.chave)) {
      origem = "env";
      valor = doAmbiente(campo.chave)!;
    } else {
      origem = "padrao";
      valor = campo.padrao;
    }
    const item: Record<string, unknown> = {
      chave: campo.chave,
      rotulo: campo.rotulo,
      grupo: campo.grupo,
      tipo: campo.tipo,
      ajuda: campo.ajuda,
      opcoes: campo.opcoes,
      origem,
    };
    if (campo.tipo === "segredo") item.configurado = Boolean(valor);
    else item.valor = valor || "";
    return item;
  });
  return {
    grupos: GRUPOS,
    campos,
    cofre: modoCofre,
    no_env: CAMPOS.filter((c) => doAmbiente(c.chave) && !(c.chave in salvos)).map((c) => c.chave),
    mudancas: (await ultimasMudancas()).map((m) => ({
      quando: m.quando ? new Date(m.quando).toISOString() : null,
      email: m.email,
      acao: m.acao,
      detalhe: m.detalhe,
    })),
  };
}
