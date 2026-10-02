/// <reference types="vitest" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: { chunkSizeWarningLimit: 50000, target: "es2022" },
  server: { port: 5200, strictPort: true },
  preview: { port: 5200, strictPort: true },
  test: { environment: "node" },
});
