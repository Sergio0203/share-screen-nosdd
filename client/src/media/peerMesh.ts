import type { SignalData } from "../../../shared/protocol";

/**
 * Servidores STUN públicos, para descobrir o endereço público de cada pessoa.
 * Sem TURN: redes muito restritivas (alguns 4G/corporativas) podem não conectar.
 */
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

interface Peer {
  pc: RTCPeerConnection;
  /** Quem faz a oferta neste par. O outro lado só responde. */
  offerer: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Canal de áudio reservado (existe depois da primeira negociação). */
  audio: RTCRtpTransceiver | null;
  /** Mensagens de sinalização processadas em ordem, uma de cada vez. */
  queue: Promise<void>;
}

export interface PeerMeshOptions {
  selfId: string;
  sendSignal(to: string, data: SignalData): void;
  /** Chamado quando chega (ou some, com null) o áudio de alguém. */
  onRemoteStream(peerId: string, stream: MediaStream | null): void;
  rtcConfig?: RTCConfiguration;
}

/**
 * Uma conexão WebRTC direta com cada outra pessoa da sala (malha). Com até 6
 * pessoas, cada uma envia no máximo 5 cópias do próprio áudio — tranquilo.
 *
 * Para evitar colisão de ofertas, em cada par só quem tem o menor id oferece.
 * A conexão é montada assim que os dois estão na sala, já com um canal de áudio
 * nos dois sentidos; ligar/desligar o microfone só troca a trilha
 * (replaceTrack), sem renegociar.
 *
 * Por que não deixar os dois lados negociarem ("perfect negotiation")?
 * No Chromium, desfazer a própria oferta (rollback) durante a coleta de
 * candidatos ICE trava a coleta: a resposta sai sem candidatos e o par fica
 * mudo. Acontecia com várias pessoas ligando o microfone juntas.
 */
export class PeerMesh {
  private peers = new Map<string, Peer>();
  private localStream = new MediaStream();
  private audioTrack: MediaStreamTrack | null = null;
  private closed = false;

  constructor(private readonly opts: PeerMeshOptions) {}

  /** Atualiza quem está na sala: conecta com quem chegou, fecha com quem saiu. */
  setParticipants(ids: string[]): void {
    if (this.closed) return;
    const present = new Set(ids.filter((id) => id !== this.opts.selfId));
    for (const id of [...this.peers.keys()]) {
      if (!present.has(id)) this.removePeer(id);
    }
    for (const id of present) {
      if (this.isOfferer(id)) this.ensurePeer(id);
    }
  }

  /** Liga (track) ou desliga (null) o envio do microfone para todos. */
  setAudioTrack(track: MediaStreamTrack | null): void {
    if (this.audioTrack) this.localStream.removeTrack(this.audioTrack);
    this.audioTrack = track;
    if (track) this.localStream.addTrack(track);
    for (const peer of this.peers.values()) this.applyAudio(peer);
  }

  handleSignal(from: string, data: SignalData): void {
    if (this.closed) return;
    const peer = this.ensurePeer(from);
    peer.queue = peer.queue
      .then(() => this.processSignal(peer, from, data))
      .catch((err) => console.warn("[telão] sinalização falhou com", from, err));
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  private isOfferer(peerId: string): boolean {
    return this.opts.selfId < peerId;
  }

  private applyAudio(peer: Peer): void {
    peer.audio?.sender.replaceTrack(this.audioTrack).catch(() => {});
  }

  private ensurePeer(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;

    const pc = new RTCPeerConnection(this.opts.rtcConfig ?? DEFAULT_RTC_CONFIG);
    const peer: Peer = {
      pc,
      offerer: this.isOfferer(id),
      makingOffer: false,
      ignoreOffer: false,
      audio: null,
      queue: Promise.resolve(),
    };
    this.peers.set(id, peer);

    pc.onnegotiationneeded = async () => {
      // Só o ofertante inicia negociação; o outro lado nunca muda os canais.
      if (!peer.offerer) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.opts.sendSignal(id, { description: pc.localDescription?.toJSON() });
      } catch (err) {
        console.warn("[telão] falha ao negociar com", id, err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      this.opts.sendSignal(id, { candidate: candidate ? candidate.toJSON() : null });
    };
    pc.ontrack = ({ track, streams }) => {
      if (track.kind !== "audio") return;
      this.opts.onRemoteStream(id, streams[0] ?? new MediaStream([track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && peer.offerer) pc.restartIce();
    };

    if (peer.offerer) {
      // Reserva o canal de áudio já na primeira oferta (dispara a negociação).
      peer.audio = pc.addTransceiver("audio", { direction: "sendrecv", streams: [this.localStream] });
      this.applyAudio(peer);
    }
    return peer;
  }

  private async processSignal(peer: Peer, from: string, { description, candidate }: SignalData): Promise<void> {
    const { pc } = peer;
    if (description) {
      // Não deveria haver colisão (só um lado oferece), mas se houver, o
      // ofertante ignora a oferta alheia.
      const collision = description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
      peer.ignoreOffer = peer.offerer && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        this.adoptAudioTransceiver(peer);
        await pc.setLocalDescription();
        this.opts.sendSignal(from, { description: pc.localDescription?.toJSON() });
      }
    } else if (candidate !== undefined) {
      try {
        await pc.addIceCandidate(candidate ?? undefined);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  }

  /** Lado que responde: usa o canal de áudio criado pela oferta para enviar também. */
  private adoptAudioTransceiver(peer: Peer): void {
    if (peer.audio) return;
    const t = peer.pc.getTransceivers().find((x) => x.receiver.track.kind === "audio");
    if (!t) return;
    t.direction = "sendrecv";
    t.sender.setStreams?.(this.localStream);
    peer.audio = t;
    this.applyAudio(peer);
  }

  private removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(id);
    this.opts.onRemoteStream(id, null);
  }
}
