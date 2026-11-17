import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, newPage, turnOn } from "./helpers";

/** Avisos como notificações flutuantes: não mudam o layout da sala. */

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** Caixas dos elementos principais da sala. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { body: box(".room-body"), screen: box(".screen-view"), controls: box(".controls"), header: box(".room-header") };
  });
}

/** Daqui em diante, o navegador recusa câmera e microfone (como "Bloquear"). */
async function blockCameraAndMic(page: Page) {
  await page.evaluate(() => {
    MediaDevices.prototype.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
}

for (const size of [{ width: 1366, height: 768 }, { width: 1024, height: 640 }]) {
  test(`avisos ficam por cima, empilhados, sem mudar o layout nem cobrir os controles (${size.width}×${size.height})`, async () => {
    const ana = await newPage(FAKE_MEDIA);
    await ana.setViewportSize(size);
    await createRoom(ana);
    await enter(ana, "Ana");
    await turnOn(ana, "screen");
    await expect(ana.getByRole("figure", { name: "Sua tela" })).toBeVisible();
    // Fecha o "Link copiado!" e espera o layout assentar.
    await ana.waitForTimeout(3500);
    const before = await layout(ana);

    await blockCameraAndMic(ana);
    await ana.getByRole("button", { name: "Ligar microfone" }).click();
    await ana.getByRole("button", { name: "Ligar câmera" }).click();
    const region = ana.getByRole("region", { name: "Avisos" });
    await expect(region.getByRole("alert")).toHaveCount(2);
    await expect(region.getByRole("alert").first()).toContainText("O navegador bloqueou o microfone.");
    await expect(region.getByRole("alert").last()).toContainText("O navegador bloqueou a câmera.");

    // O layout da sala não mudou nada.
    expect(await layout(ana)).toEqual(before);

    // Empilhados, visíveis, sem cobrir um ao outro, os controles nem o "Copiar link".
    const cards = await region.getByRole("alert").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(overlaps(cards[0], cards[1])).toBe(false);
    expect(cards[1].y).toBeGreaterThan(cards[0].y);
    const keep: Box[] = [
      before.controls,
      (await ana.getByRole("button", { name: "Copiar link" }).boundingBox())!,
      (await ana.getByLabel("Link da sala").boundingBox())!,
    ];
    for (const card of cards) {
      expect(card.y + card.height).toBeLessThanOrEqual(size.height);
      for (const k of keep) expect(overlaps(card, k), `aviso cobrindo ${JSON.stringify(k)}`).toBe(false);
    }
    // E os controles continuam clicáveis.
    await ana.getByRole("button", { name: "Parar compartilhamento" }).click();
    await expect(ana.getByRole("button", { name: "Compartilhar tela" })).toBeVisible();
  });
}

test("o mesmo tipo de aviso não se repete, e fechar remove", async () => {
  const ana = await newPage(FAKE_MEDIA);
  await createRoom(ana);
  await enter(ana, "Ana");
  await blockCameraAndMic(ana);
  const region = ana.getByRole("region", { name: "Avisos" });
  for (let i = 0; i < 3; i++) {
    await ana.getByRole("button", { name: "Ligar microfone" }).click();
    await expect(region.getByRole("alert")).toHaveCount(1);
  }
  await region.getByRole("button", { name: "Fechar aviso" }).click();
  await expect(region.getByRole("alert")).toHaveCount(0);
});
