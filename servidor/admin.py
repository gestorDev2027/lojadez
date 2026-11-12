"""Cria o administrador da área do vendedor (ou troca a senha dele), direto no banco do DATABASE_URL.

Rodar no seu computador, com o .env apontando para o Supabase:
    .venv\\Scripts\\python -m servidor.admin                  cria ou troca a senha (pergunta o e-mail e a senha)
    .venv\\Scripts\\python -m servidor.admin remover <email>  tira o acesso

A senha é digitada aqui (não aparece na tela) e só o hash vai para o banco.
"""

import getpass
import sys

from servidor import acesso, banco


def main(argumentos: list[str]) -> int:
    banco.iniciar()
    onde = "Supabase/Postgres" if banco.eh_postgres() else "SQLite local (dados/loja.db)"
    print(f"Banco: {onde}")
    if argumentos[:1] == ["remover"] and len(argumentos) == 2:
        print("Acesso removido." if acesso.remover_administrador(argumentos[1]) else "Esse e-mail não era administrador.")
        return 0
    if argumentos:
        print(__doc__)
        return 1
    email = input("E-mail do administrador: ").strip()
    senha = getpass.getpass(f"Senha (mínimo {acesso.SENHA_MINIMA} caracteres, não aparece): ")
    if senha != getpass.getpass("Repita a senha: "):
        print("As senhas não batem. Nada foi gravado.")
        return 1
    try:
        email = acesso.definir_administrador(email, senha)
    except acesso.ErroAcesso as erro:
        print(f"Não gravei: {erro.mensagem}")
        return 1
    print(f"Pronto: {email} entra na área do vendedor (/vendedor) com essa senha.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
