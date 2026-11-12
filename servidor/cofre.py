"""Os segredos da loja (chaves da Loggi e da InfinitePay).

- No Supabase: no Vault (criptografados no disco e nos backups). Cada um com o nome "loja:<CHAVE>".
- No SQLite do computador (testes): na tabela `segredos_locais`, sem criptografia.
- Num Postgres sem o Vault: recusa gravar (use o .env ou o Supabase).

O valor de um segredo nunca volta para a tela: só se ele está configurado.
"""

from sqlalchemy import delete, insert, select, text

from servidor import banco

PREFIXO = "loja:"


class ErroCofre(Exception):
    pass


def tipo() -> str:
    """vault | local | indisponivel"""
    if not banco.eh_postgres():
        return "local"
    with banco.engine.connect() as c:
        tem = c.execute(text("select to_regclass('vault.decrypted_secrets') is not null")).scalar()
    return "vault" if tem else "indisponivel"


def ler_todos() -> dict[str, str]:
    """{CHAVE: valor} de todos os segredos da loja."""
    modo = tipo()
    if modo == "indisponivel":
        return {}
    with banco.engine.connect() as c:
        if modo == "local":
            linhas = c.execute(select(banco.segredos_locais.c.nome, banco.segredos_locais.c.valor)).all()
        else:
            linhas = c.execute(text("select name, decrypted_secret from vault.decrypted_secrets where name like :p"),
                               {"p": PREFIXO + "%"}).all()
    return {nome.removeprefix(PREFIXO): valor for nome, valor in linhas if nome.startswith(PREFIXO) and valor}


def gravar(chave: str, valor: str) -> None:
    modo = tipo()
    if modo == "indisponivel":
        raise ErroCofre("Este banco não tem o Vault do Supabase: guarde as chaves no .env ou use o Supabase.")
    nome = PREFIXO + chave
    with banco.engine.begin() as c:
        if modo == "local":
            c.execute(delete(banco.segredos_locais).where(banco.segredos_locais.c.nome == nome))
            c.execute(insert(banco.segredos_locais).values(nome=nome, valor=valor, atualizado_em=banco.agora()))
            return
        existente = c.execute(text("select id from vault.secrets where name = :n"), {"n": nome}).scalar()
        if existente:
            c.execute(text("select vault.update_secret(:id, :v)"), {"id": existente, "v": valor})
        else:
            c.execute(text("select vault.create_secret(:v, :n, :d)"),
                      {"v": valor, "n": nome, "d": "Loja: chave salva pela área do vendedor"})


def apagar(chave: str) -> None:
    modo = tipo()
    if modo == "indisponivel":
        return
    nome = PREFIXO + chave
    with banco.engine.begin() as c:
        if modo == "local":
            c.execute(delete(banco.segredos_locais).where(banco.segredos_locais.c.nome == nome))
        else:
            c.execute(text("delete from vault.secrets where name = :n"), {"n": nome})
