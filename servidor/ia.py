"""A IA do painel (Google Gemini): sugere os textos de um produto e edita a foto dele.

Só a área do vendedor usa, e nada é gravado sozinho: a sugestão volta para a tela, e o vendedor escolhe o que usar.
A chave fica em GEMINI_API_KEY (Configurações → IA, ou o .env); ela vai só no cabeçalho da chamada e nunca para o log.
API REST: POST https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent
"""

import base64
import json
import logging

import httpx

from servidor import config

log = logging.getLogger("loja.ia")
URL = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
FOTO_MAXIMA = 8 * 1024 * 1024

ESTILOS = {
    "estudio": ("Fundo branco de estúdio",
                "Transforme numa foto de produto para loja online: fundo branco puro e uniforme, luz de estúdio suave, "
                "uma sombra leve embaixo do produto, produto centralizado num enquadramento quadrado."),
    "wolf": ("Fundo escuro (cara da Wolf & Co)",
             "Transforme numa foto de produto premium masculina: fundo grafite quase preto, uma luz de recorte laranja "
             "suave atrás do produto, reflexo discreto na superfície, produto centralizado num enquadramento quadrado."),
    "luz": ("Melhorar luz e nitidez",
            "Melhore a luz, a nitidez e o equilíbrio das cores, sem trocar o fundo nem o enquadramento. "
            "Deixe a imagem quadrada."),
    "livre": ("Do meu jeito", ""),
}
REGRAS_FOTO = ("Mantenha o produto exatamente como é: mesmo formato, cores, tampa, rótulo e textos impressos, sem inventar "
               "nem apagar letras. Não acrescente logotipos, marcas d'água, pessoas nem outros objetos.")

INSTRUCOES_TEXTO = (
    "Você escreve os textos da loja online da Wolf & Co, uma loja brasileira de cuidado masculino (barbear, cabelo e "
    "barba). Escreva em português do Brasil, num tom direto e confiante, sem exagero e sem emojis. Use só o que foi "
    "informado e o que dá para ver na foto: não invente ingredientes, benefícios para a saúde, resultados, "
    "certificações, prêmios nem números. Não prometa cura nem efeito médico. Não use letras maiúsculas para gritar."
)
ESQUEMA_TEXTO = {
    "type": "OBJECT",
    "properties": {
        "nome": {"type": "STRING", "description": "Nome do produto para a loja, até 60 caracteres."},
        "chamada": {"type": "STRING", "description": "Uma frase curta que vende o produto, até 120 caracteres."},
        "descricao": {"type": "STRING",
                      "description": "Descrição da página do produto: 2 a 4 parágrafos curtos separados por uma linha em "
                                     "branco, até 900 caracteres no total. Pode terminar com o modo de usar."},
    },
    "required": ["nome", "chamada", "descricao"],
}


class ErroIA(Exception):
    pass


def disponivel() -> bool:
    return bool(config.GEMINI_API_KEY)


def _chamar(modelo: str, corpo: dict, tempo: float) -> dict:
    if not disponivel():
        raise ErroIA("A IA está desligada: ponha a chave do Gemini em Configurações → IA.")
    try:
        r = httpx.post(URL.format(modelo=modelo), json=corpo, timeout=tempo,
                       headers={"x-goog-api-key": config.GEMINI_API_KEY, "Content-Type": "application/json"})
    except httpx.HTTPError:
        raise ErroIA("O Gemini não respondeu. Tente de novo em instantes.")
    if r.status_code == 429:
        raise ErroIA("O limite de uso do Gemini acabou por agora. Tente de novo em alguns minutos.")
    if r.status_code in (401, 403):
        raise ErroIA("O Gemini recusou a chave. Confira a chave em Configurações → IA.")
    if r.status_code >= 400:
        try:
            motivo = str(r.json().get("error", {}).get("message", ""))[:200]
        except ValueError:
            motivo = ""
        log.warning("Gemini recusou (%s, %s): %s", modelo, r.status_code, motivo.replace(config.GEMINI_API_KEY, "***"))
        raise ErroIA("O Gemini não conseguiu fazer isso agora. Tente de novo ou mude o pedido.")
    return r.json()


