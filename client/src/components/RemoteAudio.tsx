import { useEffect, useRef } from "react";

/** Toca o áudio de uma pessoa. Invisível. */
export function RemoteAudio({ stream, onBlocked }: { stream: MediaStream; onBlocked(): void }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play()?.catch((err: unknown) => {
      // Política de autoplay: precisa de um clique na página antes.
      if (err instanceof DOMException && err.name === "NotAllowedError") onBlocked();
    });
  }, [stream, onBlocked]);
  return <audio ref={ref} autoPlay data-remote-audio />;
}

/** Tenta tocar de novo todos os áudios (chamado num clique do usuário). */
export function unlockRemoteAudio() {
  document.querySelectorAll<HTMLAudioElement>("audio[data-remote-audio]").forEach((el) => {
    el.play()?.catch(() => {});
  });
}
