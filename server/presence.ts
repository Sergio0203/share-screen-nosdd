import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import {
  normalizeName,
  normalizeNote,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "../shared/protocol.js";
import type { RoomStore } from "./rooms.js";

/** Anti-spam: no máximo N recados por pessoa a cada janela de tempo. */
const NOTE_BURST = 5;
const NOTE_WINDOW_MS = 5000;

const inUnitRange = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export interface PresenceOptions {
  /** De quanto em quanto tempo o servidor manda ping para cada conexão. */
  heartbeatMs?: number;
  /** Sem pong por esse tempo → a conexão é considerada morta e a pessoa sai. */
  deadAfterMs?: number;
}

/**
 * WebSocket da sala: entrada com nome, lista de participantes e saída.
 * Fechar a aba fecha o socket na hora; quedas silenciosas (rede caiu)
 * são detectadas pelo heartbeat em até `deadAfterMs`.
 */
export function registerPresence(app: FastifyInstance, store: RoomStore, opts: PresenceOptions = {}) {
  const heartbeatMs = opts.heartbeatMs ?? 1000;
  const deadAfterMs = opts.deadAfterMs ?? 2500;

  /** Sockets conectados, por sala → participante. */
  const sockets = new Map<string, Map<string, WebSocket>>();

  function send(socket: WebSocket, msg: ServerMessage) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  function broadcast(roomId: string) {
    const msg: ServerMessage = { type: "participants", participants: store.list(roomId) };
    for (const socket of sockets.get(roomId)?.values() ?? []) send(socket, msg);
  }

  function fail(socket: WebSocket, code: ErrorCode) {
    send(socket, { type: "error", code });
    socket.close(1000, code);
  }

  app.get<{ Params: { id: string } }>("/api/rooms/:id/ws", { websocket: true }, (socket, req) => {
    const roomId = req.params.id;
    let participantId: string | null = null;
    let lastSeen = Date.now();
    let recentNotes: number[] = [];

    socket.on("pong", () => (lastSeen = Date.now()));
    const heartbeat = setInterval(() => {
      if (Date.now() - lastSeen > deadAfterMs) {
        socket.terminate();
        return;
      }
      socket.ping();
    }, heartbeatMs);

    socket.on("message", (raw) => {
      lastSeen = Date.now();
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return fail(socket, "bad_message");
      }

      if (msg.type === "join") {
        if (participantId) return; // já entrou
        const name = normalizeName(msg.name);
        if (!name) return fail(socket, "invalid_name");
        const result = store.join(roomId, name);
        if (!result.ok) return fail(socket, result.reason);

        participantId = result.participant.id;
        let roomSockets = sockets.get(roomId);
        if (!roomSockets) sockets.set(roomId, (roomSockets = new Map()));
        roomSockets.set(participantId, socket);

        send(socket, { type: "joined", selfId: participantId, participants: store.list(roomId) });
        broadcast(roomId);
        return;
      }

      // Daqui para baixo, só quem já entrou na sala.
      if (!participantId) return fail(socket, "bad_message");

      if (msg.type === "mic" || msg.type === "cam" || msg.type === "screen") {
        const field = ({ mic: "micOn", cam: "camOn", screen: "screenOn" } as const)[msg.type];
        store.setDevice(roomId, participantId, field, msg.on === true);
        broadcast(roomId);
        return;
      }

      if (msg.type === "note") {
        const text = normalizeNote(msg.text);
        const author = store.list(roomId).find((p) => p.id === participantId);
        const target = store.list(roomId).find((p) => p.id === msg.screenOf);
        // Só em tela que está sendo compartilhada agora, dentro da imagem.
        if (!text || !author || !target?.screenOn || !inUnitRange(msg.x) || !inUnitRange(msg.y)) return;
        const now = Date.now();
        recentNotes = recentNotes.filter((t) => now - t < NOTE_WINDOW_MS);
        if (recentNotes.length >= NOTE_BURST) return;
        recentNotes.push(now);
        const note = { id: randomUUID(), authorId: author.id, authorName: author.name, screenOf: target.id, x: msg.x, y: msg.y, text };
        for (const s of sockets.get(roomId)?.values() ?? []) send(s, { type: "note", note });
        return;
      }

      if (msg.type === "signal") {
        // Só entrega para alguém da mesma sala.
        const target = typeof msg.to === "string" ? sockets.get(roomId)?.get(msg.to) : undefined;
        if (target && msg.to !== participantId) {
          send(target, { type: "signal", from: participantId, data: msg.data });
        }
        return;
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      if (!participantId) return;
      store.leave(roomId, participantId);
      const roomSockets = sockets.get(roomId);
      roomSockets?.delete(participantId);
      if (roomSockets?.size === 0) sockets.delete(roomId);
      broadcast(roomId);
    });
  });
}
