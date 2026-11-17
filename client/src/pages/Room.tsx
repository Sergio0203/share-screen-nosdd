import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS, normalizeName, type Participant } from "../../../shared/protocol";
import { getRoom, roomUrl } from "../api";
import { copyText } from "../clipboard";
import { DeviceErrorNotice } from "../components/DeviceErrorNotice";
import { Toast, ToastStack } from "../components/Toast";
import { CamIcon, CamOffIcon, MicIcon, MicOffIcon, ScreenIcon } from "../components/icons";
import { RemoteAudio, unlockRemoteAudio } from "../components/RemoteAudio";
import { QualityPicker } from "../components/QualityPicker";
import { ScreenView } from "../components/ScreenView";
import { useFloatingWindow } from "../floating/useFloatingWindow";
import { Stage } from "../components/Stage";
import { ALL_DEVICES, useMedia, type Device, type DeviceState } from "../media/useMedia";
import { useNotes } from "../notes/useNotes";
import { joinRoom, type ConnectionEvent, type RoomConnection } from "../roomConnection";
import type { JustCreatedState } from "./Home";

type Phase =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "full" }
  | { kind: "load_error" }
  | { kind: "name" }
  | { kind: "joining" }
  | { kind: "in_room"; selfId: string; participants: Participant[] }
  | { kind: "disconnected" };

type CopyState = "idle" | "copied" | "auto_blocked" | "manual_failed";

const TOAST_MS = 3000;
const NAME_KEY = "telao:name";

function loadSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Sem storage (aba anônima etc.): só não lembra o nome.
  }
}

