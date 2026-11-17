import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, launch, newPage, turnOn } from "./helpers";

/** Recado que acompanha o cursor e some sozinho, de ponta a ponta. */

async function room() {
  const browser = await launch(FAKE_MEDIA);
  const page = async (width: number, height: number) => {
    const p = await newPage(FAKE_MEDIA, browser);
    await p.setViewportSize({ width, height });
    return p;
  };
  const ana = await page(1366, 768);
  const bia = await page(1024, 640);
  const caio = await page(1920, 1080);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  for (const [p, name] of [[bia, "Bia"], [caio, "Caio"]] as const) {
    await p.goto(url);
    await enter(p, name);
  }
  await turnOn(ana, "screen");
  for (const p of [bia, caio]) await expect(p.getByRole("figure", { name: "Tela de Ana" })).toBeVisible();
  return { ana, bia, caio };
}

const label = (page: Page, ana: Page) => (page === ana ? "Sua tela" : "Tela de Ana");

async function layerBox(page: Page, ana: Page) {
  const layer = page.getByRole("figure", { name: label(page, ana) }).getByTestId("notes-layer");
  await expect(layer).toBeVisible();
  return (await layer.boundingBox())!;
}

async function writeAt(page: Page, ana: Page, x: number, y: number, text: string) {
  const box = await layerBox(page, ana);
  await page.mouse.move(box.x + x * box.width, box.y + y * box.height);
  await page.keyboard.press("/");
  const input = page.getByRole("textbox", { name: "Recado na tela" });
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
}

/** Posição do recado relativa à imagem (0–1), na tela de quem vê. */
async function notePos(page: Page, ana: Page, author: string) {
  const note = page.getByRole("figure", { name: label(page, ana) }).getByRole("note", { name: `Recado de ${author}` });
  const box = await layerBox(page, ana);
  const n = await note.boundingBox();
  if (!n) return null;
  return { x: (n.x - box.x) / box.width, y: (n.y - box.y) / box.height };
}

test("o recado acompanha o cursor de quem escreveu, para todos", async () => {
  const { ana, bia, caio } = await room();
  await writeAt(bia, ana, 0.2, 0.3, "vem comigo");
  for (const p of [ana, caio]) await expect(p.getByRole("note", { name: "Recado de Bia" })).toBeVisible();

  // Bia arrasta o cursor pela imagem.
  const box = await layerBox(bia, ana);
  await bia.mouse.move(box.x + 0.6 * box.width, box.y + 0.6 * box.height, { steps: 15 });

  for (const p of [bia, ana, caio]) {
    await expect
      .poll(async () => {
        const pos = await notePos(p, ana, "Bia");
        return pos && Math.max(Math.abs(pos.x - 0.6), Math.abs(pos.y - 0.6));
      }, { message: `recado na tela de ${p.viewportSize()!.width}px`, timeout: 2000 })
      .toBeLessThan(0.01);
  }
});

test("depois de 5 s o recado some aos poucos, com fade de 1 s", async () => {
  const { ana, bia } = await room();
  // Observa, quadro a quadro, a opacidade do recado na tela da Ana.
  const timeline = ana.evaluate(
    () =>
      new Promise<{ fadeStart: number; gone: number; midOpacities: number[] }>((resolve) => {
        let appeared = 0;
        let fadeStart = 0;
        let opaque = false; // ignora a animação de entrada (0,15 s)
        const mid: number[] = [];
        const tick = () => {
          const note = document.querySelector<HTMLElement>('[role="note"]');
          const now = performance.now();
          if (!appeared && note) appeared = now;
          if (appeared && note) {
            const o = Number(getComputedStyle(note).opacity);
            if (o >= 0.99) opaque = true;
            if (opaque && !fadeStart && o < 0.99) fadeStart = now;
            if (fadeStart && o > 0.05 && o < 0.95) mid.push(o);
          }
          if (appeared && !note) return resolve({ fadeStart: fadeStart - appeared, gone: now - appeared, midOpacities: mid });
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await writeAt(bia, ana, 0.3, 0.3, "já já some");
  const t = await timeline;
  console.log(`fade começou em ${Math.round(t.fadeStart)} ms, sumiu em ${Math.round(t.gone)} ms`);
  expect(t.fadeStart).toBeGreaterThan(4800);
  expect(t.fadeStart).toBeLessThan(5400);
  expect(t.gone).toBeGreaterThan(5800);
  expect(t.gone).toBeLessThan(6500);
  // "Aos poucos": passou por opacidades intermediárias, não sumiu de uma vez.
  expect(t.midOpacities.length).toBeGreaterThan(5);
});

test("um novo recado da mesma pessoa substitui o anterior", async () => {
  const { ana, bia, caio } = await room();
  await writeAt(bia, ana, 0.2, 0.2, "primeiro");
  await expect(ana.getByRole("note", { name: "Recado de Bia" })).toHaveText("Biaprimeiro");
  await writeAt(bia, ana, 0.5, 0.5, "segundo");
  for (const p of [ana, bia, caio]) {
    await expect(p.getByRole("note", { name: "Recado de Bia" })).toHaveText("Biasegundo");
    await expect(p.getByRole("note")).toHaveCount(1);
  }
});

test("recados de várias pessoas aparecem ao mesmo tempo, sem um apagar o outro", async () => {
  const { ana, bia, caio } = await room();
  await writeAt(bia, ana, 0.2, 0.2, "da Bia");
  await writeAt(caio, ana, 0.5, 0.5, "do Caio");
  await writeAt(ana, ana, 0.3, 0.7, "da Ana");
  for (const p of [ana, bia, caio]) {
    await expect(p.getByRole("note")).toHaveCount(3);
    await expect(p.getByRole("note", { name: "Recado de Bia" })).toHaveText("Biada Bia");
    await expect(p.getByRole("note", { name: "Recado de Caio" })).toHaveText("Caiodo Caio");
    await expect(p.getByRole("note", { name: "Recado de Ana" })).toHaveText("Anada Ana");
  }
  // Cada um mexe o seu sem afetar os outros.
  const box = await layerBox(caio, ana);
  await caio.mouse.move(box.x + 0.4 * box.width, box.y + 0.2 * box.height, { steps: 5 });
  await expect.poll(async () => (await notePos(ana, ana, "Caio"))!.y).toBeLessThan(0.21);
  const biaPos = (await notePos(ana, ana, "Bia"))!;
  expect(Math.abs(biaPos.x - 0.2)).toBeLessThan(0.01);
});
