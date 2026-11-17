import { useCallback, useEffect, useRef, useState } from "react";
import { NOTE_FADE_MS, NOTE_VISIBLE_MS, type Note } from "../../../shared/protocol";

export interface ShownNote extends Note {
  /** Nos últimos NOTE_FADE_MS o recado vai sumindo. */
  fading: boolean;
}

/**
 * Recados na tela: no máximo um por pessoa (o novo substitui o anterior),
 * visível por 5 s e depois some com fade de 1 s. Recados de pessoas
 * diferentes convivem.
 */
export function useNotes() {
  const [byAuthor, setByAuthor] = useState<Record<string, ShownNote>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>[]>());

  const clearTimers = (authorId: string) => {
    timers.current.get(authorId)?.forEach(clearTimeout);
    timers.current.delete(authorId);
  };

  const add = useCallback((note: Note) => {
    clearTimers(note.authorId);
    setByAuthor((prev) => ({ ...prev, [note.authorId]: { ...note, fading: false } }));
    const update = (fn: (n: ShownNote) => ShownNote | null) =>
      setByAuthor((prev) => {
        const current = prev[note.authorId];
        // Só mexe se ainda for este recado (pode ter sido substituído).
        if (!current || current.id !== note.id) return prev;
        const next = { ...prev };
        const changed = fn(current);
        if (changed) next[note.authorId] = changed;
        else delete next[note.authorId];
        return next;
      });
    timers.current.set(note.authorId, [
      setTimeout(() => update((n) => ({ ...n, fading: true })), NOTE_VISIBLE_MS),
      setTimeout(() => {
        timers.current.delete(note.authorId);
        update(() => null);
      }, NOTE_VISIBLE_MS + NOTE_FADE_MS),
    ]);
  }, []);

  /** O recado de `authorId` acompanha o cursor até (x, y). */
  const move = useCallback((authorId: string, screenOf: string, x: number, y: number) => {
    setByAuthor((prev) => {
      const current = prev[authorId];
      if (!current || current.screenOf !== screenOf) return prev;
      return { ...prev, [authorId]: { ...current, x, y } };
    });
  }, []);

  const clear = useCallback(() => {
    for (const id of [...timers.current.keys()]) clearTimers(id);
    setByAuthor({});
  }, []);

  useEffect(() => clear, [clear]);

  return { notes: Object.values(byAuthor), add, move, clear };
}
