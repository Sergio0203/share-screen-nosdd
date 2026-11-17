// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Participant, ServerMessage } from "../../shared/protocol";
import { App } from "./App";

const ROOM_ID = "abcdefghijklmnopqrstuv";
const expectedUrl = `${window.location.origin}/sala/${ROOM_ID}`;

let roomFull = false;

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/rooms" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: ROOM_ID }), { status: 201 });
      }
      if (url === `/api/rooms/${ROOM_ID}`) return new Response(JSON.stringify({ id: ROOM_ID, full: roomFull }));
      return new Response("{}", { status: 404 });
    }),
  );
}

/** WebSocket falso: guarda o que o cliente manda e deixa o teste responder como o servidor. */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  sent: unknown[] = [];
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
  serverSends(msg: ServerMessage) {
    act(() => {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
    });
  }
  serverDrops() {
    act(() => {
      this.dispatchEvent(new Event("close"));
    });
  }
}
const lastSocket = () => FakeWebSocket.instances.at(-1)!;

/** Só o suficiente de WebRTC para a UI rodar no jsdom (o fluxo real é testado no e2e). */
class FakeMediaStream {
  tracks: unknown[];
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  addTrack(t: unknown) {
    this.tracks.push(t);
  }
  removeTrack(t: unknown) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}
interface FakeTransceiver {
  direction: string;
  sender: { track: unknown; replaceTrack: (t: unknown) => Promise<void>; setStreams: () => void };
  receiver: { track: { kind: string } };
}
function fakeTransceiver(direction: string, kind = "audio"): FakeTransceiver {
  const sender = {
    track: null as unknown,
    replaceTrack: async (t: unknown) => {
      sender.track = t;
    },
    setStreams: () => {},
  };
  return { direction, sender, receiver: { track: { kind } } };
}
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  transceivers: FakeTransceiver[] = [];
  signalingState = "stable";
  connectionState = "new";
  localDescription = null;
  closed = false;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate = null;
  ontrack: ((e: { track: { kind: string }; transceiver: FakeTransceiver }) => void) | null = null;
  onconnectionstatechange = null;
  constructor() {
    FakePeerConnection.instances.push(this);
  }
  addTransceiver(kind: string, init: { direction: string }) {
    const t = fakeTransceiver(init.direction, kind);
    this.transceivers.push(t);
    return t;
  }
  getTransceivers() {
    return this.transceivers;
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: { type: string }) {
    // Uma oferta remota cria o canal de áudio do lado que responde.
    if (d.type === "offer" && this.transceivers.length === 0) {
      this.transceivers.push(
        fakeTransceiver("recvonly", "audio"),
        fakeTransceiver("recvonly", "video"),
        fakeTransceiver("recvonly", "video"),
      );
    }
  }
  async addIceCandidate() {}
  restartIce() {}
  close() {
    this.closed = true;
  }
}

function fakeMicTrack() {
  const t = new EventTarget() as EventTarget & { kind: string; stop: () => void; stopped: boolean };
  t.kind = "audio";
  t.stopped = false;
  t.stop = () => {
    t.stopped = true;
  };
  return t;
}

function mockGetUserMedia(impl: (c?: MediaStreamConstraints) => Promise<unknown>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

/** getDisplayMedia falso (ou ausente, com null, como no celular). */
function mockGetDisplayMedia(impl: ((opts?: DisplayMediaStreamOptions) => Promise<unknown>) | null) {
  const getDisplayMedia = impl ? vi.fn(impl) : undefined;
  const getUserMedia = vi.fn(async () => new FakeMediaStream([fakeMicTrack()]));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia, getDisplayMedia }, configurable: true });
  return getDisplayMedia;
}

