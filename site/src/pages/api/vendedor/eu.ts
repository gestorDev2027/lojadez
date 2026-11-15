import { rota, vendedor } from "../../../servidor/http";

export const GET = rota(async (ctx) => ({ email: await vendedor(ctx) }));
