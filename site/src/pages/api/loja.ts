import { rota } from "../../servidor/http";
import { resumoDaLoja } from "../../servidor/loja";

export const GET = rota(async () => resumoDaLoja());