import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, launch, newPage, turnOn } from "./helpers";

/**
 * Recados na tela de ponta a ponta, com janelas de tamanhos diferentes:
 * o recado tem que cair no mesmo ponto da imagem para todos.
 */

const SIZES = { ana: { width: 1366, height: 768 }, bia: { width: 1024, height: 640 }, caio: { width: 1920, height: 1080 } };

async function room() {
  const browser = await launch(FAKE_MEDIA);
  const page = async (size: { width: number; height: number }) => {
    const p = await newPage(FAKE_MEDIA, browser);
    await p.setViewportSize(size);
    return p;
  };
  const ana = await page(SIZES.ana);
  const bia = await page(SIZES.bia);
  const caio = await page(SIZES.caio);
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

const screenLabel = (page: Page, sharer: Page) => (page === sharer ? "Sua tela" : "Tela de Ana");

/** Põe o cursor num ponto relativo (0–1) da imagem e aperta "/". */
async function openComposerAt(page: Page, label: string, x: number, y: number) {
  const layer = page.getByRole("figure", { name: label }).getByTestId("notes-layer");
  await expect(layer).toBeVisible();
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + x * box.width, box.y + y * box.height);
  await page.keyboard.press("/");
  const input = page.getByRole("textbox", { name: "Recado na tela" });
  await expect(input).toBeFocused();
  return input;
}

/** Onde o recado aparece, relativo à imagem (0–1), medido na tela de quem vê. */
async function notePosition(page: Page, label: string, author: string) {
  const figure = page.getByRole("figure", { name: label });
  const note = figure.getByRole("note", { name: `Recado de ${author}` });
  await expect(note).toBeVisible();
  const layer = (await figure.getByTestId("notes-layer").boundingBox())!;
  const n = (await note.boundingBox())!;
  return { x: (n.x - layer.x) / layer.width, y: (n.y - layer.y) / layer.height, text: await note.textContent() };
}

test("o recado aparece para todos, com o nome, no mesmo ponto da imagem, com janelas de tamanhos diferentes", async () => {
  test.setTimeout(90_000);
  const { ana, bia, caio } = await room();

  const input = await openComposerAt(bia, "Tela de Ana", 0.25, 0.6);
  await input.fill("olha ali");
  await input.press("Enter");
  await expect(input).toHaveCount(0);

  for (const page of [ana, bia, caio]) {
    const pos = await notePosition(page, screenLabel(page, ana), "Bia");
    expect(pos.text).toBe("Biaolha ali");
    expect(Math.abs(pos.x - 0.25), `x em ${page.viewportSize()!.width}px`).toBeLessThan(0.01);
    expect(Math.abs(pos.y - 0.6), `y em ${page.viewportSize()!.width}px`).toBeLessThan(0.01);
  }
});

test("quem compartilha também escreve, e todos veem", async () => {
  const { ana, bia, caio } = await room();
  const input = await openComposerAt(ana, "Sua tela", 0.5, 0.3);
  await input.fill("minha tela");
  await input.press("Enter");
  for (const page of [ana, bia, caio]) {
    const pos = await notePosition(page, screenLabel(page, ana), "Ana");
    expect(pos.text).toBe("Anaminha tela");
    expect(Math.abs(pos.x - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(pos.y - 0.3)).toBeLessThan(0.01);
  }
});

test("texto puro, limite de 100 caracteres com contador, e Esc cancela sem enviar", async () => {
  const { ana, bia } = await room();

  // HTML aparece literalmente.
  let input = await openComposerAt(bia, "Tela de Ana", 0.2, 0.2);
  await input.fill("<b>oi</b><img src=x onerror=alert(1)>");
  await input.press("Enter");
  const note = ana.getByRole("note", { name: "Recado de Bia" });
  await expect(note).toContainText("<b>oi</b><img src=x onerror=alert(1)>");
  expect(await note.locator("b, img").count()).toBe(0);

  // Limite e contador.
  input = await openComposerAt(bia, "Tela de Ana", 0.4, 0.4);
  await expect(bia.getByText("faltam 100 caracteres")).toBeVisible();
  await input.pressSequentially("a".repeat(120));
  await expect(input).toHaveValue("a".repeat(100));
  await expect(bia.getByText("faltam 0 caracteres")).toBeVisible();

  // Esc cancela: nada chega aos outros.
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await ana.waitForTimeout(1000);
  await expect(ana.getByRole("note")).toHaveCount(1); // só o do HTML
});

test("/ digitado em outro campo não abre o recado", async () => {
  const { ana } = await room();
  const browser = await launch(FAKE_MEDIA);
  const dani = await newPage(FAKE_MEDIA, browser);
  await dani.goto(ana.url());
  // No campo do nome, antes de entrar: "/" é só um caractere.
  await dani.getByLabel("Seu nome").fill("");
  await dani.getByLabel("Seu nome").pressSequentially("Da/ni");
  await expect(dani.getByLabel("Seu nome")).toHaveValue("Da/ni");
  await dani.getByRole("button", { name: "Entrar" }).click();

  // Dentro da sala, com o cursor sobre a tela mas o foco no link da sala.
  const layer = dani.getByRole("figure", { name: "Tela de Ana" }).getByTestId("notes-layer");
  const box = (await layer.boundingBox())!;
  await dani.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await dani.getByLabel("Link da sala").focus();
  await dani.keyboard.press("/");
  await expect(dani.getByRole("textbox", { name: "Recado na tela" })).toHaveCount(0);
});

test("o recado funciona em tela cheia, no mesmo ponto da imagem", async () => {
  const { ana, bia } = await room();
  const view = bia.getByRole("figure", { name: "Tela de Ana" });
  await view.getByRole("button", { name: "Tela cheia" }).click();
  await expect.poll(() => bia.evaluate(() => !!document.fullscreenElement)).toBe(true);

  const input = await openComposerAt(bia, "Tela de Ana", 0.7, 0.5);
  await input.fill("em tela cheia");
  await input.press("Enter");
  // Ainda em tela cheia (o Enter não saiu dela).
  expect(await bia.evaluate(() => !!document.fullscreenElement)).toBe(true);
  const pos = await notePosition(ana, "Sua tela", "Bia");
  // anchor-right: perto da borda direita o balão cresce para a esquerda; mede pela borda direita.
  const note = (await ana.getByRole("note", { name: "Recado de Bia" }).boundingBox())!;
  const layer = (await ana.getByRole("figure", { name: "Sua tela" }).getByTestId("notes-layer").boundingBox())!;
  expect(Math.abs((note.x + note.width - layer.x) / layer.width - 0.7)).toBeLessThan(0.01);
  expect(Math.abs(pos.y - 0.5)).toBeLessThan(0.01);
});
