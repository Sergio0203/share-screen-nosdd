import { useEffect, useRef } from "react";

/** Vídeo de uma pessoa com o nome por cima. Sem som (o áudio vai por RemoteAudio). */
export function VideoTile({ stream, name, self = false }: { stream: MediaStream; name: string; self?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return (
    <figure className="tile" aria-label={self ? "Sua câmera" : `Câmera de ${name}`}>
      <video ref={ref} autoPlay playsInline muted className={self ? "mirrored" : undefined} />
      <figcaption className="tile-name">{self ? `${name} (você)` : name}</figcaption>
    </figure>
  );
}
