import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ServerMessage } from "../shared/protocol.js";
import { buildApp } from "./app.js";

let app: FastifyInstance;
let base: string;
const open: WebSocket[] = [];

beforeEach(async () => {
  app = buildApp({ presence: { heartbeatMs: 100, deadAfterMs: 300 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("sem endereço");
  base = `127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  for (const ws of open.splice(0)) ws.close();
  await app.close();
});

async function createRoom(): Promise<string> {
  const res = await fetch(`http://${base}/api/rooms`, { method: "POST" });
  return (await res.json()).id;
}

/** Cliente de teste: guarda as mensagens e deixa esperar por uma condição. */
function connect(roomId: string) {
  const ws = new WebSocket(`ws://${base}/api/rooms/${roomId}/ws`);
  open.push(ws);
  const messages: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  let closed = false;
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(String(e.data)));
    waiters.forEach((w) => w());
  });
  ws.addEventListener("close", () => {
    closed = true;
    waiters.forEach((w) => w());
  });
  const opened = new Promise<void>((r) => ws.addEventListener("open", () => r()));

  return {
    ws,
    messages,
    get closed() {
      return closed;
    },
    async join(name: string) {
      await opened;
      ws.send(JSON.stringify({ type: "join", name }));
    },
    waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 2000): Promise<T> {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = [...messages].reverse().find(pred);
          if (found) resolve(found);
        };
        waiters.push(check);
        check();
        setTimeout(() => reject(new Error("timeout esperando mensagem")), timeoutMs);
      });
    },
    lastParticipants(): string[] {
      const m = [...messages].reverse().find((x) => x.type === "participants" || x.type === "joined");
      return m && "participants" in m ? m.participants.map((p) => p.name) : [];
    },
  };
}

const isJoined = (m: ServerMessage): m is Extract<ServerMessage, { type: "joined" }> => m.type === "joined";
const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: "error" }> => m.type === "error";
const participantsAre =
  (...names: string[]) =>
  (m: ServerMessage): m is Extract<ServerMessage, { type: "participants" }> =>
    m.type === "participants" && JSON.stringify(m.participants.map((p) => p.name)) === JSON.stringify(names);

describe("presença na sala", () => {
  it("quem entra recebe a lista e todos veem a nova pessoa", async () => {
    const room = await createRoom();
    const ana = connect(room);
    await ana.join("Ana");
    const joined = await ana.waitFor(isJoined);
    expect(joined.participants.map((p) => p.name)).toEqual(["Ana"]);

    const bia = connect(room);
    await bia.join("  Bia  ");
    await bia.waitFor(isJoined);
    await ana.waitFor(participantsAre("Ana", "Bia"));
    expect(bia.lastParticipants()).toEqual(["Ana", "Bia"]);
  });

  it("quem sai some da lista dos outros", async () => {
    const room = await createRoom();
    const ana = connect(room);
    await ana.join("Ana");
    await ana.waitFor(isJoined);
    const bia = connect(room);
    await bia.join("Bia");
    await ana.waitFor(participantsAre("Ana", "Bia"));

    bia.ws.close();
    await ana.waitFor(participantsAre("Ana"));
  });

  it("aceita 6 pessoas e recusa a 7ª com room_full", async () => {
    const room = await createRoom();
    for (let i = 1; i <= 6; i++) {
      const c = connect(room);
      await c.join(`P${i}`);
      await c.waitFor(isJoined);
    }
    const info = await (await fetch(`http://${base}/api/rooms/${room}`)).json();
    expect(info.full).toBe(true);

    const seventh = connect(room);
    await seventh.join("P7");
    expect((await seventh.waitFor(isError)).code).toBe("room_full");
  });

  it("depois que alguém sai de uma sala cheia, outra pessoa pode entrar", async () => {
    const room = await createRoom();
    const clients = [];
    for (let i = 1; i <= 6; i++) {
      const c = connect(room);
      await c.join(`P${i}`);
      await c.waitFor(isJoined);
      clients.push(c);
    }
    clients[0].ws.close();
    await clients[1].waitFor(participantsAre("P2", "P3", "P4", "P5", "P6"));
    const late = connect(room);
    await late.join("P7");
    await late.waitFor(isJoined);
  });

  it("recusa sala inexistente e nome vazio", async () => {
    const ghost = connect("AAAAAAAAAAAAAAAAAAAAAA");
    await ghost.join("Ana");
    expect((await ghost.waitFor(isError)).code).toBe("room_not_found");

    const room = await createRoom();
    const blank = connect(room);
    await blank.join("   ");
    expect((await blank.waitFor(isError)).code).toBe("invalid_name");
  });

  it("conexão morta (sem pong) é derrubada pelo heartbeat", async () => {
    const room = await createRoom();
    const ana = connect(room);
    await ana.join("Ana");
    await ana.waitFor(isJoined);
    const bia = connect(room);
    await bia.join("Bia");
    await ana.waitFor(participantsAre("Ana", "Bia"));

    // Simula a rede da Bia caindo: o servidor para de receber pongs dela.
    const [server] = [...app.websocketServer.clients].slice(-1);
    server.removeAllListeners("pong");
    await ana.waitFor(participantsAre("Ana"), 2000);
  });
});

