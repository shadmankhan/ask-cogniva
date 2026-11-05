import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  root: "client",
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.PORT ?? loadEnv(mode, process.cwd(), "PORT").PORT ?? 3001}` },
  },
  build: { outDir: "../dist", emptyOutDir: true },
}));
