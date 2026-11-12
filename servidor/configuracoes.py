"""A aba Configurações: ler, conferir e gravar o que hoje fica no .env.

Os valores comuns vão para a tabela `configuracoes`; os segredos (tipo "segredo") vão para o Vault (servidor/cofre.py).
Depois de gravar, `recarregar()` aplica tudo na hora (config.aplicar), sem reiniciar.
Toda mudança fica na `auditoria`, só com os nomes dos campos (nunca os valores).
"""

import logging
import re
from datetime import datetime

from sqlalchemy import delete, insert, select

from servidor import banco, catalogo, cofre, config

log = logging.getLogger("loja.configuracoes")

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)


class ErroConfiguracao(Exception):
    pass


def _ler_tabela() -> dict[str, str]:
    with banco.engine.connect() as c:
        return {l.chave: l.valor for l in c.execute(select(banco.configuracoes.c.chave, banco.configuracoes.c.valor))}


def ler() -> dict[str, str]:
    """O que foi salvo pela tela: os valores comuns e os segredos."""
    valores = {k: v for k, v in _ler_tabela().items() if k in config.POR_CHAVE}
    try:
        valores.update({k: v for k, v in cofre.ler_todos().items() if k in config.POR_CHAVE})
    except Exception:  # noqa: BLE001 - sem o Vault a loja ainda sobe com o .env
        log.exception("Não deu para ler os segredos do Vault.")
    return valores


def recarregar() -> None:
    config.aplicar(ler())
    from servidor import loggi  # evita import circular

    loggi.esquecer_token()
    catalogo.limpar_cache()


def _conferir(campo: config.Campo, bruto) -> str:
    valor = " ".join(str(bruto if bruto is not None else "").split()) if campo.tipo != "segredo" else str(bruto or "").strip()
    nome = campo.rotulo
    if campo.tipo == "segredo":
        if len(valor) > 1000:
            raise ErroConfiguracao(f"{nome}: grande demais.")
        return valor
    if len(valor) > 300:
        raise ErroConfiguracao(f"{nome}: até 300 caracteres.")
    if not valor:
        if campo.tipo in ("escolha", "sim_nao", "inteiro", "decimal", "dimensoes", "url") or campo.chave == "LOJA_ORIGEM_CEP":
            raise ErroConfiguracao(f"Preencha {nome}.")
        return ""
    if campo.tipo == "escolha" and valor.lower() not in campo.opcoes:
        raise ErroConfiguracao(f"{nome}: use {', '.join(campo.opcoes)}.")
    if campo.tipo == "sim_nao":
        if valor.lower() not in ("sim", "nao"):
            raise ErroConfiguracao(f"{nome}: sim ou nao.")
        return valor.lower()
    if campo.tipo == "escolha":
        return valor.lower()
    if campo.tipo == "digitos":
        digitos = re.sub(r"\D", "", valor)
        if len(digitos) not in campo.tamanhos:
            tamanhos = sorted(campo.tamanhos)
            texto = " ou ".join(map(str, tamanhos)) if len(tamanhos) <= 3 else f"{tamanhos[0]} a {tamanhos[-1]}"
            raise ErroConfiguracao(f"{nome}: {texto} números.")
        return digitos
    if campo.tipo in ("inteiro", "decimal"):
        try:
            numero = float(valor.replace(",", ".")) if campo.tipo == "decimal" else int(valor)
        except ValueError:
            raise ErroConfiguracao(f"{nome}: use um número{' inteiro' if campo.tipo == 'inteiro' else ''}.")
        if (campo.minimo is not None and numero < campo.minimo) or (campo.maximo is not None and numero > campo.maximo):
            raise ErroConfiguracao(f"{nome}: de {campo.minimo:g} a {campo.maximo:g}.")
        return f"{numero:g}" if campo.tipo == "decimal" else str(numero)
    if campo.tipo == "dimensoes":
        partes = valor.lower().replace(" ", "").split("x")
        if len(partes) != 3 or not all(p.isdigit() and 1 <= int(p) <= 200 for p in partes):
            raise ErroConfiguracao(f"{nome}: comprimento x largura x altura em cm, ex.: 25x15x2.")
        return "x".join(str(int(p)) for p in partes)
    if campo.tipo == "url":
        if not re.match(r"^https?://[a-z0-9.-]+(:\d+)?(/[^\s]*)?$", valor, re.I):
            raise ErroConfiguracao(f"{nome}: comece com https:// (ex.: https://sualoja.com.br).")
        return valor.rstrip("/")
    if campo.tipo == "email":
        if not EMAIL.match(valor):
            raise ErroConfiguracao(f"{nome}: e-mail inválido.")
        return valor.lower()
    if campo.tipo == "data":
        try:
            datetime.fromisoformat(valor)
        except ValueError:
            raise ErroConfiguracao(f"{nome}: use o formato 2026-11-30T23:59:59-03:00.")
        return valor
    if campo.chave == "INFINITEPAY_HANDLE":
        valor = valor.lstrip("$")
        if not re.match(r"^[a-z0-9._-]{2,60}$", valor, re.I):
            raise ErroConfiguracao(f"{nome}: só letras, números, ponto, hífen e sublinhado (sem o $).")
    return valor


