/** Protocolo da conexão WebSocket da sala (compartilhado entre front e back). */

export const MAX_PARTICIPANTS = 6;
export const MAX_NAME_LENGTH = 30;
export const MAX_NOTE_LENGTH = 100;

export interface Participant {
  id: string;
  name: string;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
}

/**
 * Dados de sinalização WebRTC repassados de um participante para outro.
 * O servidor não interpreta: só entrega ao destinatário.
 */
export interface SignalData {
  description?: RTCSessionDescriptionInit | null;
  candidate?: RTCIceCandidateInit | null;
}

/**
 * Recado escrito em cima de uma tela compartilhada. x e y vão de 0 a 1,
 * relativos à imagem compartilhada (não à janela de quem escreveu): assim o
 * recado cai no mesmo ponto da imagem para todos.
 */
export interface Note {
  id: string;
  authorId: string;
  authorName: string;
  /** Id de quem está compartilhando a tela onde o recado foi escrito. */
  screenOf: string;
  x: number;
  y: number;
  /** Sempre exibido como texto puro. */
  text: string;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "mic"; on: boolean }
  | { type: "cam"; on: boolean }
  | { type: "screen"; on: boolean }
  | { type: "signal"; to: string; data: SignalData }
  | { type: "note"; screenOf: string; x: number; y: number; text: string };

export type ErrorCode = "room_not_found" | "room_full" | "invalid_name" | "bad_message";

export type ServerMessage =
  | { type: "joined"; selfId: string; participants: Participant[] }
  | { type: "participants"; participants: Participant[] }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "note"; note: Note }
  | { type: "error"; code: ErrorCode };

/** Normaliza o nome: tira espaços extras. Retorna null se inválido. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0 || [...name].length > MAX_NAME_LENGTH) return null;
  return name;
}

/** Tamanho do texto em caracteres (um emoji conta como 1). */
export function textLength(text: string): number {
  return [...text].length;
}

/** Corta o texto em `max` caracteres sem quebrar emojis ao meio. */
export function clipText(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** Normaliza o recado: sem espaços nas pontas, 1 a 100 caracteres. Retorna null se inválido. */
export function normalizeNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0 || textLength(text) > MAX_NOTE_LENGTH) return null;
  return text;
}

export function roomSocketPath(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/ws`;
}
