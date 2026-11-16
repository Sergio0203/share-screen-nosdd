export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error(`Falha ao criar sala (${res.status})`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

export type RoomInfo = { exists: false } | { exists: true; full: boolean };

/** Consulta a sala. Lança em erro de rede. */
export async function getRoom(id: string): Promise<RoomInfo> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`Falha ao abrir sala (${res.status})`);
  const body = (await res.json()) as { full: boolean };
  return { exists: true, full: body.full };
}

export function roomPath(id: string): string {
  return `/sala/${id}`;
}

export function roomUrl(id: string): string {
  return `${window.location.origin}${roomPath(id)}`;
}
