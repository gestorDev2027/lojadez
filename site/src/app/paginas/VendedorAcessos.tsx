import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type FormEvent } from "react";
import { chamar } from "../api";
import { Cartao } from "./VendedorAjustes";
import { TrocarSenha } from "./VendedorConfiguracoes";
import type { Eu } from "./VendedorEntrar";

// A aba Acessos (só o dono): quem entra no painel, com que papel e permissões; os convites por link (o dono manda pelo
// WhatsApp; a pessoa cria a senha e, no primeiro acesso, cadastra o app autenticador). E a aba Minha conta, de todos.

interface AcessoTela {
  email: string;
  nome: string | null;
  papel: string;
  permissoes: string[];
  ativo: boolean;
  criado_por: string | null;
  criado_em: string;
  ultimo_acesso_em: string | null;
  senha_criada: boolean;
}

interface LinkGerado {
  email: string;
  tipo: "convite" | "senha";
  url: string;
}

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Os papéis que entram no painel (o de afiliado ainda não tem painel). */
const papeisDoPainel = (eu: Eu) => Object.entries(eu.papeis).filter(([id]) => id !== "afiliado");
/** As permissões que o dono pode liberar (a aba Acessos é só do dono). */
const liberaveis = (eu: Eu) => eu.todas_permissoes.filter((p) => p.id !== "acessos");

function Permissoes({ eu, papel, valor, aoMudar }: { eu: Eu; papel: string; valor: string[]; aoMudar: (v: string[]) => void }) {
  if (papel === "dono") return <p className="text-xs text-suave">O dono pode tudo, inclusive esta aba.</p>;
  return (
    <fieldset className="grid gap-1.5 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold">O que pode ver e fazer</legend>
      {liberaveis(eu).map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-sm text-tinta-2">
          <input
            type="checkbox"
            checked={valor.includes(p.id)}
            onChange={(e) => aoMudar(e.target.checked ? [...valor, p.id] : valor.filter((x) => x !== p.id))}
          />
          {p.rotulo}
        </label>
      ))}
    </fieldset>
  );
}

function MostrarLink({ link, aoFechar }: { link: LinkGerado; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const mensagem = `${link.tipo === "convite" ? "Seu acesso ao painel da loja" : "Link para criar a senha nova do painel da loja"}: ${link.url}`;
  return (
    <section role="status" className="rounded-2xl border border-laranja/40 bg-laranja/10 p-4 text-sm">
      <p className="font-bold">
        {link.tipo === "convite" ? "Convite criado" : "Link de senha nova"} para {link.email}
      </p>
      <p className="mt-1 text-tinta-2">
        Mande este link só para a pessoa (é como uma chave). Ele vale uma vez só e vence no prazo do Supabase (1 hora, se não
        foi mudado). Venceu? Gere outro na lista.
      </p>
      <p className="mt-3 rounded-xl border border-linha bg-fundo-2 p-3 font-mono text-xs break-all select-all">{link.url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-laranja px-4 py-2 text-xs"
          onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopiado(true))}
        >
          {copiado ? "Copiado" : "Copiar o link"}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-linha-2 px-4 py-2 text-xs font-bold hover:border-laranja"
        >
          Mandar pelo WhatsApp
        </a>
        <button type="button" onClick={aoFechar} className="rounded-full px-4 py-2 text-xs text-suave">
          Fechar
        </button>
      </div>
    </section>
  );
}

