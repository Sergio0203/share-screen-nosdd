import {
  roomSocketPath,
  type ClientMessage,
  type ErrorCode,
  type Participant,
  type ServerMessage,
  type SignalData,
} from "../../shared/protocol";

export type ConnectionEvent =
  | { type: "joined"; selfId: string; participants: Participant[] }
  | { type: "participants"; participants: Participant[] }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "error"; code: ErrorCode }
  /** Conexão caiu sem que tenhamos pedido para sair. */
  | { type: "disconnected" };

export interface RoomConnection {
  send(msg: ClientMessage): void;
  close(): void;
}

function socketUrl(roomId: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${roomSocketPath(roomId)}`;
}

/** Abre o WebSocket da sala, entra com o nome e repassa os eventos. */
export function joinRoom(roomId: string, name: string, onEvent: (e: ConnectionEvent) => void): RoomConnection {
  const socket = new WebSocket(socketUrl(roomId));
  let closedByUs = false;
  let gotError = false;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", name }));
  });

  socket.addEventListener("message", (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "error") gotError = true;
    onEvent(msg);
  });

  socket.addEventListener("close", () => {
    if (!closedByUs && !gotError) onEvent({ type: "disconnected" });
  });

  return {
    send(msg) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    },
    close() {
      closedByUs = true;
      socket.close();
    },
  };
}
