"""O servidor da loja: a API (/api), o simulador de pagamento (/simulador, só em testes) e o site (web/dist).

Rodar: .venv\\Scripts\\python -m uvicorn servidor.app:app --reload --port 8000
"""

import hmac
import json
import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response

from servidor import banco, config, loggi, pedidos, simulador

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("loja")

@asynccontextmanager
async def _vida(_: FastAPI):
    banco.iniciar()
    for problema in config.conferir():
        log.warning("Configuração: %s", problema)
    log.info("Loja %s no ar. Loggi: %s. InfinitePay: %s.", config.LOJA_NOME, config.LOGGI_AMBIENTE, config.INFINITEPAY_AMBIENTE)
    yield


app = FastAPI(title=config.LOJA_NOME, docs_url=None, redoc_url=None, openapi_url=None, lifespan=_vida)


@app.exception_handler(pedidos.ErroPedido)
def _erro_pedido(_: Request, erro: pedidos.ErroPedido):
    return JSONResponse({"erro": erro.mensagem}, status_code=erro.status)


# ───────── Limite de chamadas por IP (cada cotação chama a Loggi e o ViaCEP) ─────────

_chamadas: dict[str, deque] = defaultdict(deque)
_trava = threading.Lock()


def _limitar(request: Request, grupo: str, por_minuto: int) -> None:
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    chave, agora = f"{grupo}:{ip}", time.monotonic()
    with _trava:
        fila = _chamadas[chave]
        while fila and agora - fila[0] > 60:
            fila.popleft()
        if len(fila) >= por_minuto:
            raise HTTPException(429, "Muitas tentativas. Espere um minuto.")
        fila.append(agora)


def _nsu(order_nsu: str) -> str:
    try:
        return str(uuid.UUID(order_nsu))
    except ValueError:
        raise HTTPException(404, "Pedido não encontrado.")


async def _json(request: Request) -> dict:
    try:
        dados = await request.json()
    except ValueError:
        raise HTTPException(400, "Corpo inválido.")
    if not isinstance(dados, dict):
        raise HTTPException(400, "Corpo inválido.")
    return dados


# ───────── A loja ─────────

def _ofertas() -> list[dict]:
    return [{**o, "descricao": pedidos.descricao_oferta(o)} for o in config.OFERTAS]


@app.get("/api/loja")
def loja():
    p = config.PRODUTO
    return {"nome": config.LOJA_NOME, "whatsapp": config.LOJA_WHATSAPP,
            "testes": config.LOGGI_AMBIENTE == "simulado" or config.INFINITEPAY_AMBIENTE == "simulado",
            "produto": {k: p[k] for k in ("sku", "ean", "nome", "aparelhos", "refis", "laminas_por_refil")},
            "ofertas": _ofertas(), "oferta_padrao": config.OFERTA_PADRAO}


@app.get("/lp-config.js", include_in_schema=False)
def lp_config():
    """A configuração da landing page (web/lp), montada do servidor: os preços valem só daqui."""
    p = config.PRODUTO
    dados = {
        "marca": config.LOJA_NOME,
        "produto": {"nome": p["nome"], "aparelhos": p["aparelhos"], "refis": p["refis"], "laminasPorRefil": p["laminas_por_refil"]},
        "pagamentoNaEntrega": False,
        "whatsapp": {"numero": config.LOJA_WHATSAPP, "mensagem": "Olá! Tenho interesse no {kit} ({preco})."},
        "checkout": {"repassarParametros": True, "abrirEmNovaAba": False},
        "ofertas": [{"id": o["id"], "titulo": o["titulo"], "quantidade": o["kits"], "preco": o["preco_centavos"] / 100,
                     "precoDe": None, "selo": o["selo"], "checkoutUrl": f"/checkout?oferta={o['id']}"} for o in config.OFERTAS],
        "ofertaPadrao": config.OFERTA_PADRAO,
        "calculadora": {"barbeadasPorSemana": 5, "usosPorRefil": 5},
        "contagem": {"ativo": bool(config.LOJA_PROMO_ATE), "terminaEm": config.LOJA_PROMO_ATE,
                     "titulo": "Preço promocional válido por"},
        "depoimentos": [],  # só depoimentos reais
        "empresa": config.EMPRESA,
        "rastreamento": config.RASTREAMENTO,
    }
    texto = "window.LP_CONFIG = " + json.dumps(dados, ensure_ascii=False).replace("</", "<\\/") + ";\n"
    return Response(texto, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/api/cep/{cep}")
def cep(cep: str, request: Request):
    _limitar(request, "cep", 30)
    try:
        return loggi.endereco_do_cep(cep)
    except loggi.ErroFrete as erro:
        raise pedidos.ErroPedido(str(erro))


@app.post("/api/frete")
async def frete(request: Request):
    _limitar(request, "frete", 20)
    dados = await _json(request)
    return pedidos.cotar_frete(str(dados.get("cep") or ""), dados.get("oferta"))


@app.post("/api/pedidos")
async def criar_pedido(request: Request):
    _limitar(request, "pedido", 6)
    return pedidos.criar(await _json(request))


@app.get("/api/pedidos/{order_nsu}")
def ver_pedido(order_nsu: str):
    pedido = banco.buscar(_nsu(order_nsu))
    if not pedido:
        raise HTTPException(404, "Pedido não encontrado.")
    return pedidos.publico(pedido)


@app.post("/api/pedidos/{order_nsu}/conferir")
async def conferir_pedido(order_nsu: str, request: Request):
    _limitar(request, "conferir", 20)
    dados = await _json(request)
    pedido = pedidos.conferir(_nsu(order_nsu), str(dados.get("transaction_nsu") or ""), str(dados.get("slug") or ""),
                              dados.get("receipt_url"))
    return pedidos.publico(pedido)


@app.post("/api/webhooks/infinitepay")
async def webhook_infinitepay(request: Request):
    """Responde rápido: 200 quando terminou (ou o aviso não é nosso); 400 para a InfinitePay tentar de novo."""
    try:
        pedidos.processar_webhook(await _json(request))
    except pedidos.ErroPedido as erro:
        if erro.status >= 500:  # a conferência falhou: pede para reenviar
            return JSONResponse({"ok": False}, status_code=400)
        log.info("Webhook ignorado: %s", erro.mensagem)
    except HTTPException:
        return JSONResponse({"ok": False}, status_code=400)
    return {"ok": True}


# ───────── Área do vendedor ─────────

def _vendedor(request: Request) -> None:
    if not config.VENDEDOR_SENHA:
        raise HTTPException(403, "Área do vendedor desligada: defina VENDEDOR_SENHA.")
    _limitar(request, "vendedor", 60)
    enviada = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(enviada.encode(), config.VENDEDOR_SENHA.encode()):
        raise HTTPException(401, "Senha errada.")


@app.get("/api/vendedor/pedidos")
def vendedor_pedidos(request: Request, situacao: str | None = None):
    _vendedor(request)
    return [banco_para_tela(p) for p in banco.listar(situacao or None)]


def _data(valor):
    if not isinstance(valor, datetime):
        return valor
    return (valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)).isoformat()  # o SQLite perde o fuso: é UTC


