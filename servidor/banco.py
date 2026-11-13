"""O banco: uma tabela de pedidos. SQLite local (dados/loja.db) ou Postgres pelo DATABASE_URL."""

from datetime import datetime, timezone

from sqlalchemy import (JSON, Column, DateTime, Float, Integer, LargeBinary, MetaData, String, Table, Text, create_engine, delete,
                        insert, select, update)

from servidor import config

metadata = MetaData()

pedidos = Table(
    "pedidos", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("order_nsu", String(36), nullable=False, unique=True, index=True),
    Column("criado_em", DateTime(timezone=True), nullable=False),
    # aguardando_pagamento → pago → enviado; ou cancelado
    Column("situacao", String(30), nullable=False, default="aguardando_pagamento"),
    Column("sku", String(40), nullable=False),
    Column("oferta", String(20), nullable=False),
    Column("produto", Text, nullable=False),  # ex.: "Kit Barbeador 3 Lâminas - 2 Kits (2 aparelhos + 44 refis)"
    Column("kits", Integer, nullable=False),
    Column("preco_centavos", Integer, nullable=False),  # o preço da oferta
    Column("frete_tipo", String(40), nullable=False),
    Column("frete_descricao", Text, nullable=False),
    Column("frete_prazo_dias", Integer),
    Column("frete_centavos", Integer, nullable=False),  # o que o comprador paga de frete (0 no frete grátis)
    Column("frete_custo_centavos", Integer),  # o que a Loggi cobra da loja (no frete grátis, a loja paga)
    Column("total_centavos", Integer, nullable=False),
    # o comprador
    Column("nome", Text, nullable=False),
    Column("cpf", String(11), nullable=False),  # a Loggi exige o CPF do destinatário para criar o envio
    Column("email", Text, nullable=False),
    Column("telefone", Text, nullable=False),
    Column("cep", String(8), nullable=False),
    Column("rua", Text, nullable=False),
    Column("numero", Text, nullable=False),
    Column("complemento", Text),
    Column("bairro", Text, nullable=False),
    Column("cidade", Text, nullable=False),
    Column("uf", String(2), nullable=False),
    # o pagamento (InfinitePay)
    Column("link_pagamento", Text),
    Column("slug", Text),
    Column("transaction_nsu", Text),
    Column("forma_pagamento", String(30)),
    Column("valor_pago_centavos", Integer),
    Column("parcelas", Integer),
    Column("recibo_url", Text),
    Column("pago_em", DateTime(timezone=True)),
    # o envio
    Column("codigo_rastreio", Text),
    Column("enviado_em", DateTime(timezone=True)),
    Column("loggi_key", Text),  # o pacote criado na Loggi
    Column("envio_criado_em", DateTime(timezone=True)),
    Column("desconto_pix", Float),  # o % de desconto no Pix que valia quando o pedido foi criado
    Column("envio_erro", Text),  # por que o envio automático na Loggi falhou (o vendedor cria à mão)
)

# Colunas que entraram depois da tabela criada: o create_all não altera tabela existente.
COLUNAS_NOVAS = {"pedidos": {"loggi_key": "TEXT", "envio_criado_em": "TIMESTAMP WITH TIME ZONE", "envio_erro": "TEXT",
                          "desconto_pix": "DOUBLE PRECISION", "frete_custo_centavos": "INTEGER"}}


# Os ajustes que o vendedor muda pela área do vendedor (refis, preços...): valem sobre os padrões do .env.
ajustes = Table(
    "ajustes", metadata,
    Column("chave", String(60), primary_key=True),
    Column("valor", JSON, nullable=False),
    Column("atualizado_em", DateTime(timezone=True), nullable=False),
)

# Fotos enviadas pelo vendedor (ficam no banco: o disco do Render é apagado a cada publicação).
fotos = Table(
    "fotos", metadata,
    Column("nome", String(40), primary_key=True),
    Column("tipo", String(40), nullable=False),
    Column("dados", LargeBinary, nullable=False),
    Column("atualizado_em", DateTime(timezone=True), nullable=False),
)


# A configuração salva na aba Configurações (vale sobre o .env). Os segredos não ficam aqui: vão para o Vault.
configuracoes = Table(
    "configuracoes", metadata,
    Column("chave", String(60), primary_key=True),
    Column("valor", Text, nullable=False),
    Column("atualizado_em", DateTime(timezone=True), nullable=False),
    Column("atualizado_por", Text),
)

# Só sem Supabase (SQLite no computador, para testes): os segredos ficam aqui, SEM criptografia.
segredos_locais = Table(
    "segredos_locais", metadata,
    Column("nome", String(80), primary_key=True),
    Column("valor", Text, nullable=False),
    Column("atualizado_em", DateTime(timezone=True), nullable=False),
)

# Quem entra na área do vendedor. A senha fica só como hash (scrypt), nunca em texto.
administradores = Table(
    "administradores", metadata,
    Column("email", String(200), primary_key=True),
    Column("senha_hash", Text, nullable=False),
    Column("criado_em", DateTime(timezone=True), nullable=False),
    Column("atualizado_em", DateTime(timezone=True), nullable=False),
)

# As sessões abertas: só o hash do token (quem lê o banco não consegue entrar com ele).
sessoes = Table(
    "sessoes", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("email", String(200), nullable=False, index=True),
    Column("criado_em", DateTime(timezone=True), nullable=False),
    Column("expira_em", DateTime(timezone=True), nullable=False),
)

# Quem mudou o quê na configuração e quando (sem os valores).
auditoria = Table(
    "auditoria", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("quando", DateTime(timezone=True), nullable=False, index=True),
    Column("email", Text),
    Column("acao", String(60), nullable=False),
    Column("detalhe", Text),
)


