// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
      this.transceivers.push(fakeTransceiver("recvonly", "audio"), fakeTransceiver("recvonly", "video"));
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
  names.map((name, i) => ({ id: `id-${i}`, name, micOn: false, camOn: false }));

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

    ws.serverSends({ type: "participants", participants: [{ id: "id-1", name: "Bia", micOn: false, camOn: false }] });
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
      participants: [{ id: "me", name: "Ana", micOn: false, camOn: false }, ...others],
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
    const ws = await inRoomWith({ id: "zoe", name: "Zoe", micOn: false, camOn: false });
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
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: true, camOn: false }, { id: "caio", name: "Caio", micOn: false, camOn: false });
    const list = screen.getByRole("complementary", { name: "Participantes" });
    const row = (name: string) => within(list).getByText(name).closest("li")!;

    expect(within(row("Bia")).getByRole("img", { name: "microfone ligado" })).toBeInTheDocument();
    expect(within(row("Caio")).getByRole("img", { name: "microfone desligado" })).toBeInTheDocument();

    ws.serverSends({
      type: "participants",
      participants: [
        { id: "me", name: "Ana", micOn: false, camOn: false },
        { id: "bia", name: "Bia", micOn: false, camOn: false },
        { id: "caio", name: "Caio", micOn: true, camOn: false },
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
        { id: "me", name: "Ana", micOn: false, camOn: false },
        { id: "bia", name: "Bia", micOn: true, camOn: false },
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
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: true, camOn: false });

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

    ws.serverSends({ type: "participants", participants: [{ id: "me", name: "Ana", micOn: false, camOn: false }] });
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
      participants: [{ id: "me", name: "Ana", micOn: false, camOn: false }, ...others],
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
    const ws = await inRoomWith({ id: "zoe", name: "Zoe", micOn: false, camOn: false });
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
    const ws = await inRoomWith({ id: "bia", name: "Bia", micOn: false, camOn: false });
    ws.serverSends({ type: "signal", from: "bia", data: { description: { type: "offer", sdp: "x" } } });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    act(() => pc.ontrack!({ track: { kind: "video" }, transceiver: pc.transceivers[1] }));

    // Trilha existe, mas a Bia ainda não ligou a câmera: nada de vídeo.
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();

    const bia = (camOn: boolean): Participant[] => [
      { id: "me", name: "Ana", micOn: false, camOn: false },
      { id: "bia", name: "Bia", micOn: false, camOn },
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