function mockClipboard(impl: { write?: unknown; writeText?: unknown }) {
  Object.defineProperty(navigator, "clipboard", { value: impl, configurable: true });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const people = (...names: string[]): Participant[] =>
  names.map((name, i) => ({ id: `id-${i}`, name, micOn: false, camOn: false, screenOn: false }));

async function enterAs(name: string) {
  const input = await screen.findByLabelText("Seu nome");
  await userEvent.clear(input);
  await userEvent.type(input, name);
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

beforeEach(() => {
  roomFull = false;
  localStorage.clear();
  FakeWebSocket.instances = [];
  mockFetch();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  FakePeerConnection.instances = [];
  // jsdom não tem ClipboardItem; um stub simples basta.
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(public items: Record<string, Promise<Blob>>) {}
    },
  );
  document.execCommand = vi.fn(() => false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Criar sala", () => {
  it("um clique cria a sala, entra nela e copia o link", async () => {
    let copied = "";
    mockClipboard({
      write: vi.fn(async ([item]: [{ items: Record<string, Promise<Blob>> }]) => {
        copied = await (await item.items["text/plain"]).text();
      }),
    });
    renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    expect(await screen.findByText("Link copiado!")).toBeInTheDocument();
    expect(copied).toBe(expectedUrl);
    expect(screen.getByLabelText("Link da sala")).toHaveValue(expectedUrl);
    expect(await screen.findByLabelText("Seu nome")).toBeInTheDocument();
  });

  it("se o navegador bloquear, mostra o link e um botão Copiar link que funciona", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    mockClipboard({ write: vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError")), writeText });
    renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Criar sala" }));

    expect(await screen.findByText(/não deixou copiar o link automaticamente/)).toBeInTheDocument();
    expect(screen.queryByText("Link copiado!")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Link da sala")).toHaveValue(expectedUrl);

    writeText.mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenLastCalledWith(expectedUrl);
    expect(await screen.findByText("Link copiado!")).toBeInTheDocument();
  });

  it("dentro da sala sempre dá para copiar o link de novo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard({ writeText });
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    lastSocket().serverSends({ type: "joined", selfId: "id-0", participants: people("Ana") });

    expect(await screen.findByText("Você está na sala.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenCalledWith(expectedUrl);
    expect(await screen.findByText("Link copiado!")).toBeInTheDocument();
  });

  it("o aviso de link copiado some sozinho", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    renderAt(`/sala/${ROOM_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Copiar link" }));
    expect(screen.getByText("Link copiado!")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(screen.queryByText("Link copiado!")).not.toBeInTheDocument();
  });

  it("se tudo falhar, seleciona o link para copiar à mão", async () => {
    mockClipboard({ writeText: vi.fn().mockRejectedValue(new Error("no")) });
    renderAt(`/sala/${ROOM_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Copiar link" }));
    expect(await screen.findByText(/O link está selecionado/)).toBeInTheDocument();
  });
});

describe("Entrar na sala pelo link", () => {
  beforeEach(() => mockClipboard({}));

  it("pede o nome antes de entrar e envia o nome ao servidor", async () => {
    renderAt(`/sala/${ROOM_ID}`);
    expect(await screen.findByText("Como você quer aparecer?")).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);

    await enterAs("Bia");
    await vi.waitFor(() => expect(lastSocket().sent).toEqual([{ type: "join", name: "Bia" }]));
    expect(lastSocket().url).toBe(`ws://${window.location.host}/api/rooms/${ROOM_ID}/ws`);
  });

  it("não deixa entrar sem nome", async () => {
    renderAt(`/sala/${ROOM_ID}`);
    await screen.findByLabelText("Seu nome");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Digite um nome");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("mostra a lista de participantes e atualiza quando alguém entra ou sai", async () => {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Bia");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "id-1", participants: people("Ana", "Bia") });

    const list = await screen.findByRole("complementary", { name: "Participantes" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["AAna", "BBia (você)"]);
    expect(list).toHaveTextContent("(2/6)");

    ws.serverSends({ type: "participants", participants: people("Ana", "Bia", "Caio") });
    expect(within(list).getByText("Caio")).toBeInTheDocument();

    ws.serverSends({ type: "participants", participants: [{ id: "id-1", name: "Bia", micOn: false, camOn: false, screenOn: false }] });
    expect(within(list).queryByText("Ana")).not.toBeInTheDocument();
    expect(list).toHaveTextContent("(1/6)");
  });

  it("lembra o nome usado da última vez", async () => {
    localStorage.setItem("telao:name", "Ana");
    renderAt(`/sala/${ROOM_ID}`);
    expect(await screen.findByLabelText("Seu nome")).toHaveValue("Ana");
  });

  it("link de sala inexistente mostra mensagem clara e botão para criar sala nova", async () => {
    renderAt("/sala/zzzzzzzzzzzzzzzzzzzzzz");
    expect(await screen.findByText("Sala não encontrada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar uma sala nova" })).toHaveAttribute("href", "/");
  });

  it("sala cheia ao abrir o link mostra 'Sala cheia' e não pede nome", async () => {
    roomFull = true;
    renderAt(`/sala/${ROOM_ID}`);
    expect(await screen.findByText("Sala cheia")).toBeInTheDocument();
    expect(screen.queryByLabelText("Seu nome")).not.toBeInTheDocument();
  });

  it("se a sala encher enquanto digitava o nome, a 7ª pessoa vê 'Sala cheia'", async () => {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Gil");
    lastSocket().serverSends({ type: "error", code: "room_full" });
    expect(await screen.findByText("Sala cheia")).toBeInTheDocument();
  });

  it("se a conexão cair, oferece entrar de novo", async () => {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    lastSocket().serverSends({ type: "joined", selfId: "id-0", participants: people("Ana") });
    lastSocket().serverDrops();

    await userEvent.click(await screen.findByRole("button", { name: "Entrar de novo" }));
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.waitFor(() => expect(lastSocket().sent).toEqual([{ type: "join", name: "Ana" }]));
  });
});

describe("Conversar por voz", () => {
  beforeEach(() => mockClipboard({}));

  async function inRoomWith(...others: Participant[]) {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({
      type: "joined",
      selfId: "me",
      participants: [{ id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false }, ...others],
    });
    await screen.findByText("Você está na sala.");
    return ws;
  }

  const micButton = () => screen.getByRole("button", { name: /microfone/ });

  it("entra com o microfone desligado, sem pedir permissão", async () => {
    const getUserMedia = mockGetUserMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    const ws = await inRoomWith();
    expect(micButton()).toHaveAccessibleName("Ligar microfone");
    expect(micButton()).toHaveAttribute("aria-pressed", "false");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(ws.sent).not.toContainEqual(expect.objectContaining({ type: "mic" }));
  });

  it("o botão liga e desliga o microfone e avisa o servidor", async () => {
    const track = fakeMicTrack();
    mockGetUserMedia(async () => new FakeMediaStream([track]));
    // "me" < "zoe": eu sou quem oferece, a conexão nasce assim que ela aparece.
    const ws = await inRoomWith({ id: "zoe", name: "Zoe", micOn: false, camOn: false, screenOn: false });
    expect(FakePeerConnection.instances).toHaveLength(1);
    const [audio, camera] = FakePeerConnection.instances[0].transceivers;
    expect(audio.direction).toBe("sendrecv");
    expect(camera.receiver.track.kind).toBe("video");
    expect(camera.direction).toBe("sendrecv");
    expect(audio.sender.track).toBeNull();

    await userEvent.click(micButton());
    expect(await screen.findByRole("button", { name: "Desligar microfone" })).toHaveAttribute("aria-pressed", "true");
    expect(ws.sent).toContainEqual({ type: "mic", on: true });
    // O áudio passa a ser enviado para a Zoe.
    await vi.waitFor(() => expect(audio.sender.track).toBe(track));

    await userEvent.click(micButton());
    expect(micButton()).toHaveAccessibleName("Ligar microfone");
    expect(ws.sent.at(-1)).toEqual({ type: "mic", on: false });
    expect(track.stopped).toBe(true);
    await vi.waitFor(() => expect(audio.sender.track).toBeNull());
  });

  it("todos veem quem está com o microfone ligado ou desligado", async () => {
    mockGetUserMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: true, camOn: false, screenOn: false }, { id: "caio", name: "Caio", micOn: false, camOn: false, screenOn: false });
    const list = screen.getByRole("complementary", { name: "Participantes" });
    const row = (name: string) => within(list).getByText(name).closest("li")!;

    expect(within(row("Bia")).getByRole("img", { name: "microfone ligado" })).toBeInTheDocument();
    expect(within(row("Caio")).getByRole("img", { name: "microfone desligado" })).toBeInTheDocument();

    ws.serverSends({
      type: "participants",
      participants: [
        { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false },
        { id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: false },
        { id: "caio", name: "Caio", micOn: true, camOn: false, screenOn: false },
      ],
    });
    expect(within(row("Bia")).getByRole("img", { name: "microfone desligado" })).toBeInTheDocument();
    expect(within(row("Caio")).getByRole("img", { name: "microfone ligado" })).toBeInTheDocument();
  });

  it("permissão negada explica como liberar e o resto da sala continua funcionando", async () => {
    mockGetUserMedia(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    const ws = await inRoomWith();

    await userEvent.click(micButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("O navegador bloqueou o microfone.");
    expect(alert).toHaveTextContent(/cadeado/);
    expect(alert).toHaveTextContent(/continua na sala/);
    expect(micButton()).toHaveAccessibleName("Ligar microfone");
    expect(ws.sent).not.toContainEqual({ type: "mic", on: true });

    // A sala segue viva: a lista atualiza e o link continua copiável.
    ws.serverSends({
      type: "participants",
      participants: [
        { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false },
        { id: "bia", name: "Bia", micOn: true, camOn: false, screenOn: false },
      ],
    });
    expect(screen.getByText("Bia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeEnabled();
  });

  it("sem microfone conectado mostra outra mensagem", async () => {
    mockGetUserMedia(async () => {
      throw new DOMException("none", "NotFoundError");
    });
    await inRoomWith();
    await userEvent.click(micButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Nenhum microfone encontrado.");
  });

  it("toca o áudio que chega de outra pessoa e para quando ela sai", async () => {
    mockGetUserMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: true, camOn: false, screenOn: false });

    // "bia" < "me": a Bia oferece; a conexão só nasce quando a oferta chega.
    expect(FakePeerConnection.instances).toHaveLength(0);
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    // Quem responde também passa a enviar pelo mesmo canal.
    await vi.waitFor(() => expect(FakePeerConnection.instances[0].transceivers[0].direction).toBe("sendrecv"));
    const pc = FakePeerConnection.instances[0];
    const remoteTrack = { kind: "audio" };
    act(() => pc.ontrack!({ track: remoteTrack, transceiver: pc.transceivers[0] }));
    const audio = document.querySelector("audio[data-remote-audio]") as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect((audio.srcObject as unknown as FakeMediaStream).tracks).toEqual([remoteTrack]);

    ws.serverSends({ type: "participants", participants: [{ id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false }] });
    expect(document.querySelector("audio[data-remote-audio]")).toBeNull();
    expect(FakePeerConnection.instances[0].closed).toBe(true);
  });
});

describe("Ativar a webcam", () => {
  beforeEach(() => {
    mockClipboard({});
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
  });

  async function inRoomWith(...others: Participant[]) {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({
      type: "joined",
      selfId: "me",
      participants: [{ id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false }, ...others],
    });
    await screen.findByText("Você está na sala.");
    return ws;
  }
  const camButton = () => screen.getByRole("button", { name: /câmera/ });

  it("entra com a câmera desligada, sem pedir permissão", async () => {
    const getUserMedia = mockGetUserMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    await inRoomWith();
    expect(camButton()).toHaveAccessibleName("Ligar câmera");
    expect(camButton()).toHaveAttribute("aria-pressed", "false");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("o botão liga e desliga a câmera, mostra o próprio vídeo e avisa o servidor", async () => {
    const track = Object.assign(fakeMicTrack(), { kind: "video" });
    const getUserMedia = mockGetUserMedia(async () => new FakeMediaStream([track]));
    const ws = await inRoomWith({ id: "zoe", name: "Zoe", micOn: false, camOn: false, screenOn: false });
    const camera = FakePeerConnection.instances[0].transceivers[1];

    await userEvent.click(camButton());
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything() }));
    expect(await screen.findByRole("button", { name: "Desligar câmera" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("figure", { name: "Sua câmera" })).toHaveTextContent("Ana (você)");
    expect(ws.sent).toContainEqual({ type: "cam", on: true });
    await vi.waitFor(() => expect(camera.sender.track).toBe(track));
    // O microfone não foi mexido.
    expect(FakePeerConnection.instances[0].transceivers[0].sender.track).toBeNull();

    await userEvent.click(camButton());
    expect(camButton()).toHaveAccessibleName("Ligar câmera");
    expect(ws.sent.at(-1)).toEqual({ type: "cam", on: false });
    expect(track.stopped).toBe(true);
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(camera.sender.track).toBeNull());
  });

  it("todos veem o vídeo de quem ligou a câmera, com o nome; some quando ela desliga", async () => {
    mockGetUserMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: false });
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[1] }));

    // Trilha existe, mas a Bia ainda não ligou a câmera: nada de vídeo.
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();

    const bia = (camOn: boolean): Participant[] => [
      { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false },
      { id: "bia", name: "Bia", micOn: false, camOn, screenOn: false },
    ];
    ws.serverSends({ type: "participants", participants: bia(true) });
    const tile = screen.getByRole("figure", { name: "Câmera de Bia" });
    expect(tile).toHaveTextContent("Bia");
    expect(within(screen.getByRole("complementary")).getByRole("img", { name: "câmera ligada" })).toBeInTheDocument();

    ws.serverSends({ type: "participants", participants: bia(false) });
    expect(screen.queryByRole("figure", { name: "Câmera de Bia" })).not.toBeInTheDocument();
  });

  it("permissão negada explica como liberar e o resto da sala continua funcionando", async () => {
    const getUserMedia = mockGetUserMedia(async (c?: MediaStreamConstraints) => {
      if (c?.video) throw new DOMException("Permission denied", "NotAllowedError");
      return new FakeMediaStream([fakeMicTrack()]);
    });
    const ws = await inRoomWith();

    await userEvent.click(camButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("O navegador bloqueou a câmera.");
    expect(alert).toHaveTextContent(/cadeado/);
    expect(alert).toHaveTextContent(/Câmera para Permitir/);
    expect(camButton()).toHaveAccessibleName("Ligar câmera");
    expect(ws.sent).not.toContainEqual({ type: "cam", on: true });

    // O microfone continua funcionando.
    await userEvent.click(screen.getByRole("button", { name: "Ligar microfone" }));
    expect(await screen.findByRole("button", { name: "Desligar microfone" })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("câmera em uso por outro programa mostra outra mensagem", async () => {
    mockGetUserMedia(async () => {
      throw new DOMException("busy", "NotReadableError");
    });
    await inRoomWith();
    await userEvent.click(camButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para usar a câmera.");
  });
});

describe("Compartilhar a tela", () => {
  beforeEach(() => {
    mockClipboard({});
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
  });

  const ana = { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false };

  async function inRoomWith(...others: Participant[]) {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "me", participants: [ana, ...others] });
    await screen.findByText("Você está na sala.");
    return ws;
  }
  const shareButton = () => screen.getByRole("button", { name: /Compartilhar tela|Parar compartilhamento/ });
  /** Trilha de tela falsa que obedece applyConstraints (como o Chrome faz). */
  const screenTrack = (source = { width: 1920, height: 1080, frameRate: 60 }) => {
    let settings = { width: 1280, height: 720, frameRate: 30 };
    const fit = (c: MediaTrackConstraints) => {
      const max = (v: unknown, fallback: number) => (v as { max?: number })?.max ?? fallback;
      settings = {
        width: Math.min(source.width, max(c.width, source.width)),
        height: Math.min(source.height, max(c.height, source.height)),
        frameRate: Math.min(source.frameRate, max(c.frameRate, source.frameRate)),
      };
    };
    return Object.assign(fakeMicTrack(), {
      kind: "video",
      contentHint: "",
      fit,
      getSettings: () => settings,
      applyConstraints: vi.fn(async (c: MediaTrackConstraints) => fit(c)),
    });
  };

  it("o botão compartilha a tela, avisa o servidor e mostra que está compartilhando", async () => {
    const track = screenTrack();
    const getDisplayMedia = mockGetDisplayMedia(async () => new FakeMediaStream([track]));
    const ws = await inRoomWith({ id: "zoe", name: "Zoe", micOn: false, camOn: false, screenOn: false });
    const screenSlot = FakePeerConnection.instances[0].transceivers[2];
    expect(shareButton()).toHaveAccessibleName("Compartilhar tela");

    await userEvent.click(shareButton());
    // Sem forçar tela inteira: o seletor do navegador oferece tela, janela ou aba.
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything(), audio: false }));
    expect(await screen.findByRole("button", { name: "Parar compartilhamento" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Você está compartilhando a tela.")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Sua tela" })).toBeInTheDocument();
    expect(ws.sent).toContainEqual({ type: "screen", on: true });
    await vi.waitFor(() => expect(screenSlot.sender.track).toBe(track));
    expect(track.contentHint).toBe("motion");
    // Câmera e microfone não foram mexidos.
    expect(FakePeerConnection.instances[0].transceivers[1].sender.track).toBeNull();

    await userEvent.click(shareButton());
    expect(shareButton()).toHaveAccessibleName("Compartilhar tela");
    expect(ws.sent.at(-1)).toEqual({ type: "screen", on: false });
    expect(track.stopped).toBe(true);
    expect(screen.queryByText("Você está compartilhando a tela.")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screenSlot.sender.track).toBeNull());
  });

  it("parar pelo botão nativo do navegador também encerra para todos", async () => {
    const track = screenTrack();
    mockGetDisplayMedia(async () => new FakeMediaStream([track]));
    const ws = await inRoomWith();
    await userEvent.click(shareButton());
    await screen.findByRole("button", { name: "Parar compartilhamento" });

    // O botão nativo "Parar compartilhamento" encerra a trilha e dispara "ended".
    act(() => {
      track.dispatchEvent(new Event("ended"));
    });
    expect(shareButton()).toHaveAccessibleName("Compartilhar tela");
    expect(ws.sent.at(-1)).toEqual({ type: "screen", on: false });
    expect(screen.queryByRole("figure", { name: "Sua tela" })).not.toBeInTheDocument();
  });

  it("os outros veem a tela em destaque, com tela cheia; some quando para", async () => {
    mockGetDisplayMedia(async () => new FakeMediaStream([screenTrack()]));
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: false, camOn: true, screenOn: false });
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => {
      pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[1] });
      pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[2] });
    });
    expect(screen.queryByRole("figure", { name: "Tela de Bia" })).not.toBeInTheDocument();

    const bia = (screenOn: boolean): Participant[] => [ana, { id: "bia", name: "Bia", micOn: false, camOn: true, screenOn }];
    ws.serverSends({ type: "participants", participants: bia(true) });
    const view = screen.getByRole("figure", { name: "Tela de Bia" });
    expect(view).toHaveClass("screen-view");
    // A câmera dela continua aparecendo, numa faixa abaixo do destaque.
    expect(screen.getByRole("figure", { name: "Câmera de Bia" }).parentElement).toHaveClass("camera-strip");
    expect(within(view).getByRole("button", { name: "Tela cheia" })).toBeVisible();
    expect(within(screen.getByRole("complementary")).getByRole("img", { name: "compartilhando a tela" })).toBeInTheDocument();

    view.requestFullscreen = vi.fn(async () => {});
    await userEvent.click(within(view).getByRole("button", { name: "Tela cheia" }));
    expect(view.requestFullscreen).toHaveBeenCalled();

    ws.serverSends({ type: "participants", participants: bia(false) });
    expect(screen.queryByRole("figure", { name: "Tela de Bia" })).not.toBeInTheDocument();
  });

  it("quem compartilha vê a própria tela em destaque, com tela cheia", async () => {
    mockGetDisplayMedia(async () => new FakeMediaStream([screenTrack()]));
    await inRoomWith();
    await userEvent.click(shareButton());
    const own = await screen.findByRole("figure", { name: "Sua tela" });
    expect(own).toHaveClass("screen-view");
    expect(within(own).getByRole("button", { name: "Tela cheia" })).toBeInTheDocument();
  });

  it("se outra pessoa também compartilha, a tela dela fica em destaque e dá para ver a sua", async () => {
    mockGetDisplayMedia(async () => new FakeMediaStream([screenTrack()]));
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: true });
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[2] }));
    await userEvent.click(shareButton());
    await screen.findByText("Você está compartilhando a tela.");

    expect(screen.getByRole("figure", { name: "Tela de Bia" })).toHaveClass("screen-view");
    await userEvent.click(screen.getByRole("button", { name: "Ver sua tela" }));
    expect(screen.getByRole("figure", { name: "Sua tela" })).toHaveClass("screen-view");
    expect(screen.getByRole("button", { name: "Ver tela de Bia" })).toBeInTheDocument();
  });

  it("com duas telas compartilhadas, dá para escolher qual ver em destaque", async () => {
    mockGetDisplayMedia(async () => new FakeMediaStream([screenTrack()]));
    const ws = await inRoomWith(
      { id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: true },
      { id: "caio", name: "Caio", micOn: false, camOn: false, screenOn: true },
    );
    for (const from of ["bia", "caio"]) {
      ws.serverSends({ type: "signal", from, data: { description: { type: "offer", sdp: "x" } } });
    }
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    act(() => {
      for (const pc of FakePeerConnection.instances) pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[2] });
    });
    expect(screen.getByRole("figure", { name: "Tela de Bia" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver tela de Caio" }));
    expect(screen.getByRole("figure", { name: "Tela de Caio" })).toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: "Tela de Bia" })).not.toBeInTheDocument();
  });

  it("permissão negada explica e a pessoa continua podendo assistir", async () => {
    mockGetDisplayMedia(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: false });
    await userEvent.click(shareButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A tela não foi compartilhada.");
    expect(alert).toHaveTextContent(/cadeado/);
    expect(alert).toHaveTextContent(/pode assistir/);
    expect(shareButton()).toHaveAccessibleName("Compartilhar tela");
    expect(ws.sent).not.toContainEqual({ type: "screen", on: true });

    // Ainda assiste a tela de outra pessoa.
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[2] }));
    ws.serverSends({ type: "participants", participants: [ana, { id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: true }] });
    expect(screen.getByRole("figure", { name: "Tela de Bia" })).toBeInTheDocument();
  });

  it("bloqueio do sistema (macOS) explica onde liberar", async () => {
    mockGetDisplayMedia(async () => {
      throw new DOMException("Permission denied by system", "NotAllowedError");
    });
    await inRoomWith();
    await userEvent.click(shareButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Gravação de Tela/);
  });

  it("navegador sem compartilhamento de tela (celular) explica e não quebra", async () => {
    mockGetDisplayMedia(null);
    await inRoomWith();
    await userEvent.click(shareButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este navegador não permite compartilhar a tela.");
    expect(alert).toHaveTextContent(/computador/);
    expect(shareButton()).toHaveAccessibleName("Compartilhar tela");
  });
});