# No Postgres (Supabase ou Render), as tabelas ficam no esquema "loja", não no "public": o Supabase publica o "public"
# na API REST, e a chave anon (que é pública) leria os pedidos, com CPF e endereço. O "loja" não é publicado, e ainda
# assim as tabelas ficam com RLS ligado e sem acesso para os papéis anon e authenticated.
ESQUEMA = "loja"


def _criar_engine():
    url = config.DATABASE_URL
    if url:
        url = url.replace("postgres://", "postgresql+psycopg://", 1).replace("postgresql://", "postgresql+psycopg://", 1)
        return create_engine(url, pool_pre_ping=True, execution_options={"schema_translate_map": {None: ESQUEMA}})
    pasta = config.RAIZ / "dados"
    pasta.mkdir(exist_ok=True)
    return create_engine(f"sqlite:///{pasta / 'loja.db'}")


engine = _criar_engine()


def iniciar() -> None:
    from sqlalchemy import inspect, text

    postgres = engine.dialect.name == "postgresql"
    if postgres:
        with engine.begin() as c:
            c.execute(text(f"CREATE SCHEMA IF NOT EXISTS {ESQUEMA}"))
    metadata.create_all(engine)
    esquema = ESQUEMA if postgres else None
    prefixo = f"{ESQUEMA}." if postgres else ""

    with engine.begin() as c:
        for tabela, colunas in COLUNAS_NOVAS.items():
            existentes = {col["name"] for col in inspect(c).get_columns(tabela, schema=esquema)}
            for nome, tipo in colunas.items():
                if nome not in existentes:
                    c.execute(text(f"ALTER TABLE {prefixo}{tabela} ADD COLUMN {nome} {tipo}"))
        if postgres:
            # O dono das tabelas (o usuário do DATABASE_URL) passa pelo RLS; os demais, sem política, não leem nada.
            for tabela in metadata.tables:
                c.execute(text(f"ALTER TABLE {ESQUEMA}.{tabela} ENABLE ROW LEVEL SECURITY"))
            # Os papéis da API REST do Supabase não existem num Postgres comum (Render): só revoga se existirem.
            c.execute(text(f"""
                DO $$
                DECLARE papel text;
                BEGIN
                  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
                      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA {ESQUEMA} FROM %I', papel);
                      EXECUTE format('REVOKE ALL ON SCHEMA {ESQUEMA} FROM %I', papel);
                    END IF;
                  END LOOP;
                END $$;
            """))


def agora() -> datetime:
    return datetime.now(timezone.utc)


def inserir(valores: dict) -> None:
    with engine.begin() as c:
        c.execute(insert(pedidos).values(**valores))


def buscar(order_nsu: str) -> dict | None:
    with engine.connect() as c:
        linha = c.execute(select(pedidos).where(pedidos.c.order_nsu == order_nsu)).mappings().first()
    return dict(linha) if linha else None


def alterar(order_nsu: str, valores: dict, *, so_se_situacao: tuple[str, ...] | None = None) -> bool:
    """Altera o pedido. Com `so_se_situacao`, só altera se ele estiver numa dessas situações (evita corrida)."""
    consulta = update(pedidos).where(pedidos.c.order_nsu == order_nsu)
    if so_se_situacao:
        consulta = consulta.where(pedidos.c.situacao.in_(so_se_situacao))
    with engine.begin() as c:
        return c.execute(consulta.values(**valores)).rowcount > 0


def ler_ajustes() -> dict:
    with engine.connect() as c:
        return {l.chave: l.valor for l in c.execute(select(ajustes.c.chave, ajustes.c.valor))}


def gravar_ajustes(valores: dict) -> None:
    with engine.begin() as c:
        for chave, valor in valores.items():
            c.execute(delete(ajustes).where(ajustes.c.chave == chave))
            if valor is not None:
                c.execute(insert(ajustes).values(chave=chave, valor=valor, atualizado_em=agora()))


def ler_foto(nome: str) -> dict | None:
    with engine.connect() as c:
        linha = c.execute(select(fotos).where(fotos.c.nome == nome)).mappings().first()
    return dict(linha) if linha else None


def gravar_foto(nome: str, tipo: str | None, dados: bytes | None) -> None:
    """Grava a foto; sem dados, apaga (volta a foto padrão)."""
    with engine.begin() as c:
        c.execute(delete(fotos).where(fotos.c.nome == nome))
        if dados:
            c.execute(insert(fotos).values(nome=nome, tipo=tipo, dados=dados, atualizado_em=agora()))


def eh_postgres() -> bool:
    return engine.dialect.name == "postgresql"


def registrar(email: str | None, acao: str, detalhe: str = "") -> None:
    with engine.begin() as c:
        c.execute(insert(auditoria).values(quando=agora(), email=email, acao=acao, detalhe=detalhe[:1000]))


def ultimas_mudancas(limite: int = 20) -> list[dict]:
    with engine.connect() as c:
        consulta = select(auditoria).order_by(auditoria.c.quando.desc(), auditoria.c.id.desc()).limit(limite)
        return [dict(l) for l in c.execute(consulta).mappings().all()]


def listar(situacao: str | None = None, limite: int = 200) -> list[dict]:
    consulta = select(pedidos).order_by(pedidos.c.criado_em.desc()).limit(limite)
    if situacao:
        consulta = consulta.where(pedidos.c.situacao == situacao)
    with engine.connect() as c:
        return [dict(l) for l in c.execute(consulta).mappings().all()]
