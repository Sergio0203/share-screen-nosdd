// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

const ROOM_ID = "abcdefghijklmnopqrstuv";

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/rooms" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: ROOM_ID }), { status: 201 });
      }
      if (url === `/api/rooms/${ROOM_ID}`) return new Response(JSON.stringify({ id: ROOM_ID }));
      return new Response("{}", { status: 404 });
    }),
  );
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

const expectedUrl = `${window.location.origin}/sala/${ROOM_ID}`;

beforeEach(() => {
  mockFetch();
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

  it("link de sala inexistente mostra 'Sala não encontrada'", async () => {
    mockClipboard({});
    renderAt("/sala/zzzzzzzzzzzzzzzzzzzzzz");
    expect(await screen.findByText("Sala não encontrada")).toBeInTheDocument();
  });
});
