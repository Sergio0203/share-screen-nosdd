import { chromium, expect, test, type Browser, type Page } from "@playwright/test";

/** Microfone e câmera falsos do Chromium, com permissão concedida automaticamente. */
export const FAKE_MEDIA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
/** Como se a pessoa clicasse em "Bloquear" em todo pedido de permissão. */
export const DENY_MEDIA = ["--use-fake-device-for-media-stream", "--deny-permission-prompts"];

const browsers: Browser[] = [];
test.afterEach(async () => {
  await Promise.all(browsers.splice(0).map((b) => b.close()));
});

export async function launch(args: string[]): Promise<Browser> {
  // Chromium completo (não o headless-shell, que não implementa permissões de mídia).
  const browser = await chromium.launch({ channel: "chromium", args });
  browsers.push(browser);
  return browser;
}

export async function newPage(args: string[], browser?: Browser): Promise<Page> {
  const page = await (await (browser ?? (await launch(args))).newContext()).newPage();
  // Qualquer erro de JS na página faz o teste falhar.
  page.on("pageerror", (err) => {
    throw err;
  });
  return page;
}

export async function createRoom(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Criar sala" }).click();
  await page.waitForURL(/\/sala\//);
  return page.url();
}

export async function enter(page: Page, name: string) {
  await page.getByLabel("Seu nome").fill(name);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("complementary", { name: "Participantes" })).toBeVisible();
}

/** Ícones de estado (microfone, câmera) de uma pessoa na lista de participantes. */
export const statusIcons = (page: Page, name: string) =>
  page.getByRole("complementary", { name: "Participantes" }).getByRole("listitem").filter({ hasText: name }).getByRole("img");
