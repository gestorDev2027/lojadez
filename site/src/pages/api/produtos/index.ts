// A lista da vitrine: o kit de lâminas e os produtos ativos (destaque, categoria, selo, vendidos).
import { rota } from "../../../servidor/http";
import { vitrine } from "../../../servidor/produtos";

export const GET = rota(async () => vitrine());