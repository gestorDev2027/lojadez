import { useState, type FormEvent } from "react";
import { chamar } from "../api";

// Entrar no painel: e-mail e senha e, sempre, o código do app autenticador. Quem ainda não tem o app cadastra na hora,
// lendo o QR code. A senha fica só na memória desta tela entre os passos (o servidor confere de novo a cada passo).
// E a tela do link de convite ou de troca de senha (/vendedor#convite=... ou #senha=...), onde a pessoa cria a senha.

export interface Eu {
  email: string;
  nome: string | null;
  papel: string;
  permissoes: string[];
  papeis: Record<string, { rotulo: string; permissoes: string[] }>;
  todas_permissoes: { id: string; rotulo: string }[];
}

type Resposta =
  | { etapa: "pronto" }
  | { etapa: "codigo" }
  | { etapa: "cadastrar_app"; fator_id: string; qr: string; segredo: string };

const imagemDoQr = (qr: string) => (qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`);

export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [etapa, setEtapa] = useState<"senha" | "codigo" | "cadastrar_app">("senha");
  const [app, setApp] = useState<{ fator_id: string; qr: string; segredo: string } | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await chamar<Resposta>("/api/vendedor/entrar", {
        corpo: { email, senha, codigo: etapa === "senha" ? "" : codigo, fator_id: app?.fator_id ?? "" },
      });
      if (r.etapa === "pronto") {
        setSenha("");
        return aoEntrar();
      }
      setCodigo("");
      if (r.etapa === "cadastrar_app") setApp({ fator_id: r.fator_id, qr: r.qr, segredo: r.segredo });
      setEtapa(r.etapa);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function voltar() {
    setEtapa("senha");
    setApp(null);
    setCodigo("");
    setErro("");
  }

  const campoCodigo = (
    <label className="grid gap-1.5 text-sm font-medium">
      Código de 6 números do app
      <input
        className="campo text-center font-mono text-xl tracking-[.4em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
      />
    </label>
  );

  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <form className="grid gap-3 rounded-2xl border border-linha bg-cartao p-6" onSubmit={(e) => void enviar(e)}>
        <h1 className="text-xl font-bold">Área do vendedor</h1>
        {etapa === "senha" ? (
          <>
            <label className="grid gap-1.5 text-sm font-medium">
              E-mail
              <input className="campo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Senha
              <input className="campo" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
            </label>
          </>
        ) : etapa === "codigo" ? (
          <>
            <p className="text-sm text-tinta-2">Abra o app autenticador no celular e digite o código da loja.</p>
            {campoCodigo}
          </>
        ) : (
          app && (
            <>
              <p className="text-sm text-tinta-2">
                Para proteger o painel, todo acesso usa um app autenticador (Google Authenticator, Microsoft Authenticator,
                1Password...). Cadastre uma vez só:
              </p>
              <ol className="ml-5 list-decimal text-sm text-tinta-2">
                <li>No app, toque em adicionar e leia o QR code.</li>
                <li>Digite abaixo o código de 6 números que aparece.</li>
              </ol>
              <img src={imagemDoQr(app.qr)} alt="QR code para cadastrar o app autenticador" className="mx-auto size-48 rounded-xl bg-white p-2" />
              <p className="text-xs text-suave">
                Não consegue ler? Digite esta chave no app:{" "}
                <span className="font-mono break-all text-tinta select-all">{app.segredo}</span>
              </p>
              {campoCodigo}
            </>
          )
        )}
        {erro && (
          <p role="alert" className="text-sm text-alerta">
            {erro}
          </p>
        )}
        <button type="submit" disabled={enviando} className="btn-laranja px-5 py-3 text-sm">
          {enviando ? "Conferindo…" : etapa === "senha" ? "Continuar" : etapa === "codigo" ? "Entrar" : "Cadastrar e entrar"}
        </button>
        {etapa !== "senha" && (
          <button type="button" onClick={voltar} className="text-sm text-suave hover:text-tinta">
            Voltar
          </button>
        )}
      </form>
    </section>
  );
}

export interface LinkDaUrl {
  tipo: "convite" | "senha";
  token_hash: string;
}

/** O link do convite ou da troca de senha. Lido, sai do endereço (não fica no histórico do navegador). */
export function lerLinkDaUrl(): LinkDaUrl | null {
  const m = /^#(convite|senha)=([A-Za-z0-9_-]{10,200})$/.exec(window.location.hash);
  if (!m) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return { tipo: m[1] as LinkDaUrl["tipo"], token_hash: m[2] };
}

export function CriarSenha({ link, aoTerminar }: { link: LinkDaUrl; aoTerminar: () => void }) {
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState("");

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 10) return setErro("A senha precisa ter pelo menos 10 caracteres.");
    if (senha !== repetir) return setErro("As duas senhas estão diferentes.");
    setEnviando(true);
    try {
      const r = await chamar<{ email: string }>("/api/vendedor/link", { corpo: { ...link, senha } });
      setSenha("");
      setRepetir("");
      setPronto(r.email);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (pronto)
    return (
      <section className="mx-auto max-w-sm px-4 py-12">
        <div className="grid gap-3 rounded-2xl border border-linha bg-cartao p-6">
          <h1 className="text-xl font-bold">Senha criada</h1>
          <p className="text-sm text-tinta-2">
            Agora entre com <strong className="text-tinta">{pronto}</strong> e a senha nova. No primeiro acesso, você cadastra o app
            autenticador no celular.
          </p>
          <button type="button" onClick={aoTerminar} className="btn-laranja px-5 py-3 text-sm">
            Entrar
          </button>
        </div>
      </section>
    );

  const tipo = ver ? "text" : "password";
  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <form className="grid gap-3 rounded-2xl border border-linha bg-cartao p-6" onSubmit={(e) => void enviar(e)}>
        <h1 className="text-xl font-bold">{link.tipo === "convite" ? "Bem-vindo ao painel" : "Senha nova"}</h1>
        <p className="text-sm text-tinta-2">
          {link.tipo === "convite" ? "Crie a sua senha para entrar no painel da loja." : "Crie a senha nova do seu acesso ao painel."} O link
          vale uma vez só.
        </p>
        <label className="grid gap-1.5 text-sm font-medium">
          Senha (pelo menos 10 caracteres)
          <input className="campo" type={tipo} autoComplete="new-password" required minLength={10} value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Repita a senha
          <input className="campo" type={tipo} autoComplete="new-password" required value={repetir} onChange={(e) => setRepetir(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-tinta-2">
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
          Mostrar a senha
        </label>
        {erro && (
          <p role="alert" className="text-sm text-alerta">
            {erro}
          </p>
        )}
        <button type="submit" disabled={enviando} className="btn-laranja px-5 py-3 text-sm">
          {enviando ? "Salvando…" : "Criar a senha"}
        </button>
        <button type="button" onClick={aoTerminar} className="text-sm text-suave hover:text-tinta">
          Já tenho senha: entrar
        </button>
      </form>
    </section>
  );
}
