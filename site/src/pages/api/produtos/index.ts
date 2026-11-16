// A lista da vitrine: o kit de lâminas e os produtos ativos (destaque, categoria, selo, vendidos).
import { rotaPublica } from "../../../servidor/http";
import { vitrine } from "../../../servidor/produtos";

export const GET = rotaPublica(async () => vitrine());