describe("Escolher a qualidade do compartilhamento", () => {
  beforeEach(() => {
    mockClipboard({});
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
  });

  const ana = { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false };
  const zoe = { id: "zoe", name: "Zoe", micOn: false, camOn: false, screenOn: false };

  async function inRoom() {
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "me", participants: [ana, zoe] });
    await screen.findByText("Você está na sala.");
    return ws;
  }

  function fakeScreenTrack() {
    let settings = { width: 0, height: 0, frameRate: 0 };
    const fit = (c?: MediaTrackConstraints) => {
      const max = (v: unknown) => (v as { max: number }).max;
      settings = { width: max(c?.width), height: max(c?.height), frameRate: max(c?.frameRate) };
    };
    return Object.assign(fakeMicTrack(), {
      kind: "video",
      contentHint: "",
      fit,
      getSettings: () => settings,
      applyConstraints: vi.fn(async (c: MediaTrackConstraints) => fit(c)),
    });
  }

  /** Sender falso com getParameters/setParameters, para conferir banda e fps enviados. */
  function trackSendParams() {
    const sent: Array<RTCRtpEncodingParameters & { degradationPreference?: string }> = [];
    for (const pc of FakePeerConnection.instances) {
      const sender = pc.transceivers[2].sender as unknown as {
        getParameters(): RTCRtpSendParameters;
        setParameters(p: RTCRtpSendParameters): Promise<void>;
      };
      sender.getParameters = () => ({ encodings: [{}] }) as RTCRtpSendParameters;
      sender.setParameters = async (p) => {
        sent.push({ ...p.encodings[0], degradationPreference: (p as { degradationPreference?: string }).degradationPreference });
      };
    }
    return sent;
  }

  const picker = () => screen.getByRole("combobox", { name: "Qualidade do compartilhamento" });

  it("oferece 720p 30 fps, 1080p 30 fps e 1080p 60 fps antes de compartilhar", async () => {
    mockGetDisplayMedia(async () => new FakeMediaStream([fakeScreenTrack()]));
    await inRoom();
    const options = within(picker()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["720p 30 fps", "1080p 30 fps", "1080p 60 fps"]);
    expect(picker()).toHaveValue("720p30");
  });

  it("a qualidade escolhida antes é usada ao compartilhar, e a interface mostra qual está ativa", async () => {
    const track = fakeScreenTrack();
    const getDisplayMedia = mockGetDisplayMedia(async (opts) => {
      track.fit(opts?.video as MediaTrackConstraints);
      return new FakeMediaStream([track]);
    })!;
    await inRoom();
    const sent = trackSendParams();

    await userEvent.selectOptions(picker(), "1080p 60 fps");
    await userEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));

    const video = (getDisplayMedia.mock.calls[0][0] as DisplayMediaStreamOptions).video as MediaTrackConstraints;
    expect(video).toMatchObject({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 } });
    const status = await screen.findByText(/Qualidade ativa/);
    expect(status).toHaveTextContent("Qualidade ativa: 1080p 60 fps · capturando 1920×1080 a 60 fps");
    await vi.waitFor(() => expect(sent.at(-1)).toMatchObject({ maxFramerate: 60, maxBitrate: 4_000_000 }));
  });

  it("troca a qualidade durante o compartilhamento, sem parar e recomeçar", async () => {
    const track = fakeScreenTrack();
    const getDisplayMedia = mockGetDisplayMedia(async (opts) => {
      track.fit(opts?.video as MediaTrackConstraints);
      return new FakeMediaStream([track]);
    })!;
    const ws = await inRoom();
    const sent = trackSendParams();
    const screenSlot = FakePeerConnection.instances[0].transceivers[2];

    await userEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));
    expect(await screen.findByText(/Qualidade ativa/)).toHaveTextContent("720p 30 fps · capturando 1280×720 a 30 fps");

    await userEvent.selectOptions(picker(), "1080p 30 fps");
    expect(track.applyConstraints).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: expect.objectContaining({ max: 1920 }), frameRate: expect.objectContaining({ max: 30 }) }),
    );
    expect(await screen.findByText(/Qualidade ativa/)).toHaveTextContent("1080p 30 fps · capturando 1920×1080 a 30 fps");
    expect(sent.at(-1)).toMatchObject({ maxFramerate: 30, maxBitrate: 2_500_000 });

    await userEvent.selectOptions(picker(), "1080p 60 fps");
    expect(await screen.findByText(/Qualidade ativa/)).toHaveTextContent("1080p 60 fps · capturando 1920×1080 a 60 fps");
    expect(sent.at(-1)).toMatchObject({ maxFramerate: 60, maxBitrate: 4_000_000 });

    // Sem parar: a mesma trilha continua no ar, uma única captura.
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(track.stopped).toBe(false);
    expect(screenSlot.sender.track).toBe(track);
    expect(ws.sent.filter((m) => (m as { type: string }).type === "screen")).toEqual([{ type: "screen", on: true }]);
  });

  it("cada qualidade tem sua política; começa em resolução cheia e depois adota a do perfil", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const track = fakeScreenTrack();
    mockGetDisplayMedia(async (opts) => {
      track.fit(opts?.video as MediaTrackConstraints);
      return new FakeMediaStream([track]);
    });
    await inRoom();
    const sent = trackSendParams();

    await userEvent.selectOptions(picker(), "1080p 60 fps");
    await userEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));
    await screen.findByText(/Qualidade ativa/);
    // Partida: resolução cheia (evita começar borrado).
    expect(sent.at(-1)).toMatchObject({ maxFramerate: 60, degradationPreference: "maintain-resolution" });
    // Depois: 1080p 60 prioriza fluidez (jogos).
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(sent.at(-1)).toMatchObject({ maxFramerate: 60, degradationPreference: "maintain-framerate" });

    // 1080p 30 prioriza nitidez o tempo todo.
    await userEvent.selectOptions(picker(), "1080p 30 fps");
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(sent.at(-1)).toMatchObject({ maxFramerate: 30, degradationPreference: "maintain-resolution" });
  });

  it("se o navegador recusar a troca, avisa e mantém a qualidade anterior", async () => {
    const track = fakeScreenTrack();
    mockGetDisplayMedia(async (opts) => {
      track.fit(opts?.video as MediaTrackConstraints);
      return new FakeMediaStream([track]);
    });
    await inRoom();
    await userEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));
    await screen.findByText(/Qualidade ativa/);

    track.applyConstraints.mockRejectedValueOnce(new DOMException("no", "OverconstrainedError"));
    await userEvent.selectOptions(picker(), "1080p 60 fps");
    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para mudar a qualidade");
    expect(picker()).toHaveValue("720p30");
    expect(screen.getByText(/Qualidade ativa/)).toHaveTextContent("720p 30 fps");
  });

  it("lembra a qualidade escolhida da última vez", async () => {
    localStorage.setItem("telao:screenQuality", "1080p30");
    mockGetDisplayMedia(async () => new FakeMediaStream([fakeScreenTrack()]));
    await inRoom();
    expect(picker()).toHaveValue("1080p30");
  });
});

