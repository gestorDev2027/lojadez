// O site no ar (Render): liga o servidor do Astro, o Python por dentro e as tarefas a cada 15 minutos.
//   node servidor.mjs        (depois do `npm run build`; o Dockerfile já faz tudo)
//
// - Astro: HOST e PORT do ambiente (no Render, 0.0.0.0 e a porta que ele dá).
// - Python (as abas do painel ainda não reescritas, servidor/python.ts): só com PYTHON_COMANDO, ouvindo só por dentro
//   (127.0.0.1, porta de PYTHON_URL). Se cair, liga de novo em 5 segundos.
// - Tarefas: POST /api/tarefas com uma chave sorteada aqui a cada vez que o servidor liga (ninguém de fora sabe).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

process.env.TAREFAS_CHAVE = randomBytes(32).toString("hex");

let python = null;
let desligando = false;

function ligarPython() {
  const comando = (process.env.PYTHON_COMANDO ?? "").trim();
  if (!comando || desligando) return;
  // "exec": o sh vira o próprio Python, e o sinal de desligar chega nele.
  python = spawn("sh", ["-c", `exec ${comando}`], { stdio: "inherit", cwd: process.env.PYTHON_PASTA || undefined });
  python.on("exit", (codigo) => {
    if (desligando) return;
    console.error(`Python parou (código ${codigo}). Ligando de novo em 5 segundos.`);
    setTimeout(ligarPython, 5000);
  });
}

// O Render manda SIGTERM ao publicar uma versão nova: desliga o Python junto.
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    desligando = true;
    python?.kill("SIGTERM");
    process.exit(0);
  });
}

async function rodarTarefas() {
  const porta = process.env.PORT ?? "4321";
  try {
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/tarefas`, {
      method: "POST",
      headers: { "x-tarefas-chave": process.env.TAREFAS_CHAVE },
      signal: AbortSignal.timeout(5 * 60_000),
    });
    console.info(`Tarefas: ${resposta.status} ${await resposta.text()}`);
  } catch (erro) {
    console.error("Tarefas: não rodaram", erro);
  }
}

ligarPython();
await import("./dist/server/entry.mjs");
// TAREFAS_DESLIGADAS=sim: para testar o build no computador sem mexer nos pedidos de verdade.
if (process.env.TAREFAS_DESLIGADAS !== "sim") {
  setTimeout(rodarTarefas, 60_000); // a primeira, um minuto depois de ligar
  setInterval(rodarTarefas, 15 * 60_000);
}
