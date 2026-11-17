import { useCallback, useEffect, useState } from "react";

/** Document Picture-in-Picture (Chrome/Edge 116+): janela sempre por cima dos outros apps. */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

function api(): DocumentPictureInPicture | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture ?? null;
}

export function floatingWindowSupported(): boolean {
  return api() !== null;
}

/** Copia os estilos da página para a janela flutuante (ela nasce em branco). */
function copyStyles(from: Document, to: Document) {
  for (const node of from.querySelectorAll('style, link[rel="stylesheet"]')) {
    to.head.appendChild(node.cloneNode(true));
  }
}

/**
 * Janela flutuante de quem transmite. A pessoa pode mover e redimensionar
 * (é o navegador quem cuida disso); fechar só fecha a janela.
 */
export function useFloatingWindow() {
  const [win, setWin] = useState<Window | null>(null);
  const [error, setError] = useState(false);

  const open = useCallback(async () => {
    const pip = api();
    if (!pip) return;
    try {
      // Precisa ser chamado no clique (ativação do usuário).
      const w = await pip.requestWindow({ width: 480, height: 300 });
      copyStyles(document, w.document);
      w.document.title = "Telão — recados";
      w.document.body.className = "floating-body";
      w.addEventListener("pagehide", () => setWin(null), { once: true });
      setError(false);
      setWin(w);
    } catch {
      setError(true);
    }
  }, []);

  const close = useCallback(() => {
    win?.close();
    setWin(null);
  }, [win]);

  // Saiu da sala: fecha a janela junto.
  useEffect(() => () => win?.close(), [win]);

  return { win, open, close, error, supported: floatingWindowSupported() };
}
