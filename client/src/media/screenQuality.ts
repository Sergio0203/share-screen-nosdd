/** Qualidades de compartilhamento de tela que a pessoa pode escolher. */
/**
 * `degradation`: o que sacrificar quando faltar banda ou CPU.
 * - 1080p 30: mantém a nitidez (texto, desktop) e reduz o fps.
 * - 1080p 60: mantém a fluidez (jogos) e reduz a resolução.
 */
export const SCREEN_QUALITIES = {
  "720p30": { label: "720p 30 fps", width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000, degradation: "balanced" },
  "1080p30": { label: "1080p 30 fps", width: 1920, height: 1080, frameRate: 30, maxBitrate: 2_500_000, degradation: "maintain-resolution" },
  "1080p60": { label: "1080p 60 fps", width: 1920, height: 1080, frameRate: 60, maxBitrate: 4_000_000, degradation: "maintain-framerate" },
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
  const { frameRate, maxBitrate, degradation } = SCREEN_QUALITIES[q];
  return { maxBitrate, maxFramerate: frameRate, degradationPreference: degradation };
}

export interface SendParams {
  maxBitrate: number;
  maxFramerate?: number;
  degradationPreference?: "maintain-resolution" | "maintain-framerate" | "balanced";
}