function Convidar({ eu, aoConvidar }: { eu: Eu; aoConvidar: (link: LinkGerado) => void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState("operacao");
  const [permissoes, setPermissoes] = useState<string[]>(eu.papeis.operacao?.permissoes ?? []);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (papel === "dono" && !window.confirm(`${email} vai ser dono: pode tudo, inclusive mexer nos acessos. Continuar?`)) return;
    setEnviando(true);
    try {
      const r = await chamar<{ link: { tipo: "convite" | "senha"; url: string } }>("/api/vendedor/acessos", {
        corpo: { email, nome, papel, permissoes },
      });
      aoConvidar({ email: email.trim().toLowerCase(), ...r.link });
      setEmail("");
      setNome("");
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Convidar uma pessoa">
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 font-semibold">
            E-mail
            <input className="campo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-1.5 font-semibold">
            Nome (opcional)
            <input className="campo" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
        </div>
        <label className="grid gap-1.5 font-semibold">
          Papel
          <select
            className="campo"
            value={papel}
            onChange={(e) => {
              setPapel(e.target.value);
              setPermissoes(eu.papeis[e.target.value]?.permissoes ?? []);
            }}
          >
            {papeisDoPainel(eu).map(([id, p]) => (
              <option key={id} value={id}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>
        <Permissoes eu={eu} papel={papel} valor={permissoes} aoMudar={setPermissoes} />
        {erro && (
          <p role="alert" className="text-alerta">
            {erro}
          </p>
        )}
        <button type="submit" disabled={enviando} className="btn-laranja justify-self-start px-5 py-3 text-sm">
          {enviando ? "Criando…" : "Criar o convite"}
        </button>
      </form>
    </Cartao>
  );
}

function LinhaAcesso({
  a,
  eu,
  aoMudar,
  aoLink,
}: {
  a: AcessoTela;
  eu: Eu;
  aoMudar: () => void;
  aoLink: (link: LinkGerado) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [papel, setPapel] = useState(a.papel);
  const [permissoes, setPermissoes] = useState(a.permissoes);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const voce = a.email === eu.email;
  const caminho = `/api/vendedor/acessos/${encodeURIComponent(a.email)}`;

  async function fazer(acao: () => Promise<void>) {
    setErro("");
    setOcupado(true);
    try {
      await acao();
      aoMudar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const rotuloPapel = eu.papeis[a.papel]?.rotulo ?? a.papel;
  const nomes = Object.fromEntries(eu.todas_permissoes.map((p) => [p.id, p.rotulo]));

  return (
    <li className="grid gap-3 border-b border-linha py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {a.nome || a.email}
            {voce && <span className="ml-2 font-mono text-[11px] text-suave">(você)</span>}
          </p>
          {a.nome && <p className="truncate text-xs text-suave">{a.email}</p>}
          <p className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-laranja/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-laranja-2">{rotuloPapel}</span>
            {!a.ativo ? (
              <span className="rounded-full bg-red-400/15 px-2.5 py-0.5 font-mono text-[11px] text-red-300">Bloqueado</span>
            ) : !a.senha_criada ? (
              <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 font-mono text-[11px] text-amber-300">Convite pendente</span>
            ) : (
              <span className="rounded-full bg-ok/15 px-2.5 py-0.5 font-mono text-[11px] text-ok">Ativo</span>
            )}
          </p>
        </div>
        <p className="text-right font-mono text-[11px] text-suave">
          Último acesso: {dataHora(a.ultimo_acesso_em)}
          <br />
          Criado em {dataHora(a.criado_em)}
          {a.criado_por ? ` por ${a.criado_por}` : ""}
        </p>
      </div>
      {a.papel !== "dono" && !editando && (
        <p className="text-xs text-tinta-2">{a.permissoes.map((p) => nomes[p] ?? p).join(" · ") || "Nenhuma área liberada"}</p>
      )}

      {editando && (
        <div className="grid gap-3 rounded-xl border border-linha p-3 text-sm">
          <label className="grid gap-1.5 font-semibold">
            Papel
            <select
              className="campo"
              value={papel}
              onChange={(e) => {
                setPapel(e.target.value);
                setPermissoes(eu.papeis[e.target.value]?.permissoes ?? []);
              }}
            >
              {papeisDoPainel(eu).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </label>
          <Permissoes eu={eu} papel={papel} valor={permissoes} aoMudar={setPermissoes} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={ocupado}
              className="btn-laranja px-4 py-2 text-xs"
              onClick={() =>
                void fazer(async () => {
                  if (papel === "dono" && a.papel !== "dono" && !window.confirm(`${a.email} vai ser dono e poder tudo. Continuar?`)) return;
                  await chamar(caminho, { metodo: "PATCH", corpo: { papel, permissoes } });
                  setEditando(false);
                })
              }
            >
              Salvar
            </button>
            <button type="button" onClick={() => setEditando(false)} className="rounded-full px-4 py-2 text-xs text-suave">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!voce && !editando && (
        <div className="flex flex-wrap gap-2 text-xs">
          <BotaoAcao disabled={ocupado} onClick={() => setEditando(true)}>
            Mudar papel e permissões
          </BotaoAcao>
          <BotaoAcao
            disabled={ocupado}
            onClick={() =>
              void fazer(async () => {
                if (a.ativo && !window.confirm(`Bloquear ${a.email}? A pessoa sai do painel na hora.`)) return;
                await chamar(caminho, { metodo: "PATCH", corpo: { ativo: !a.ativo } });
              })
            }
          >
            {a.ativo ? "Bloquear" : "Desbloquear"}
          </BotaoAcao>
          {a.ativo && (
            <BotaoAcao
              disabled={ocupado}
              onClick={() =>
                void fazer(async () => {
                  const r = await chamar<{ link: { tipo: "convite" | "senha"; url: string } }>(`${caminho}/link`, { corpo: {} });
                  aoLink({ email: a.email, ...r.link });
                })
              }
            >
              {a.senha_criada ? "Link de senha nova" : "Novo link de convite"}
            </BotaoAcao>
          )}
          {a.senha_criada && (
            <BotaoAcao
              disabled={ocupado}
              onClick={() =>
                void fazer(async () => {
                  if (!window.confirm(`Tirar o app autenticador de ${a.email}? No próximo login, a pessoa cadastra outro celular.`)) return;
                  await chamar(`${caminho}/app`, { metodo: "DELETE" });
                })
              }
            >
              Trocar o celular (app)
            </BotaoAcao>
          )}
          <BotaoAcao
            perigo
            disabled={ocupado}
            onClick={() =>
              void fazer(async () => {
                if (!window.confirm(`Remover o acesso de ${a.email}? A conta é apagada; para voltar, só com um convite novo.`)) return;
                await chamar(caminho, { metodo: "DELETE" });
              })
            }
          >
            Remover
          </BotaoAcao>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-sm text-alerta">
          {erro}
        </p>
      )}
    </li>
  );
}

function BotaoAcao({ perigo, ...props }: { perigo?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-full border px-3 py-1.5 font-bold disabled:opacity-50 ${
        perigo ? "border-red-400/40 text-red-300 hover:border-red-400" : "border-linha-2 text-tinta-2 hover:border-laranja hover:text-tinta"
      }`}
    />
  );
}

export function AbaAcessos({ eu }: { eu: Eu }) {
  const [acessos, setAcessos] = useState<AcessoTela[] | null>(null);
  const [erro, setErro] = useState("");
  const [link, setLink] = useState<LinkGerado | null>(null);

  const carregar = useCallback(() => {
    chamar<{ acessos: AcessoTela[] }>("/api/vendedor/acessos")
      .then((r) => setAcessos(r.acessos))
      .catch((e: Error) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <div className="grid gap-5">
      <header>
        <h1 className="font-display text-4xl uppercase">Acessos</h1>
        <p className="mt-1 text-sm text-tinta-2">
          Quem entra no painel e o que cada um pode fazer. Todo acesso entra com senha e app autenticador; bloquear derruba a
          pessoa na hora. Tudo fica nas últimas mudanças (Configurações).
        </p>
      </header>
      {link && <MostrarLink link={link} aoFechar={() => setLink(null)} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Cartao titulo="Quem tem acesso">
          {erro && (
            <p role="alert" className="text-sm text-alerta">
              {erro}
            </p>
          )}
          {!acessos ? (
            <p className="text-sm text-suave">Carregando…</p>
          ) : (
            <ul>
              {acessos.map((a) => (
                <LinhaAcesso key={a.email} a={a} eu={eu} aoMudar={carregar} aoLink={setLink} />
              ))}
            </ul>
          )}
        </Cartao>
        <Convidar
          eu={eu}
          aoConvidar={(l) => {
            setLink(l);
            carregar();
          }}
        />
      </div>
    </div>
  );
}

export function AbaConta({ eu, aoSair }: { eu: Eu; aoSair: () => void }) {
  const nomes = Object.fromEntries(eu.todas_permissoes.map((p) => [p.id, p.rotulo]));
  return (
    <div className="grid gap-5">
      <header>
        <h1 className="font-display text-4xl uppercase">Minha conta</h1>
      </header>
      <div className="grid gap-5 lg:grid-cols-2">
        <Cartao titulo="Seu acesso">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-suave">E-mail</dt>
              <dd className="font-semibold">{eu.email}</dd>
            </div>
            <div>
              <dt className="text-suave">Papel</dt>
              <dd className="font-semibold">{eu.papeis[eu.papel]?.rotulo ?? eu.papel}</dd>
            </div>
            <div>
              <dt className="text-suave">Pode ver e fazer</dt>
              <dd className="text-tinta-2">{eu.permissoes.map((p) => nomes[p] ?? p).join(" · ")}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-suave">Trocou de celular? Peça ao dono da loja para tirar o app antigo; no próximo login, você cadastra o novo.</p>
        </Cartao>
        <TrocarSenha senha={eu.email} aoTrocar={aoSair} />
      </div>
    </div>
  );
}
