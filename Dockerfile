# Etapa 1: o site (Astro), com as dependências só de produção no fim.
FROM node:24-slim AS site
WORKDIR /site
COPY site/package.json site/package-lock.json ./
RUN npm ci
COPY site/ ./
# O build confere as variáveis (astro.config.mjs): um DATABASE_URL de mentira só para isto; o de verdade vem do Render.
RUN DATABASE_URL=postgres://construcao@localhost/loja npm run build && npm prune --omit=dev

# Etapa 2: o servidor. O Node (Astro) atende na porta do Render; o Python (as abas do painel ainda não reescritas)
# roda por dentro, só em 127.0.0.1:8001, ligado pelo servidor.mjs.
FROM python:3.14-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 NODE_ENV=production HOST=0.0.0.0
COPY --from=site /usr/local/bin/node /usr/local/bin/node
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY servidor/ ./servidor/
COPY --from=site /site/package.json ./site/
COPY --from=site /site/node_modules ./site/node_modules
COPY --from=site /site/dist ./site/dist
COPY site/servidor.mjs ./site/
ENV PYTHON_URL=http://127.0.0.1:8001 \
    PYTHON_PASTA=/app \
    PYTHON_COMANDO="uvicorn servidor.app:app --host 127.0.0.1 --port 8001 --proxy-headers --forwarded-allow-ips=127.0.0.1"
WORKDIR /app/site
EXPOSE 4321
CMD ["node", "servidor.mjs"]