describe("voz: estado do microfone e sinalização", () => {
  const isSignal = (m: ServerMessage): m is Extract<ServerMessage, { type: "signal" }> => m.type === "signal";

  async function twoInRoom() {
    const room = await createRoom();
    const ana = connect(room);
    await ana.join("Ana");
    const anaId = (await ana.waitFor(isJoined)).selfId;
    const bia = connect(room);
    await bia.join("Bia");
    const biaId = (await bia.waitFor(isJoined)).selfId;
    await ana.waitFor(participantsAre("Ana", "Bia"));
    return { room, ana, anaId, bia, biaId };
  }

  it("todos entram com o microfone desligado", async () => {
    const { bia } = await twoInRoom();
    const joined = await bia.waitFor(isJoined);
    expect(joined.participants.every((p) => p.micOn === false)).toBe(true);
  });

  it("ligar/desligar o microfone é repassado a todos", async () => {
    const { ana, bia, anaId } = await twoInRoom();
    ana.ws.send(JSON.stringify({ type: "mic", on: true }));
    const micOn = (m: ServerMessage): m is Extract<ServerMessage, { type: "participants" }> =>
      m.type === "participants" && m.participants.find((p) => p.id === anaId)?.micOn === true;
    await bia.waitFor(micOn);

    ana.ws.send(JSON.stringify({ type: "mic", on: false }));
    await bia.waitFor(
      (m): m is Extract<ServerMessage, { type: "participants" }> =>
        m.type === "participants" && m.participants.find((p) => p.id === anaId)?.micOn === false,
    );
  });

  it("sinalização chega só ao destinatário, com o remetente", async () => {
    const { ana, anaId, bia, biaId, room } = await twoInRoom();
    const caio = connect(room);
    await caio.join("Caio");
    await caio.waitFor(isJoined);

    const data = { description: { type: "offer", sdp: "v=0" } };
    ana.ws.send(JSON.stringify({ type: "signal", to: biaId, data }));
    const got = await bia.waitFor(isSignal);
    expect(got).toEqual({ type: "signal", from: anaId, data });

    await new Promise((r) => setTimeout(r, 100));
    expect(caio.messages.some((m) => m.type === "signal")).toBe(false);
  });

  it("não repassa sinalização para outra sala nem antes de entrar", async () => {
    const { bia, biaId } = await twoInRoom();
    const otherRoom = await createRoom();
    const intruso = connect(otherRoom);
    await intruso.join("Intruso");
    await intruso.waitFor(isJoined);
    intruso.ws.send(JSON.stringify({ type: "signal", to: biaId, data: {} }));

    const anon = connect(otherRoom);
    await new Promise<void>((r) => anon.ws.addEventListener("open", () => r())); // conecta mas não entra
    anon.ws.send(JSON.stringify({ type: "signal", to: biaId, data: {} }));
    expect((await anon.waitFor(isError)).code).toBe("bad_message");
    expect(bia.messages.some((m) => m.type === "signal")).toBe(false);
  });
});
