// O repasse das abas que ainda estão no Python (servidor/python.ts) e a rota das tarefas a cada 15 minutos.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as rotaTarefas } from "../src/pages/api/tarefas";
import { GET as repassarGet, POST as repassarPost } from "../src/pages/api/vendedor/[...resto]";
import { vaiProPython } from "../src/servidor/python";
import { bancoNovo, chamar, entrarComo } from "./apoio";

// Um "Python" de mentira: guarda o que recebeu e responde em JSON.
let servidor: Server;
let recebidos: { metodo: string; url: string; cabecalhos: IncomingMessage["headers"]; corpo: string }[] = [];

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let corpo = "";
    req.on("data", (parte) => (corpo += parte));
    req.on("end", () => {
      recebidos.push({ metodo: req.method ?? "", url: req.url ?? "", cabecalhos: req.headers, corpo });
      res.writeHead(201, { "Content-Type": "application/json", "X-Do-Python": "sim" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  process.env.PYTHON_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.PYTHON_URL;
  delete process.env.TAREFAS_CHAVE;
  await new Promise((pronto) => servidor.close(pronto));
});

describe("abas no Python", () => {
  beforeEach(async () => {
    await bancoNovo();
    recebidos = [];
  });

  it("só as áreas que ainda estão no Python passam", () => {
    for (const caminho of ["/api/vendedor/painel", "/api/vendedor/financeiro/custos", "/api/vendedor/afiliados/3/campanhas", "/api/vendedor/ia/foto"])
      expect(vaiProPython(caminho)).toBe(true);
    for (const caminho of ["/api/vendedor/primeiro-acesso", "/api/vendedor/xyz", "/api/pedidos", "/api/vendedor"])
      expect(vaiProPython(caminho)).toBe(false);
  });

  it("repassa com a sessão no Authorization, sem o cookie, e devolve a resposta do Python", async () => {
    const token = await entrarComo("dono@loja.com");
    const r = await chamar(repassarPost, { token, caminho: "/api/vendedor/cupons?x=1", corpo: { codigo: "BEMVINDO" } });
    expect(r.status).toBe(201);
    expect(r.dados).toEqual({ ok: true });
    expect(r.cabecalhos.get("X-Do-Python")).toBe("sim");
    const [pedido] = recebidos;
    expect(pedido).toMatchObject({ metodo: "POST", url: "/api/vendedor/cupons?x=1", corpo: JSON.stringify({ codigo: "BEMVINDO" }) });
    expect(pedido.cabecalhos.authorization).toBe(`Bearer ${token}`);
    expect(pedido.cabecalhos.cookie).toBeUndefined();
    expect(pedido.cabecalhos["x-forwarded-for"]).toBe("127.0.0.1");
  });

  it("sem sessão, sem a permissão da área ou numa área que não existe, nada chega ao Python", async () => {
    expect((await chamar(repassarGet, { caminho: "/api/vendedor/painel" })).status).toBe(401);
    const operacao = await entrarComo("op@loja.com", "operacao", ["visao", "pedidos", "estoque"]);
    expect((await chamar(repassarGet, { token: operacao, caminho: "/api/vendedor/painel" })).status).toBe(201);
    expect((await chamar(repassarGet, { token: operacao, caminho: "/api/vendedor/financeiro" })).status).toBe(403);
    const dono = await entrarComo("dono@loja.com");
    expect((await chamar(repassarGet, { token: dono, caminho: "/api/vendedor/primeiro-acesso" })).status).toBe(404);
    expect(recebidos.map((p) => p.url)).toEqual(["/api/vendedor/painel"]);
  });

  it("de outro site, o pedido que muda algo é recusado", async () => {
    const token = await entrarComo("dono@loja.com");
    const r = await chamar(repassarPost, { token, caminho: "/api/vendedor/cupons", corpo: {}, cabecalhos: { Origin: "https://outro.site" } });
    expect(r.status).toBe(403);
    expect(recebidos).toEqual([]);
  });
});

describe("tarefas a cada 15 minutos", () => {
  beforeEach(async () => {
    await bancoNovo();
  });

  it("só rodam com a chave do servidor; sem chave configurada, a rota não existe", async () => {
    delete process.env.TAREFAS_CHAVE;
    expect((await chamar(rotaTarefas, { metodo: "POST", cabecalhos: { "x-tarefas-chave": "" } })).status).toBe(404);
    process.env.TAREFAS_CHAVE = "chave-de-teste-123";
    expect((await chamar(rotaTarefas, { metodo: "POST", cabecalhos: { "x-tarefas-chave": "errada" } })).status).toBe(404);
    const r = await chamar(rotaTarefas, { metodo: "POST", cabecalhos: { "x-tarefas-chave": "chave-de-teste-123" } });
    expect(r.status).toBe(200);
    expect(r.dados).toEqual({ conferidos: 0, pagos: 0, liberados: 0 });
  });
});
