export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error(`Falha ao criar sala (${res.status})`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** true se a sala existe, false se não existe. Lança em erro de rede. */
export async function roomExists(id: string): Promise<boolean> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Falha ao abrir sala (${res.status})`);
  return true;
}

export function roomPath(id: string): string {
  return `/sala/${id}`;
}

export function roomUrl(id: string): string {
  return `${window.location.origin}${roomPath(id)}`;
}
