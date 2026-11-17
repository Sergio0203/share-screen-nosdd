import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Os testes abrem vários navegadores com vídeo e áudio reais; com a máquina
  // carregada, um prazo apertado pode estourar. Uma nova tentativa separa isso
  // de defeito real: o relatório marca como "flaky" o que só passou na 2ª vez.
  retries: 1,
  use: { baseURL: "http://localhost:5173" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
