import { rotaPublica } from "../../servidor/http";
import { resumoDaLoja } from "../../servidor/loja";

export const GET = rotaPublica(async () => resumoDaLoja());