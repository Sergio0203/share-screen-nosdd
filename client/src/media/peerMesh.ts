import type { SignalData } from "../../../shared/protocol";
import { DEFAULT_SCREEN_QUALITY, sendParams, type SendParams } from "./screenQuality";
import { withStartBitrate } from "./sdp";

/**
 * Servidores STUN públicos, para descobrir o endereço público de cada pessoa.
 * Sem TURN: redes muito restritivas (alguns 4G/corporativas) podem não conectar.
 */
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

/**
 * Canais de mídia de cada conexão, na ordem em que são negociados. A ordem é a
 * mesma dos dois lados (é a ordem das linhas m= do SDP), então o índice do
 * transceiver identifica o canal.
 */
export const SLOTS = [
  { name: "audio", kind: "audio" },
  { name: "camera", kind: "video" },
  { name: "screen", kind: "video" },
] as const;
export type Slot = (typeof SLOTS)[number]["name"];

/**
 * Ao começar a enviar, o encoder parte em resolução cheia por alguns segundos
 * e só depois adota a política do perfil (ex.: manter fps). Sem isso, no lado
 * que respondeu à oferta, o Chrome começava a tela em 720p e só subia para
 * 1080p depois de ~10 s.
 */
const STARTUP_BOOST_MS = 3000;

/** Limites de envio padrão por canal (por cópia; cada pessoa envia até 5). */
const DEFAULT_SEND_PARAMS: Partial<Record<Slot, SendParams>> = {
  camera: { maxBitrate: 500_000 },
  screen: sendParams(DEFAULT_SCREEN_QUALITY),
};

interface Peer {
  pc: RTCPeerConnection;
  /** Quem faz a oferta neste par. O outro lado só responde. */
  offerer: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Canais reservados, por nome (existem depois da primeira negociação). */
  transceivers: Partial<Record<Slot, RTCRtpTransceiver>>;
  /** Mensagens de sinalização processadas em ordem, uma de cada vez. */
  queue: Promise<void>;
}

export interface PeerMeshOptions {
  selfId: string;
  sendSignal(to: string, data: SignalData): void;
  /** Chamado quando chega (ou some, com null) a mídia de alguém num canal. */
  onRemoteTrack(peerId: string, slot: Slot, stream: MediaStream | null): void;
  rtcConfig?: RTCConfiguration;
}

/**
 * Uma conexão WebRTC direta com cada outra pessoa da sala (malha).
 *
 * Para evitar colisão de ofertas, em cada par só quem tem o menor id oferece.
 * A conexão é montada assim que os dois estão na sala, já com todos os canais
 * (áudio, câmera, tela) nos dois sentidos; ligar/desligar um dispositivo só troca a
 * trilha (replaceTrack), sem renegociar.
 *
 * Por que não deixar os dois lados negociarem ("perfect negotiation")?
 * No Chromium, desfazer a própria oferta (rollback) durante a coleta de
 * candidatos ICE trava a coleta: a resposta sai sem candidatos e o par fica
 * mudo. Acontecia com várias pessoas ligando o microfone juntas.
 */
export class PeerMesh {
  private peers = new Map<string, Peer>();
  private local: Record<Slot, MediaStreamTrack | null> = { audio: null, camera: null, screen: null };
  private params: Partial<Record<Slot, SendParams>> = { ...DEFAULT_SEND_PARAMS };
  private boostTimers = new Set<ReturnType<typeof setTimeout>>();
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

  /** Começa (track) ou para (null) de enviar num canal para todos. */
  setTrack(slot: Slot, track: MediaStreamTrack | null): void {
    this.local[slot] = track;
    for (const peer of this.peers.values()) {
      this.applyTrack(peer, slot);
      if (track) void this.applyParams(peer, slot);
    }
  }

  /** Muda banda/fps máximos enviados num canal, em todas as conexões (sem renegociar). */
  setSendParams(slot: Slot, params: SendParams): Promise<void> {
    this.params[slot] = params;
    return Promise.all([...this.peers.values()].map((peer) => this.applyParams(peer, slot))).then(() => {});
  }