export function Room() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const linkInput = useRef<HTMLInputElement>(null);
  const connection = useRef<RoomConnection | null>(null);
  /** A mesma conexão, como estado, para os efeitos de mídia reagirem a ela. */
  const [activeConnection, setActiveConnection] = useState<RoomConnection | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const notes = useNotes();
  const floating = useFloatingWindow();
  const addNote = useRef(notes.add);
  addNote.current = notes.add;
  const moveNote = useRef(notes.move);
  moveNote.current = notes.move;
  const cursorThrottle = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });

  /**
   * Meu recado segue meu cursor: move na hora aqui e manda para os outros no
   * máximo a cada 50 ms (sempre mandando a última posição no fim).
   */
  function moveMyNote(selfId: string, screenOf: string, x: number, y: number) {
    notes.move(selfId, screenOf, x, y);
    const t = cursorThrottle.current;
    if (t.timer) clearTimeout(t.timer);
    const sendNow = () => {
      t.last = Date.now();
      t.timer = null;
      activeConnection?.send({ type: "cursor", screenOf, x, y });
    };
    const wait = 50 - (Date.now() - t.last);
    if (wait <= 0) sendNow();
    else t.timer = setTimeout(sendNow, wait);
  }

  // Lido uma única vez: resultado da cópia automática feita ao criar a sala.
  const [copyState, setCopyState] = useState<CopyState>(() => {
    const state = location.state as JustCreatedState | null;
    if (!state?.justCreated) return "idle";
    return state.copied ? "copied" : "auto_blocked";
  });
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState(loadSavedName);
  const [nameError, setNameError] = useState<string | null>(null);

  const url = roomUrl(id);
  const inRoom = phase.kind === "in_room" ? phase : null;

  const media = useMedia({
    connection: inRoom ? activeConnection : null,
    selfId: inRoom?.selfId ?? null,
    participants: inRoom?.participants ?? [],
  });
  const handleSignal = useRef(media.handleSignal);
  handleSignal.current = media.handleSignal;
  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);

  // Parou de compartilhar: a janela flutuante não tem mais o que mostrar.
  const sharing = media.local.screen;
  const closeFloating = floating.close;
  useEffect(() => {
    if (!sharing && floating.win) closeFloating();
  }, [sharing, floating.win, closeFloating]);

  // Limpa o estado da navegação para não repetir o aviso ao recarregar.
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "loading" });
    getRoom(id)
      .then((info) => {
        if (cancelled) return;
        if (!info.exists) setPhase({ kind: "not_found" });
        else if (info.full) setPhase({ kind: "full" });
        else setPhase({ kind: "name" });
      })
      .catch(() => !cancelled && setPhase({ kind: "load_error" }));
    return () => {
      cancelled = true;
      connection.current?.close();
      connection.current = null;
      setActiveConnection(null);
    };
  }, [id]);

  // "Link copiado!" some sozinho.
  useEffect(() => {
    if (copyState !== "copied") return;
    const t = setTimeout(() => setCopyState("idle"), TOAST_MS);
    return () => clearTimeout(t);
  }, [copyState]);

  function handleEvent(e: ConnectionEvent) {
    switch (e.type) {
      case "joined":
        setPhase({ kind: "in_room", selfId: e.selfId, participants: e.participants });
        break;
      case "participants":
        setPhase((p) => (p.kind === "in_room" ? { ...p, participants: e.participants } : p));
        break;
      case "signal":
        handleSignal.current(e.from, e.data);
        break;
      case "note":
        addNote.current(e.note);
        break;
      case "noteMove":
        moveNote.current(e.authorId, e.screenOf, e.x, e.y);
        break;
      case "error":
        connection.current = null;
        setActiveConnection(null);
        if (e.code === "room_full") setPhase({ kind: "full" });
        else if (e.code === "room_not_found") setPhase({ kind: "not_found" });
        else if (e.code === "invalid_name") {
          setNameError("Nome inválido.");
          setPhase({ kind: "name" });
        } else setPhase({ kind: "disconnected" });
        break;
      case "disconnected":
        connection.current = null;
        setActiveConnection(null);
        setPhase({ kind: "disconnected" });
        break;
    }
  }

  function enter(displayName: string) {
    connection.current?.close();
    setPhase({ kind: "joining" });
    const conn = joinRoom(id, displayName, handleEvent);
    connection.current = conn;
    setActiveConnection(conn);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = normalizeName(name);
    if (!clean) {
      setNameError("Digite um nome para os outros te reconhecerem.");
      return;
    }
    setNameError(null);
    setName(clean);
    saveName(clean);
    enter(clean);
  }

  async function handleCopy() {
    const ok = await copyText(url);
    if (ok) {
      setCopyState("copied");
    } else {
      setCopyState("manual_failed");
      linkInput.current?.select();
    }
  }

  if (phase.kind === "not_found") {
    return (
      <main className="center">
        <h1>Sala não encontrada</h1>
        <p>O link pode estar errado ou a sala já foi encerrada.</p>
        <Link className="btn btn-primary" to="/">
          Criar uma sala nova
        </Link>
      </main>
    );
  }

  if (phase.kind === "full") {
    return (
      <main className="center">
        <h1>Sala cheia</h1>
        <p>Esta sala já tem {MAX_PARTICIPANTS} pessoas. Espere alguém sair ou crie outra sala.</p>
        <Link className="btn btn-primary" to="/">
          Criar uma sala nova
        </Link>
      </main>
    );
  }

  if (phase.kind === "load_error") {
    return (
      <main className="center">
        <h1>Não foi possível abrir a sala</h1>
        <p>Verifique sua conexão e recarregue a página.</p>
      </main>
    );
  }

  return (
    <div className="room">
      <header className="room-header">
        <Link to="/" className="logo logo-small">
          Telão
        </Link>
        <div className="share">
          <label htmlFor="room-link" className="sr-only">
            Link da sala
          </label>
          <input
            id="room-link"
            ref={linkInput}
            className="share-link"
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="btn btn-primary" onClick={handleCopy}>
            Copiar link
          </button>
        </div>
      </header>

      {/* Avisos por cima da sala (não mudam o layout). Uma vaga por tipo. */}
      <ToastStack>
        {copyState === "auto_blocked" && (
          <Toast key="copy" role="status" onClose={() => setCopyState("idle")}>
            O navegador não deixou copiar o link automaticamente. Use o botão <strong>Copiar link</strong> acima
            para mandar para a galera.
          </Toast>
        )}
        {copyState === "manual_failed" && (
          <Toast key="copy" onClose={() => setCopyState("idle")}>
            Não deu para copiar. O link está selecionado — use <kbd>Ctrl</kbd>+<kbd>C</kbd>.
          </Toast>
        )}
        {ALL_DEVICES.map(
          (d) =>
            media.errors[d] && (
              <DeviceErrorNotice key={d} device={d} error={media.errors[d]} onDismiss={() => media.dismissError(d)} />
            ),
        )}
        {media.qualityError && (
          <Toast key="quality" onClose={media.dismissQualityError}>
            Não deu para mudar a qualidade agora. O compartilhamento continua na qualidade anterior.
          </Toast>
        )}
        {audioBlocked && (
          <Toast
            key="audio"
            onClose={() => setAudioBlocked(false)}
            action={
              <button
                className="btn btn-primary btn-small"
                onClick={() => {
                  unlockRemoteAudio();
                  setAudioBlocked(false);
                }}
              >
                Ativar som
              </button>
            }
          >
            O navegador pausou o som dos outros participantes.
          </Toast>
        )}
      </ToastStack>

      <div className="room-body">
        <main className="stage">
          {phase.kind === "loading" && <p className="muted">Abrindo a sala…</p>}

          {(phase.kind === "name" || phase.kind === "joining") && (
            <form className="join-form" onSubmit={handleSubmit}>
              <h1>Como você quer aparecer?</h1>
              <label htmlFor="display-name" className="sr-only">
                Seu nome
              </label>
              <input
                id="display-name"
                className="input"
                placeholder="Seu nome"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                autoFocus
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
                disabled={phase.kind === "joining"}
              />
              {nameError && (
                <p className="error" role="alert">
                  {nameError}
                </p>
              )}
              <button className="btn btn-primary btn-big" disabled={phase.kind === "joining"}>
                {phase.kind === "joining" ? "Entrando…" : "Entrar"}
              </button>
            </form>
          )}

          {inRoom && (
            <Stage
              selfId={inRoom.selfId}
              selfName={inRoom.participants.find((p) => p.id === inRoom.selfId)?.name ?? name}
              participants={inRoom.participants}
              remote={media.remote}
              localCamera={media.local.cam}
              localScreen={media.local.screen}
              screenQuality={media.screenQuality}
              screenCapture={media.screenCapture}
              notes={notes.notes}
              onWriteNote={(screenOf, x, y, text) => activeConnection?.send({ type: "note", screenOf, x, y, text })}
              onMoveNote={(screenOf, x, y) => moveMyNote(inRoom.selfId, screenOf, x, y)}
            />
          )}
          {inRoom && (
            <div className="controls">
              {ALL_DEVICES.map((d) => (
                <DeviceButton key={d} device={d} state={media.state[d]} onClick={() => media.toggle(d)} />
              ))}
              <QualityPicker value={media.screenQuality} onChange={(q) => void media.setScreenQuality(q)} />
              {media.state.screen === "on" && (
                <FloatingButton
                  supported={floating.supported}
                  open={!!floating.win}
                  onOpen={() => void floating.open()}
                  onClose={floating.close}
                />
              )}
            </div>
          )}

          {phase.kind === "disconnected" && (
            <div className="center-block">
              <h1>Você saiu da sala</h1>
              <p className="muted">A conexão caiu.</p>
              <button className="btn btn-primary" onClick={() => enter(name)}>
                Entrar de novo
              </button>
            </div>
          )}
        </main>

        {phase.kind === "in_room" && (
          <aside className="participants" aria-label="Participantes">
            <h2>
              Participantes{" "}
              <span className="muted">
                ({phase.participants.length}/{MAX_PARTICIPANTS})
              </span>
            </h2>
            <ul>
              {phase.participants.map((p) => (
                <li key={p.id}>
                  <span className="avatar" aria-hidden>
                    {[...p.name][0]?.toUpperCase()}
                  </span>
                  <span className="participant-name">
                    {p.name}
                    {p.id === phase.selfId && <span className="muted"> (você)</span>}
                  </span>
                  <span className="device-status">
                    <span
                      className={`mic-status ${p.micOn ? "is-on" : ""}`}
                      role="img"
                      aria-label={p.micOn ? "microfone ligado" : "microfone desligado"}
                      title={p.micOn ? "Microfone ligado" : "Microfone desligado"}
                    >
                      {p.micOn ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
                    </span>
                    <span
                      className={`mic-status ${p.camOn ? "is-on" : ""}`}
                      role="img"
                      aria-label={p.camOn ? "câmera ligada" : "câmera desligada"}
                      title={p.camOn ? "Câmera ligada" : "Câmera desligada"}
                    >
                      {p.camOn ? <CamIcon size={16} /> : <CamOffIcon size={16} />}
                    </span>
                    {p.screenOn && (
                      <span className="mic-status is-on" role="img" aria-label="compartilhando a tela" title="Compartilhando a tela">
                        <ScreenIcon size={16} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      {Object.entries(media.remote).map(
        ([peerId, m]) => m.audio && <RemoteAudio key={peerId} stream={m.audio} onBlocked={onAudioBlocked} />,
      )}

      {/* Janela flutuante de quem transmite: miniatura da própria tela com os recados. */}
      {floating.win &&
        inRoom &&
        media.local.screen &&
        createPortal(
          <div className="floating-root">
            <ScreenView
              floating
              stream={media.local.screen}
              label="Sua tela"
              notes={notes.notes.filter((n) => n.screenOf === inRoom.selfId)}
            />
          </div>,
          floating.win.document.body,
        )}

      {copyState === "copied" && (
        <div className="toast" role="status">
          Link copiado!
        </div>
      )}
    </div>
  );
}

const BUTTON_TEXT: Record<Device, { on: string; off: string }> = {
  mic: { on: "Desligar microfone", off: "Ligar microfone" },
  cam: { on: "Desligar câmera", off: "Ligar câmera" },
  screen: { on: "Parar compartilhamento", off: "Compartilhar tela" },
};

function DeviceButton({ device, state, onClick }: { device: Device; state: DeviceState; onClick(): void }) {
  const on = state === "on";
  const Icon = device === "mic" ? (on ? MicIcon : MicOffIcon) : device === "cam" ? (on ? CamIcon : CamOffIcon) : ScreenIcon;
  return (
    <button
      className={`btn btn-control ${on ? "is-on" : ""}`}
      onClick={onClick}
      disabled={state === "starting"}
      aria-pressed={on}
      aria-label={on ? BUTTON_TEXT[device].on : BUTTON_TEXT[device].off}
    >
      <Icon />
      <span aria-hidden>
        {on ? BUTTON_TEXT[device].on : state === "starting" ? (device === "screen" ? "Escolhendo…" : "Ligando…") : BUTTON_TEXT[device].off}
      </span>
    </button>
  );
}

function FloatingButton({ supported, open, onOpen, onClose }: { supported: boolean; open: boolean; onOpen(): void; onClose(): void }) {
  if (!supported) {
    return (
      <span className="floating-unsupported">
        <button className="btn btn-control" disabled aria-describedby="floating-why">
          Abrir janela flutuante
        </button>
        <span id="floating-why" className="muted">
          Janela flutuante só no Chrome ou Edge (versão 116 ou mais nova) no computador.
        </span>
      </span>
    );
  }
  return (
    <button
      className={`btn btn-control ${open ? "is-on" : ""}`}
      aria-pressed={open}
      onClick={open ? onClose : onOpen}
      title="Uma janela sempre por cima dos outros apps, para ver os recados enquanto joga"
    >
      {open ? "Fechar janela flutuante" : "Abrir janela flutuante"}
    </button>
  );
}
