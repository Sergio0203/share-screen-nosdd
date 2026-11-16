import { expect, test, type Page } from "@playwright/test";
import { createRoom, DENY_MEDIA, enter, FAKE_MEDIA, newPage, statusIcons } from "./helpers";

/**
 * Câmera de ponta a ponta em Chromium real. A câmera falsa do Chrome gera um
 * vídeo animado; conferimos que os quadros chegam (e continuam chegando).
 */

const camStatus = (page: Page, name: string) => statusIcons(page, name).nth(1);
const tileOf = (page: Page, name: string) => page.getByRole("figure", { name: `Câmera de ${name}` });

/** O vídeo do bloco tem tamanho e está recebendo quadros novos? */
async function isLive(page: Page, name: string): Promise<boolean> {
  const video = tileOf(page, name).locator("video");
  if ((await video.count()) === 0) return false;
  return video.evaluate(async (el: HTMLVideoElement) => {
    const frames = () => el.getVideoPlaybackQuality().totalVideoFrames;
    const before = frames();
    await new Promise((r) => setTimeout(r, 500));
    return el.videoWidth > 0 && frames() > before;
  });
}

test("quem liga a câmera é visto por todos, com o nome; desligar some em até 3 s", async () => {
  const ana = await newPage(FAKE_MEDIA);
  const bia = await newPage(FAKE_MEDIA);
  const caio = await newPage(FAKE_MEDIA);

  const url = await createRoom(ana);
  await enter(ana, "Ana");
  for (const [page, name] of [[bia, "Bia"], [caio, "Caio"]] as const) {
    await page.goto(url);
    await enter(page, name);
  }

  // Entram com a câmera desligada: ninguém vê vídeo.
  await expect(ana.getByRole("button", { name: "Ligar câmera" })).toBeVisible();
  await expect(camStatus(bia, "Ana")).toHaveAccessibleName("câmera desligada");
  await expect(bia.getByRole("figure")).toHaveCount(0);

  // Ana liga: ela se vê, e Bia e Caio veem o vídeo dela com o nome.
  await ana.getByRole("button", { name: "Ligar câmera" }).click();
  await expect(ana.getByRole("figure", { name: "Sua câmera" })).toContainText("Ana (você)");
  for (const page of [bia, caio]) {
    await expect(tileOf(page, "Ana")).toContainText("Ana");
    await expect(camStatus(page, "Ana")).toHaveAccessibleName("câmera ligada");
    await expect.poll(() => isLive(page, "Ana"), { timeout: 10_000 }).toBe(true);
  }

  // Ligar a câmera não liga o microfone.
  await expect(statusIcons(bia, "Ana").first()).toHaveAccessibleName("microfone desligado");

  // Ana desliga: o vídeo some para todos em até 3 s.
  await ana.getByRole("button", { name: "Desligar câmera" }).click();
  await expect(ana.getByRole("figure")).toHaveCount(0);
  for (const page of [bia, caio]) {
    await expect(tileOf(page, "Ana")).toHaveCount(0, { timeout: 3000 });
  }

  // Religa sem problema.
  await ana.getByRole("button", { name: "Ligar câmera" }).click();
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 10_000 }).toBe(true);
});

test("várias câmeras ao mesmo tempo, e quem entra depois vê quem já estava com a câmera ligada", async () => {
  const ana = await newPage(FAKE_MEDIA);
  const bia = await newPage(FAKE_MEDIA);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");

  await Promise.all([ana, bia].map((p) => p.getByRole("button", { name: "Ligar câmera" }).click()));
  await expect.poll(() => isLive(ana, "Bia"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 10_000 }).toBe(true);

  const caio = await newPage(FAKE_MEDIA);
  await caio.goto(url);
  await enter(caio, "Caio");
  await expect.poll(() => isLive(caio, "Ana"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => isLive(caio, "Bia"), { timeout: 10_000 }).toBe(true);

  // Quem sai da sala com a câmera ligada some da tela dos outros.
  await bia.close();
  await expect(tileOf(ana, "Bia")).toHaveCount(0, { timeout: 3000 });
  await expect(tileOf(caio, "Bia")).toHaveCount(0, { timeout: 3000 });
});

test("permissão da câmera negada mostra como liberar e a pessoa continua vendo os outros", async () => {
  const ana = await newPage(FAKE_MEDIA);
  const bia = await newPage(DENY_MEDIA);

  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");

  await bia.getByRole("button", { name: "Ligar câmera" }).click();
  const alert = bia.getByRole("alert");
  await expect(alert).toContainText("O navegador bloqueou a câmera.");
  await expect(alert).toContainText("Câmera para Permitir");
  await expect(bia.getByRole("button", { name: "Ligar câmera" })).toBeVisible();
  await expect(camStatus(ana, "Bia")).toHaveAccessibleName("câmera desligada");

  // O resto funciona: Bia vê a câmera da Ana.
  await ana.getByRole("button", { name: "Ligar câmera" }).click();
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 10_000 }).toBe(true);
});
