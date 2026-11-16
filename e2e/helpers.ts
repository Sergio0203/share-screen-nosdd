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

/** Guarda as RTCPeerConnection da página, para o teste ler as estatísticas. */
export async function trackPeerConnections(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pcs: RTCPeerConnection[] };
    w.__pcs = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        w.__pcs.push(this);
      }
    };
  });
}

export interface VideoStats {
  width: number;
  height: number;
  fps: number;
  /** Só no envio: limite de fps configurado no encoder. */
  maxFramerate?: number;
  framesSent?: number;
  trackId?: string;
  /** Só no envio: por que o encoder está limitando (cpu, bandwidth, none). */
  limitation?: string;
}

/** Estatísticas do canal de tela (3º canal) na primeira conexão aberta. */
export async function screenStats(page: Page, side: "send" | "receive"): Promise<VideoStats | null> {
  return page.evaluate(async (side) => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
    const pc = pcs.find((p) => p.connectionState === "connected");
    const t = pc?.getTransceivers()[2];
    if (!t) return null;
    const type = side === "send" ? "outbound-rtp" : "inbound-rtp";
    const report = await (side === "send" ? t.sender : t.receiver).getStats();
    let s: Record<string, number> | undefined;
    report.forEach((r) => {
      if (r.type === type && r.frameHeight) s = r;
    });
    if (!s) return null;
    return {
      width: s.frameWidth,
      height: s.frameHeight,
      fps: s.framesPerSecond ?? 0,
      maxFramerate: side === "send" ? t.sender.getParameters().encodings[0]?.maxFramerate : undefined,
      framesSent: s.framesSent,
      limitation: (s as unknown as { qualityLimitationReason?: string }).qualityLimitationReason,
      trackId: side === "send" ? t.sender.track?.id : undefined,
    };
  }, side);
}

const ON_LABEL = { mic: "Desligar microfone", cam: "Desligar câmera", screen: "Parar compartilhamento" };
const OFF_LABEL = { mic: "Ligar microfone", cam: "Ligar câmera", screen: "Compartilhar tela" };

/**
 * Liga microfone/câmera/tela e espera de fato ligar. Os prazos dos requisitos
 * ("os outros veem em até X s") contam a partir daqui, não do clique: abrir a
 * captura pode demorar com a máquina carregada.
 */
export async function turnOn(page: Page, device: keyof typeof ON_LABEL) {
  await page.getByRole("button", { name: OFF_LABEL[device] }).click();
  await expect(page.getByRole("button", { name: ON_LABEL[device] })).toBeVisible({ timeout: 10_000 });
}
