import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A landing page (public/loja.html + public/assets) é estática e usa /assets; o app React (checkout, obrigado,
// vendedor) vai para /app-assets para não misturar. No desenvolvimento, a API está no servidor Python (porta 8000).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { assetsDir: "app-assets" },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/simulador": "http://localhost:8000",
      "/lp-config.js": "http://localhost:8000",
    },
  },
});
