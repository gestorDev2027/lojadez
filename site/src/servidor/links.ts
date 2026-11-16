// O endereço do link de convite ou de troca de senha. O código vai depois do "#": não chega ao servidor nem aos logs
// (a tela lê e manda no corpo do POST /api/vendedor/link).
import { amb } from "./ambiente";
import type { Link } from "./acesso";

export function comUrl(request: Request, link: Link) {
  const origem = (amb("SITE_URL") ?? new URL(request.url).origin).replace(/\/+$/, "");
  return { ...link, url: `${origem}/vendedor#${link.tipo}=${link.token_hash}` };
}
