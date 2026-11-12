# Loja de lâminas de barbear

Site de venda de um produto (o kit de lâminas MADE basics, MADE-BB006). O cliente calcula o frete pela **Loggi**, preenche
os dados de entrega e paga por Pix ou cartão no **checkout da InfinitePay**. O vendedor vê os pedidos pagos em `/vendedor`.

As duas integrações têm um **modo simulado**: dá para rodar e testar o fluxo inteiro sem credenciais e sem cobrar nada.

## Como a compra funciona

1. **Frete:** o cliente digita o CEP. O servidor busca o endereço no ViaCEP e cota na Loggi
   (`POST /v1/companies/{id}/quotations`), com o peso e as medidas da caixa. A tela mostra Econômico e Expresso.
2. **Pedido:** com os dados de entrega, o servidor **cota o frete de novo e recalcula o preço** (nunca usa valores
   vindos do navegador), grava o pedido (`order_nsu`) e cria o link na InfinitePay (`POST /links`), com o produto e o
   frete como itens.
3. **Pagamento:** o cliente paga na página da InfinitePay.
4. **Confirmação:** a InfinitePay avisa o webhook (`/api/webhooks/infinitepay`) e devolve o cliente para `/obrigado`.
   O aviso dela **não é assinado**: em qualquer dos dois casos, o servidor confere em `POST /payment_check` e só marca
   "pago" se o valor bater com o do pedido. Valor diferente vira "Valor divergente" para o vendedor conferir.
5. **Envio:** em `/vendedor`, o vendedor copia o endereço, despacha e marca como enviado com o código de rastreio, que
   aparece para o cliente na página do pedido.

## Rodar no computador

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env          # e defina VENDEDOR_SENHA
cd web; npm install; npm run build; cd ..
.venv\Scripts\python -m uvicorn servidor.app:app --reload --port 8000
```

Abra http://localhost:8000. A área do vendedor fica em http://localhost:8000/vendedor.

Para mexer na tela com recarga automática, rode também `cd web; npm run dev` e use http://localhost:5173 (com
`SITE_URL=http://localhost:5173` no `.env`, para o pagamento simulado voltar para lá).

Testes do fluxo (com tudo simulado e sem rede):

```powershell
.venv\Scripts\python -m pip install pytest
.venv\Scripts\python -m pytest testes -q
```

## Ligar a Loggi de verdade

1. Peça ao comercial da Loggi o `client_id`, o `client_secret`, o código da empresa (`company_id`) e os códigos de
   serviço (`externalServiceId`).
2. No `.env`: `LOGGI_AMBIENTE=staging` (homologação) e as credenciais. Depois de testar, `producao`.
3. Confira `LOJA_ORIGEM_CEP`, `PRODUTO_PESO_G` e `PRODUTO_DIMENSOES_CM`: a cotação depende deles.

O token (`POST /v2/oauth2/token`) fica guardado na memória até vencer e é renovado sozinho. Se a Loggi responder 401,
o servidor pede um token novo e tenta mais uma vez.

**Ainda não confirmado na documentação da Loggi:** o cabeçalho do token (usamos `Authorization: Bearer`) e o formato
exato do preço na resposta da cotação (o código aceita número, texto ou `{units, nanos}`). Confira no primeiro teste em
staging.

## Ligar a InfinitePay de verdade

1. No app da InfinitePay, ative o **Checkout Integrado**.
2. No `.env`: `INFINITEPAY_AMBIENTE=real` e `INFINITEPAY_HANDLE` (sua InfiniteTag, sem o `$`).
3. Opcional: crie uma API Key e ponha em `INFINITEPAY_API_KEY`. Com ela, cada link vale por 48 h, aceita um pagamento só
   e aceita Pix e cartão.
4. `SITE_URL` precisa ser o endereço público com `https://`. Sem isso a InfinitePay não manda o webhook, e o pedido só é
   confirmado quando o cliente volta para `/obrigado`.

**Atenção:** a InfinitePay não tem ambiente de testes. No modo `real`, cada pedido cria um link de verdade na sua conta.
Faça o primeiro teste com um pedido pequeno e pago por você.

**Ainda não confirmado:** a documentação não mostra a resposta de `POST /links`. O código procura o link nos campos
`url`, `link`, `checkout_url` e `payment_url` e, se não achar, mostra quais campos vieram.

## Publicar no Render

O `render.yaml` cria o serviço (Docker) e um Postgres para os pedidos. Defina as variáveis marcadas com `sync: false` no
painel do Render. Use o plano `starter` ou acima: no free o site dorme, e o webhook pode chegar com ele dormindo.

## Antes de vender

- [ ] Preço, peso e medidas da embalagem (`.env`).
- [ ] Quantas cargas vêm no kit (pôr no `PRODUTO_RESUMO`).
- [ ] Fotos de produto boas no lugar de `web/public/produto/frente.jpg` e `verso.jpg` (hoje são as fotos do celular).
- [ ] Nome da loja e domínio próprios (a loja não deve parecer o site oficial da marca MADE basics).
- [ ] Política de privacidade, trocas e devoluções (Código de Defesa do Consumidor: 7 dias para compras online), com CNPJ
      ou CPF e contato da loja no rodapé.
- [ ] Nota fiscal (ou declaração de conteúdo) para o envio.

## Próximos passos

- Criar o envio na Loggi pelo pedido pago (`async-shipments`) e gerar a etiqueta. Exige o CPF do destinatário e a nota
  fiscal ou a declaração de conteúdo.
- Receber o webhook de rastreio da Loggi e mostrar o andamento ao cliente.
- E-mail de confirmação para o cliente e de aviso para o vendedor.

## Estrutura

```
servidor/app.py          rotas: /api (loja, frete, pedidos, webhook, vendedor), /simulador e o site
servidor/pedidos.py      regras: cotar, criar o pedido, conferir o pagamento, despachar
servidor/loggi.py        ViaCEP, token OAuth2 e cotação (real ou simulada)
servidor/infinitepay.py  link de pagamento e payment_check (real ou simulado)
servidor/simulador.py    a InfinitePay de mentira (só em testes)
servidor/banco.py        a tabela de pedidos (SQLite local ou Postgres)
servidor/config.py       as variáveis de ambiente e o produto
web/src/paginas/         Loja (produto, frete e checkout), Obrigado e Vendedor
testes/test_fluxo.py     o fluxo inteiro, simulado
```
