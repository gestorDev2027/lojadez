"""O catálogo que o vendedor muda pela área do vendedor, sem mexer no .env nem republicar o site.

Os padrões vêm do .env (servidor/config.py); o que o vendedor grava fica na tabela `ajustes` e vale sobre eles:
- refis por kit e lâminas por refil;
- preço e selo de cada oferta (1, 2 e 3 kits) e se ela aparece;
- o "monte o seu kit" (de 4 kits até o máximo, pelo preço por kit da faixa "4 ou mais");
- a partir de quantos kits o frete é grátis (a loja paga a Loggi);
- a foto do kit (tabela `fotos`), usada na landing page e no checkout.
"""

import copy
import threading

from servidor import banco, config


class ErroCatalogo(Exception):
    pass


_cache: dict = {}
_trava = threading.Lock()

FOTO_KIT = "kit"
TIPOS_FOTO = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG", "image/webp": b"RIFF"}
FOTO_MAXIMA = 8 * 1024 * 1024


def _ajustes() -> dict:
    with _trava:
        if "ajustes" not in _cache:
            _cache["ajustes"] = banco.ler_ajustes()
        return _cache["ajustes"]


def limpar_cache() -> None:
    with _trava:
        _cache.clear()


TEXTOS_KIT = {"nome": 80, "chamada": 140, "descricao": 4000}
MEDIDAS_KIT = {"peso_g": ("Peso de 1 kit embalado (g)", 1, 30000), "comprimento_cm": ("Comprimento (cm)", 1, 100),
               "largura_cm": ("Largura (cm)", 1, 100), "altura_cm": ("Altura (cm)", 1, 100)}


def produto() -> dict:
    """O kit de lâminas: os padrões (config) com o que o vendedor mudou (nome, textos, refis, medidas)."""
    p = copy.deepcopy(config.PRODUTO)
    p.update(chamada="", descricao="")
    a = _ajustes()
    for chave in ("refis", "laminas_por_refil", *MEDIDAS_KIT):
        if chave in a:
            p[chave] = int(a[chave])
    for chave in TEXTOS_KIT:
        if a.get(chave):
            p[chave] = str(a[chave])
    return p


CATEGORIAS_PADRAO = ["Barbear", "Cabelo", "Barba", "Kits"]


def categorias() -> list[str]:
    return list(_ajustes().get("categorias") or CATEGORIAS_PADRAO)


def vitrine_kit() -> dict:
    """Destaque, categoria e selo do kit de lâminas na vitrine."""
    a = _ajustes()
    return {"destaque": bool(a.get("destaque", True)), "categoria": a.get("categoria") or "Barbear", "selo": a.get("selo") or ""}


def medidas() -> dict:
    p = produto()
    return {k: int(p[k]) for k in MEDIDAS_KIT}


def ofertas(so_ativas: bool = True) -> list[dict]:
    a = _ajustes().get("ofertas") or {}
    saida = []
    for padrao in config.OFERTAS:
        o = {**padrao, "ativa": True, **{k: v for k, v in (a.get(padrao["id"]) or {}).items() if k in ("preco_centavos", "selo", "ativa")}}
        o["frete_gratis"] = frete_gratis(o["kits"])
        if o["ativa"] or not so_ativas:
            saida.append(o)
    return saida


def frete_gratis_a_partir() -> int:
    """A partir de quantos kits o frete é grátis (0: nunca)."""
    return int(_ajustes().get("frete_gratis_a_partir", config.FRETE_GRATIS_A_PARTIR))


def frete_gratis(kits: int) -> bool:
    limite = frete_gratis_a_partir()
    return bool(limite) and kits >= limite


def montar() -> dict:
    """O "monte o seu kit": {ativo, minimo, maximo, preco_kit_centavos}."""
    m = {**config.MONTAR_PADRAO, **(_ajustes().get("montar") or {})}
    return {"ativo": bool(m["ativo"]), "minimo": config.MONTAR_MINIMO, "maximo": int(m["maximo"]),
            "preco_kit_centavos": int(m["preco_kit_centavos"])}


def oferta_montada(kits: int) -> dict | None:
    """A oferta de N kits do "monte o seu" (id "kitN"), ou None se não vale."""
    m = montar()
    if not m["ativo"] or not m["minimo"] <= kits <= m["maximo"]:
        return None
    return {"id": f"kit{kits}", "titulo": f"{kits} Kits", "kits": kits, "preco_centavos": kits * m["preco_kit_centavos"],
            "selo": "", "ativa": True, "montada": True, "frete_gratis": frete_gratis(kits)}


def oferta(oferta_id: str) -> dict | None:
    fixa = next((o for o in ofertas() if o["id"] == oferta_id), None)
    if fixa:
        return fixa
    if oferta_id.startswith("kit") and oferta_id[3:].isdigit() and len(oferta_id) <= 5:
        return oferta_montada(int(oferta_id[3:]))
    return None


def oferta_padrao() -> str:
    ativas = [o["id"] for o in ofertas()]
    return config.OFERTA_PADRAO if config.OFERTA_PADRAO in ativas else (ativas[0] if ativas else "")


def _inteiro(valor, nome: str, minimo: int, maximo: int) -> int:
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        raise ErroCatalogo(f"{nome}: use um número inteiro.")
    if not minimo <= numero <= maximo:
        raise ErroCatalogo(f"{nome}: de {minimo} a {maximo}.")
    return numero


