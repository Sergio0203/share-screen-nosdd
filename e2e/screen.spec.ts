import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, newPage, statusIcons, turnOn } from "./helpers";

/**
 * Compartilhamento de tela de ponta a ponta em Chromium real. Com
 * --use-fake-ui-for-media-stream o seletor escolhe a tela sozinho.
 */

const screenOf = (page: Page, name: string) => page.getByRole("figure", { name: `Tela de ${name}` });

/** O vídeo da tela tem tamanho e está recebendo quadros novos? */
async function isLive(page: Page, name: string): Promise<boolean> {
  const video = screenOf(page, name).locator("video");
  if ((await video.count()) === 0) return false;
  return video.evaluate(async (el: HTMLVideoElement) => {
    const frames = () => el.getVideoPlaybackQuality().totalVideoFrames;
    const before = frames();
    // Até 1 s esperando um quadro novo (com a máquina carregada o fps cai).
    for (let i = 0; i < 10 && frames() <= before; i++) await new Promise((r) => setTimeout(r, 100));
    return el.videoWidth > 0 && frames() > before;
  });
}

/** Guarda as trilhas de tela para o teste simular o botão nativo do navegador. */
async function captureScreenTracks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __screenTracks: MediaStreamTrack[] };
    w.__screenTracks = [];
    const original = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = async function (...args) {
      const stream = await original.apply(this, args);
      w.__screenTracks.push(...stream.getVideoTracks());
      return stream;
    };
  });
}

/** O que o navegador faz no "Parar compartilhamento" nativo: encerra a trilha e dispara "ended". */
async function clickNativeStop(page: Page) {
  await page.evaluate(() => {
    for (const t of (window as unknown as { __screenTracks: MediaStreamTrack[] }).__screenTracks) {
      t.stop();
      t.dispatchEvent(new Event("ended"));
    }
  });
}

async function roomWith(...names: string[]): Promise<Page[]> {
  const pages: Page[] = [];
  for (const _ of names) {
    const page = await newPage(FAKE_MEDIA);
    await captureScreenTracks(page);
    pages.push(page);
  }
  const url = await createRoom(pages[0]);
  await enter(pages[0], names[0]);
  for (let i = 1; i < names.length; i++) {
    await pages[i].goto(url);
    await enter(pages[i], names[i]);
  }
  return pages;
}

test("os outros começam a ver em até 5 s; parar pelo botão do app some em até 3 s", async () => {
  const [ana, bia, caio] = await roomWith("Ana", "Bia", "Caio");

  await turnOn(ana, "screen");
  const started = Date.now();
  await expect(ana.getByText("Você está compartilhando a tela.")).toBeVisible();
  for (const page of [bia, caio]) {
    await expect.poll(() => isLive(page, "Ana"), { timeout: 5000 }).toBe(true);
  }
  console.log(`tela visível para todos em ${Date.now() - started} ms`);
  await expect(statusIcons(bia, "Ana").and(bia.getByRole("img", { name: "compartilhando a tela" }))).toBeVisible();

  await ana.getByRole("button", { name: "Parar compartilhamento" }).click();
  for (const page of [bia, caio]) await expect(screenOf(page, "Ana")).toHaveCount(0, { timeout: 3000 });
  await expect(ana.getByRole("button", { name: "Compartilhar tela" })).toBeVisible();
});

test("parar pelo botão nativo do navegador some para os outros em até 3 s", async () => {
  const [ana, bia] = await roomWith("Ana", "Bia");
  await turnOn(ana, "screen");
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 5000 }).toBe(true);

  await clickNativeStop(ana);
  await expect(screenOf(bia, "Ana")).toHaveCount(0, { timeout: 3000 });
  await expect(ana.getByRole("button", { name: "Compartilhar tela" })).toBeVisible();
  await expect(ana.getByText("Você está compartilhando a tela.")).toHaveCount(0);

  // E dá para compartilhar de novo.
  await turnOn(ana, "screen");
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 5000 }).toBe(true);
});

test("a tela aparece em destaque, maior que as câmeras, e vai para tela cheia (sai com Esc)", async () => {
  const [ana, bia] = await roomWith("Ana", "Bia");
  await turnOn(ana, "cam");
  await turnOn(ana, "screen");
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 5000 }).toBe(true);
  const camera = bia.getByRole("figure", { name: "Câmera de Ana" });
  await expect(camera).toBeVisible();

  const screenBox = (await screenOf(bia, "Ana").boundingBox())!;
  const cameraBox = (await camera.boundingBox())!;
  expect(screenBox.width * screenBox.height).toBeGreaterThan(4 * cameraBox.width * cameraBox.height);

  await screenOf(bia, "Ana").getByRole("button", { name: "Tela cheia" }).click();
  await expect.poll(() => bia.evaluate(() => document.fullscreenElement?.getAttribute("aria-label"))).toBe("Tela de Ana");
  await expect(screenOf(bia, "Ana").getByRole("button", { name: "Sair da tela cheia" })).toBeVisible();

  await bia.keyboard.press("Escape");
  await expect.poll(() => bia.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(screenOf(bia, "Ana").getByRole("button", { name: "Tela cheia" })).toBeVisible();
});

test("quem entra depois vê a tela que já estava sendo compartilhada", async () => {
  const [ana] = await roomWith("Ana");
  await turnOn(ana, "screen");
  await expect(ana.getByText("Você está compartilhando a tela.")).toBeVisible();

  const bia = await newPage(FAKE_MEDIA);
  await bia.goto(ana.url());
  await enter(bia, "Bia");
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 5000 }).toBe(true);
});

test("permissão negada explica e a pessoa continua assistindo", async () => {
  const [ana, bia] = await roomWith("Ana", "Bia");
  // Simula o navegador recusando (o seletor real não aparece no Chromium de teste).
  await bia.evaluate(() => {
    MediaDevices.prototype.getDisplayMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });

  await bia.getByRole("button", { name: "Compartilhar tela" }).click();
  await expect(bia.getByRole("alert")).toContainText("A tela não foi compartilhada.");
  await expect(bia.getByRole("button", { name: "Compartilhar tela" })).toBeVisible();

  await turnOn(ana, "screen");
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 5000 }).toBe(true);
});

test("navegador sem compartilhamento de tela (celular) explica e a pessoa continua assistindo", async () => {
  const [ana, bia] = await roomWith("Ana", "Bia");
  await bia.evaluate(() => {
    // @ts-expect-error simulando navegador de celular, que não tem a função
    delete MediaDevices.prototype.getDisplayMedia;
  });

  await bia.getByRole("button", { name: "Compartilhar tela" }).click();
  await expect(bia.getByRole("alert")).toContainText("Este navegador não permite compartilhar a tela.");

  await turnOn(ana, "screen");
  await expect.poll(() => isLive(bia, "Ana"), { timeout: 5000 }).toBe(true);
});
