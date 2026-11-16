// O que sobrou da área do vendedor (as abas que ainda estão no Python): servidor/python.ts. As rotas com arquivo próprio
// nesta pasta vêm antes desta; área que não está em AREAS_NO_PYTHON responde 404.
import { rota } from "../../../servidor/http";
import { repassarAoPython } from "../../../servidor/python";

const repassar = rota(repassarAoPython);

export const GET = repassar;
export const POST = repassar;
export const PUT = repassar;
export const PATCH = repassar;
export const DELETE = repassar;
