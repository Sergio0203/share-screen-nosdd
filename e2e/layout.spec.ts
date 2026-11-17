import { expect, test, type Page } from "@playwright/test";
import { createRoom, enter, FAKE_MEDIA, newPage, turnOn } from "./helpers";

/**
 * Layout da tela em destaque, medido no navegador: maior tamanho possível na
 * proporção da imagem, câmeras e controles em volta sem cobrir, e reajuste ao
 * redimensionar. Vale para quem compartilha e para quem assiste.
 */

type Box = { x: number; y: number; width: number; height: number };

const SIZES = [
  { width: 1366, height: 768 }, // notebook comum (16:9)
  { width: 1920, height: 1080 }, // full HD
  { width: 1280, height: 1024 }, // 5:4 — sobra altura
  { width: 2560, height: 1080 }, // ultrawide — sobra largura
  { width: 1024, height: 640 }, // janela pequena
];

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

async function checkSpotlight(page: Page, label: string) {
  const figure = page.getByRole("figure", { name: label });
  await expect(figure).toBeVisible();
  // Espera a proporção da imagem ser aplicada (vem do vídeo).
  await expect.poll(() => figure.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);

  const m = await page.evaluate((label) => {
    const fig = document.querySelector(`figure[aria-label="${label}"]`)!;
    const area = fig.parentElement!;
    const video = fig.querySelector("video")!;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const stage = document.querySelector(".stage")!;
    return {
      fig: box(fig),
      area: box(area),
      stage: box(stage),
      videoAspect: video.videoWidth / video.videoHeight,
      others: [...document.querySelectorAll(".camera-strip .tile, .controls, .sharing-banner, .participants, .room-header")].map(box),
      scrolls: stage.scrollHeight > stage.clientHeight + 1 || document.documentElement.scrollHeight > innerHeight + 1,
    };
  }, label);

  const ctx = `${label} em ${page.viewportSize()!.width}×${page.viewportSize()!.height}`;
  // Sem cortar nem distorcer: a caixa tem a proporção da imagem.
  expect(Math.abs(m.fig.width / m.fig.height - m.videoAspect), `${ctx}: proporção`).toBeLessThan(0.02);
  // Maior tamanho possível: encosta na largura ou na altura da área livre.
  const fillsWidth = Math.abs(m.fig.width - m.area.width) <= 2;
  const fillsHeight = Math.abs(m.fig.height - m.area.height) <= 2;
  expect(fillsWidth || fillsHeight, `${ctx}: ocupa a área (${JSON.stringify(m.fig)} em ${JSON.stringify(m.area)})`).toBe(true);
  // A área livre usa toda a largura do palco.
  expect(m.area.width, `${ctx}: largura da área`).toBeGreaterThan(m.stage.width - 2 * 16 - 2);
  // Câmeras, controles e o resto não cobrem a imagem.
  for (const other of m.others) expect(overlaps(m.fig, other), `${ctx}: sobreposição com ${JSON.stringify(other)}`).toBe(false);
  // Tudo cabe na janela, sem rolar.
  expect(m.scrolls, `${ctx}: não rola`).toBe(false);
  return m.fig;
}

test("a tela ocupa o maior espaço possível, para quem compartilha e quem assiste, e se ajusta à janela", async () => {
  test.setTimeout(120_000);
  const ana = await newPage(FAKE_MEDIA);
  const bia = await newPage(FAKE_MEDIA);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");
  await turnOn(ana, "cam");
  await turnOn(bia, "cam");
  await turnOn(ana, "screen");

  let previous: Box | null = null;
  for (const size of SIZES) {
    await ana.setViewportSize(size);
    await bia.setViewportSize(size);
    const own = await checkSpotlight(ana, "Sua tela");
    const watched = await checkSpotlight(bia, "Tela de Ana");
    // Muda de tamanho junto com a janela.
    if (previous) expect(watched.width).not.toBeCloseTo(previous.width, 0);
    previous = watched;
    // Bem grande: pelo menos metade da janela em largura ou em altura.
    for (const fig of [own, watched]) {
      expect(fig.width / size.width > 0.5 || fig.height / size.height > 0.5).toBe(true);
    }
    // Câmeras e controles continuam visíveis.
    await expect(bia.getByRole("figure", { name: "Câmera de Ana" })).toBeInViewport();
    await expect(bia.getByRole("button", { name: "Compartilhar tela" })).toBeInViewport();
    await expect(ana.getByRole("button", { name: "Parar compartilhamento" })).toBeInViewport();
  }
});

test("quem assiste vê o botão de tela cheia; ele funciona e sai com Esc", async () => {
  const ana = await newPage(FAKE_MEDIA);
  const bia = await newPage(FAKE_MEDIA);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");
  await turnOn(ana, "screen");

  const view = bia.getByRole("figure", { name: "Tela de Ana" });
  const button = view.getByRole("button", { name: "Tela cheia" });
  await expect(button).toBeVisible();
  await expect(button).toBeInViewport();

  await button.click();
  await expect.poll(() => bia.evaluate(() => document.fullscreenElement?.getAttribute("aria-label"))).toBe("Tela de Ana");
  // Em tela cheia a imagem ocupa a tela inteira.
  const full = await view.boundingBox();
  const vp = bia.viewportSize()!;
  expect(Math.round(full!.width)).toBe(vp.width);
  await expect(view.getByRole("button", { name: "Sair da tela cheia" })).toBeVisible();

  await bia.keyboard.press("Escape");
  await expect.poll(() => bia.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(button).toBeVisible();
});
