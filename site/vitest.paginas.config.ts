/// <reference types="vitest/config" />
// Os testes das páginas Astro (testes/paginas): renderizam os .astro com o Container API, por isso usam a configuração
// do Astro (getViteConfig). O .env não é lido nos testes (astro.config.mjs confere o VITEST).
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    include: ["testes/paginas/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { DATABASE_URL: "" },
  },
});
