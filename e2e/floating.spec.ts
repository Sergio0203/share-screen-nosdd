import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, launch, newPage, turnOn } from "./helpers";

/**
 * Janela flutuante (Document Picture-in-Picture) de quem transmite, em
 * Chromium real. O Playwright enxerga a janela como mais uma página.
 */

async function room() {
  const browser = await launch(FAKE_MEDIA);
  const ana = await newPage(FAKE_MEDIA, browser);
  const bia = await newPage(FAKE_MEDIA, browser);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");
  await turnOn(ana, "screen");
  await expect(bia.getByRole("figure", { name: "Tela de Ana" })).toBeVisible();
  return { ana, bia };
}

async function openFloating(ana: Page): Promise<Page> {
  const [pip] = await Promise.all([
    ana.context().waitForEvent("page"),
    ana.getByRole("button", { name: "Abrir janela flutuante" }).click(),
  ]);
  await expect(pip.getByRole("figure", { name: "Sua tela" })).toBeVisible();
  return pip;
}

async function layer(page: Page, label: string) {
  const l = page.getByRole("figure", { name: label }).getByTestId("notes-layer");
  await expect(l).toBeVisible();
  return (await l.boundingBox())!;
}

async function notePos(page: Page, label: string, author: string) {
  const box = await layer(page, label);
  const n = await page.getByRole("figure", { name: label }).getByRole("note", { name: `Recado de ${author}` }).boundingBox();
  return n && { x: (n.x - box.x) / box.width, y: (n.y - box.y) / box.height };
}

async function biaWrites(bia: Page, x: number, y: number, text: string) {
  const box = await layer(bia, "Tela de Ana");
  await bia.mouse.move(box.x + x * box.width, box.y + y * box.height);
  await bia.keyboard.press("/");
  const input = bia.getByRole("textbox", { name: "Recado na tela" });
  await input.fill(text);
  await input.press("Enter");
}

const near = (pos: { x: number; y: number } | null, x: number, y: number) =>
  !!pos && Math.abs(pos.x - x) < 0.01 && Math.abs(pos.y - y) < 0.01;

test("a janela flutuante mostra a própria tela com os recados, no mesmo ponto e com o mesmo comportamento", async () => {
  const { ana, bia } = await room();
  const pip = await openFloating(ana);

  // A miniatura está viva (recebendo quadros).
  await expect
    .poll(() =>
      pip.getByRole("figure", { name: "Sua tela" }).locator("video").evaluate(async (v: HTMLVideoElement) => {
        const f = v.getVideoPlaybackQuality().totalVideoFrames;
        await new Promise((r) => setTimeout(r, 500));
        return v.videoWidth > 0 && v.getVideoPlaybackQuality().totalVideoFrames > f;
      }),
    )
    .toBe(true);

  // Recado da Bia aparece na janela flutuante no mesmo ponto da imagem.
  await biaWrites(bia, 0.3, 0.4, "atrás de você!");
  await expect(pip.getByRole("note", { name: "Recado de Bia" })).toHaveText("Biaatrás de você!");
  expect(near(await notePos(pip, "Sua tela", "Bia"), 0.3, 0.4)).toBe(true);

  // Segue o cursor de quem escreveu.
  const box = await layer(bia, "Tela de Ana");
  await bia.mouse.move(box.x + 0.55 * box.width, box.y + 0.5 * box.height, { steps: 10 });
  await expect.poll(async () => near(await notePos(pip, "Sua tela", "Bia"), 0.55, 0.5), { timeout: 2000 }).toBe(true);

  // A janela pode ser redimensionada: a imagem acompanha e o recado continua no mesmo ponto.
  const before = await layer(pip, "Sua tela");
  await pip.setViewportSize({ width: 360, height: 220 });
  await expect.poll(async () => (await layer(pip, "Sua tela")).width).toBeLessThan(before.width);
  expect(near(await notePos(pip, "Sua tela", "Bia"), 0.55, 0.5)).toBe(true);
  const after = await layer(pip, "Sua tela");
  expect(after.width).toBeLessThanOrEqual(360 + 1);
  expect(after.height).toBeLessThanOrEqual(220 + 1);

  // Some depois de 5 s (com fade), como na aba.
  await expect(pip.getByRole("note", { name: "Recado de Bia" })).toHaveClass(/fading/, { timeout: 6000 });
  await expect(pip.getByRole("note")).toHaveCount(0, { timeout: 2000 });
});

test("na janela flutuante só se lê: / não abre nada e não há tela cheia", async () => {
  const { ana } = await room();
  const pip = await openFloating(ana);
  const box = await layer(pip, "Sua tela");
  await pip.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pip.keyboard.press("/");
  await expect(pip.getByRole("textbox")).toHaveCount(0);
  await expect(ana.getByRole("textbox", { name: "Recado na tela" })).toHaveCount(0);
  await expect(pip.getByRole("button", { name: "Tela cheia" })).toHaveCount(0);
});

test("fechar a janela não para o compartilhamento; parar o compartilhamento fecha a janela", async () => {
  const { ana, bia } = await room();
  let pip = await openFloating(ana);
  await pip.close(); // como clicar no X da janela
  await expect(ana.getByRole("button", { name: "Abrir janela flutuante" })).toBeVisible();
  await expect(ana.getByRole("button", { name: "Parar compartilhamento" })).toBeVisible();
  // Bia continua vendo a tela da Ana.
  await expect(bia.getByRole("figure", { name: "Tela de Ana" })).toBeVisible();
  await bia.waitForTimeout(1000);
  await expect(bia.getByRole("figure", { name: "Tela de Ana" })).toBeVisible();

  // Reabre; parar o compartilhamento fecha a janela junto.
  pip = await openFloating(ana);
  const closed = pip.waitForEvent("close");
  await ana.getByRole("button", { name: "Parar compartilhamento" }).click();
  await closed;
  await expect(ana.getByRole("button", { name: /janela flutuante/ })).toHaveCount(0);
});

test("sem suporte a janela flutuante, o botão aparece desabilitado com explicação", async () => {
  const browser = await launch(FAKE_MEDIA);
  const ana = await newPage(FAKE_MEDIA, browser);
  await ana.addInitScript(() => {
    delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
  });
  await createRoom(ana);
  await enter(ana, "Ana");
  await turnOn(ana, "screen");
  const button = ana.getByRole("button", { name: "Abrir janela flutuante" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription(/só no Chrome ou Edge/);
});
