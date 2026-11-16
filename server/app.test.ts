import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { ROOM_ID_PATTERN, RoomStore } from "./rooms.js";

describe("API de salas", () => {
  it("cria uma sala com id difícil de adivinhar", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/api/rooms" });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(ROOM_ID_PATTERN);
  });

  it("cada sala tem um id único", async () => {
    const app = buildApp();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      ids.add((await app.inject({ method: "POST", url: "/api/rooms" })).json().id);
    }
    expect(ids.size).toBe(200);
  });

  it("encontra uma sala criada e recusa ids desconhecidos ou malformados", async () => {
    const app = buildApp();
    const { id } = (await app.inject({ method: "POST", url: "/api/rooms" })).json();
    expect((await app.inject({ url: `/api/rooms/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/rooms/AAAAAAAAAAAAAAAAAAAAAA" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/rooms/..%2F..%2Fetc" })).statusCode).toBe(404);
  });

  it("salas expiram depois do TTL", () => {
    let now = 0;
    const store = new RoomStore(1000, () => now);
    const room = store.create();
    now = 999;
    expect(store.get(room.id)).toBeDefined();
    now = 1001;
    expect(store.get(room.id)).toBeUndefined();
  });
});
