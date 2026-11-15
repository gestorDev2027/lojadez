import { defineConfig } from "vitest/config";

// Os testes não usam o .env: cada um monta um banco em memória (testes/apoio.ts).
export default defineConfig({
  test: {
    include: ["testes/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { DATABASE_URL: "" },
  },
});
