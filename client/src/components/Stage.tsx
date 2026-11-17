import { useState } from "react";
import type { Note, Participant } from "../../../shared/protocol";
import { SCREEN_QUALITIES, type ScreenQuality } from "../media/screenQuality";
import type { CaptureInfo, RemoteMedia } from "../media/useMedia";
import { ScreenView } from "./ScreenView";
import { VideoTile } from "./VideoTile";

interface Props {
  selfId: string;
  selfName: string;
  participants: Participant[];
  remote: RemoteMedia;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  screenQuality: ScreenQuality;
  screenCapture: CaptureInfo | null;
  notes: Note[];
  /** Escreve um recado na tela de `screenOf`, na posição relativa (x, y). */
  onWriteNote(screenOf: string, x: number, y: number, text: string): void;
}

interface SharedScreen {
  id: string;
  label: string;
  /** Texto do botão para trocar o destaque para esta tela. */
  pick: string;
  stream: MediaStream;
}

/**
 * Área central da sala. Com tela compartilhada: a tela em destaque ocupa todo o
 * espaço que sobra, e as câmeras ficam numa faixa abaixo. Sem tela: as câmeras
 * em grade.
 */
export function Stage({
  selfId,
  selfName,
  participants,
  remote,
  localCamera,
  localScreen,
  screenQuality,
  screenCapture,
  notes,
  onWriteNote,
}: Props) {
  const [chosen, setChosen] = useState<string | null>(null);

  const others = participants.filter((p) => p.id !== selfId);
  const cameras = others.filter((p) => p.camOn && remote[p.id]?.camera);
  const screens: SharedScreen[] = others
    .filter((p) => p.screenOn && remote[p.id]?.screen)
    .map((p) => ({ id: p.id, label: `Tela de ${p.name}`, pick: `Ver tela de ${p.name}`, stream: remote[p.id]!.screen! }));
  // A própria tela também vai para o destaque — por último: se outra pessoa
  // também estiver compartilhando, mostra a dela primeiro.
  if (localScreen) screens.push({ id: selfId, label: "Sua tela", pick: "Ver sua tela", stream: localScreen });
  const spotlight = screens.find((s) => s.id === chosen) ?? screens[0];

  const cameraTiles = (
    <>
      {localCamera && <VideoTile stream={localCamera} name={selfName} self />}
      {cameras.map((p) => (
        <VideoTile key={p.id} stream={remote[p.id]!.camera!} name={p.name} />
      ))}
    </>
  );

  if (!spotlight) {
    if (!localCamera && cameras.length === 0) return <p className="muted stage-empty">Você está na sala.</p>;
    return <div className="tiles">{cameraTiles}</div>;
  }

  return (
    <>
      {localScreen && (
        <div className="sharing-banner" role="status">
          <p>Você está compartilhando a tela.</p>
          <p className="sharing-quality">
            Qualidade ativa: <strong>{SCREEN_QUALITIES[screenQuality].label}</strong>
            {screenCapture && (
              <span className="muted">
                {" "}
                · capturando {screenCapture.width}×{screenCapture.height} a {screenCapture.frameRate} fps
                {screenCapture.height < SCREEN_QUALITIES[screenQuality].height && " (a janela é menor que a qualidade escolhida)"}
              </span>
            )}
          </p>
        </div>
      )}

      <ScreenView
        key={spotlight.id}
        stream={spotlight.stream}
        label={spotlight.label}
        notes={notes.filter((n) => n.screenOf === spotlight.id)}
        onWrite={(x, y, text) => onWriteNote(spotlight.id, x, y, text)}
      />

      {screens.length > 1 && (
        <div className="screen-picker" role="group" aria-label="Outras telas compartilhadas">
          {screens
            .filter((s) => s !== spotlight)
            .map((s) => (
              <button key={s.id} className="btn btn-small" onClick={() => setChosen(s.id)}>
                {s.pick}
              </button>
            ))}
        </div>
      )}

      {(localCamera || cameras.length > 0) && (
        <div className="camera-strip" role="group" aria-label="Câmeras">
          {cameraTiles}
        </div>
      )}
    </>
  );
}
