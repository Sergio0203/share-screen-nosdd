import { useState } from "react";
import type { Participant } from "../../../shared/protocol";
import type { RemoteMedia } from "../media/useMedia";
import { ScreenView } from "./ScreenView";
import { VideoTile } from "./VideoTile";

interface Props {
  selfId: string;
  selfName: string;
  participants: Participant[];
  remote: RemoteMedia;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
}

/**
 * Área central da sala: compartilhamento de tela em destaque (se houver) e,
 * abaixo, as câmeras.
 */
export function Stage({ selfId, selfName, participants, remote, localCamera, localScreen }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);

  const others = participants.filter((p) => p.id !== selfId);
  const sharers = others.filter((p) => p.screenOn && remote[p.id]?.screen);
  const cameras = others.filter((p) => p.camOn && remote[p.id]?.camera);
  // Em destaque: a tela escolhida, ou a primeira disponível.
  const spotlight = sharers.find((p) => p.id === chosen) ?? sharers[0];

  if (!spotlight && !localScreen && !localCamera && cameras.length === 0) {
    return <p className="muted">Você está na sala.</p>;
  }

  return (
    <div className={`stage-content ${spotlight ? "has-spotlight" : ""}`}>
      {spotlight && <ScreenView key={spotlight.id} stream={remote[spotlight.id]!.screen!} name={spotlight.name} />}

      {sharers.length > 1 && (
        <div className="screen-picker" role="group" aria-label="Outras telas compartilhadas">
          {sharers
            .filter((p) => p !== spotlight)
            .map((p) => (
              <button key={p.id} className="btn btn-small" onClick={() => setChosen(p.id)}>
                Ver tela de {p.name}
              </button>
            ))}
        </div>
      )}

      {localScreen && (
        <p className="sharing-banner" role="status">
          Você está compartilhando a tela.
        </p>
      )}

      <div className={`tiles ${spotlight ? "tiles-small" : ""}`}>
        {localScreen && (
          <VideoTile stream={localScreen} name={selfName} label="Sua tela" caption="Sua tela" mirrored={false} />
        )}
        {localCamera && <VideoTile stream={localCamera} name={selfName} self />}
        {cameras.map((p) => (
          <VideoTile key={p.id} stream={remote[p.id]!.camera!} name={p.name} />
        ))}
      </div>
    </div>
  );
}
