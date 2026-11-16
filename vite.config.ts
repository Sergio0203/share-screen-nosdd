/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3000", ws: true } },
  },
  build: { outDir: "../dist/client", emptyOutDir: true },
  test: {
    root: ".",
    include: ["client/src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    setupFiles: ["client/src/test-setup.ts"],
  },
});