describe("Escrever na tela com /", () => {
  const ana = { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false };
  const bia = { id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: true };
  // Imagem de 1280×720 mostrada numa caixa de 800×450 em (100, 50).
  const BOX = { left: 100, top: 50, width: 800, height: 450 };

  beforeEach(() => {
    mockClipboard({});
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const r = { x: BOX.left, y: BOX.top, ...BOX, right: BOX.left + BOX.width, bottom: BOX.top + BOX.height };
      return { ...r, toJSON: () => r } as DOMRect;
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 720 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLVideoElement.prototype as { videoWidth?: number }).videoWidth;
    delete (HTMLVideoElement.prototype as { videoHeight?: number }).videoHeight;
  });

  /** Ana na sala vendo a tela da Bia. */
  async function watchingBia() {
    mockGetDisplayMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "me", participants: [ana, bia] });
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[2] }));
    const view = await screen.findByRole("figure", { name: "Tela de Bia" });
    return { ws, view };
  }

  /** Cursor sobre a imagem, em posição relativa (0–1). */
  function pointAt(view: HTMLElement, x: number, y: number) {
    fireEvent.pointerMove(view, { clientX: BOX.left + x * BOX.width, clientY: BOX.top + y * BOX.height });
  }
  const composer = () => screen.queryByRole("textbox", { name: "Recado na tela" });

  it("com o cursor sobre a tela, / abre o campo na posição do cursor; Enter envia", async () => {
    const { ws, view } = await watchingBia();
    pointAt(view, 0.25, 0.75);
    await userEvent.keyboard("/");
    const input = composer()!;
    expect(input).toHaveFocus();
    expect(input).toHaveValue(""); // a própria "/" não entra no texto
    const form = input.closest("form")!;
    expect(form.style.left).toBe("25%");
    expect(form.style.top).toBe("75%");

    await userEvent.type(input, "olha ali{Enter}");
    expect(ws.sent.at(-1)).toEqual({ type: "note", screenOf: "bia", x: 0.25, y: 0.75, text: "olha ali" });
    expect(composer()).not.toBeInTheDocument();
  });

  it("Esc cancela sem enviar", async () => {
    const { ws, view } = await watchingBia();
    pointAt(view, 0.5, 0.5);
    await userEvent.keyboard("/");
    await userEvent.type(composer()!, "deixa pra lá{Escape}");
    expect(composer()).not.toBeInTheDocument();
    expect(ws.sent.some((m) => (m as { type: string }).type === "note")).toBe(false);
  });

  it("não abre com o cursor fora da tela", async () => {
    const { view } = await watchingBia();
    pointAt(view, 0.5, 0.5);
    fireEvent.pointerLeave(view);
    await userEvent.keyboard("/");
    expect(composer()).not.toBeInTheDocument();
  });

  it("/ digitado em outro campo não abre nada", async () => {
    const { view } = await watchingBia();
    pointAt(view, 0.5, 0.5);
    const link = screen.getByLabelText("Link da sala");
    link.focus();
    await userEvent.keyboard("/");
    expect(composer()).not.toBeInTheDocument();
  });

  it("no máximo 100 caracteres, mostrando quantos faltam", async () => {
    const { ws, view } = await watchingBia();
    pointAt(view, 0.5, 0.5);
    await userEvent.keyboard("/");
    const input = composer()!;
    expect(screen.getByText("faltam 100 caracteres")).toBeInTheDocument();
    await userEvent.type(input, "abc");
    expect(screen.getByText("faltam 97 caracteres")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.paste("x".repeat(130));
    expect(input).toHaveValue("x".repeat(100));
    expect(screen.getByText("faltam 0 caracteres")).toBeInTheDocument();
    await userEvent.type(input, "y{Enter}");
    expect((ws.sent.at(-1) as { text: string }).text).toBe("x".repeat(100));
  });

  it("recado recebido aparece na tela, no ponto certo, com o nome, como texto puro, e some depois", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ws } = await watchingBia();
    ws.serverSends({
      type: "note",
      note: { id: "n1", authorId: "bia", authorName: "Bia", screenOf: "bia", x: 0.1, y: 0.2, text: "<b>oi</b>" },
    });
    const note = screen.getByRole("note", { name: "Recado de Bia" });
    expect(note).toHaveTextContent("Bia<b>oi</b>");
    expect(note.querySelector("b")).toBeNull();
    expect(note.style.left).toBe("10%");
    expect(note.style.top).toBe("20%");
    // A camada de recados fica exatamente sobre a imagem.
    const layer = screen.getByTestId("notes-layer");
    expect(layer.style.width).toBe("800px");
    expect(layer.style.height).toBe("450px");

    await act(() => vi.advanceTimersByTimeAsync(6_100));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("quem compartilha escreve na própria tela", async () => {
    mockGetDisplayMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "me", participants: [ana] });
    await userEvent.click(await screen.findByRole("button", { name: "Compartilhar tela" }));
    const own = await screen.findByRole("figure", { name: "Sua tela" });
    pointAt(own, 0.9, 0.9);
    await userEvent.keyboard("/");
    await userEvent.type(composer()!, "minha tela{Enter}");
    expect(ws.sent.at(-1)).toEqual({ type: "note", screenOf: "me", x: 0.9, y: 0.9, text: "minha tela" });
  });
});

