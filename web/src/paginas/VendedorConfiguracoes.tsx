import { useEffect, useState, type FormEvent } from "react";
import { chamar, type CampoConfig, type EstadoConfig } from "../api";
import { Cartao } from "./VendedorAjustes";

// A aba Configurações: o que antes ficava no .env. As chaves vão para o Vault do Supabase e nunca voltam para a tela.
// Salvar pede a senha de novo: daqui se mudam as chaves de pagamento.

const ORIGENS: Record<CampoConfig["origem"], string> = {
  vault: "no Vault",
  banco: "salvo aqui",
  env: "do .env",
  padrao: "padrão",
};

const NUMERICOS = new Set(["digitos", "inteiro", "decimal"]);

export function AbaConfiguracoes({ senha, aoSair }: { senha: string; aoSair: () => void }) {
  const [estado, setEstado] = useState<EstadoConfig | null>(null);
  const [mudancas, setMudancas] = useState<Record<string, string>>({});
  const [apagar, setApagar] = useState<string[]>([]);
  const [confirmacao, setConfirmacao] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    chamar<EstadoConfig>("/api/vendedor/configuracoes", { senha })
      .then(setEstado)
      .catch((e: Error) => setAviso({ ok: false, texto: e.message }));
  }, [senha]);

  function mudar(campo: CampoConfig, valor: string) {
    setMudancas((atual) => {
      const novo = { ...atual };
      if (campo.tipo !== "segredo" && valor === (campo.valor ?? "")) delete novo[campo.chave];
      else if (campo.tipo === "segredo" && !valor) delete novo[campo.chave];
      else novo[campo.chave] = valor;
      return novo;
    });
  }

  async function enviar(caminho: string, metodo: string, corpo: object, sucesso: string) {
    setSalvando(true);
    setAviso(null);
    try {
      const novo = await chamar<EstadoConfig>(caminho, { senha, metodo, corpo: { ...corpo, senha: confirmacao } });
      setEstado(novo);
      setMudancas({});
      setApagar([]);
      setConfirmacao("");
      setAviso({ ok: true, texto: sucesso });
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  function salvar(e: FormEvent) {
    e.preventDefault();
    void enviar("/api/vendedor/configuracoes", "PUT", { valores: mudancas, apagar_segredos: apagar }, "Salvo. Já vale na loja.");
  }

  if (!estado) return <p className="mt-6 text-suave">{aviso?.texto || "Carregando…"}</p>;
  const quantas = Object.keys(mudancas).length + apagar.length;

  return (
    <div className="mt-6 grid gap-5">
      <p className="text-sm text-tinta-2">
        {estado.cofre === "vault" && "As chaves (Loggi e InfinitePay) ficam criptografadas no Vault do Supabase e nunca voltam para a tela. "}
        {estado.cofre === "local" &&
          "Você está no banco do computador (sem Supabase): aqui as chaves ficam sem criptografia. Para publicar, use o Supabase. "}
        {estado.cofre === "indisponivel" && "Este banco não tem o Vault do Supabase: as chaves continuam no .env. "}
        O que você salva aqui vale na hora e passa por cima do <code className="font-mono">.env</code>.
      </p>

      {estado.no_env.length > 0 && (
        <section className="rounded-2xl border border-laranja/40 bg-laranja/10 p-4 text-sm">
          <p className="font-bold">{estado.no_env.length} configurações ainda vêm do .env</p>
          <p className="mt-1 text-tinta-2">
            Leve tudo para o banco (as chaves para o Vault) com um clique. Depois, no .env e no Render só precisa ficar o DATABASE_URL.
            Digite sua senha embaixo, em “Confirmar com a senha”.
          </p>
          <button
            type="button"
            disabled={salvando || !confirmacao}
            onClick={() => void enviar("/api/vendedor/configuracoes/importar", "POST", {}, "Pronto: o .env foi levado para o banco.")}
            className="mt-3 rounded-full border border-laranja px-4 py-2 font-bold text-laranja-2 disabled:opacity-50"
          >
            Levar o .env para o banco
          </button>
        </section>
      )}

      <form onSubmit={salvar} className="grid gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          {Object.entries(estado.grupos).map(([grupo, titulo]) => (
            <Cartao key={grupo} titulo={titulo}>
              <div className="grid gap-4">
                {estado.campos
                  .filter((c) => c.grupo === grupo)
                  .map((c) => (
                    <CampoConfiguracao
                      key={c.chave}
                      campo={c}
                      valor={mudancas[c.chave] ?? (c.tipo === "segredo" ? "" : (c.valor ?? ""))}
                      mudou={c.chave in mudancas}
                      tirar={apagar.includes(c.chave)}
                      aoMudar={(v) => mudar(c, v)}
                      aoTirar={(sim) => setApagar((a) => (sim ? [...a, c.chave] : a.filter((x) => x !== c.chave)))}
                    />
                  ))}
              </div>
            </Cartao>
          ))}
        </div>

        <div className="sticky bottom-3 z-10 flex flex-wrap items-end gap-3 rounded-2xl border border-linha-2 bg-fundo-2/95 p-4 backdrop-blur">
          <label className="grid min-w-56 flex-1 gap-1.5 text-sm font-semibold">
            Confirmar com a senha
            <input
              className="campo"
              type="password"
              autoComplete="current-password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </label>
          <button type="submit" disabled={salvando || !quantas || !confirmacao} className="btn-laranja px-6 py-3 text-sm disabled:opacity-50">
            {salvando ? "Salvando…" : quantas ? `Salvar ${quantas} ${quantas > 1 ? "mudanças" : "mudança"}` : "Nada mudou"}
          </button>
          {aviso && (
            <p role={aviso.ok ? "status" : "alert"} className={`w-full text-sm ${aviso.ok ? "text-ok" : "text-alerta"}`}>
              {aviso.texto}
            </p>
          )}
        </div>
      </form>

      <div className="grid gap-5 lg:grid-cols-2">
        <TrocarSenha senha={senha} aoTrocar={aoSair} />
        <Cartao titulo="Últimas mudanças">
          {estado.mudancas.length === 0 ? (
            <p className="text-sm text-suave">Nada ainda.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {estado.mudancas.map((m, i) => (
                <li key={i} className="border-b border-linha pb-2 last:border-0">
                  <span className="block">{m.detalhe || m.acao}</span>
                  <span className="font-mono text-xs text-suave">
                    {[m.email, m.quando ? new Date(m.quando).toLocaleString("pt-BR") : ""].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </div>
  );
}

function CampoConfiguracao({
  campo: c,
  valor,
  mudou,
  tirar,
  aoMudar,
  aoTirar,
}: {
  campo: CampoConfig;
  valor: string;
  mudou: boolean;
  tirar: boolean;
  aoMudar: (v: string) => void;
  aoTirar: (sim: boolean) => void;
}) {
  const id = `cfg-${c.chave}`;
  const origem = mudou ? "alterado" : c.tipo === "segredo" && !c.configurado ? "não configurada" : ORIGENS[c.origem];
  return (
    <div className="grid gap-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-semibold">
          {c.rotulo}
        </label>
        <span className={`shrink-0 font-mono text-[11px] ${mudou ? "text-laranja-2" : "text-suave"}`}>{origem}</span>
      </div>
      {c.tipo === "escolha" || c.tipo === "sim_nao" ? (
        <select id={id} className="campo" value={valor} onChange={(e) => aoMudar(e.target.value)}>
          {(c.tipo === "sim_nao" ? ["nao", "sim"] : c.opcoes).map((o) => (
            <option key={o} value={o}>
              {o === "nao" ? "Não" : o === "sim" ? "Sim" : o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="campo font-mono"
          type={c.tipo === "segredo" ? "password" : c.tipo === "email" ? "email" : "text"}
          autoComplete={c.tipo === "segredo" ? "new-password" : "off"}
          inputMode={NUMERICOS.has(c.tipo) ? (c.tipo === "decimal" ? "decimal" : "numeric") : undefined}
          placeholder={c.tipo === "segredo" ? (c.configurado ? "•••••••• (deixe vazio para manter)" : "Cole aqui") : undefined}
          disabled={tirar}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
        />
      )}
      {c.tipo === "segredo" && c.configurado && (c.origem === "vault" || c.origem === "banco") && (
        <label className="flex items-center gap-2 text-xs text-suave">
          <input type="checkbox" checked={tirar} onChange={(e) => aoTirar(e.target.checked)} />
          Tirar esta chave
        </label>
      )}
      {c.ajuda && <span className="text-xs text-suave">{c.ajuda}</span>}
    </div>
  );
}

function TrocarSenha({ senha, aoTrocar }: { senha: string; aoTrocar: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetir, setRepetir] = useState("");
  const [erro, setErro] = useState("");
  const [trocando, setTrocando] = useState(false);

  async function trocar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (nova !== repetir) return setErro("As senhas novas não batem.");
    setTrocando(true);
    try {
      await chamar("/api/vendedor/senha", { senha, corpo: { atual, nova } });
      window.alert("Senha trocada. Entre de novo com a senha nova.");
      aoTrocar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setTrocando(false);
    }
  }

  return (
    <Cartao titulo="Sua senha">
      <form onSubmit={(e) => void trocar(e)} className="grid gap-3 text-sm">
        <label className="grid gap-1.5 font-semibold">
          Senha atual
          <input className="campo" type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} />
        </label>
        <label className="grid gap-1.5 font-semibold">
          Senha nova (mínimo 10 caracteres)
          <input className="campo" type="password" autoComplete="new-password" required minLength={10} value={nova} onChange={(e) => setNova(e.target.value)} />
        </label>
        <label className="grid gap-1.5 font-semibold">
          Repita a senha nova
          <input className="campo" type="password" autoComplete="new-password" required value={repetir} onChange={(e) => setRepetir(e.target.value)} />
        </label>
        {erro && (
          <p role="alert" className="text-alerta">
            {erro}
          </p>
        )}
        <button type="submit" disabled={trocando} className="justify-self-start rounded-full border border-linha-2 px-5 py-2.5 font-bold hover:border-laranja">
          {trocando ? "Trocando…" : "Trocar a senha"}
        </button>
      </form>
    </Cartao>
  );
}
