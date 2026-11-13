"""O servidor da loja: a API (/api), o simulador de pagamento (/simulador, só em testes) e o site (web/dist).

Rodar: .venv\\Scripts\\python -m uvicorn servidor.app:app --reload --port 8000
"""

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

import base64

from servidor import acesso, banco, catalogo, config, configuracoes, ia, loggi, painel, pedidos, produtos, simulador

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("loja")

@asynccontextmanager
async def _vida(_: FastAPI):
    banco.iniciar()
    configuracoes.recarregar()  # o que foi salvo na aba Configurações (e no Vault) vale sobre o .env
    acesso.acesso_do_ambiente()  # LOJA_ADMIN_EMAIL e LOJA_ADMIN_SENHA no .env: cria o acesso ou acerta a senha
    acesso.preparar_primeiro_acesso()  # sem administrador: mostra no terminal o código do primeiro acesso
    for problema in config.conferir():
        log.warning("Configuração: %s", problema)
    log.info("Loja %s no ar. Loggi: %s. InfinitePay: %s.", config.LOJA_NOME, config.LOGGI_AMBIENTE, config.INFINITEPAY_AMBIENTE)
    yield


app = FastAPI(title=config.LOJA_NOME, docs_url=None, redoc_url=None, openapi_url=None, lifespan=_vida)


@app.exception_handler(pedidos.ErroPedido)
def _erro_pedido(_: Request, erro: pedidos.ErroPedido):
    return JSONResponse({"erro": erro.mensagem}, status_code=erro.status)


@app.exception_handler(acesso.ErroAcesso)
def _erro_acesso(_: Request, erro: acesso.ErroAcesso):
    return JSONResponse({"erro": erro.mensagem}, status_code=erro.status)


@app.exception_handler(ia.ErroIA)
def _erro_ia(_: Request, erro: ia.ErroIA):
    return JSONResponse({"erro": str(erro)}, status_code=422)


@app.exception_handler(painel.ErroPainel)
def _erro_painel(_: Request, erro: painel.ErroPainel):
    return JSONResponse({"erro": str(erro)}, status_code=422)


@app.exception_handler(produtos.ErroProduto)
def _erro_produto(_: Request, erro: produtos.ErroProduto):
    return JSONResponse({"erro": str(erro)}, status_code=422)


@app.exception_handler(configuracoes.ErroConfiguracao)
def _erro_configuracao(_: Request, erro: configuracoes.ErroConfiguracao):
    return JSONResponse({"erro": str(erro)}, status_code=422)


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
    return [{**o, "descricao": pedidos.descricao_oferta(o)} for o in catalogo.ofertas()]


@app.get("/api/loja")
def loja():
    p = catalogo.produto()
    return {"nome": config.LOJA_NOME, "whatsapp": config.LOJA_WHATSAPP,
            "testes": config.LOGGI_AMBIENTE == "simulado" or config.INFINITEPAY_AMBIENTE == "simulado",
            "produto": {k: p[k] for k in ("sku", "ean", "nome", "aparelhos", "refis", "laminas_por_refil")},
            "foto": catalogo.url_foto(), "ofertas": _ofertas(), "oferta_padrao": catalogo.oferta_padrao(),
            "desconto_pix": config.desconto_pix(), "montar": catalogo.montar(),
            "frete_gratis_a_partir": catalogo.frete_gratis_a_partir()}


