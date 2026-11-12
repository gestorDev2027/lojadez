"""O banco: uma tabela de pedidos. SQLite local (dados/loja.db) ou Postgres pelo DATABASE_URL."""

from datetime import datetime, timezone

from sqlalchemy import (JSON, Column, DateTime, Integer, LargeBinary, MetaData, String, Table, Text, create_engine, delete,
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
    Column("frete_centavos", Integer, nullable=False),
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
)


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


def _criar_engine():
    url = config.DATABASE_URL
    if url:
        url = url.replace("postgres://", "postgresql+psycopg://", 1).replace("postgresql://", "postgresql+psycopg://", 1)
        return create_engine(url, pool_pre_ping=True)
    pasta = config.RAIZ / "dados"
    pasta.mkdir(exist_ok=True)
    return create_engine(f"sqlite:///{pasta / 'loja.db'}")


engine = _criar_engine()


def iniciar() -> None:
    metadata.create_all(engine)


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


def listar(situacao: str | None = None, limite: int = 200) -> list[dict]:
    consulta = select(pedidos).order_by(pedidos.c.criado_em.desc()).limit(limite)
    if situacao:
        consulta = consulta.where(pedidos.c.situacao == situacao)
    with engine.connect() as c:
        return [dict(l) for l in c.execute(consulta).mappings().all()]