def salvar(dados: dict) -> dict:
    """Confere e grava refis, lâminas e ofertas. Devolve o catálogo novo."""
    novos: dict = {}
    if "refis" in dados:
        novos["refis"] = _inteiro(dados["refis"], "Refis por kit", 1, 200)
    if "laminas_por_refil" in dados:
        novos["laminas_por_refil"] = _inteiro(dados["laminas_por_refil"], "Lâminas por refil", 1, 10)
    for chave, maximo in TEXTOS_KIT.items():
        if chave in dados:
            valor = str(dados[chave] or "").strip() if chave == "descricao" else " ".join(str(dados[chave] or "").split())
            if chave == "nome" and 0 < len(valor) < 3:  # vazio: volta ao nome padrão
                raise ErroCatalogo("Nome do kit: pelo menos 3 letras.")
            if len(valor) > maximo:
                raise ErroCatalogo(f"{chave.capitalize()} do kit: até {maximo} caracteres.")
            novos[chave] = valor or None
    for chave, (rotulo, minimo, maximo) in MEDIDAS_KIT.items():
        if chave in dados:
            novos[chave] = _inteiro(dados[chave], rotulo, minimo, maximo)
    if "destaque" in dados:
        novos["destaque"] = bool(dados["destaque"])
    if "categoria" in dados:
        novos["categoria"] = str(dados["categoria"] or "")[:40] or None
    if "selo" in dados:
        novos["selo"] = " ".join(str(dados["selo"] or "").split())[:40] or None
    if "categorias" in dados:
        lista = []
        for nome in dados["categorias"] or []:
            nome = " ".join(str(nome or "").split())[:40]
            if nome and nome.lower() not in [x.lower() for x in lista]:
                lista.append(nome)
        if not lista:
            raise ErroCatalogo("Deixe pelo menos uma categoria.")
        if len(lista) > 12:
            raise ErroCatalogo("Até 12 categorias.")
        novos["categorias"] = lista
    if "ofertas" in dados:
        ids = {o["id"] for o in config.OFERTAS}
        ofertas_novas = {}
        for oid, valores in (dados["ofertas"] or {}).items():
            if oid not in ids or not isinstance(valores, dict):
                raise ErroCatalogo(f"Oferta desconhecida: {oid}.")
            ofertas_novas[oid] = {
                "preco_centavos": _inteiro(valores.get("preco_centavos"), f"Preço de {oid}", 100, 10_000_000),
                "selo": " ".join(str(valores.get("selo") or "").split())[:40],
                "ativa": bool(valores.get("ativa", True)),
            }
        if not any(v["ativa"] for v in ofertas_novas.values()):
            raise ErroCatalogo("Deixe pelo menos uma oferta ativa.")
        novos["ofertas"] = ofertas_novas
    if "frete_gratis_a_partir" in dados:
        novos["frete_gratis_a_partir"] = _inteiro(dados["frete_gratis_a_partir"], "Frete grátis a partir de", 0, 100)
    if "montar" in dados:
        m = dados["montar"] if isinstance(dados["montar"], dict) else {}
        novos["montar"] = {
            "ativo": bool(m.get("ativo", True)),
            "maximo": _inteiro(m.get("maximo"), "Máximo de kits", config.MONTAR_MINIMO, 30),
            "preco_kit_centavos": _inteiro(m.get("preco_kit_centavos"), "Preço por kit (4 ou mais)", 100, 1_000_000),
        }
    banco.gravar_ajustes(novos)
    limpar_cache()
    return resumo()


def salvar_foto(tipo: str, dados: bytes) -> None:
    tipo = (tipo or "").split(";")[0].strip().lower()
    if tipo not in TIPOS_FOTO or not dados.startswith(TIPOS_FOTO[tipo]):
        raise ErroCatalogo("Envie uma foto JPG, PNG ou WebP.")
    if len(dados) > FOTO_MAXIMA:
        raise ErroCatalogo("A foto tem até 8 MB.")
    banco.gravar_foto(FOTO_KIT, tipo, dados)
    limpar_cache()


def apagar_foto() -> None:
    banco.gravar_foto(FOTO_KIT, None, None)
    limpar_cache()


def foto() -> dict | None:
    """{"tipo", "dados", "versao"} da foto enviada, ou None (usa a padrão)."""
    with _trava:
        if "foto" not in _cache:
            _cache["foto"] = banco.ler_foto(FOTO_KIT) or {}
        f = _cache["foto"]
    if not f:
        return None
    return {"tipo": f["tipo"], "dados": f["dados"], "versao": int(f["atualizado_em"].timestamp())}


def url_foto() -> str:
    """O endereço da foto do kit, com versão (o navegador busca a nova quando ela muda)."""
    f = foto()
    return f"/produto/foto?v={f['versao']}" if f else "/assets/img/kit-foto.jpg"


def resumo() -> dict:
    return {"produto": produto(), "ofertas": ofertas(so_ativas=False), "foto": url_foto(), "foto_enviada": foto() is not None,
            "montar": montar(), "frete_gratis_a_partir": frete_gratis_a_partir(), "vitrine": vitrine_kit(),
            "categorias": categorias()}