def _partes(resposta: dict) -> list[dict]:
    candidatos = resposta.get("candidates") or []
    if not candidatos:
        motivo = (resposta.get("promptFeedback") or {}).get("blockReason")
        raise ErroIA("O Gemini recusou o pedido." + (f" ({motivo})" if motivo else ""))
    return (candidatos[0].get("content") or {}).get("parts") or []


def _foto(tipo: str | None, dados: bytes | None) -> list[dict]:
    if not dados or not tipo:
        return []
    return [{"inline_data": {"mime_type": tipo, "data": base64.b64encode(dados).decode()}}]


def sugerir_textos(info: dict, foto_tipo: str | None = None, foto_dados: bytes | None = None) -> dict:
    """{nome, chamada, descricao} sugeridos a partir do que o vendedor preencheu (e da foto, se houver)."""
    campos = [("Nome atual", info.get("nome")), ("Unidade", info.get("unidade")),
              ("O que vem em 1 unidade", info.get("conteudo")), ("Chamada atual", info.get("chamada")),
              ("Descrição atual", info.get("descricao")), ("O que o vendedor quer destacar", info.get("observacoes"))]
    texto = "\n".join(f"{rotulo}: {str(valor).strip()[:1500]}" for rotulo, valor in campos if str(valor or "").strip())
    if not texto and not foto_dados:
        raise ErroIA("Preencha pelo menos o nome (ou envie a foto) para a IA ter de onde partir.")
    pedido = ("Escreva o nome, a chamada e a descrição deste produto para a página dele na loja."
              + (" Use a foto para entender o produto." if foto_dados else "") + "\n\n" + (texto or "(só a foto)"))
    corpo = {
        "system_instruction": {"parts": [{"text": INSTRUCOES_TEXTO}]},
        "contents": [{"parts": [*_foto(foto_tipo, foto_dados), {"text": pedido}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": ESQUEMA_TEXTO,
                             "temperature": 0.7},
    }
    resposta = _chamar(config.GEMINI_MODELO_TEXTO, corpo, 60)
    bruto = "".join(p.get("text", "") for p in _partes(resposta))
    try:
        dados = json.loads(bruto)
    except ValueError:
        raise ErroIA("O Gemini respondeu num formato estranho. Tente de novo.")
    return {"nome": str(dados.get("nome") or "")[:80].strip(), "chamada": str(dados.get("chamada") or "")[:140].strip(),
            "descricao": str(dados.get("descricao") or "")[:4000].strip()}


def editar_foto(foto_tipo: str, foto_dados: bytes, estilo: str, instrucao: str = "") -> dict:
    """A foto editada: {"tipo", "dados"} (bytes). Não grava: o vendedor decide se usa."""
    if estilo not in ESTILOS:
        raise ErroIA("Escolha um dos estilos.")
    instrucao = " ".join((instrucao or "").split())[:500]
    base = ESTILOS[estilo][1]
    if estilo == "livre" and not instrucao:
        raise ErroIA("Escreva o que você quer mudar na foto.")
    pedido = " ".join(t for t in (base, instrucao, REGRAS_FOTO) if t)
    corpo = {"contents": [{"parts": [*_foto(foto_tipo, foto_dados), {"text": pedido}]}],
             "generationConfig": {"responseModalities": ["IMAGE"]}}
    resposta = _chamar(config.GEMINI_MODELO_IMAGEM, corpo, 150)
    for parte in _partes(resposta):
        dados = parte.get("inlineData") or parte.get("inline_data")
        if dados and dados.get("data"):
            imagem = base64.b64decode(dados["data"])
            if len(imagem) > FOTO_MAXIMA:
                raise ErroIA("A foto gerada ficou grande demais. Tente outro estilo.")
            return {"tipo": dados.get("mimeType") or dados.get("mime_type") or "image/png", "dados": imagem}
    raise ErroIA("O Gemini não devolveu uma imagem. Tente de novo ou mude o pedido.")
