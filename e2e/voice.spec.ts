import { chromium, expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Voz de ponta a ponta em Chromium real. O microfone falso do Chrome gera um
 * bipe contínuo; medimos se o som chega do outro lado com um AnalyserNode.
 */

const FAKE_MIC = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

let browsers: Browser[] = [];
test.afterEach(async () => {
  await Promise.all(browsers.map((b) => b.close()));
  browsers = [];
});

async function newPage(args: string[]): Promise<Page> {
  // Chromium completo (não o headless-shell, que não implementa permissões de mídia).
  const browser = await chromium.launch({ channel: "chromium", args });
  browsers.push(browser);
  const page = await (await browser.newContext()).newPage();
  // Qualquer erro de JS na página faz o teste falhar.
  page.on("pageerror", (err) => {
    throw err;
  });
  return page;
}

async function createRoom(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Criar sala" }).click();
  await page.waitForURL(/\/sala\//);
  return page.url();
}

async function enter(page: Page, name: string) {
  await page.getByLabel("Seu nome").fill(name);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Você está na sala.")).toBeVisible();
}

/** Volume (RMS, 0–1) do áudio que está chegando de outras pessoas. */
async function incomingLevel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const audios = [...document.querySelectorAll<HTMLAudioElement>("audio[data-remote-audio]")].filter(
      (el) => el.srcObject instanceof MediaStream,
    );
    if (audios.length === 0) return 0;
    const ctx = new AudioContext();
    await ctx.resume();
    let max = 0;
    for (const el of audios) {
      const stream = el.srcObject as MediaStream;
      if (stream.getAudioTracks().length === 0) continue;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 50));
        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
        max = Math.max(max, rms);
      }
    }
    await ctx.close();
    return max;
  });
}

const micStatus = (page: Page, name: string) =>
  page.getByRole("complementary", { name: "Participantes" }).getByRole("listitem").filter({ hasText: name }).getByRole("img");

test("quem liga o microfone é ouvido pelos outros; todos veem o estado", async () => {
  const ana = await newPage(FAKE_MIC);
  const bia = await newPage(FAKE_MIC);

  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");

  // Entram com microfone desligado.
  await expect(ana.getByRole("button", { name: "Ligar microfone" })).toBeVisible();
  await expect(micStatus(bia, "Ana")).toHaveAccessibleName("microfone desligado");
  expect(await incomingLevel(bia)).toBeLessThan(0.001);

  // Ana liga: Bia vê o ícone e ouve.
  await ana.getByRole("button", { name: "Ligar microfone" }).click();
  await expect(ana.getByRole("button", { name: "Desligar microfone" })).toBeVisible();
  await expect(micStatus(bia, "Ana")).toHaveAccessibleName("microfone ligado", { timeout: 3000 });
  await expect.poll(() => incomingLevel(bia), { timeout: 10_000 }).toBeGreaterThan(0.01);

  // Bia também liga: os dois se ouvem.
  await bia.getByRole("button", { name: "Ligar microfone" }).click();
  await expect(micStatus(ana, "Bia")).toHaveAccessibleName("microfone ligado", { timeout: 3000 });
  await expect.poll(() => incomingLevel(ana), { timeout: 10_000 }).toBeGreaterThan(0.01);

  // Ana desliga: some o som dela do lado da Bia.
  await ana.getByRole("button", { name: "Desligar microfone" }).click();
  await expect(micStatus(bia, "Ana")).toHaveAccessibleName("microfone desligado", { timeout: 3000 });
  await expect.poll(() => incomingLevel(bia), { timeout: 5000 }).toBeLessThan(0.001);

  // E religa sem problema.
  await ana.getByRole("button", { name: "Ligar microfone" }).click();
  await expect.poll(() => incomingLevel(bia), { timeout: 10_000 }).toBeGreaterThan(0.01);
});

test("quem entra depois ouve quem já estava com o microfone ligado", async () => {
  const ana = await newPage(FAKE_MIC);
  const bia = await newPage(FAKE_MIC);
  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await ana.getByRole("button", { name: "Ligar microfone" }).click();
  await expect(ana.getByRole("button", { name: "Desligar microfone" })).toBeVisible();

  await bia.goto(url);
  await enter(bia, "Bia");
  await expect(micStatus(bia, "Ana")).toHaveAccessibleName("microfone ligado");
  await expect.poll(() => incomingLevel(bia), { timeout: 10_000 }).toBeGreaterThan(0.01);
});

test("permissão negada mostra como liberar e a pessoa continua ouvindo a sala", async () => {
  const ana = await newPage(FAKE_MIC);
  // Como se a Bia clicasse em "Bloquear" no pedido de permissão.
  const bia = await newPage(["--use-fake-device-for-media-stream", "--deny-permission-prompts"]);

  const url = await createRoom(ana);
  await enter(ana, "Ana");
  await bia.goto(url);
  await enter(bia, "Bia");

  await bia.getByRole("button", { name: "Ligar microfone" }).click();
  await expect(bia.getByRole("alert")).toContainText("O navegador bloqueou o microfone.");
  await expect(bia.getByRole("alert")).toContainText("cadeado");
  await expect(bia.getByRole("button", { name: "Ligar microfone" })).toBeVisible();
  await expect(micStatus(ana, "Bia")).toHaveAccessibleName("microfone desligado");

  // O resto funciona: Bia ainda ouve a Ana.
  await ana.getByRole("button", { name: "Ligar microfone" }).click();
  await expect(micStatus(bia, "Ana")).toHaveAccessibleName("microfone ligado", { timeout: 3000 });
  await expect.poll(() => incomingLevel(bia), { timeout: 10_000 }).toBeGreaterThan(0.01);
});

/** Quantas pessoas diferentes estão sendo ouvidas (cada áudio com som). */
async function audibleCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const audios = [...document.querySelectorAll<HTMLAudioElement>("audio[data-remote-audio]")].filter(
      (el) => el.srcObject instanceof MediaStream && (el.srcObject as MediaStream).getAudioTracks().length > 0,
    );
    const ctx = new AudioContext();
    await ctx.resume();
    const analysers = audios.map((el) => {
      const a = ctx.createAnalyser();
      ctx.createMediaStreamSource(el.srcObject as MediaStream).connect(a);
      return { a, max: 0 };
    });
    const buf = new Float32Array(2048);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const x of analysers) {
        x.a.getFloatTimeDomainData(buf);
        x.max = Math.max(x.max, Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length));
      }
    }
    await ctx.close();
    return analysers.filter((x) => x.max > 0.01).length;
  });
}

test("6 pessoas ligando o microfone ao mesmo tempo: todas ouvem as outras 5", async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({ channel: "chromium", args: FAKE_MIC });
  browsers.push(browser);
  const pages: Page[] = [];
  for (let i = 0; i < 6; i++) {
    const page = await (await browser.newContext()).newPage();
    page.on("pageerror", (err) => {
      throw err;
    });
    pages.push(page);
  }

  const url = await createRoom(pages[0]);
  await enter(pages[0], "P1");
  for (let i = 1; i < 6; i++) {
    await pages[i].goto(url);
    await enter(pages[i], `P${i + 1}`);
  }
  await expect(pages[0].getByText("(6/6)")).toBeVisible();

  // Todos clicam praticamente juntos: força colisão de negociações.
  await Promise.all(pages.map((p) => p.getByRole("button", { name: "Ligar microfone" }).click()));

  for (const page of pages) {
    await expect.poll(() => audibleCount(page), { timeout: 20_000 }).toBe(5);
  }
});
