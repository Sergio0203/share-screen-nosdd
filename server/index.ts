import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { RoomStore } from "./rooms.js";

const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? (isProd ? "0.0.0.0" : "127.0.0.1");

const store = new RoomStore();
setInterval(() => store.sweep(), 10 * 60 * 1000).unref();

const app = buildApp({
  store,
  logger: true,
  clientDir: isProd ? fileURLToPath(new URL("../dist/client", import.meta.url)) : undefined,
});

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
