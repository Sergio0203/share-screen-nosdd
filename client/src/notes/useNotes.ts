import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "../../../shared/protocol";

/** Quanto tempo um recado fica na tela. */
export const NOTE_TTL_MS = 10_000;

/** Recados recebidos; cada um some sozinho depois de NOTE_TTL_MS. */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const add = useCallback((note: Note) => {
    setNotes((prev) => [...prev, note]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    }, NOTE_TTL_MS);
    timers.current.add(timer);
  }, []);

  const clear = useCallback(() => setNotes([]), []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { notes, add, clear };
}