describe("O recado segue o cursor e some sozinho", () => {
  const ana = { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false };
  const bia = { id: "bia", name: "Bia", micOn: false, camOn: false, screenOn: true };
  const BOX = { left: 100, top: 50, width: 800, height: 450 };

  beforeEach(() => {
    mockClipboard({});
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const r = { x: BOX.left, y: BOX.top, ...BOX, right: BOX.left + BOX.width, bottom: BOX.top + BOX.height };
      return { ...r, toJSON: () => r } as DOMRect;
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 720 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLVideoElement.prototype as { videoWidth?: number }).videoWidth;
    delete (HTMLVideoElement.prototype as { videoHeight?: number }).videoHeight;
  });

  async function watchingBia() {
    mockGetDisplayMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "me", participants: [ana, bia] });
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[2] }));
    const view = await screen.findByRole("figure", { name: "Tela de Bia" });
    return { ws, view };
  }
  const noteFrom = (authorId: string, authorName: string, text: string, x = 0.2, y = 0.2, id = text) => ({
    type: "note" as const,
    note: { id, authorId, authorName, screenOf: "bia", x, y, text },
  });
  const pointAt = (view: HTMLElement, x: number, y: number) =>
    fireEvent.pointerMove(view, { clientX: BOX.left + x * BOX.width, clientY: BOX.top + y * BOX.height });

  it("fica visível 5 s, depois some com fade de 1 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ws } = await watchingBia();
    ws.serverSends(noteFrom("bia", "Bia", "oi"));
    const note = screen.getByRole("note", { name: "Recado de Bia" });
    await act(() => vi.advanceTimersByTimeAsync(4_900));
    expect(note).not.toHaveClass("fading");
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(note).toHaveClass("fading"); // CSS: opacity 0 com transição de 1 s
    expect(note).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("um novo recado da mesma pessoa substitui o anterior (e ganha os 5 s inteiros)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ws } = await watchingBia();
    ws.serverSends(noteFrom("bia", "Bia", "primeiro"));
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    ws.serverSends(noteFrom("bia", "Bia", "segundo", 0.7, 0.7));
    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent("segundo");
    // Os cronômetros do primeiro não apagam o segundo.
    await act(() => vi.advanceTimersByTimeAsync(2_500));
    expect(screen.getByRole("note")).not.toHaveClass("fading");
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("recados de várias pessoas aparecem ao mesmo tempo", async () => {
    const { ws } = await watchingBia();
    ws.serverSends(noteFrom("bia", "Bia", "da Bia"));
    ws.serverSends(noteFrom("caio", "Caio", "do Caio", 0.6, 0.6));
    ws.serverSends(noteFrom("me", "Ana", "da Ana", 0.4, 0.8));
    expect(screen.getAllByRole("note")).toHaveLength(3);
    expect(screen.getByRole("note", { name: "Recado de Caio" })).toHaveTextContent("do Caio");
  });

  it("o recado de outra pessoa acompanha o cursor dela", async () => {
    const { ws } = await watchingBia();
    ws.serverSends(noteFrom("caio", "Caio", "segue", 0.2, 0.2));
    ws.serverSends({ type: "noteMove", authorId: "caio", screenOf: "bia", x: 0.55, y: 0.45 });
    const note = screen.getByRole("note", { name: "Recado de Caio" });
    expect(note.style.left).toBe("55%");
    expect(note.style.top).toBe("45%");
  });

  it("o meu recado segue o meu cursor na hora e o movimento vai para os outros, com limite de frequência", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ws, view } = await watchingBia();
    // Sem recado meu: mexer o cursor não manda nada.
    pointAt(view, 0.3, 0.3);
    expect(ws.sent.some((m) => (m as { type: string }).type === "cursor")).toBe(false);

    ws.serverSends(noteFrom("me", "Ana", "meu", 0.3, 0.3));
    const before = ws.sent.length;
    for (let i = 1; i <= 10; i++) pointAt(view, 0.3 + i * 0.03, 0.5); // rajada de movimentos
    const mine = screen.getByRole("note", { name: "Recado de Ana" });
    expect(mine.style.left).toBe("60%"); // move na hora, localmente
    const cursors = () => ws.sent.slice(before).filter((m) => (m as { type: string }).type === "cursor");
    expect(cursors().length).toBeLessThanOrEqual(2);
    await act(() => vi.advanceTimersByTimeAsync(100));
    // A última posição sempre chega.
    expect(cursors().at(-1)).toEqual({ type: "cursor", screenOf: "bia", x: 0.6, y: 0.5 });
  });
});

