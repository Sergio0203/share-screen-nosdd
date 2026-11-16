/** Qualidades de compartilhamento de tela que a pessoa pode escolher. */
export const SCREEN_QUALITIES = {
  "720p30": { label: "720p 30 fps", width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000 },
  "1080p30": { label: "1080p 30 fps", width: 1920, height: 1080, frameRate: 30, maxBitrate: 2_500_000 },
  "1080p60": { label: "1080p 60 fps", width: 1920, height: 1080, frameRate: 60, maxBitrate: 4_000_000 },
} as const;

export type ScreenQuality = keyof typeof SCREEN_QUALITIES;
export const SCREEN_QUALITY_IDS = Object.keys(SCREEN_QUALITIES) as ScreenQuality[];
export const DEFAULT_SCREEN_QUALITY: ScreenQuality = "720p30";

export function isScreenQuality(v: unknown): v is ScreenQuality {
  return typeof v === "string" && v in SCREEN_QUALITIES;
}

/** Restrições de captura: no máximo a resolução/fps escolhidos (não aumenta janelas pequenas). */
export function captureConstraints(q: ScreenQuality): MediaTrackConstraints {
  const { width, height, frameRate } = SCREEN_QUALITIES[q];
  return {
    width: { ideal: width, max: width },
    height: { ideal: height, max: height },
    frameRate: { ideal: frameRate, max: frameRate },
  };
}

/** Parâmetros de envio (por cópia enviada a cada pessoa). */
export function sendParams(q: ScreenQuality): SendParams {
  const { frameRate, maxBitrate } = SCREEN_QUALITIES[q];
  // A pessoa escolheu a resolução: se faltar banda, cai o fps, não a resolução.
  // Também evita que o Chrome comece em 720p e só suba para 1080p após ~10 s
  // (acontecia quando quem compartilha é o lado que respondeu à oferta).
  return { maxBitrate, maxFramerate: frameRate, degradationPreference: "maintain-resolution" };
}

export interface SendParams {
  maxBitrate: number;
  maxFramerate?: number;
  degradationPreference?: "maintain-resolution" | "maintain-framerate" | "balanced";
}
