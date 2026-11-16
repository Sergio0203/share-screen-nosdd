import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, roomPath, roomUrl } from "../api";
import { copyDeferredText } from "../clipboard";

/** Estado passado para a sala logo após criá-la. */
export interface JustCreatedState {
  justCreated: true;
  copied: boolean;
}

export function Home() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    setCreating(true);
    setError(null);

    const idPromise = createRoom();
    // A cópia começa aqui, ainda dentro do clique, para o navegador permitir.
    const copyPromise = copyDeferredText(idPromise.then(roomUrl));

    idPromise
      .then(async (id) => {
        const copied = await copyPromise;
        const state: JustCreatedState = { justCreated: true, copied };
        navigate(roomPath(id), { state });
      })
      .catch(() => {
        setError("Não foi possível criar a sala. Tente de novo.");
        setCreating(false);
      });
  }

  return (
    <main className="home">
      <h1 className="logo">Telão</h1>
      <p className="tagline">Compartilhe a tela com até 6 pessoas. Sem cadastro.</p>
      <button className="btn btn-primary btn-big" onClick={handleCreate} disabled={creating}>
        {creating ? "Criando…" : "Criar sala"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
