import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  test: {
    environment: "node",
  },
});
