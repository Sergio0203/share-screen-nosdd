import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS, normalizeName, type Participant } from "../../../shared/protocol";
import { getRoom, roomUrl } from "../api";
import { copyText } from "../clipboard";
import { MicIcon, MicOffIcon } from "../components/icons";
import { MicErrorNotice } from "../components/MicErrorNotice";
import { RemoteAudio, unlockRemoteAudio } from "../components/RemoteAudio";
import { useVoice } from "../media/useVoice";
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

  const voice = useVoice({
    connection: inRoom ? activeConnection : null,
    selfId: inRoom?.selfId ?? null,
    participants: inRoom?.participants ?? [],
  });
  const handleSignal = useRef(voice.handleSignal);
  handleSignal.current = voice.handleSignal;
  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);

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

      {copyState === "auto_blocked" && (
        <p className="notice" role="status">
          O navegador não deixou copiar o link automaticamente. Use o botão <strong>Copiar link</strong> acima
          para mandar para a galera.
        </p>
      )}
      {voice.micError && <MicErrorNotice error={voice.micError} onDismiss={voice.dismissMicError} />}
      {audioBlocked && (
        <div className="notice notice-row" role="alert">
          <div>O navegador pausou o som dos outros participantes.</div>
          <button
            className="btn btn-primary btn-small"
            onClick={() => {
              unlockRemoteAudio();
              setAudioBlocked(false);
            }}
          >
            Ativar som
          </button>
        </div>
      )}
      {copyState === "manual_failed" && (
        <p className="notice" role="alert">
          Não deu para copiar. O link está selecionado — use <kbd>Ctrl</kbd>+<kbd>C</kbd>.
        </p>
      )}

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

          {phase.kind === "in_room" && <p className="muted">Você está na sala.</p>}
          {phase.kind === "in_room" && (
            <div className="controls">
              <button
                className={`btn btn-control ${voice.mic === "on" ? "is-on" : ""}`}
                onClick={voice.toggleMic}
                disabled={voice.mic === "starting"}
                aria-pressed={voice.mic === "on"}
              >
                {voice.mic === "on" ? <MicIcon /> : <MicOffIcon />}
                <span>
                  {voice.mic === "on" ? "Desligar microfone" : voice.mic === "starting" ? "Ligando…" : "Ligar microfone"}
                </span>
              </button>
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
                  <span
                    className={`mic-status ${p.micOn ? "is-on" : ""}`}
                    role="img"
                    aria-label={p.micOn ? "microfone ligado" : "microfone desligado"}
                    title={p.micOn ? "Microfone ligado" : "Microfone desligado"}
                  >
                    {p.micOn ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      {Object.entries(voice.remoteStreams).map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} onBlocked={onAudioBlocked} />
      ))}

      {copyState === "copied" && (
        <div className="toast" role="status">
          Link copiado!
        </div>
      )}
    </div>
  );
}