  /** Aplica os limites do canal a uma conexão, com a partida em resolução cheia. */
  private async applyParams(peer: Peer, slot: Slot): Promise<void> {
    const params = this.params[slot];
    const sender = peer.transceivers[slot]?.sender;
    if (!params || !sender) return;
    const needsBoost = params.degradationPreference && params.degradationPreference !== "maintain-resolution";
    if (!needsBoost) return applySendParams(sender, params);
    await applySendParams(sender, { ...params, degradationPreference: "maintain-resolution" });
    const timer = setTimeout(() => {
      this.boostTimers.delete(timer);
      // Usa os limites atuais (podem ter mudado nesse meio-tempo).
      const current = this.params[slot];
      if (!this.closed && current && peer.transceivers[slot]?.sender === sender) void applySendParams(sender, current);
    }, STARTUP_BOOST_MS);
    this.boostTimers.add(timer);
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
    for (const timer of this.boostTimers) clearTimeout(timer);
    this.boostTimers.clear();
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  private isOfferer(peerId: string): boolean {
    return this.opts.selfId < peerId;
  }

  private applyTrack(peer: Peer, slot: Slot): void {
    peer.transceivers[slot]?.sender.replaceTrack(this.local[slot]).catch(() => {});
  }

  private adopt(peer: Peer, slot: Slot, t: RTCRtpTransceiver): void {
    peer.transceivers[slot] = t;
    this.applyTrack(peer, slot);
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
      transceivers: {},
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
    pc.ontrack = ({ track, transceiver }) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(transceiver)];
      if (slot && slot.kind === track.kind) this.opts.onRemoteTrack(id, slot.name, new MediaStream([track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && peer.offerer) pc.restartIce();
    };

    if (peer.offerer) {
      // Reserva todos os canais já na primeira oferta (dispara a negociação).
      for (const slot of SLOTS) {
        const params = this.params[slot.name];
        const t = pc.addTransceiver(slot.kind, {
          direction: "sendrecv",
          sendEncodings: params ? [{ maxBitrate: params.maxBitrate, maxFramerate: params.maxFramerate }] : undefined,
        });
        this.adopt(peer, slot.name, t);
      }
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
      // Começa a estimativa de banda alta, para a tela não sair borrada no início.
      await pc.setRemoteDescription(
        description.sdp ? { type: description.type, sdp: withStartBitrate(description.sdp) } : description,
      );
      if (description.type === "answer") {
        // Negociação concluída: aplica os limites completos (sendEncodings não
        // cobre degradationPreference).
        for (const slot of SLOTS) void this.applyParams(peer, slot.name);
      }
      if (description.type === "offer") {
        const adopted = this.adoptRemoteTransceivers(peer);
        await pc.setLocalDescription();
        this.opts.sendSignal(from, { description: pc.localDescription?.toJSON() });
        // Só depois da resposta o navegador tem os parâmetros de envio.
        for (const slot of adopted) void this.applyParams(peer, slot);
      }
    } else if (candidate !== undefined) {
      try {
        await pc.addIceCandidate(candidate ?? undefined);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  }

  /** Lado que responde: usa os canais criados pela oferta para enviar também. */
  private adoptRemoteTransceivers(peer: Peer): Slot[] {
    const adopted: Slot[] = [];
    peer.pc.getTransceivers().forEach((t, i) => {
      const slot = SLOTS[i];
      if (!slot || peer.transceivers[slot.name] || t.receiver.track.kind !== slot.kind) return;
      t.direction = "sendrecv";
      this.adopt(peer, slot.name, t);
      adopted.push(slot.name);
    });
    return adopted;
  }

  private removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(id);
    for (const slot of SLOTS) this.opts.onRemoteTrack(id, slot.name, null);
  }
}

async function applySendParams(
  sender: RTCRtpSender,
  { maxBitrate, maxFramerate, degradationPreference }: SendParams,
): Promise<void> {
  try {
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (degradationPreference) params.degradationPreference = degradationPreference;
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = maxBitrate;
    if (maxFramerate) params.encodings[0].maxFramerate = maxFramerate;
    else delete params.encodings[0].maxFramerate;
    await sender.setParameters(params);
  } catch {
    // Navegador sem suporte: segue com o que conseguir.
  }
}
