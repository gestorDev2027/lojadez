"""Frete e envio pela Loggi: endereço pelo CEP (ViaCEP), token OAuth2, cotação, envio, etiqueta, cancelamento e rastreio.

No ambiente "simulado" tudo é uma conta local (para desenvolver sem as credenciais). Em staging/producao, chama a API da
Loggi (sempre em /v1/companies/{company_id}):
- POST /v2/oauth2/token (client_id e client_secret → idToken, vale 24 h);
- POST /quotations (cotação);
- POST /async-shipments (cria o pacote; a Loggi confirma depois, por isso a etiqueta pode demorar uns segundos);
- POST /labels (etiqueta em PDF, base64);
- POST /packages/cancel?loggi_key= (cancela);
- GET /packages/{tracking_code}/tracking (rastreio).
"""

import base64
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

def pacote(kits: int, valor_centavos: int, medidas: dict | None = None) -> dict:
    """Uma caixa com as unidades empilhadas (altura × quantidade) e 100 g de embalagem. Sem medidas: as do kit de lâminas."""
    if medidas is None:
        from servidor import catalogo  # aqui, para não importar em ciclo

        medidas = catalogo.medidas()  # o kit de lâminas, com as medidas da área do vendedor
    p = medidas
    return {"peso_g": p["peso_g"] * kits + 100, "comprimento_cm": p["comprimento_cm"], "largura_cm": p["largura_cm"],
            "altura_cm": min(p["altura_cm"] * kits, 100), "valor_centavos": valor_centavos}


# ───────── Token (OAuth2 client credentials) ─────────

_token: dict = {}
_trava_token = threading.Lock()


def esquecer_token() -> None:
    """As chaves mudaram (aba Configurações): o próximo pedido pega um token novo."""
    with _trava_token:
        _token.clear()


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


