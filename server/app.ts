import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { MAX_PARTICIPANTS } from "../shared/protocol.js";
import { registerPresence, type PresenceOptions } from "./presence.js";
import { RoomStore } from "./rooms.js";

export interface AppOptions {
  store?: RoomStore;
  /** Pasta com o build do front (produção). Se ausente, só a API é servida. */
  clientDir?: string;
  logger?: boolean;
  presence?: PresenceOptions;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const store = opts.store ?? new RoomStore();
  const app = Fastify({ logger: opts.logger ?? false });

  app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  app.post("/api/rooms", async (_req, reply) => {
    const room = store.create();
    return reply.code(201).send({ id: room.id });
  });

  app.get<{ Params: { id: string } }>("/api/rooms/:id", async (req, reply) => {
    const room = store.get(req.params.id);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    return { id: room.id, full: room.participants.size >= MAX_PARTICIPANTS };
  });

  app.register(async (scoped) => registerPresence(scoped, store, opts.presence));

  if (opts.clientDir && existsSync(opts.clientDir)) {
    app.register(fastifyStatic, { root: opts.clientDir });
    // SPA: qualquer rota que não seja da API devolve o index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}
