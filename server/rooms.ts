import { randomBytes } from "node:crypto";

/** 16 bytes aleatórios (128 bits) em base64url → 22 caracteres. Inviável de adivinhar. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function generateRoomId(): string {
  return randomBytes(16).toString("base64url");
}

export interface Room {
  id: string;
  createdAt: number;
}

/**
 * Salas em memória. Não há persistência de propósito: uma sala é efêmera,
 * e reiniciar o servidor encerra todas.
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
    const room: Room = { id, createdAt: this.now() };
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
    return this.now() - room.createdAt > this.ttlMs;
  }
}