def banco_para_tela(p: dict) -> dict:
    return {k: _data(v) for k, v in p.items() if k != "id"}


@app.post("/api/vendedor/pedidos/{order_nsu}/enviado")
async def vendedor_enviado(order_nsu: str, request: Request):
    _vendedor(request)
    dados = await _json(request)
    return banco_para_tela(pedidos.marcar_enviado(_nsu(order_nsu), str(dados.get("codigo_rastreio") or "")))


@app.post("/api/vendedor/pedidos/{order_nsu}/cancelar")
def vendedor_cancelar(order_nsu: str, request: Request):
    _vendedor(request)
    return banco_para_tela(pedidos.cancelar(_nsu(order_nsu)))


# ───────── Simulador da InfinitePay (só em testes) ─────────

def _simulador_ligado() -> None:
    if config.INFINITEPAY_AMBIENTE != "simulado":
        raise HTTPException(404)


@app.get("/simulador/pagamento/{order_nsu}", response_class=HTMLResponse)
def simulador_pagina(order_nsu: str):
    _simulador_ligado()
    return simulador.pagina(_nsu(order_nsu))


@app.post("/simulador/pagar/{order_nsu}")
async def simulador_pagar(order_nsu: str, request: Request):
    _simulador_ligado()
    order_nsu = _nsu(order_nsu)
    forma = (parse_qs((await request.body()).decode()).get("forma") or ["pix"])[0]
    pedido = banco.buscar(order_nsu)
    if not pedido or pedido["situacao"] != "aguardando_pagamento":
        return RedirectResponse(f"/simulador/pagamento/{order_nsu}", status_code=303)
    pagamento = simulador.pagar(order_nsu, forma)
    pedidos.processar_webhook(simulador.aviso_webhook(pagamento))  # o que o webhook faria
    return RedirectResponse(simulador.url_de_volta(pagamento), status_code=303)


@app.get("/simulador/comprovante/{order_nsu}", response_class=HTMLResponse)
def simulador_comprovante(order_nsu: str):
    _simulador_ligado()
    pedido = banco.buscar(_nsu(order_nsu))
    if not pedido or not pedido.get("pago_em"):
        raise HTTPException(404)
    return (f"<!doctype html><meta charset='utf-8'><title>Comprovante simulado</title>"
            f"<body style='font-family:system-ui;padding:24px'><h1>Comprovante (simulado)</h1>"
            f"<p>Pedido {pedido['order_nsu']}</p><p>Valor: {pedido['total_centavos'] / 100:.2f}</p>"
            f"<p>Forma: {pedido['forma_pagamento']}</p><a href='/'>Voltar à loja</a></body>")


# ───────── O site (web/dist, depois do npm run build) ─────────
# "/" é a landing page (web/public/loja.html, com assets/ do modelo); /checkout, /obrigado e /vendedor são o app React
# (web/dist/index.html, com app-assets/).

_SITE = config.RAIZ / "web" / "dist"
PAGINAS_DO_APP = ("checkout", "obrigado", "vendedor")


@app.get("/{caminho:path}", include_in_schema=False)
def site(caminho: str):
    if caminho.startswith(("api/", "simulador/")):
        raise HTTPException(404)
    if not (_SITE / "index.html").is_file():
        return HTMLResponse("<p>O site ainda não foi construído: rode <code>npm run build</code> na pasta web.</p>")
    limpo = caminho.strip("/")
    if not limpo:
        return FileResponse(_SITE / "loja.html")
    if limpo.split("/")[0] in PAGINAS_DO_APP:
        return FileResponse(_SITE / "index.html")
    arquivo = (_SITE / limpo).resolve()
    if arquivo.is_file() and _SITE.resolve() in arquivo.parents:
        cache = "public, max-age=31536000, immutable" if limpo.startswith("app-assets/") else "public, max-age=3600"
        return FileResponse(arquivo, headers={"Cache-Control": cache})
    raise HTTPException(404)
