import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev では Vite(5173)から API サーバ(8787)へ /api をプロキシ。
// build 時は web/dist へ出力し、本番は Node サーバ(src/server)が dist を配信する。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
