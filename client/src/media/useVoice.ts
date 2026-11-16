import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, SignalData } from "../../../shared/protocol";
import type { RoomConnection } from "../roomConnection";
import { PeerMesh } from "./peerMesh";

export type MicState = "off" | "starting" | "on";
export type MicError = "denied" | "not_found" | "in_use" | "insecure" | "other";

function classify(err: unknown): MicError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "AbortError") return "in_use";
  return "other";
}

interface Options {
  connection: RoomConnection | null;
  selfId: string | null;
  participants: Participant[];
}

/**
 * Voz da sala: liga/desliga o microfone, envia para todos pela malha WebRTC
 * e expõe o áudio que chega de cada pessoa.
 */
export function useVoice({ connection, selfId, participants }: Options) {
  const [mic, setMic] = useState<MicState>("off");
  const [micError, setMicError] = useState<MicError | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const mesh = useRef<PeerMesh | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  /** Sinalização que chegou antes da malha existir (logo após entrar). */
  const pending = useRef<Array<[string, SignalData]>>([]);

  // Uma malha por entrada na sala.
  useEffect(() => {
    if (!connection || !selfId) return;
    const m = new PeerMesh({
      selfId,
      sendSignal: (to: string, data: SignalData) => connection.send({ type: "signal", to, data }),
      onRemoteStream: (peerId, stream) =>
        setRemoteStreams((prev) => {
          const next = { ...prev };
          if (stream) next[peerId] = stream;
          else delete next[peerId];
          return next;
        }),
    });
    mesh.current = m;
    m.setParticipants(participantsRef.current.map((p) => p.id));
    for (const [from, data] of pending.current.splice(0)) m.handleSignal(from, data);
    return () => {
      m.close();
      mesh.current = null;
      track.current?.stop();
      track.current = null;
      setMic("off");
      setRemoteStreams({});
    };
  }, [connection, selfId]);

  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  const ids = participants.map((p) => p.id).join(",");
  useEffect(() => {
    mesh.current?.setParticipants(ids ? ids.split(",") : []);
  }, [ids, connection, selfId]);

  /** Repassa a sinalização recebida pelo WebSocket. */
  const handleSignal = useCallback((from: string, data: SignalData) => {
    if (mesh.current) mesh.current.handleSignal(from, data);
    else pending.current.push([from, data]);
  }, []);

  const turnOff = useCallback(() => {
    track.current?.stop();
    track.current = null;
    mesh.current?.setAudioTrack(null);
    connection?.send({ type: "mic", on: false });
    setMic("off");
  }, [connection]);

  const turnOn = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("insecure");
      return;
    }
    setMic("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const t = stream.getAudioTracks()[0];
      if (!mesh.current) {
        t.stop(); // saiu da sala enquanto esperava a permissão
        return;
      }
      track.current = t;
      // Microfone desconectado / revogado no meio da conversa.
      t.addEventListener("ended", () => track.current === t && turnOff());
      mesh.current.setAudioTrack(t);
      connection?.send({ type: "mic", on: true });
      setMicError(null);
      setMic("on");
    } catch (err) {
      setMicError(classify(err));
      setMic("off");
    }
  }, [connection, turnOff]);

  const toggleMic = useCallback(() => {
    if (mic === "on") turnOff();
    else if (mic === "off") void turnOn();
  }, [mic, turnOn, turnOff]);

  return { mic, micError, dismissMicError: () => setMicError(null), toggleMic, remoteStreams, handleSignal };
}
