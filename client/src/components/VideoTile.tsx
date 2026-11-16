import { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream;
  name: string;
  self?: boolean;
  /** Rótulo acessível e legenda; por padrão, os de câmera. */
  label?: string;
  caption?: string;
  mirrored?: boolean;
}

/** Vídeo de uma pessoa com o nome por cima. Sem som (o áudio vai por RemoteAudio). */
export function VideoTile({ stream, name, self = false, label, caption, mirrored = self }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return (
    <figure className="tile" aria-label={label ?? (self ? "Sua câmera" : `Câmera de ${name}`)}>
      <video ref={ref} autoPlay playsInline muted className={mirrored ? "mirrored" : undefined} />
      <figcaption className="tile-name">{caption ?? (self ? `${name} (você)` : name)}</figcaption>
    </figure>
  );
}
