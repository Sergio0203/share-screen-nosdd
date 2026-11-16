import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  normalizeName,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "../shared/protocol.js";
import type { RoomStore } from "./rooms.js";

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
