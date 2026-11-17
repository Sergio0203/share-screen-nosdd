import { useState, type FormEvent, type KeyboardEvent } from "react";
import { clipText, MAX_NOTE_LENGTH, normalizeNote, textLength } from "../../../shared/protocol";

interface Props {
  x: number;
  y: number;
  onSend(text: string): void;
  onCancel(): void;
}

/** Campo do recado, aberto no ponto do cursor. Enter envia, Esc cancela. */
export function NoteComposer({ x, y, onSend, onCancel }: Props) {
  const [text, setText] = useState("");
  const left = MAX_NOTE_LENGTH - textLength(text);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = normalizeNote(text);
    if (clean) onSend(clean);
    else onCancel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // Não deixa o Esc sair da tela cheia: aqui ele só cancela o recado.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <form className={`note-composer ${noteAnchor(x, y)}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onSubmit={submit}>
      <input
        autoFocus
        aria-label="Recado na tela"
        placeholder="Escreva e aperte Enter"
        value={text}
        // Não deixa passar de 100 caracteres (contando emoji como 1).
        onChange={(e) => setText(clipText(e.target.value, MAX_NOTE_LENGTH))}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      />
      <span className="note-counter" aria-live="polite">
        {left === 1 ? "falta 1 caractere" : `faltam ${left} caracteres`}
      </span>
    </form>
  );
}

/** Perto das bordas, o balão cresce para dentro da imagem. */
export function noteAnchor(x: number, y: number): string {
  return `${x > 0.65 ? "anchor-right" : ""} ${y > 0.8 ? "anchor-bottom" : ""}`.trim();
}
