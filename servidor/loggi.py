"""Frete pela Loggi: endereço pelo CEP (ViaCEP), token OAuth2 e cotação.

No ambiente "simulado" a cotação é uma conta local (para desenvolver sem as credenciais). Em staging/producao, chama a
API da Loggi: POST /v2/oauth2/token (client_id e client_secret → idToken) e
POST /v1/companies/{company_id}/quotations.
"""

import math
import re
import threading
import time

import httpx

from servidor import config


class ErroFrete(Exception):
    """Erro com mensagem que pode ir para o cliente."""


# ───────── CEP ─────────

_cache_cep: dict[str, dict] = {}


def limpar_cep(cep: str) -> str:
    digitos = re.sub(r"\D", "", cep or "")
    if len(digitos) != 8:
        raise ErroFrete("CEP inválido: use os 8 números.")
    return digitos


def endereco_do_cep(cep: str) -> dict:
    """Rua, bairro, cidade e UF pelo ViaCEP (com cache em memória)."""
    cep = limpar_cep(cep)
    if cep in _cache_cep:
        return _cache_cep[cep]
    try:
        r = httpx.get(f"https://viacep.com.br/ws/{cep}/json/", timeout=8)
        dados = r.json() if r.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        raise ErroFrete("Não consegui consultar o CEP agora. Tente de novo em instantes.")
    if not dados or dados.get("erro"):
        raise ErroFrete("CEP não encontrado.")
    endereco = {"cep": cep, "rua": dados.get("logradouro") or "", "bairro": dados.get("bairro") or "",
                "cidade": dados.get("localidade") or "", "uf": dados.get("uf") or ""}
    _cache_cep[cep] = endereco
    return endereco


# ───────── O pacote ─────────

def pacote(kits: int, valor_centavos: int) -> dict:
    """Uma caixa com os kits empilhados (altura × kits) e 100 g de embalagem."""
    p = config.PRODUTO
    return {"peso_g": p["peso_g"] * kits + 100, "comprimento_cm": p["comprimento_cm"], "largura_cm": p["largura_cm"],
            "altura_cm": min(p["altura_cm"] * kits, 100), "valor_centavos": valor_centavos}


# ───────── Token (OAuth2 client credentials) ─────────

_token: dict = {}
_trava_token = threading.Lock()


def _obter_token(renovar: bool = False) -> str:
    with _trava_token:
        if not renovar and _token.get("valor") and _token.get("vence", 0) > time.time() + 60:
            return _token["valor"]
        try:
            r = httpx.post(f"{config.LOGGI_URL}/v2/oauth2/token", timeout=15,
                           json={"client_id": config.LOGGI_CLIENT_ID, "client_secret": config.LOGGI_CLIENT_SECRET})
        except httpx.HTTPError:
            raise ErroFrete("A Loggi não respondeu. Tente de novo em instantes.")
        if r.status_code != 200:
            raise ErroFrete("Não consegui entrar na Loggi (credenciais). Avise a loja.")
        dados = r.json()
        try:
            validade = int(float(str(dados.get("expiresIn") or "3600").rstrip("s")))
        except ValueError:
            validade = 3600
        _token.update(valor=dados["idToken"], vence=time.time() + validade)
        return _token["valor"]


def _chamar(metodo: str, caminho: str, corpo: dict | None = None) -> httpx.Response:
    url = f"{config.LOGGI_URL}/v1/companies/{config.LOGGI_COMPANY_ID}{caminho}"
    for tentativa in range(2):
        cabecalhos = {"Authorization": f"Bearer {_obter_token(renovar=tentativa > 0)}"}
        try:
            r = httpx.request(metodo, url, json=corpo, headers=cabecalhos, timeout=20)
        except httpx.HTTPError:
            raise ErroFrete("A Loggi não respondeu. Tente de novo em instantes.")
        if r.status_code != 401:  # token vencido antes da hora: renova uma vez
            return r
    return r


# ───────── Cotação ─────────

