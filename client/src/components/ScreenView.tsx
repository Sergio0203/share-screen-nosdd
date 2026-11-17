import { useEffect, useRef, useState } from "react";

interface Props {
  stream: MediaStream;
  /** Rótulo acessível e legenda (ex.: "Tela de Ana", "Sua tela"). */
  label: string;
}

const DEFAULT_ASPECT = 16 / 9;

/**
 * Compartilhamento de tela em destaque. Ocupa o maior tamanho que cabe na área
 * disponível, na proporção real da imagem (sem cortar nem distorcer), e tem
 * botão de tela cheia (sai com Esc).
 */
export function ScreenView({ stream, label }: Props) {
  const figure = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    // A proporção vem da própria imagem (e muda se a janela compartilhada mudar).
    const update = () => {
      if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight);
    };
    update();
    el.addEventListener("loadedmetadata", update);
    el.addEventListener("resize", update);
    return () => {
      el.removeEventListener("loadedmetadata", update);
      el.removeEventListener("resize", update);
    };
  }, [stream]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === figure.current);
    // O navegador já sai da tela cheia com Esc; isto é só um reforço para
    // quando a tecla chega à página (ex.: alguns navegadores embutidos).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.fullscreenElement === figure.current) void document.exitFullscreen();
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void figure.current?.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className="spotlight-area">
      <figure
        ref={figure}
        className="screen-view"
        aria-label={label}
        style={{ "--aspect": aspect } as React.CSSProperties}
      >
        <video ref={video} autoPlay playsInline muted onDoubleClick={toggleFullscreen} />
        <figcaption className="tile-name">{label}</figcaption>
        <button className="btn screen-fullscreen" onClick={toggleFullscreen}>
          {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </figure>
    </div>
  );
}
