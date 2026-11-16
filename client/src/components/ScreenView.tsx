import { useEffect, useRef, useState } from "react";

/** Compartilhamento de tela em destaque, com botão de tela cheia (sai com Esc). */
export function ScreenView({ stream, name }: { stream: MediaStream; name: string }) {
  const figure = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
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
    <figure ref={figure} className="screen-view" aria-label={`Tela de ${name}`}>
      <video ref={video} autoPlay playsInline muted onDoubleClick={toggleFullscreen} />
      <figcaption className="tile-name">Tela de {name}</figcaption>
      <button className="btn btn-small screen-fullscreen" onClick={toggleFullscreen}>
        {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
      </button>
    </figure>
  );
}
