// O endereço do link de convite ou de troca de senha: o do próprio site onde o dono gerou o link (no Render, o
// endereço público; no computador, o localhost do Astro). O código vai depois do "#": não chega ao servidor nem aos
// logs (a tela lê e manda no corpo do POST /api/vendedor/link).
import type { Link } from "./acesso";

export function comUrl(request: Request, link: Link) {
  return { ...link, url: `${new URL(request.url).origin}/vendedor#${link.tipo}=${link.token_hash}` };
}
