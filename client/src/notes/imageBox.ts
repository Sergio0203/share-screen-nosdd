export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Onde a imagem de um <video object-fit: contain> aparece de fato dentro do
 * elemento (descontando as faixas pretas), em coordenadas da janela.
 */
export function displayedImage(video: HTMLVideoElement): Box {
  const r = video.getBoundingClientRect();
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0;
  if (!aspect || !r.width || !r.height) return { left: r.left, top: r.top, width: r.width, height: r.height };
  if (r.width / r.height > aspect) {
    const width = r.height * aspect;
    return { left: r.left + (r.width - width) / 2, top: r.top, width, height: r.height };
  }
  const height = r.width / aspect;
  return { left: r.left, top: r.top + (r.height - height) / 2, width: r.width, height };
}

/** Ponto da janela → posição relativa na imagem (0–1), ou null se fora dela. */
export function toImagePoint(box: Box, clientX: number, clientY: number): { x: number; y: number } | null {
  if (!box.width || !box.height) return null;
  const x = (clientX - box.left) / box.width;
  const y = (clientY - box.top) / box.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

/** Foco num campo de texto: aí "/" é só um caractere. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}
