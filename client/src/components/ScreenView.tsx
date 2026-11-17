import { useCallback, useEffect, useRef, useState } from "react";
import type { ShownNote } from "../notes/useNotes";
import { displayedImage, isTyping, toImagePoint, type Box } from "../notes/imageBox";
import { NoteComposer, noteAnchor } from "../notes/NoteComposer";

interface Props {
  stream: MediaStream;
  /** Rótulo acessível e legenda (ex.: "Tela de Ana", "Sua tela"). */
  label: string;
  /** Recados escritos nesta tela. */
  notes?: ShownNote[];
  /** Envia um recado na posição (x, y) relativa à imagem (0–1). */
  onWrite?(x: number, y: number, text: string): void;
  /** Cursor sobre a imagem (0–1) — usado para o próprio recado acompanhar o cursor. */
  onCursor?(x: number, y: number): void;
}

const DEFAULT_ASPECT = 16 / 9;

/**
 * Compartilhamento de tela em destaque. Ocupa o maior tamanho que cabe na área
 * disponível, na proporção real da imagem (sem cortar nem distorcer), e tem
 * botão de tela cheia (sai com Esc).
 *
 * Com o cursor sobre a imagem, "/" abre um campo para escrever um recado ali.
 * Recados ficam numa camada alinhada à imagem (descontando faixas pretas, que
 * aparecem em tela cheia), em posição relativa — o mesmo ponto para todos.
 */
export function ScreenView({ stream, label, notes = [], onWrite, onCursor }: Props) {
  const figure = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  /** Onde a imagem aparece dentro da figura (px, relativo à figura). */
  const [imageBox, setImageBox] = useState<Box | null>(null);
  /** Último ponto do cursor sobre a imagem (0–1), ou null fora dela. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [composer, setComposer] = useState<{ x: number; y: number } | null>(null);
  const composerOpen = useRef(false);
  composerOpen.current = composer !== null;
  const canWrite = useRef(false);
  canWrite.current = !!onWrite;
  const cursorListener = useRef(onCursor);
  cursorListener.current = onCursor;

  const measure = useCallback(() => {
    const fig = figure.current;
    const vid = video.current;
    if (!fig || !vid) return;
    const f = fig.getBoundingClientRect();
    const img = displayedImage(vid);
    setImageBox({ left: img.left - f.left, top: img.top - f.top, width: img.width, height: img.height });
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    // A proporção vem da própria imagem (e muda se a janela compartilhada mudar).
    const update = () => {
      if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight);
      measure();
    };
    update();
    el.addEventListener("loadedmetadata", update);
    el.addEventListener("resize", update);
    return () => {
      el.removeEventListener("loadedmetadata", update);
      el.removeEventListener("resize", update);
    };
  }, [stream, measure]);

  // Reposiciona a camada de recados quando a figura muda de tamanho.
  useEffect(() => {
    const fig = figure.current;
    if (!fig || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(fig);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === figure.current);
      measure();
    };
    const onKey = (e: KeyboardEvent) => {
      // "/" com o cursor sobre a imagem abre o recado — exceto se a pessoa
      // estiver digitando em outro campo (ex.: o nome).
      if (e.key === "/" && canWrite.current && !composerOpen.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTyping(e.target) || !pointer.current) return;
        e.preventDefault();
        setComposer(pointer.current);
        return;
      }
      // O navegador já sai da tela cheia com Esc; isto é só um reforço para
      // quando a tecla chega à página (ex.: alguns navegadores embutidos).
      if (e.key === "Escape" && !composerOpen.current && document.fullscreenElement === figure.current) {
        void document.exitFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [measure]);

  function trackPointer(e: React.PointerEvent) {
    if (!video.current) return;
    const point = toImagePoint(displayedImage(video.current), e.clientX, e.clientY);
    pointer.current = point;
    if (point) cursorListener.current?.(point.x, point.y);
  }

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
        onPointerMove={trackPointer}
        onPointerEnter={trackPointer}
        onPointerLeave={() => (pointer.current = null)}
      >
        <video ref={video} autoPlay playsInline muted onDoubleClick={toggleFullscreen} />
        <figcaption className="tile-name">{label}</figcaption>
        {onWrite && !composer && (
          <span className="screen-hint" aria-hidden>
            Aperte <kbd>/</kbd> para escrever aqui
          </span>
        )}

        {imageBox && (
          <div
            className="notes-layer"
            data-testid="notes-layer"
            style={{ left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height }}
          >
            {notes.map((n) => (
              <div
                key={n.id}
                className={`note ${noteAnchor(n.x, n.y)} ${n.fading ? "fading" : ""}`}
                role="note"
                aria-label={`Recado de ${n.authorName}`}
                data-x={n.x}
                data-y={n.y}
                style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
              >
                {/* Sempre texto puro: o React escapa, nunca vira HTML. */}
                <span className="note-author">{n.authorName}</span>
                <span className="note-text">{n.text}</span>
              </div>
            ))}
            {composer && onWrite && (
              <NoteComposer
                x={composer.x}
                y={composer.y}
                onSend={(text) => {
                  onWrite(composer.x, composer.y, text);
                  setComposer(null);
                }}
                onCancel={() => setComposer(null)}
              />
            )}
          </div>
        )}

        <button className="btn screen-fullscreen" onClick={toggleFullscreen}>
          {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </figure>
    </div>
  );
}