def _chamar(metodo: str, caminho: str, corpo: dict | None = None, params: dict | None = None) -> httpx.Response:
    url = f"{config.LOGGI_URL}/v1/companies/{config.LOGGI_COMPANY_ID}{caminho}"
    for tentativa in range(2):
        cabecalhos = {"Authorization": f"Bearer {_obter_token(renovar=tentativa > 0)}"}
        try:
            r = httpx.request(metodo, url, json=corpo, params=params, headers=cabecalhos, timeout=30)
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
        rotulo = (cotacao.get("freightTypeLabel") or ROTULOS.get(tipo, tipo)).removeprefix("Loggi ").strip()  # "Loggi Econômico"
        opcoes.append({"tipo": tipo, "nome": rotulo or ROTULOS.get(tipo, tipo),
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


def cotar(cep: str, kits: int, valor_centavos: int, medidas: dict | None = None) -> dict:
    """As opções de frete para o CEP e a quantidade. Devolve o endereço achado e as opções (mais barata primeiro)."""
    destino = endereco_do_cep(cep)
    caixa = pacote(kits, valor_centavos, medidas)
    opcoes = _cotar_simulado(destino, caixa) if config.LOGGI_AMBIENTE == "simulado" else _cotar_loggi(destino, caixa)
    if not opcoes:
        raise ErroFrete("A Loggi não entrega neste CEP.")
    return {"endereco": destino, "opcoes": sorted(opcoes, key=lambda o: o["centavos"])}


# ───────── Envio (criar o pacote na Loggi) ─────────

def _erro_da_loggi(r: httpx.Response, acao: str) -> ErroFrete:
    try:
        dados = r.json()
        detalhe = dados.get("message") or dados.get("detail") or ""
    except ValueError:
        detalhe = ""
    return ErroFrete(f"A Loggi recusou {acao} (erro {r.status_code}){': ' + str(detalhe)[:300] if detalhe else ''}.")


def _endereco_correios(rua: str, numero: str, complemento: str | None, bairro: str, cep: str, cidade: str, uf: str) -> dict:
    endereco = {"logradouro": rua[:128], "numero": (numero or "S/N")[:8], "bairro": bairro[:64], "cep": cep,
                "cidade": cidade[:32], "uf": uf}
    if complemento:
        endereco["complemento"] = complemento[:128]
    return endereco


def remetente() -> dict:
    r = config.REMETENTE
    if not r["nome"] or len(r["documento"]) not in (11, 14) or not r["numero"]:
        raise ErroFrete("Faltam os dados do remetente no .env: LOJA_REMETENTE_NOME, LOJA_REMETENTE_DOCUMENTO e "
                        "LOJA_ORIGEM_NUMERO.")
    origem = endereco_do_cep(config.ORIGEM_CEP)
    dados = {"name": r["nome"][:128], "federalTaxId": r["documento"], "address": {
        "instructions": r["instrucoes"][:300],
        "correiosAddress": _endereco_correios(r["rua"] or origem["rua"], r["numero"], r["complemento"] or None,
                                              r["bairro"] or origem["bairro"], origem["cep"], origem["cidade"], origem["uf"]),
    }}
    if r["telefone"]:
        dados["phoneNumber"] = r["telefone"][:16]
    return dados


def _do_produto(pedido: dict) -> tuple[dict | None, str]:
    """As medidas da caixa e o conteúdo declarado: do produto do catálogo, ou (sem produto_id) os do kit de lâminas."""
    if pedido.get("produto_id"):
        from servidor import produtos  # aqui, para não importar em ciclo

        produto = produtos.buscar(pedido["produto_id"])
        if produto:
            unidade = produto["unidade"] if pedido["kits"] == 1 else produto["unidade_plural"]
            return produtos.medidas(produto), f"{produto['nome']} ({pedido['kits']} {unidade})"
    return None, f"{config.CONTEUDO_DECLARADO} ({pedido['kits']} kit{'s' if pedido['kits'] > 1 else ''})"


def corpo_envio(pedido: dict) -> dict:
    medidas, conteudo = _do_produto(pedido)
    caixa = pacote(pedido["kits"], pedido["preco_centavos"], medidas)
    destinatario = {
        "name": pedido["nome"][:128], "federalTaxId": pedido["cpf"], "email": pedido["email"][:300],
        "phoneNumber": pedido["telefone"][:16],
        "address": {
            "instructions": (pedido.get("complemento") or "Entregar ao destinatário")[:300],
            "correiosAddress": _endereco_correios(pedido["rua"], pedido["numero"], pedido.get("complemento"),
                                                  pedido["bairro"], pedido["cep"], pedido["cidade"], pedido["uf"]),
        },
    }
    return {
        "externalServiceId": (config.LOGGI_SERVICOS or ["SIMULADO"])[0],
        "shipFrom": remetente() if config.LOGGI_AMBIENTE != "simulado" else {"name": "Loja (simulado)"},
        "shipTo": destinatario,
        "packages": [{
            "sequence": pedido["order_nsu"],
            "freightType": pedido["frete_tipo"] if pedido["frete_tipo"] in ROTULOS else "FREIGHT_TYPE_ECONOMIC",
            "weightG": caixa["peso_g"], "lengthCm": caixa["comprimento_cm"], "widthCm": caixa["largura_cm"],
            "heightCm": caixa["altura_cm"],
            "documentTypes": [{"contentDeclaration": {
                "totalValue": f"{pedido['preco_centavos'] / 100:.2f}",
                "description": conteudo[:200],
            }}],
        }],
    }


def criar_envio(pedido: dict) -> dict:
    """Cria o pacote na Loggi. Devolve {"loggi_key", "tracking_code"}."""
    corpo = corpo_envio(pedido)
    if config.LOGGI_AMBIENTE == "simulado":
        chave = "SIM" + pedido["order_nsu"].replace("-", "").upper()[:23]
        return {"loggi_key": chave, "tracking_code": chave[-8:]}
    r = _chamar("POST", "/async-shipments", corpo)
    if r.status_code >= 400:
        raise _erro_da_loggi(r, "o envio")
    pacotes = r.json().get("packages") or []
    if not pacotes or not pacotes[0].get("loggiKey"):
        raise ErroFrete("A Loggi aceitou o envio, mas não devolveu o código do pacote.")
    return {"loggi_key": pacotes[0]["loggiKey"], "tracking_code": pacotes[0].get("trackingCode") or ""}


# Um PDF mínimo, só para o modo simulado.
_PDF_SIMULADO = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj "
                 b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 298 420]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")


def etiqueta(loggi_key: str, layout: str = "LABEL_LAYOUT_A6") -> bytes:
    """A etiqueta Loggi em PDF. Logo depois de criar o envio, a Loggi ainda pode estar processando: tente de novo."""
    if config.LOGGI_AMBIENTE == "simulado":
        return _PDF_SIMULADO
    r = _chamar("POST", "/labels", {"loggiKeys": [loggi_key], "format": "LABEL_FORMAT_PDF", "layout": layout,
                                    "responseType": "LABEL_RESPONSE_TYPE_BASE_64", "labelType": "LABEL_TYPE_DEFAULT"})
    if r.status_code >= 400:
        raise _erro_da_loggi(r, "a etiqueta")
    dados = r.json()
    if dados.get("failure"):
        motivo = ((dados["failure"][0].get("status") or {}).get("message") or "").strip()
        raise ErroFrete("A etiqueta ainda não está pronta (a Loggi está confirmando o envio). Tente de novo em alguns "
                        f"segundos.{' Motivo: ' + motivo if motivo else ''}")
    conteudo = (dados.get("success") or {}).get("content")
    if not conteudo:
        raise ErroFrete("A Loggi não devolveu a etiqueta.")
    return base64.b64decode(conteudo)


def cancelar_envio(loggi_key: str) -> str | None:
    """Cancela o pacote. Devolve o aviso da Loggi, se houver (ex.: já em rota, cancelamento não garantido)."""
    if config.LOGGI_AMBIENTE == "simulado":
        return None
    r = _chamar("POST", "/packages/cancel", params={"loggi_key": loggi_key})
    if r.status_code >= 400:
        raise _erro_da_loggi(r, "o cancelamento")
    try:
        return r.json().get("warning_message") or None
    except ValueError:
        return None


def rastrear(tracking_code: str) -> dict:
    """A situação do pacote, só com o que pode ir para o cliente (sem nome, documento ou dados do motorista)."""
    if config.LOGGI_AMBIENTE == "simulado":
        return {"descricao": "Pedido recebido pela Loggi (simulado)", "situacao": "simulado", "atualizado_em": None,
                "previsao": None, "historico": []}
    r = _chamar("GET", f"/packages/{tracking_code}/tracking")
    if r.status_code == 404:
        return {"descricao": "A Loggi ainda não registrou movimentação.", "situacao": None, "atualizado_em": None,
                "previsao": None, "historico": []}
    if r.status_code >= 400:
        raise _erro_da_loggi(r, "o rastreio")
    pacotes = r.json().get("packages") or []
    if not pacotes:
        return {"descricao": "Sem informações ainda.", "situacao": None, "atualizado_em": None, "previsao": None, "historico": []}
    p = pacotes[0]
    estado = p.get("status") or {}

    def local(item):
        lugar = item.get("location") or {}
        return ", ".join(x for x in (lugar.get("city"), lugar.get("state")) if x) or None

    historico = [{"descricao": (h.get("status") or {}).get("description") or "",
                  "quando": (h.get("status") or {}).get("updatedTime"), "local": local(h)}
                 for h in (p.get("trackingHistory") or [])][-15:]
    return {"descricao": estado.get("description") or estado.get("highLevelStatus") or "",
            "situacao": estado.get("highLevelStatus"), "atualizado_em": estado.get("updatedTime"),
            "previsao": p.get("promisedDate"), "local": local(p), "historico": historico}