ROTULOS = {"FREIGHT_TYPE_ECONOMIC": "Econômico", "FREIGHT_TYPE_EXPRESS": "Expresso"}


def _centavos(valor) -> int:
    """O preço da Loggi pode vir como número, texto ou dinheiro do Google ({units, nanos})."""
    if isinstance(valor, dict):
        return round((int(valor.get("units") or 0) + int(valor.get("nanos") or 0) / 1e9) * 100)
    return round(float(str(valor).replace(",", ".")) * 100)


def _linhas(endereco: dict) -> dict:
    return {"addressLine1": endereco["rua"] or endereco["cidade"], "postalCode": endereco["cep"],
            "city": endereco["cidade"], "state": endereco["uf"]}


def _cotar_loggi(destino: dict, caixa: dict) -> list[dict]:
    origem = endereco_do_cep(config.ORIGEM_CEP)
    corpo = {
        "shipFrom": {"lines": _linhas(origem)},
        "shipTo": {"lines": _linhas(destino)},
        "packages": [{
            "weightG": caixa["peso_g"], "lengthCm": caixa["comprimento_cm"], "widthCm": caixa["largura_cm"],
            "heightCm": caixa["altura_cm"],
            "goodsValue": {"currencyCode": "BRL", "units": caixa["valor_centavos"] // 100,
                           "nanos": (caixa["valor_centavos"] % 100) * 10_000_000},
        }],
        "externalServiceIds": config.LOGGI_SERVICOS,
    }
    r = _chamar("POST", "/quotations", corpo)
    if r.status_code == 429:
        raise ErroFrete("Muitas cotações agora. Tente de novo em um minuto.")
    if r.status_code >= 400:
        raise ErroFrete("A Loggi não conseguiu cotar este endereço.")
    dados = r.json().get("packagesQuotations") or []
    if isinstance(dados, dict):  # a documentação mostra lista e objeto
        dados = [dados]
    opcoes = []
    for cotacao in (dados[0].get("quotations") or []) if dados else []:
        tipo = cotacao.get("freightType") or "FREIGHT_TYPE_ECONOMIC"
        preco = cotacao.get("price") or {}
        opcoes.append({"tipo": tipo, "nome": cotacao.get("freightTypeLabel") or ROTULOS.get(tipo, tipo),
                       "centavos": _centavos(preco.get("totalAmount", 0)), "prazo_dias": int(cotacao.get("sloInDays") or 0),
                       "servico": cotacao.get("externalServiceId")})
    return opcoes


def _cotar_simulado(destino: dict, caixa: dict) -> list[dict]:
    """Uma conta local, para desenvolver sem a Loggi: distância pela região do CEP e peso."""
    distancia = abs(int(destino["cep"][0]) - int(config.ORIGEM_CEP[0]))
    quilos = math.ceil(caixa["peso_g"] / 1000)
    economico = 1490 + distancia * 350 + quilos * 200
    return [
        {"tipo": "FREIGHT_TYPE_ECONOMIC", "nome": "Econômico", "centavos": economico, "prazo_dias": 3 + distancia,
         "servico": "SIMULADO"},
        {"tipo": "FREIGHT_TYPE_EXPRESS", "nome": "Expresso", "centavos": round(economico * 1.6, -1),
         "prazo_dias": max(1, (3 + distancia) // 2), "servico": "SIMULADO"},
    ]


def cotar(cep: str, kits: int, valor_centavos: int) -> dict:
    """As opções de frete para o CEP e os kits. Devolve o endereço achado e as opções (mais barata primeiro)."""
    destino = endereco_do_cep(cep)
    caixa = pacote(kits, valor_centavos)
    opcoes = _cotar_simulado(destino, caixa) if config.LOGGI_AMBIENTE == "simulado" else _cotar_loggi(destino, caixa)
    if not opcoes:
        raise ErroFrete("A Loggi não entrega neste CEP.")
    return {"endereco": destino, "opcoes": sorted(opcoes, key=lambda o: o["centavos"])}
