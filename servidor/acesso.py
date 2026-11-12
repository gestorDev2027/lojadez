"""Quem entra na área do vendedor: e-mail e senha, com sessão.

- A senha fica só como hash scrypt (sal próprio), nunca em texto. Conferência em tempo constante.
- Entrou: um token aleatório (vale ACESSO_HORAS). No banco fica só o hash dele.
- Cinco senhas erradas para o mesmo e-mail em 15 minutos bloqueiam esse e-mail por 15 minutos.
- O primeiro administrador é criado pelo comando `python -m servidor.admin` (a senha não passa pela tela nem pelo chat).
"""

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import timedelta

from sqlalchemy import delete, insert, select, update

from servidor import banco

ACESSO_HORAS = 12
SENHA_MINIMA = 10
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)
_N, _R, _P = 2**14, 8, 1

_erros: dict[str, list[float]] = {}
_trava = threading.Lock()


class ErroAcesso(Exception):
    def __init__(self, mensagem: str, status: int = 401):
        super().__init__(mensagem)
        self.mensagem, self.status = mensagem, status


def _b64(dados: bytes) -> str:
    return base64.b64encode(dados).decode()


def gerar_hash(senha: str) -> str:
    sal = secrets.token_bytes(16)
    chave = hashlib.scrypt(senha.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(sal)}${_b64(chave)}"


def senha_confere(senha: str, guardado: str) -> bool:
    try:
        _, n, r, p, sal, chave = guardado.split("$")
        calculada = hashlib.scrypt(senha.encode(), salt=base64.b64decode(sal), n=int(n), r=int(r), p=int(p),
                                   dklen=len(base64.b64decode(chave)))
        return hmac.compare_digest(calculada, base64.b64decode(chave))
    except (ValueError, TypeError):
        return False


_HASH_FALSO = gerar_hash(secrets.token_urlsafe(16))  # e-mail que não existe gasta o mesmo tempo


def _email(email: str) -> str:
    email = (email or "").strip().lower()
    if not EMAIL.match(email):
        raise ErroAcesso("E-mail inválido.", 422)
    return email


def conferir_senha_nova(senha: str) -> None:
    if len(senha or "") < SENHA_MINIMA:
        raise ErroAcesso(f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres.", 422)
    if len(senha) > 200:
        raise ErroAcesso("Senha grande demais.", 422)


def existe_administrador() -> bool:
    with banco.engine.connect() as c:
        return c.execute(select(banco.administradores.c.email).limit(1)).first() is not None


def definir_administrador(email: str, senha: str) -> str:
    """Cria o administrador ou troca a senha dele (e fecha as sessões abertas)."""
    email = _email(email)
    conferir_senha_nova(senha)
    agora = banco.agora()
    with banco.engine.begin() as c:
        existe = c.execute(select(banco.administradores.c.email).where(banco.administradores.c.email == email)).first()
        if existe:
            c.execute(update(banco.administradores).where(banco.administradores.c.email == email)
                      .values(senha_hash=gerar_hash(senha), atualizado_em=agora))
        else:
            c.execute(insert(banco.administradores).values(email=email, senha_hash=gerar_hash(senha), criado_em=agora,
                                                           atualizado_em=agora))
        c.execute(delete(banco.sessoes).where(banco.sessoes.c.email == email))
    banco.registrar(email, "senha" if existe else "administrador", "Senha trocada" if existe else "Administrador criado")
    return email


def remover_administrador(email: str) -> bool:
    email = _email(email)
    with banco.engine.begin() as c:
        c.execute(delete(banco.sessoes).where(banco.sessoes.c.email == email))
        apagou = c.execute(delete(banco.administradores).where(banco.administradores.c.email == email)).rowcount > 0
    if apagou:
        banco.registrar(email, "administrador", "Administrador removido")
    return apagou


def _bloqueado(email: str) -> bool:
    with _trava:
        recentes = [t for t in _erros.get(email, []) if t > time.monotonic() - 900]
        _erros[email] = recentes
        return len(recentes) >= 5


def _errou(email: str) -> None:
    with _trava:
        _erros.setdefault(email, []).append(time.monotonic())


def conferir_credenciais(email: str, senha: str) -> str:
    """Devolve o e-mail se a senha confere; senão, ErroAcesso (sem dizer se o e-mail existe)."""
    email = (email or "").strip().lower()
    if _bloqueado(email):
        raise ErroAcesso("Muitas tentativas erradas. Espere 15 minutos.", 429)
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.administradores.c.senha_hash)
                          .where(banco.administradores.c.email == email)).first()
    if not senha_confere(senha or "", linha.senha_hash if linha else _HASH_FALSO) or not linha:
        _errou(email)
        raise ErroAcesso("E-mail ou senha errados.")
    with _trava:
        _erros.pop(email, None)
    return email


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def entrar(email: str, senha: str) -> dict:
    email = conferir_credenciais(email, senha)
    token = secrets.token_urlsafe(32)
    agora = banco.agora()
    expira = agora + timedelta(hours=ACESSO_HORAS)
    with banco.engine.begin() as c:
        c.execute(delete(banco.sessoes).where(banco.sessoes.c.expira_em < agora))
        c.execute(insert(banco.sessoes).values(token_hash=_hash_token(token), email=email, criado_em=agora,
                                               expira_em=expira))
    banco.registrar(email, "entrada", "Entrou na área do vendedor")
    return {"token": token, "email": email, "expira_em": expira.isoformat()}


def sessao(token: str) -> str | None:
    """O e-mail de quem está com esta sessão, ou None."""
    if not token or len(token) > 100:
        return None
    with banco.engine.connect() as c:
        linha = c.execute(select(banco.sessoes.c.email, banco.sessoes.c.expira_em)
                          .where(banco.sessoes.c.token_hash == _hash_token(token))).first()
    if not linha:
        return None
    expira = linha.expira_em if linha.expira_em.tzinfo else linha.expira_em.replace(tzinfo=banco.agora().tzinfo)
    return linha.email if expira > banco.agora() else None


def sair(token: str) -> None:
    with banco.engine.begin() as c:
        c.execute(delete(banco.sessoes).where(banco.sessoes.c.token_hash == _hash_token(token or "")))


def trocar_senha(email: str, atual: str, nova: str) -> None:
    conferir_credenciais(email, atual)
    definir_administrador(email, nova)
