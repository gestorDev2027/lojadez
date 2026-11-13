"""Configuração da loja.

De onde vem cada valor, nesta ordem:
1. o que o vendedor salvou na aba Configurações (tabela `configuracoes`; os segredos no Vault do Supabase);
2. as variáveis de ambiente (arquivo .env no desenvolvimento);
3. o padrão abaixo.

No .env (e no Render) só precisa ficar o DATABASE_URL. Nenhuma chave fica no código. `aplicar()` recalcula os valores
quando o vendedor salva (servidor/configuracoes.py): vale na hora, sem republicar o site.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env")


@dataclass(frozen=True)
class Campo:
    chave: str  # o nome da variável de ambiente e da linha no banco
    rotulo: str
    grupo: str
    tipo: str = "texto"  # texto | segredo | escolha | sim_nao | inteiro | decimal | digitos | dimensoes | url | email | data
    padrao: str = ""
    ajuda: str = ""
    opcoes: tuple[str, ...] = ()
    minimo: float | None = None
    maximo: float | None = None
    tamanhos: tuple[int, ...] = field(default=())  # para "digitos": quantos dígitos valem


GRUPOS = {
    "loja": "A loja",
    "pacote": "O pacote (para a Loggi)",
    "loggi": "Loggi",
    "remetente": "Remetente (quem envia)",
    "infinitepay": "InfinitePay",
    "afiliados": "Afiliados",
    "ia": "IA (Google Gemini)",
    "rastreamento": "Rastreamento (opcional)",
}

CAMPOS: tuple[Campo, ...] = (
    Campo("LOJA_NOME", "Nome da loja", "loja", padrao="Wolf & Co"),
    Campo("SITE_URL", "Endereço do site", "loja", "url", "http://localhost:8000",
          "Sem a barra no fim. A InfinitePay manda o cliente de volta para cá; o aviso de pagamento só vem com https."),
    Campo("LOJA_WHATSAPP", "WhatsApp", "loja", "digitos", "5511983910543", "Com 55 e o DDD, só números.",
          tamanhos=(12, 13)),
    Campo("LOJA_PROMO_ATE", "Fim da promoção", "loja", "data", "2026-11-30T23:59:59-03:00",
          "Contagem regressiva da página. Vazio: não aparece. Use só uma data real."),
    Campo("EMPRESA_RAZAO_SOCIAL", "Razão social", "loja"),
    Campo("EMPRESA_CNPJ", "CNPJ", "loja", "digitos", tamanhos=(14,)),
    Campo("EMPRESA_EMAIL", "E-mail de contato", "loja", "email"),

    Campo("PRODUTO_NOME", "Nome do produto", "pacote", padrao="Kit Barbeador 3 Lâminas"),
    Campo("PRODUTO_PESO_G", "Peso de 1 kit embalado (g)", "pacote", "inteiro", "300", minimo=1, maximo=30000),
    Campo("PRODUTO_DIMENSOES_CM", "Medidas de 1 kit embalado (cm)", "pacote", "dimensoes", "32x17x5",
          "Comprimento x largura x altura, ex.: 25x15x2."),

    Campo("LOGGI_AMBIENTE", "Ambiente", "loggi", "escolha", "simulado",
          "simulado: frete de mentira, nada vai para a Loggi.", opcoes=("simulado", "staging", "producao")),
    Campo("LOGGI_CLIENT_ID", "client_id", "loggi", "segredo"),
    Campo("LOGGI_CLIENT_SECRET", "client_secret", "loggi", "segredo"),
    Campo("LOGGI_COMPANY_ID", "company_id", "loggi", "digitos", tamanhos=tuple(range(1, 21))),
    Campo("LOGGI_SERVICOS", "Código do serviço (externalServiceId)", "loggi", ajuda="Mais de um: separe por vírgula."),
    Campo("LOGGI_ENVIO_AUTOMATICO", "Criar o envio sozinho quando o pagamento entra", "loggi", "sim_nao", "nao",
          "Se a Loggi recusar, o pedido mostra o motivo e o envio é criado à mão."),
    Campo("LOGGI_DESCRICAO_CONTEUDO", "Conteúdo declarado", "loggi",
          padrao="Kit barbeador com aparelho e refis de lâminas"),

    Campo("LOJA_ORIGEM_CEP", "CEP de onde sai o envio", "remetente", "digitos", "01310100", tamanhos=(8,)),
    Campo("LOJA_ORIGEM_NUMERO", "Número", "remetente"),
    Campo("LOJA_ORIGEM_COMPLEMENTO", "Complemento", "remetente"),
    Campo("LOJA_ORIGEM_RUA", "Rua", "remetente", ajuda="Vazio: a rua do CEP."),
    Campo("LOJA_ORIGEM_BAIRRO", "Bairro", "remetente", ajuda="Vazio: o bairro do CEP."),
    Campo("LOJA_ORIGEM_INSTRUCOES", "Instruções para a coleta", "remetente", padrao="Remetente da loja"),
    Campo("LOJA_REMETENTE_NOME", "Nome ou razão social", "remetente"),
    Campo("LOJA_REMETENTE_DOCUMENTO", "CPF ou CNPJ", "remetente", "digitos", tamanhos=(11, 14)),
    Campo("LOJA_REMETENTE_TELEFONE", "Telefone com DDD", "remetente", "digitos", tamanhos=(10, 11)),

    Campo("INFINITEPAY_AMBIENTE", "Ambiente", "infinitepay", "escolha", "simulado",
          "simulado: página de pagamento de mentira da própria loja.", opcoes=("simulado", "real")),
    Campo("INFINITEPAY_HANDLE", "InfiniteTag", "infinitepay", ajuda="Seu usuário no app da InfinitePay, sem o $."),
    Campo("INFINITEPAY_API_KEY", "API Key do Checkout Integrado", "infinitepay", "segredo",
          ajuda="Começa com inchk_. Necessária para o desconto no Pix e para o link valer um pagamento só."),
    Campo("INFINITEPAY_DESCONTO_PIX", "Desconto no Pix (%)", "infinitepay", "decimal", "0",
          "0: sem desconto. Vale sobre o total (kit + frete). Precisa da API Key.", minimo=0, maximo=50),
    Campo("INFINITEPAY_VALIDADE_HORAS", "Validade do link (horas)", "infinitepay", "inteiro", "48", minimo=1, maximo=720),

    Campo("AFILIADOS_DIAS_LIBERACAO", "Dias para liberar a comissão", "afiliados", "inteiro", "7",
          "A comissão fica “a liberar” por estes dias depois do pagamento (o prazo de devolução); depois fica disponível "
          "para repassar.", minimo=0, maximo=90),
    Campo("GEMINI_API_KEY", "Chave da API do Gemini", "ia", "segredo",
          ajuda="Do Google AI Studio. Liga as sugestões de texto e a edição de foto no cadastro de produtos."),
    Campo("GEMINI_MODELO_TEXTO", "Modelo de texto", "ia", padrao="gemini-3.8-flash"),
    Campo("GEMINI_MODELO_IMAGEM", "Modelo de imagem", "ia", padrao="gemini-nano-banana-2.1"),

    Campo("META_PIXEL_ID", "Meta Pixel ID", "rastreamento", "digitos", tamanhos=tuple(range(10, 21))),
    Campo("GTM_ID", "Google Tag Manager ID", "rastreamento", ajuda="Ex.: GTM-XXXXXXX."),
)

POR_CHAVE = {c.chave: c for c in CAMPOS}

# Valores que não mudam pela tela
PRODUTO_SKU, PRODUTO_EAN = "MADE-BB006", "7892125080110"
INFINITEPAY_URL = "https://api.checkout.infinitepay.io"
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
# O acesso à área do vendedor fixo no .env (opcional). Ao ligar, a loja cria esse acesso (ou acerta a senha) no banco,
# onde fica só o hash. A senha desse acesso só muda no .env.
ADMIN_EMAIL = (os.getenv("LOJA_ADMIN_EMAIL") or "").strip().lower()
ADMIN_SENHA = os.getenv("LOJA_ADMIN_SENHA") or ""


def _digitos(texto: str) -> str:
    return "".join(c for c in texto or "" if c.isdigit())


def _inteiro(texto: str, padrao: int) -> int:
    try:
        return int(str(texto).strip() or padrao)
    except ValueError:
        return padrao


def _decimal(texto: str, padrao: float) -> float:
    try:
        return float(str(texto).strip().replace(",", ".") or padrao)
    except ValueError:
        return padrao


def dimensoes(texto: str, padrao: str = "32x17x5") -> tuple[int, int, int]:
    partes = [p for p in str(texto).lower().replace(" ", "").split("x") if p]
    try:
        c, l, a = (int(p) for p in partes)
        return c, l, a
    except ValueError:
        c, l, a = (int(p) for p in padrao.split("x"))
        return c, l, a


def do_ambiente(chave: str) -> str | None:
    """O valor da variável de ambiente (None se não existe ou está vazia)."""
    valor = (os.getenv(chave) or "").strip()
    return valor or None


def aplicar(sobrepor: dict | None = None) -> None:
    """Recalcula a configuração: o que veio do banco (`sobrepor`) vale sobre o .env, que vale sobre o padrão."""
    sobrepor = sobrepor or {}

    def v(chave: str) -> str:
        if chave in sobrepor and sobrepor[chave] is not None:
            return str(sobrepor[chave]).strip()
        return do_ambiente(chave) or POR_CHAVE[chave].padrao

    g = globals()
    g["LOJA_NOME"] = v("LOJA_NOME")
    g["SITE_URL"] = v("SITE_URL").rstrip("/")
    g["LOJA_WHATSAPP"] = _digitos(v("LOJA_WHATSAPP"))
    g["LOJA_PROMO_ATE"] = v("LOJA_PROMO_ATE")
    g["EMPRESA"] = {"razaoSocial": v("EMPRESA_RAZAO_SOCIAL"), "cnpj": v("EMPRESA_CNPJ"), "email": v("EMPRESA_EMAIL")}
    g["RASTREAMENTO"] = {"metaPixelId": v("META_PIXEL_ID"), "gtmId": v("GTM_ID")}

    comprimento, largura, altura = dimensoes(v("PRODUTO_DIMENSOES_CM"))
    g["PRODUTO"] = {
        "sku": PRODUTO_SKU, "ean": PRODUTO_EAN, "nome": v("PRODUTO_NOME"), "aparelhos": 1,
        # refis e preços: os padrões; o vendedor muda pela aba Produto e preços (servidor/catalogo.py)
        "refis": _inteiro(os.getenv("PRODUTO_REFIS") or "", 19), "laminas_por_refil": 3,
        "peso_g": _inteiro(v("PRODUTO_PESO_G"), 300),
        "comprimento_cm": comprimento, "largura_cm": largura, "altura_cm": altura,
    }

    g["LOGGI_AMBIENTE"] = v("LOGGI_AMBIENTE").lower()
    g["LOGGI_URL"] = {"staging": "https://stg.api.loggi.com", "producao": "https://api.loggi.com"}.get(g["LOGGI_AMBIENTE"], "")
    g["LOGGI_CLIENT_ID"] = v("LOGGI_CLIENT_ID")
    g["LOGGI_CLIENT_SECRET"] = v("LOGGI_CLIENT_SECRET")
    g["LOGGI_COMPANY_ID"] = v("LOGGI_COMPANY_ID")
    g["LOGGI_SERVICOS"] = [s.strip() for s in v("LOGGI_SERVICOS").split(",") if s.strip()]
    g["LOGGI_ENVIO_AUTOMATICO"] = v("LOGGI_ENVIO_AUTOMATICO").lower() in ("sim", "s", "true", "1")
    g["CONTEUDO_DECLARADO"] = v("LOGGI_DESCRICAO_CONTEUDO")
    g["ORIGEM_CEP"] = _digitos(v("LOJA_ORIGEM_CEP"))
    g["REMETENTE"] = {
        "nome": v("LOJA_REMETENTE_NOME"), "documento": _digitos(v("LOJA_REMETENTE_DOCUMENTO")),
        "telefone": _digitos(v("LOJA_REMETENTE_TELEFONE")), "numero": v("LOJA_ORIGEM_NUMERO"),
        "complemento": v("LOJA_ORIGEM_COMPLEMENTO"), "rua": v("LOJA_ORIGEM_RUA"), "bairro": v("LOJA_ORIGEM_BAIRRO"),
        "instrucoes": v("LOJA_ORIGEM_INSTRUCOES"),
    }

    g["INFINITEPAY_AMBIENTE"] = v("INFINITEPAY_AMBIENTE").lower()
    g["INFINITEPAY_HANDLE"] = v("INFINITEPAY_HANDLE").lstrip("$")
    g["INFINITEPAY_API_KEY"] = v("INFINITEPAY_API_KEY")
    g["INFINITEPAY_VALIDADE_HORAS"] = _inteiro(v("INFINITEPAY_VALIDADE_HORAS"), 48)
    g["INFINITEPAY_DESCONTO_PIX"] = min(max(_decimal(v("INFINITEPAY_DESCONTO_PIX"), 0), 0), 50)

    g["AFILIADOS_DIAS_LIBERACAO"] = _inteiro(v("AFILIADOS_DIAS_LIBERACAO"), 7)
    g["GEMINI_API_KEY"] = v("GEMINI_API_KEY")
    g["GEMINI_MODELO_TEXTO"] = v("GEMINI_MODELO_TEXTO") or "gemini-3.8-flash"
    g["GEMINI_MODELO_IMAGEM"] = v("GEMINI_MODELO_IMAGEM") or "gemini-nano-banana-2.1"


aplicar()

# As ofertas: quantos kits e o preço de cada pacote (em centavos). São os PADRÕES: o vendedor muda refis, preços e
# foto pela área do vendedor (servidor/catalogo.py), e o que ele grava vale sobre estes valores.
OFERTAS = [
    {"id": "kit1", "titulo": "1 Kit", "kits": 1, "preco_centavos": _inteiro(os.getenv("OFERTA_KIT1_CENTAVOS") or "", 2390),
     "selo": ""},
    {"id": "kit2", "titulo": "2 Kits", "kits": 2, "preco_centavos": _inteiro(os.getenv("OFERTA_KIT2_CENTAVOS") or "", 4490),
     "selo": "Recomendado"},
    {"id": "kit3", "titulo": "3 Kits", "kits": 3, "preco_centavos": _inteiro(os.getenv("OFERTA_KIT3_CENTAVOS") or "", 6290),
     "selo": "Menor preço por refil"},
]
OFERTA_PADRAO = "kit2"
# "Monte o seu kit": de MONTAR_MINIMO kits até o máximo, cada kit pelo preço da faixa "4 ou mais". O frete é grátis a partir
# de FRETE_GRATIS_A_PARTIR kits (0: nunca); a loja paga a Loggi. Tudo isso muda em Produto e preços.
MONTAR_MINIMO = 4
MONTAR_PADRAO = {"ativo": True, "maximo": 10, "preco_kit_centavos": 1990}
FRETE_GRATIS_A_PARTIR = 4


def desconto_pix() -> float:
    """O desconto no Pix que vale de fato: a InfinitePay só aplica com a API Key (no simulado, sempre)."""
    if INFINITEPAY_AMBIENTE == "simulado" or INFINITEPAY_API_KEY:
        return INFINITEPAY_DESCONTO_PIX
    return 0.0


def conferir() -> list[str]:
    """Os problemas de configuração que impedem o modo real (aparecem no log ao subir e na aba Integrações)."""
    problemas = []
    if LOGGI_AMBIENTE not in ("simulado", "staging", "producao"):
        problemas.append("Loggi: o ambiente deve ser simulado, staging ou producao.")
    if LOGGI_AMBIENTE != "simulado":
        for nome, valor in (("client_id", LOGGI_CLIENT_ID), ("client_secret", LOGGI_CLIENT_SECRET),
                            ("company_id", LOGGI_COMPANY_ID)):
            if not valor:
                problemas.append(f"Loggi: falta o {nome}.")
        if not LOGGI_SERVICOS:
            problemas.append("Loggi: falta o código do serviço (externalServiceId).")
    if len(ORIGEM_CEP) != 8:
        problemas.append("Remetente: o CEP de origem precisa ter 8 dígitos.")
    if LOGGI_AMBIENTE != "simulado":
        if not REMETENTE["nome"] or len(REMETENTE["documento"]) not in (11, 14):
            problemas.append("Remetente: para criar envios na Loggi, preencha o nome e o CPF ou CNPJ.")
        if not REMETENTE["numero"]:
            problemas.append("Remetente: para criar envios na Loggi, preencha o número do endereço de origem.")
    if INFINITEPAY_AMBIENTE not in ("simulado", "real"):
        problemas.append("InfinitePay: o ambiente deve ser simulado ou real.")
    if INFINITEPAY_AMBIENTE == "real" and not INFINITEPAY_HANDLE:
        problemas.append("InfinitePay: falta a InfiniteTag (usada também para conferir os pagamentos).")
    if INFINITEPAY_DESCONTO_PIX and not desconto_pix():
        problemas.append("InfinitePay: o desconto no Pix só vale com a API Key do Checkout Integrado.")
    return problemas