def salvar(valores: dict, apagar_segredos: list | None, email: str) -> dict:
    """Confere tudo antes de gravar qualquer coisa. Segredo vazio = não muda; para tirar, use `apagar_segredos`."""
    if not isinstance(valores, dict):
        raise ErroConfiguracao("Nada para salvar.")
    comuns, segredos = {}, {}
    for chave, bruto in valores.items():
        campo = config.POR_CHAVE.get(chave)
        if not campo:
            raise ErroConfiguracao(f"Campo desconhecido: {chave}.")
        valor = _conferir(campo, bruto)
        if campo.tipo == "segredo":
            if valor:
                segredos[chave] = valor
        else:
            comuns[chave] = valor
    apagar = [c for c in (apagar_segredos or []) if c in config.POR_CHAVE and config.POR_CHAVE[c].tipo == "segredo"]
    if (segredos or apagar) and cofre.tipo() == "indisponivel":
        raise ErroConfiguracao("Este banco não tem o Vault do Supabase: as chaves ficam no .env.")

    with banco.engine.begin() as c:
        for chave, valor in comuns.items():
            c.execute(delete(banco.configuracoes).where(banco.configuracoes.c.chave == chave))
            c.execute(insert(banco.configuracoes).values(chave=chave, valor=valor, atualizado_em=banco.agora(),
                                                         atualizado_por=email))
    for chave, valor in segredos.items():
        cofre.gravar(chave, valor)
    for chave in apagar:
        cofre.apagar(chave)

    mudou = sorted(set(comuns) | set(segredos) | set(apagar))
    if mudou:
        banco.registrar(email, "configuracao", "Mudou: " + ", ".join(mudou))
    recarregar()
    return estado()


def importar_do_ambiente(email: str) -> dict:
    """Leva para o banco (e os segredos para o Vault) o que está no .env e ainda não foi salvo pela tela."""
    salvos = ler()
    valores = {}
    for campo in config.CAMPOS:
        do_env = config.do_ambiente(campo.chave)
        if do_env and campo.chave not in salvos:
            valores[campo.chave] = do_env
    if not valores:
        return estado()
    try:
        return salvar(valores, None, email)
    except ErroConfiguracao as erro:
        raise ErroConfiguracao(f"Não importei nada: {erro}")


def estado() -> dict:
    """Para a tela: cada campo com o valor que vale e de onde ele vem. Segredos: só se estão configurados."""
    salvos = ler()
    modo_cofre = cofre.tipo()
    campos = []
    for campo in config.CAMPOS:
        if campo.chave in salvos:
            origem = "vault" if campo.tipo == "segredo" and modo_cofre == "vault" else "banco"
            valor = salvos[campo.chave]
        elif config.do_ambiente(campo.chave):
            origem, valor = "env", config.do_ambiente(campo.chave)
        else:
            origem, valor = "padrao", campo.padrao
        item = {"chave": campo.chave, "rotulo": campo.rotulo, "grupo": campo.grupo, "tipo": campo.tipo,
                "ajuda": campo.ajuda, "opcoes": list(campo.opcoes), "origem": origem}
        if campo.tipo == "segredo":
            item["configurado"] = bool(valor)
        else:
            item["valor"] = valor or ""
        campos.append(item)
    return {
        "grupos": config.GRUPOS,
        "campos": campos,
        "cofre": modo_cofre,
        "no_env": [c.chave for c in config.CAMPOS if config.do_ambiente(c.chave) and c.chave not in salvos],
        "mudancas": [{"quando": m["quando"].isoformat() if m["quando"] else None, "email": m["email"],
                      "acao": m["acao"], "detalhe": m["detalhe"]} for m in banco.ultimas_mudancas()],
    }
