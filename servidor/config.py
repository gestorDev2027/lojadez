"""Configuração da loja: tudo vem das variáveis de ambiente (arquivo .env no desenvolvimento).

Nenhuma chave fica no código. Os valores do produto abaixo são PROVISÓRIOS: confira preço, peso e medidas da embalagem
antes de vender (a cotação da Loggi depende deles).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env")


def _texto(nome: str, padrao: str = "") -> str:
    return (os.getenv(nome) or padrao).strip()


def _inteiro(nome: str, padrao: int) -> int:
    try:
        return int(_texto(nome) or padrao)
    except ValueError:
        return padrao


def _dimensoes(nome: str, padrao: str) -> tuple[int, int, int]:
    partes = [p for p in _texto(nome, padrao).lower().replace(" ", "").split("x") if p]
    try:
        c, l, a = (int(p) for p in partes)
        return c, l, a
    except ValueError:
        c, l, a = (int(p) for p in padrao.split("x"))
        return c, l, a


# ───────── A loja ─────────

LOJA_NOME = _texto("LOJA_NOME", "Wolf & Co")
# Endereço público do site, sem a barra final. É para cá que a InfinitePay manda o cliente de volta e o webhook.
SITE_URL = _texto("SITE_URL", "http://localhost:8000").rstrip("/")
VENDEDOR_SENHA = _texto("VENDEDOR_SENHA")  # vazia: a área do vendedor fica fechada
LOJA_WHATSAPP = "".join(c for c in _texto("LOJA_WHATSAPP", "5511983910543") if c.isdigit())
# Fim da promoção (contagem regressiva da LP). Vazio: a contagem não aparece. Use só uma data real.
LOJA_PROMO_ATE = _texto("LOJA_PROMO_ATE", "2026-11-30T23:59:59-03:00")
EMPRESA = {"razaoSocial": _texto("EMPRESA_RAZAO_SOCIAL"), "cnpj": _texto("EMPRESA_CNPJ"), "email": _texto("EMPRESA_EMAIL")}
RASTREAMENTO = {"metaPixelId": _texto("META_PIXEL_ID"), "gtmId": _texto("GTM_ID")}

# ───────── O produto (valores provisórios: confira) ─────────

# Medidas e peso de UM kit embalado (a caixa da Loggi soma os kits do pedido).
_comprimento, _largura, _altura = _dimensoes("PRODUTO_DIMENSOES_CM", "32x17x5")
PRODUTO = {
    "sku": "MADE-BB006",
    "ean": "7892125080110",
    "nome": _texto("PRODUTO_NOME", "Kit Barbeador 3 Lâminas"),
    "aparelhos": 1,
    "refis": _inteiro("PRODUTO_REFIS", 19),
    "laminas_por_refil": 3,
    "peso_g": _inteiro("PRODUTO_PESO_G", 300),
    "comprimento_cm": _comprimento,
    "largura_cm": _largura,
    "altura_cm": _altura,
}

# As ofertas: quantos kits e o preço de cada pacote (em centavos). São os PADRÕES: o vendedor muda refis, preços e
# foto pela área do vendedor (servidor/catalogo.py), e o que ele grava vale sobre estes valores.
OFERTAS = [
    {"id": "kit1", "titulo": "1 Kit", "kits": 1, "preco_centavos": _inteiro("OFERTA_KIT1_CENTAVOS", 2390), "selo": ""},
    {"id": "kit2", "titulo": "2 Kits", "kits": 2, "preco_centavos": _inteiro("OFERTA_KIT2_CENTAVOS", 4490),
     "selo": "Recomendado"},
    {"id": "kit3", "titulo": "3 Kits", "kits": 3, "preco_centavos": _inteiro("OFERTA_KIT3_CENTAVOS", 6290),
     "selo": "Menor preço por refil"},
]
OFERTA_PADRAO = "kit2"

# ───────── Loggi (frete) ─────────

LOGGI_AMBIENTE = _texto("LOGGI_AMBIENTE", "simulado").lower()  # simulado | staging | producao
LOGGI_URL = {"staging": "https://stg.api.loggi.com", "producao": "https://api.loggi.com"}.get(LOGGI_AMBIENTE, "")
LOGGI_CLIENT_ID = _texto("LOGGI_CLIENT_ID")
LOGGI_CLIENT_SECRET = _texto("LOGGI_CLIENT_SECRET")
LOGGI_COMPANY_ID = _texto("LOGGI_COMPANY_ID")
# Os códigos de serviço (SISU) que a Loggi passa na homologação, separados por vírgula.
LOGGI_SERVICOS = [s.strip() for s in _texto("LOGGI_SERVICOS").split(",") if s.strip()]
ORIGEM_CEP = "".join(c for c in _texto("LOJA_ORIGEM_CEP", "01310100") if c.isdigit())
# Quem envia (vai na etiqueta e no envio da Loggi). Rua, bairro e cidade vêm do CEP; os campos abaixo trocam se precisar.
REMETENTE = {
    "nome": _texto("LOJA_REMETENTE_NOME"),
    "documento": "".join(c for c in _texto("LOJA_REMETENTE_DOCUMENTO") if c.isdigit()),  # CPF ou CNPJ
    "telefone": "".join(c for c in _texto("LOJA_REMETENTE_TELEFONE") if c.isdigit()),
    "numero": _texto("LOJA_ORIGEM_NUMERO"),
    "complemento": _texto("LOJA_ORIGEM_COMPLEMENTO"),
    "rua": _texto("LOJA_ORIGEM_RUA"),
    "bairro": _texto("LOJA_ORIGEM_BAIRRO"),
    "instrucoes": _texto("LOJA_ORIGEM_INSTRUCOES", "Remetente da loja"),
}
# Como o pacote vai documentado no envio: declaração de conteúdo (sem nota fiscal).
CONTEUDO_DECLARADO = _texto("LOGGI_DESCRICAO_CONTEUDO", "Kit barbeador com aparelho e refis de lâminas")

# ───────── InfinitePay (pagamento) ─────────

INFINITEPAY_AMBIENTE = _texto("INFINITEPAY_AMBIENTE", "simulado").lower()  # simulado | real
INFINITEPAY_URL = "https://api.checkout.infinitepay.io"
INFINITEPAY_HANDLE = _texto("INFINITEPAY_HANDLE").lstrip("$")
INFINITEPAY_API_KEY = _texto("INFINITEPAY_API_KEY")
# Por quantas horas o link de pagamento vale (só com a API Key).
INFINITEPAY_VALIDADE_HORAS = _inteiro("INFINITEPAY_VALIDADE_HORAS", 48)

# ───────── Banco ─────────

DATABASE_URL = _texto("DATABASE_URL")


def conferir() -> list[str]:
    """Os problemas de configuração que impedem o modo real (aparecem no log ao subir)."""
    problemas = []
    if LOGGI_AMBIENTE not in ("simulado", "staging", "producao"):
        problemas.append("LOGGI_AMBIENTE deve ser simulado, staging ou producao.")
    if LOGGI_AMBIENTE != "simulado":
        for nome, valor in (("LOGGI_CLIENT_ID", LOGGI_CLIENT_ID), ("LOGGI_CLIENT_SECRET", LOGGI_CLIENT_SECRET),
                            ("LOGGI_COMPANY_ID", LOGGI_COMPANY_ID)):
            if not valor:
                problemas.append(f"Falta {nome} para a Loggi.")
        if not LOGGI_SERVICOS:
            problemas.append("Falta LOGGI_SERVICOS (os códigos de serviço da Loggi).")
    if len(ORIGEM_CEP) != 8:
        problemas.append("LOJA_ORIGEM_CEP precisa ter 8 dígitos.")
    if LOGGI_AMBIENTE != "simulado":
        if not REMETENTE["nome"] or len(REMETENTE["documento"]) not in (11, 14):
            problemas.append("Para criar envios na Loggi: LOJA_REMETENTE_NOME e LOJA_REMETENTE_DOCUMENTO (CPF ou CNPJ).")
        if not REMETENTE["numero"]:
            problemas.append("Para criar envios na Loggi: LOJA_ORIGEM_NUMERO (o número do endereço de origem).")
    if INFINITEPAY_AMBIENTE not in ("simulado", "real"):
        problemas.append("INFINITEPAY_AMBIENTE deve ser simulado ou real.")
    if INFINITEPAY_AMBIENTE == "real" and not INFINITEPAY_HANDLE:
        problemas.append("Falta INFINITEPAY_HANDLE (a InfiniteTag, usada também para conferir os pagamentos).")
    return problemas