describe("Janela flutuante para quem transmite", () => {
  const ana = { id: "me", name: "Ana", micOn: false, camOn: false, screenOn: false };

  beforeEach(() => {
    mockClipboard({});
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
  });
  afterEach(() => {
    delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    document.querySelectorAll("iframe").forEach((f) => f.remove());
  });

  /** Simula a janela flutuante com um iframe (outro documento, como a real). */
  function mockPictureInPicture() {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const pipWindow = frame.contentWindow!;
    const close = vi.fn(() => pipWindow.dispatchEvent(new Event("pagehide")));
    Object.defineProperty(pipWindow, "close", { value: close, configurable: true });
    const requestWindow = vi.fn(async () => pipWindow);
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow, window: null };
    return { pipWindow, requestWindow, close, doc: () => pipWindow.document };
  }

  async function sharing() {
    mockGetDisplayMedia(async () => new FakeMediaStream([fakeMicTrack()]));
    renderAt(`/sala/${ROOM_ID}`);
    await enterAs("Ana");
    const ws = lastSocket();
    ws.serverSends({ type: "joined", selfId: "me", participants: [ana] });
    await screen.findByText("Você está na sala.");
    expect(screen.queryByRole("button", { name: /janela flutuante/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));
    await screen.findByRole("button", { name: "Parar compartilhamento" });
    return ws;
  }

  it("durante o compartilhamento, abre a janela com a própria tela e os recados por cima, só para ler", async () => {
    const pip = mockPictureInPicture();
    const css = document.createElement("style");
    css.textContent = ".note { color: black }";
    document.head.appendChild(css);
    const ws = await sharing();
    await userEvent.click(screen.getByRole("button", { name: "Abrir janela flutuante" }));
    expect(pip.requestWindow).toHaveBeenCalled();
    const inPip = within(pip.doc().body);
    const view = await inPip.findByRole("figure", { name: "Sua tela" });
    // Estilos da página copiados para a janela (ela nasce em branco).
    expect([...pip.doc().head.querySelectorAll("style")].map((s) => s.textContent)).toContain(".note { color: black }");
    css.remove();
    // Só leitura: sem tela cheia nem dica de escrever.
    expect(inPip.queryByRole("button", { name: "Tela cheia" })).not.toBeInTheDocument();
    expect(view.querySelector(".screen-hint")).toBeNull();

    ws.serverSends({ type: "note", note: { id: "n1", authorId: "bia", authorName: "Bia", screenOf: "me", x: 0.3, y: 0.4, text: "atrás de você" } });
    const note = await inPip.findByRole("note", { name: "Recado de Bia" });
    expect(note).toHaveTextContent("atrás de você");
    expect(note.style.left).toBe("30%");
    // Mesmo comportamento: segue o cursor de quem escreveu.
    ws.serverSends({ type: "noteMove", authorId: "bia", screenOf: "me", x: 0.6, y: 0.5 });
    expect(note.style.left).toBe("60%");

    // "/" na janela flutuante não abre nada.
    fireEvent.keyDown(pip.doc().body, { key: "/" });
    expect(inPip.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("fechar a janela não para o compartilhamento; parar o compartilhamento fecha a janela", async () => {
    const pip = mockPictureInPicture();
    const ws = await sharing();
    await userEvent.click(screen.getByRole("button", { name: "Abrir janela flutuante" }));
    await within(pip.doc().body).findByRole("figure", { name: "Sua tela" });

    // A pessoa fecha a janela flutuante (pelo X dela).
    act(() => {
      pip.pipWindow.dispatchEvent(new Event("pagehide"));
    });
    expect(screen.getByRole("button", { name: "Abrir janela flutuante" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parar compartilhamento" })).toBeInTheDocument();
    expect(ws.sent.filter((m) => (m as { type: string }).type === "screen").at(-1)).toEqual({ type: "screen", on: true });

    // Reabre e depois para o compartilhamento: a janela fecha junto.
    await userEvent.click(screen.getByRole("button", { name: "Abrir janela flutuante" }));
    await userEvent.click(screen.getByRole("button", { name: "Parar compartilhamento" }));
    expect(pip.close).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /janela flutuante/ })).not.toBeInTheDocument();
  });

  it("navegador sem suporte: botão desabilitado com explicação", async () => {
    await sharing();
    const button = screen.getByRole("button", { name: "Abrir janela flutuante" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/só no Chrome ou Edge/);
  });
});
