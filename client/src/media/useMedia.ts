import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, SignalData } from "../../../shared/protocol";
import type { RoomConnection } from "../roomConnection";
import { PeerMesh, type Slot } from "./peerMesh";

export type Device = "mic" | "cam" | "screen";
export const ALL_DEVICES: Device[] = ["mic", "cam", "screen"];
export type DeviceState = "off" | "starting" | "on";
export type DeviceError =
  | "denied"
  /** Bloqueado pelo sistema operacional (ex.: macOS sem permissão de Gravação de Tela). */
  | "system_denied"
  | "not_found"
  | "in_use"
  | "insecure"
  /** O navegador não tem a função (ex.: compartilhar tela no celular). */
  | "unsupported"
  | "other";

interface DeviceConfig {
  slot: Slot;
  supported(): boolean;
  acquire(): Promise<MediaStream>;
}

const DEVICES: Record<Device, DeviceConfig> = {
  mic: {
    slot: "audio",
    supported: () => !!navigator.mediaDevices?.getUserMedia,
    acquire: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
  },
  cam: {
    slot: "camera",
    supported: () => !!navigator.mediaDevices?.getUserMedia,
    // Resolução modesta: cada pessoa envia até 5 cópias do vídeo.
    acquire: () =>
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
      }),
  },
  screen: {
    slot: "screen",
    supported: () => !!navigator.mediaDevices?.getDisplayMedia,
    acquire: async () => {
      // O seletor do navegador oferece tela inteira, janela de um app ou aba.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
        // Não oferecer a própria aba do Telão (efeito espelho infinito).
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);
      // Jogos: prioriza fluidez em vez de nitidez quando falta banda.
      const track = stream.getVideoTracks()[0];
      if (track && "contentHint" in track) track.contentHint = "motion";
      return stream;
    },
  },
};

function classify(err: unknown): DeviceError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  const message = err instanceof Error || err instanceof DOMException ? err.message : "";
  if (name === "NotAllowedError" && /system/i.test(message)) return "system_denied";
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
  const [state, setState] = useState<Record<Device, DeviceState>>({ mic: "off", cam: "off", screen: "off" });
  const [errors, setErrors] = useState<Record<Device, DeviceError | null>>({ mic: null, cam: null, screen: null });
  const [remote, setRemote] = useState<RemoteMedia>({});
  const [local, setLocal] = useState<Record<Device, MediaStream | null>>({ mic: null, cam: null, screen: null });
  const mesh = useRef<PeerMesh | null>(null);
  const tracks = useRef<Record<Device, MediaStreamTrack | null>>({ mic: null, cam: null, screen: null });
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
      for (const d of ALL_DEVICES) {
        tracks.current[d]?.stop();
        tracks.current[d] = null;
      }
      setState({ mic: "off", cam: "off", screen: "off" });
      setLocal({ mic: null, cam: null, screen: null });
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
      setLocal((l) => ({ ...l, [device]: null }));
      setDevice(device, "off");
    },
    [connection],
  );

  const turnOn = useCallback(
    async (device: Device) => {
      if (!DEVICES[device].supported()) {
        setError(device, window.isSecureContext === false ? "insecure" : "unsupported");
        return;
      }
      setDevice(device, "starting");
      try {
        const stream = await DEVICES[device].acquire();
        const track = stream.getTracks()[0];
        if (!mesh.current) {
          track.stop(); // saiu da sala enquanto esperava a permissão
          return;
        }
        tracks.current[device] = track;
        // Dispositivo desconectado, permissão revogada ou — na tela — o botão
        // nativo "Parar compartilhamento" do navegador.
        track.addEventListener("ended", () => tracks.current[device] === track && turnOff(device));
        mesh.current.setTrack(DEVICES[device].slot, track);
        connection?.send({ type: device, on: true });
        setLocal((l) => ({ ...l, [device]: stream }));
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
    state,
    errors,
    dismissError: (device: Device) => setError(device, null),
    toggle,
    remote,
    local,
    handleSignal,
  };
}
