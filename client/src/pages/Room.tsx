import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { roomExists, roomUrl } from "../api";
import { copyText } from "../clipboard";
import type { JustCreatedState } from "./Home";

type LoadState = "loading" | "ready" | "not_found" | "error";
type CopyState = "idle" | "copied" | "auto_blocked" | "manual_failed";

const TOAST_MS = 3000;

export function Room() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const linkInput = useRef<HTMLInputElement>(null);

  // Lido uma única vez: resultado da cópia automática feita ao criar a sala.
  const [copyState, setCopyState] = useState<CopyState>(() => {
    const state = location.state as JustCreatedState | null;
    if (!state?.justCreated) return "idle";
    return state.copied ? "copied" : "auto_blocked";
  });
  const [load, setLoad] = useState<LoadState>("loading");

  const url = roomUrl(id);

  // Limpa o estado da navegação para não repetir o aviso ao recarregar.
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    roomExists(id)
      .then((exists) => !cancelled && setLoad(exists ? "ready" : "not_found"))
      .catch(() => !cancelled && setLoad("error"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // "Link copiado!" some sozinho.
  useEffect(() => {
    if (copyState !== "copied") return;
    const t = setTimeout(() => setCopyState("idle"), TOAST_MS);
    return () => clearTimeout(t);
  }, [copyState]);

  async function handleCopy() {
    const ok = await copyText(url);
    if (ok) {
      setCopyState("copied");
    } else {
      setCopyState("manual_failed");
      linkInput.current?.select();
    }
  }

  if (load === "not_found") {
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

  if (load === "error") {
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
      {copyState === "manual_failed" && (
        <p className="notice" role="alert">
          Não deu para copiar. O link está selecionado — use <kbd>Ctrl</kbd>+<kbd>C</kbd>.
        </p>
      )}

      <main className="stage">
        {load === "loading" ? <p className="muted">Entrando na sala…</p> : <p className="muted">Você está na sala.</p>}
      </main>

      {copyState === "copied" && (
        <div className="toast" role="status">
          Link copiado!
        </div>
      )}
    </div>
  );
}
