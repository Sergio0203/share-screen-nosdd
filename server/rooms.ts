import { randomBytes, randomUUID } from "node:crypto";
import { MAX_PARTICIPANTS, type Participant } from "../shared/protocol.js";

/** 16 bytes aleatórios (128 bits) em base64url → 22 caracteres. Inviável de adivinhar. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function generateRoomId(): string {
  return randomBytes(16).toString("base64url");
}

export interface Room {
  id: string;
  /** Última vez que alguém entrou ou saiu (ou a criação). */
  lastActiveAt: number;
  participants: Map<string, Participant>;
}

export type JoinResult = { ok: true; participant: Participant } | { ok: false; reason: "room_not_found" | "room_full" };

/**
 * Salas em memória. Não há persistência de propósito: uma sala é efêmera,
 * e reiniciar o servidor encerra todas. Uma sala vazia expira depois do TTL.
 */
export class RoomStore {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  create(): Room {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    const room: Room = { id, lastActiveAt: this.now(), participants: new Map() };
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    if (!ROOM_ID_PATTERN.test(id)) return undefined;
    const room = this.rooms.get(id);
    if (room && this.isExpired(room)) {
      this.rooms.delete(id);
      return undefined;
    }
    return room;
  }

  join(roomId: string, name: string): JoinResult {
    const room = this.get(roomId);
    if (!room) return { ok: false, reason: "room_not_found" };
    if (room.participants.size >= MAX_PARTICIPANTS) return { ok: false, reason: "room_full" };
    const participant: Participant = { id: randomUUID(), name, micOn: false, camOn: false };
    room.participants.set(participant.id, participant);
    room.lastActiveAt = this.now();
    return { ok: true, participant };
  }

  leave(roomId: string, participantId: string): void {
    const room = this.rooms.get(roomId);
    if (!room?.participants.delete(participantId)) return;
    room.lastActiveAt = this.now();
  }

  setDevice(roomId: string, participantId: string, device: "micOn" | "camOn", on: boolean): void {
    const participant = this.rooms.get(roomId)?.participants.get(participantId);
    if (participant) participant[device] = on;
  }

  /** Participantes na ordem de entrada. */
  list(roomId: string): Participant[] {
    return [...(this.rooms.get(roomId)?.participants.values() ?? [])].map((p) => ({ ...p }));
  }

  /** Remove salas expiradas. Chamado periodicamente pelo servidor. */
  sweep(): void {
    for (const room of this.rooms.values()) {
      if (this.isExpired(room)) this.rooms.delete(room.id);
    }
  }

  get size(): number {
    return this.rooms.size;
  }

  private isExpired(room: Room): boolean {
    return room.participants.size === 0 && this.now() - room.lastActiveAt > this.ttlMs;
  }
}
