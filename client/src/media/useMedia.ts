import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, SignalData } from "../../../shared/protocol";
import type { RoomConnection } from "../roomConnection";
import { PeerMesh, type Slot } from "./peerMesh";

export type Device = "mic" | "cam";
export type DeviceState = "off" | "starting" | "on";
export type DeviceError = "denied" | "not_found" | "in_use" | "insecure" | "other";

const DEVICES: Record<Device, { slot: Slot; constraints: MediaStreamConstraints }> = {
  mic: {
    slot: "audio",
    constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
  },
  cam: {
    slot: "camera",
    // Resolução modesta: cada pessoa envia até 5 cópias do vídeo.
    constraints: { video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } },
  },
};

function classify(err: unknown): DeviceError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "AbortError") return "in_use";
  return "other";
}

/** Mídia que chega de cada pessoa, por canal. */
export type RemoteMedia = Record<string, Partial<Record<Slot, MediaStream>>>;

interface Options {
  connection: RoomConnection | null;
  selfId: string | null;
  participants: Participant[];
}

/**
 * Mídia da sala: liga/desliga microfone e câmera, envia para todos pela malha
 * WebRTC e expõe o que chega de cada pessoa.
 */
export function useMedia({ connection, selfId, participants }: Options) {
  const [state, setState] = useState<Record<Device, DeviceState>>({ mic: "off", cam: "off" });
  const [errors, setErrors] = useState<Record<Device, DeviceError | null>>({ mic: null, cam: null });
  const [remote, setRemote] = useState<RemoteMedia>({});
  const [localCamera, setLocalCamera] = useState<MediaStream | null>(null);
  const mesh = useRef<PeerMesh | null>(null);
  const tracks = useRef<Record<Device, MediaStreamTrack | null>>({ mic: null, cam: null });
  /** Sinalização que chegou antes da malha existir (logo após entrar). */
  const pending = useRef<Array<[string, SignalData]>>([]);
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  const setDevice = (device: Device, value: DeviceState) => setState((s) => ({ ...s, [device]: value }));
  const setError = (device: Device, value: DeviceError | null) => setErrors((e) => ({ ...e, [device]: value }));

  // Uma malha por entrada na sala.
  useEffect(() => {
    if (!connection || !selfId) return;
    const m = new PeerMesh({
      selfId,
      sendSignal: (to, data) => connection.send({ type: "signal", to, data }),
      onRemoteTrack: (peerId, slot, stream) =>
        setRemote((prev) => {
          const media = { ...prev[peerId] };
          if (stream) media[slot] = stream;
          else delete media[slot];
          const next = { ...prev, [peerId]: media };
          if (Object.keys(media).length === 0) delete next[peerId];
          return next;
        }),
    });
    mesh.current = m;
    m.setParticipants(participantsRef.current.map((p) => p.id));
    for (const [from, data] of pending.current.splice(0)) m.handleSignal(from, data);
    return () => {
      m.close();
      mesh.current = null;
      for (const d of ["mic", "cam"] as const) {
        tracks.current[d]?.stop();
        tracks.current[d] = null;
      }
      setState({ mic: "off", cam: "off" });
      setLocalCamera(null);
      setRemote({});
    };
  }, [connection, selfId]);

  const ids = participants.map((p) => p.id).join(",");
  useEffect(() => {
    mesh.current?.setParticipants(ids ? ids.split(",") : []);
  }, [ids, connection, selfId]);

  /** Repassa a sinalização recebida pelo WebSocket. */
  const handleSignal = useCallback((from: string, data: SignalData) => {
    if (mesh.current) mesh.current.handleSignal(from, data);
    else pending.current.push([from, data]);
  }, []);

  const turnOff = useCallback(
    (device: Device) => {
      tracks.current[device]?.stop();
      tracks.current[device] = null;
      mesh.current?.setTrack(DEVICES[device].slot, null);
      connection?.send({ type: device, on: false });
      if (device === "cam") setLocalCamera(null);
      setDevice(device, "off");
    },
    [connection],
  );

  const turnOn = useCallback(
    async (device: Device) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(device, "insecure");
        return;
      }
      setDevice(device, "starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia(DEVICES[device].constraints);
        const track = stream.getTracks()[0];
        if (!mesh.current) {
          track.stop(); // saiu da sala enquanto esperava a permissão
          return;
        }
        tracks.current[device] = track;
        // Dispositivo desconectado / permissão revogada no meio da conversa.
        track.addEventListener("ended", () => tracks.current[device] === track && turnOff(device));
        mesh.current.setTrack(DEVICES[device].slot, track);
        connection?.send({ type: device, on: true });
        if (device === "cam") setLocalCamera(stream);
        setError(device, null);
        setDevice(device, "on");
      } catch (err) {
        setError(device, classify(err));
        setDevice(device, "off");
      }
    },
    [connection, turnOff],
  );

  const toggle = useCallback(
    (device: Device) => {
      if (state[device] === "on") turnOff(device);
      else if (state[device] === "off") void turnOn(device);
    },
    [state, turnOn, turnOff],
  );

  return {
    mic: state.mic,
    cam: state.cam,
    errors,
    dismissError: (device: Device) => setError(device, null),
    toggle,
    remote,
    localCamera,
    handleSignal,
  };
}
