/** Protocolo da conexão WebSocket da sala (compartilhado entre front e back). */

export const MAX_PARTICIPANTS = 6;
export const MAX_NAME_LENGTH = 30;

export interface Participant {
  id: string;
  name: string;
}

export type ClientMessage = { type: "join"; name: string };

export type ErrorCode = "room_not_found" | "room_full" | "invalid_name" | "bad_message";

export type ServerMessage =
  | { type: "joined"; selfId: string; participants: Participant[] }
  | { type: "participants"; participants: Participant[] }
  | { type: "error"; code: ErrorCode };

/** Normaliza o nome: tira espaços extras. Retorna null se inválido. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0 || [...name].length > MAX_NAME_LENGTH) return null;
  return name;
}

export function roomSocketPath(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/ws`;
}