@app.get("/produto/foto", include_in_schema=False)
def produto_foto():
    f = catalogo.foto()
    if not f:
        return RedirectResponse("/assets/img/kit-foto.jpg", status_code=302)
    return Response(f["dados"], media_type=f["tipo"], headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/produtos/{slug}/foto", include_in_schema=False)
def foto_de_produto(slug: str):
    f = produtos.foto(slug) if produtos.buscar(slug) else None
    if not f:
        return RedirectResponse(produtos.FOTO_PADRAO, status_code=302)
    return Response(f["dados"], media_type=f["tipo"], headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/api/produtos")
def vitrine():
    """A lista da página /produtos: o kit de lâminas e os produtos ativos."""
    return produtos.vitrine()


@app.get("/api/produtos/{slug}")
def ver_produto(slug: str):
    produto = produtos.buscar(slug, so_ativo=True)
    if not produto:
        raise HTTPException(404, "Produto não encontrado.")
    return produtos.publico(produto)


@app.get("/lp-config.js", include_in_schema=False)
def lp_config():
    """A configuração da landing page (web/public/loja.html), montada do servidor: preços, refis e foto valem só daqui."""
    p = catalogo.produto()
    dados = {
        "fotoKit": catalogo.url_foto(),
        "marca": config.LOJA_NOME,
        "produto": {"nome": p["nome"], "aparelhos": p["aparelhos"], "refis": p["refis"], "laminasPorRefil": p["laminas_por_refil"]},
        "pagamentoNaEntrega": False,
        "descontoPix": config.desconto_pix(),
        "whatsapp": {"numero": config.LOJA_WHATSAPP, "mensagem": "Olá! Tenho interesse no {kit} ({preco})."},
        "checkout": {"repassarParametros": True, "abrirEmNovaAba": False},
        "ofertas": [{"id": o["id"], "titulo": o["titulo"], "quantidade": o["kits"], "preco": o["preco_centavos"] / 100,
                     "precoDe": None, "selo": o["selo"],
                     "freteGratis": bool(o.get("frete_gratis")), "checkoutUrl": f"/checkout?oferta={o['id']}"} for o in catalogo.ofertas()],
        "ofertaPadrao": catalogo.oferta_padrao(),
        "produtos": [{"nome": p["nome"], "chamada": p["chamada"], "foto": p["foto"], "url": p["url"],
                      "aPartirDe": p["a_partir_de_centavos"] / 100} for p in produtos.vitrine() if p["id"] != produtos.KIT],
        "montar": {**catalogo.montar(), "precoKit": catalogo.montar()["preco_kit_centavos"] / 100},
        "freteGratisAPartir": catalogo.frete_gratis_a_partir(),
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
    return pedidos.cotar_frete(str(dados.get("cep") or ""), dados.get("oferta"), dados.get("produto"))


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


@app.get("/api/pedidos/{order_nsu}/rastreio")
def rastreio_pedido(order_nsu: str, request: Request):
    _limitar(request, "rastreio", 20)
    return pedidos.rastreio(_nsu(order_nsu))


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

def _token(request: Request) -> str:
    return request.headers.get("authorization", "").removeprefix("Bearer ").strip()


def _vendedor(request: Request) -> str:
    """Confere a sessão e devolve o e-mail de quem entrou."""
    _limitar(request, "vendedor", 120)
    email = acesso.sessao(_token(request))
    if not email:
        raise HTTPException(401, "Entre de novo na área do vendedor.")
    return email


@app.post("/api/vendedor/entrar")
async def vendedor_entrar(request: Request):
    _limitar(request, "entrar", 10)
    dados = await _json(request)
    if not acesso.existe_administrador():
        raise acesso.ErroAcesso("Ainda não há acesso. Crie o primeiro com o código que aparece no terminal.", 403)
    return acesso.entrar(str(dados.get("email") or ""), str(dados.get("senha") or ""))


@app.get("/api/vendedor/primeiro-acesso")
def vendedor_primeiro_acesso(request: Request):
    _limitar(request, "vendedor", 120)
    return {"disponivel": acesso.preparar_primeiro_acesso()}


@app.post("/api/vendedor/primeiro-acesso")
async def vendedor_criar_primeiro_acesso(request: Request):
    _limitar(request, "entrar", 10)
    dados = await _json(request)
    return acesso.criar_primeiro_acesso(str(dados.get("codigo") or ""), str(dados.get("email") or ""),
                                        str(dados.get("senha") or ""))


@app.post("/api/vendedor/sair")
def vendedor_sair(request: Request):
    acesso.sair(_token(request))
    return {"ok": True}


@app.get("/api/vendedor/eu")
def vendedor_eu(request: Request):
    return {"email": _vendedor(request)}


@app.post("/api/vendedor/senha")
async def vendedor_trocar_senha(request: Request):
    email = _vendedor(request)
    _limitar(request, "senha", 10)
    dados = await _json(request)
    acesso.trocar_senha(email, str(dados.get("atual") or ""), str(dados.get("nova") or ""))
    return {"ok": True}  # as sessões foram fechadas: a tela pede para entrar de novo


# Configurações: o que hoje fica no .env, editável aqui. Salvar pede a senha de novo (são as chaves de pagamento).

@app.get("/api/vendedor/configuracoes")
def vendedor_configuracoes(request: Request):
    _vendedor(request)
    return configuracoes.estado()


def _confirmar_senha(request: Request, email: str, dados: dict) -> None:
    _limitar(request, "confirmar", 10)
    acesso.conferir_credenciais(email, str(dados.get("senha") or ""))


@app.put("/api/vendedor/configuracoes")
async def vendedor_salvar_configuracoes(request: Request):
    email = _vendedor(request)
    dados = await _json(request)
    _confirmar_senha(request, email, dados)
    return configuracoes.salvar(dados.get("valores") or {}, dados.get("apagar_segredos") or [], email)


@app.post("/api/vendedor/configuracoes/importar")
async def vendedor_importar_configuracoes(request: Request):
    email = _vendedor(request)
    _confirmar_senha(request, email, await _json(request))
    return configuracoes.importar_do_ambiente(email)

@app.get("/api/vendedor/painel")
def vendedor_painel(request: Request, de: str | None = None, ate: str | None = None, visao: str = "vendas",
                    produto: str | None = None, quantidade: int | None = None):
    """A visão geral: indicadores do período e os recortes (produto → quantidade → afiliado)."""
    _vendedor(request)
    return painel.visao_geral(de, ate, visao, produto, quantidade)


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


# Envio pela Loggi: cria o pacote (de verdade, fora do modo simulado), baixa a etiqueta e cancela.

@app.post("/api/vendedor/pedidos/{order_nsu}/loggi/envio")
def vendedor_criar_envio(order_nsu: str, request: Request):
    _vendedor(request)
    return banco_para_tela(pedidos.criar_envio_loggi(_nsu(order_nsu)))


@app.get("/api/vendedor/pedidos/{order_nsu}/loggi/etiqueta")
def vendedor_etiqueta(order_nsu: str, request: Request):
    _vendedor(request)
    nsu = _nsu(order_nsu)
    pdf = pedidos.etiqueta_loggi(nsu)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="etiqueta-loggi-{nsu[:8]}.pdf"', "Cache-Control": "no-store"})


@app.post("/api/vendedor/pedidos/{order_nsu}/loggi/cancelar")
def vendedor_cancelar_envio(order_nsu: str, request: Request):
    _vendedor(request)
    return banco_para_tela(pedidos.cancelar_envio_loggi(_nsu(order_nsu)))


# Produto e preços: o que muda aqui vale na hora na landing page e no checkout.

@app.get("/api/vendedor/catalogo")
def vendedor_catalogo(request: Request):
    _vendedor(request)
    return catalogo.resumo()


@app.put("/api/vendedor/catalogo")
async def vendedor_salvar_catalogo(request: Request):
    _vendedor(request)
    try:
        return catalogo.salvar(await _json(request))
    except catalogo.ErroCatalogo as erro:
        raise pedidos.ErroPedido(str(erro))


@app.put("/api/vendedor/foto")
async def vendedor_foto(request: Request):
    _vendedor(request)
    dados = await request.body()
    try:
        catalogo.salvar_foto(request.headers.get("content-type", ""), dados)
    except catalogo.ErroCatalogo as erro:
        raise pedidos.ErroPedido(str(erro))
    return catalogo.resumo()


@app.delete("/api/vendedor/foto")
def vendedor_apagar_foto(request: Request):
    _vendedor(request)
    catalogo.apagar_foto()
    return catalogo.resumo()


# Produtos do catálogo (além do kit de lâminas, que fica em Produto e preços).

@app.get("/api/vendedor/produtos")
def vendedor_produtos(request: Request):
    _vendedor(request)
    return [produtos.para_vendedor(p) for p in produtos.listar(so_ativos=False)]


@app.post("/api/vendedor/produtos")
async def vendedor_criar_produto(request: Request):
    email = _vendedor(request)
    return produtos.para_vendedor(produtos.salvar(await _json(request), None, email))


@app.put("/api/vendedor/produtos/{slug}")
async def vendedor_salvar_produto(slug: str, request: Request):
    email = _vendedor(request)
    return produtos.para_vendedor(produtos.salvar(await _json(request), slug, email))


@app.put("/api/vendedor/produtos/{slug}/foto")
async def vendedor_foto_produto(slug: str, request: Request):
    _vendedor(request)
    produtos.salvar_foto(slug, request.headers.get("content-type", ""), await request.body())
    return produtos.para_vendedor(produtos.buscar(slug))


@app.delete("/api/vendedor/produtos/{slug}/foto")
def vendedor_apagar_foto_produto(slug: str, request: Request):
    _vendedor(request)
    if not produtos.buscar(slug):
        raise HTTPException(404, "Produto não encontrado.")
    produtos.apagar_foto(slug)
    return produtos.para_vendedor(produtos.buscar(slug))


# IA (Gemini) no cadastro de produtos: sugere textos e edita a foto. Nada é gravado sozinho.

@app.get("/api/vendedor/ia")
def vendedor_ia(request: Request):
    _vendedor(request)
    return {"disponivel": ia.disponivel(), "estilos": [{"id": k, "rotulo": v[0]} for k, v in ia.ESTILOS.items()]}


@app.post("/api/vendedor/ia/textos")
async def vendedor_ia_textos(request: Request):
    _vendedor(request)
    _limitar(request, "ia", 12)
    dados = await _json(request)
    foto = produtos.foto(str(dados.get("produto") or "")) if dados.get("produto") and dados.get("usar_foto", True) else None
    return ia.sugerir_textos(dados, foto["tipo"] if foto else None, foto["dados"] if foto else None)


@app.post("/api/vendedor/ia/foto")
async def vendedor_ia_foto(request: Request):
    _vendedor(request)
    _limitar(request, "ia", 12)
    dados = await _json(request)
    foto = produtos.foto(str(dados.get("produto") or ""))
    if not foto:
        raise ia.ErroIA("Envie uma foto do produto primeiro: a IA edita a foto que já está lá.")
    editada = ia.editar_foto(foto["tipo"], foto["dados"], str(dados.get("estilo") or ""), str(dados.get("instrucao") or ""))
    return {"tipo": editada["tipo"], "dados": base64.b64encode(editada["dados"]).decode()}


# Integrações: o que está ligado e o que falta (nunca mostra as chaves).

@app.get("/api/vendedor/integracoes")
def vendedor_integracoes(request: Request):
    _vendedor(request)
    tem = lambda valor: bool(valor)  # noqa: E731
    return {
        "loggi": {"ambiente": config.LOGGI_AMBIENTE, "client_id": tem(config.LOGGI_CLIENT_ID),
                  "client_secret": tem(config.LOGGI_CLIENT_SECRET), "company_id": tem(config.LOGGI_COMPANY_ID),
                  "servicos": len(config.LOGGI_SERVICOS), "origem_cep": config.ORIGEM_CEP,
                  "envio_automatico": config.LOGGI_ENVIO_AUTOMATICO},
        "infinitepay": {"ambiente": config.INFINITEPAY_AMBIENTE, "handle": tem(config.INFINITEPAY_HANDLE),
                        "api_key": tem(config.INFINITEPAY_API_KEY), "site_url": config.SITE_URL,
                        "webhook": config.SITE_URL.startswith("https://"),
                        "desconto_pix": config.INFINITEPAY_DESCONTO_PIX, "desconto_pix_vale": config.desconto_pix()},
        "problemas": config.conferir(),
    }


@app.post("/api/vendedor/integracoes/loggi/testar")
async def vendedor_testar_loggi(request: Request):
    """Uma cotação de verdade (ou simulada) para um CEP: confere credenciais, endereço de origem e serviço."""
    _vendedor(request)
    dados = await _json(request)
    oferta = catalogo.oferta(catalogo.oferta_padrao())
    inicio = time.monotonic()
    try:
        cotacao = loggi.cotar(str(dados.get("cep") or config.ORIGEM_CEP), oferta["kits"], oferta["preco_centavos"])
    except loggi.ErroFrete as erro:
        return {"ok": False, "detalhe": str(erro), "ambiente": config.LOGGI_AMBIENTE}
    return {"ok": True, "ambiente": config.LOGGI_AMBIENTE, "ms": int((time.monotonic() - inicio) * 1000),
            "opcoes": cotacao["opcoes"], "endereco": cotacao["endereco"]}


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
# "/" é a landing page (web/public/loja.html, com assets/ do modelo); /checkout, /obrigado, /vendedor, /produtos e /p/<slug>
# são o app React
# (web/dist/index.html, com app-assets/).

_SITE = config.RAIZ / "web" / "dist"
PAGINAS_DO_APP = ("checkout", "obrigado", "vendedor", "p", "produtos")


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
        # app-assets/ tem o hash no nome; o resto (a landing page) muda sem mudar de nome: o navegador confere sempre.
        cache = "public, max-age=31536000, immutable" if limpo.startswith("app-assets/") else "no-cache"
        return FileResponse(arquivo, headers={"Cache-Control": cache})
    raise HTTPException(404)
