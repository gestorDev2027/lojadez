# Etapa 1: constrói o site (React).
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Etapa 2: o servidor (FastAPI), que serve a API e o site.
FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY servidor/ ./servidor/
COPY --from=web /web/dist ./web/dist
EXPOSE 8000
CMD ["sh", "-c", "uvicorn servidor.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
