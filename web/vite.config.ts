import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// No desenvolvimento, a API e o simulador de pagamento estão no servidor Python (porta 8000).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000", "/simulador": "http://localhost:8000" },
  },
});
