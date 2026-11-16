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

const people = (...names: string[]): Participant[] => names.map((name, i) => ({ id: `id-${i}`, name }));

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

    ws.serverSends({ type: "participants", participants: [{ id: "id-1", name: "Bia" }] });
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
