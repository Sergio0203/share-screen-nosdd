import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, newPage, screenStats, trackPeerConnections } from "./helpers";

/**
 * Qualidade do compartilhamento conferida nas estatísticas do WebRTC (as
 * mesmas de chrome://webrtc-internals): resolução e fps enviados/recebidos.
 *
 * A tela falsa do Chromium de teste é 1920×1080 e aceita até 60 fps, mas o
 * Chromium sem janela só entrega ~20 quadros por segundo de captura. Então o
 * fps é conferido pelo que está configurado (captura e encoder) e pelo teto
 * respeitado; 60 fps reais só aparecem numa máquina com tela de verdade.
 */

async function sharing(): Promise<{ ana: Page; bia: Page }> {
  const ana = await newPage(FAKE_MEDIA);
  const bia = await newPage(FAKE_MEDIA);
  await trackPeerConnections(ana);
  await trackPeerConnections(bia);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");
  return { ana, bia };
}

const picker = (page: Page) => page.getByRole("combobox", { name: "Qualidade do compartilhamento" });
const active = (page: Page) => page.getByText(/Qualidade ativa/);

/** Espera o envio e o recebimento chegarem à resolução esperada. */
async function expectResolution(ana: Page, bia: Page, width: number, height: number) {
  await expect
    .poll(async () => (await screenStats(ana, "send"))?.height, { timeout: 15_000, message: "altura enviada" })
    .toBe(height);
  await expect
    .poll(async () => (await screenStats(bia, "receive"))?.height, { timeout: 15_000, message: "altura recebida" })
    .toBe(height);
  expect((await screenStats(ana, "send"))!.width).toBe(width);
}

test("antes de compartilhar há 720p 30, 1080p 30 e 1080p 60; a escolhida é a enviada", async () => {
  const { ana, bia } = await sharing();
  await expect(picker(ana).getByRole("option")).toHaveText(["720p 30 fps", "1080p 30 fps", "1080p 60 fps"]);

  await picker(ana).selectOption({ label: "1080p 60 fps" });
  await ana.getByRole("button", { name: "Compartilhar tela" }).click();
  await expect(active(ana)).toContainText("Qualidade ativa: 1080p 60 fps");
  await expect(active(ana)).toContainText("capturando 1920×1080 a 60 fps");

  await expectResolution(ana, bia, 1920, 1080);
  expect((await screenStats(ana, "send"))!.maxFramerate).toBe(60);
});

test("trocar durante o compartilhamento muda resolução e fps enviados, sem parar", async () => {
  test.setTimeout(90_000);
  const { ana, bia } = await sharing();
  await picker(ana).selectOption({ label: "720p 30 fps" });
  await ana.getByRole("button", { name: "Compartilhar tela" }).click();

  // 720p 30 fps
  await expect(active(ana)).toContainText("Qualidade ativa: 720p 30 fps · capturando 1280×720 a 30 fps");
  await expectResolution(ana, bia, 1280, 720);
  const first = (await screenStats(ana, "send"))!;
  expect(first.maxFramerate).toBe(30);
  expect(first.fps).toBeLessThanOrEqual(31);

  // 1080p 30 fps
  await picker(ana).selectOption({ label: "1080p 30 fps" });
  await expect(active(ana)).toContainText("Qualidade ativa: 1080p 30 fps · capturando 1920×1080 a 30 fps");
  await expectResolution(ana, bia, 1920, 1080);
  const second = (await screenStats(ana, "send"))!;
  expect(second.maxFramerate).toBe(30);
  expect(second.fps).toBeLessThanOrEqual(31);

  // 1080p 60 fps
  await picker(ana).selectOption({ label: "1080p 60 fps" });
  await expect(active(ana)).toContainText("Qualidade ativa: 1080p 60 fps · capturando 1920×1080 a 60 fps");
  await expect.poll(async () => (await screenStats(ana, "send"))?.maxFramerate).toBe(60);

  // E de volta para 720p.
  await picker(ana).selectOption({ label: "720p 30 fps" });
  await expectResolution(ana, bia, 1280, 720);

  // Sem parar e recomeçar: mesma trilha o tempo todo, quadros sempre subindo.
  const last = (await screenStats(ana, "send"))!;
  expect(last.trackId).toBe(first.trackId);
  expect(last.framesSent!).toBeGreaterThan(second.framesSent!);
  await expect(ana.getByRole("button", { name: "Parar compartilhamento" })).toBeVisible();
});

test("a tela sai na qualidade escolhida logo no começo, sem demorar para sair do borrão", async () => {
  const { ana, bia } = await sharing();
  await picker(ana).selectOption({ label: "1080p 30 fps" });
  await ana.getByRole("button", { name: "Compartilhar tela" }).click();
  const started = Date.now();
  await expectResolution(ana, bia, 1920, 1080);
  console.log(`1080p chegou a quem assiste em ${Date.now() - started} ms`);
  expect(Date.now() - started).toBeLessThan(5000);
});
