import type { ReactNode } from "react";

interface Props {
  /** "alert" para erros (lido na hora por leitores de tela), "status" para avisos. */
  role?: "alert" | "status";
  onClose(): void;
  /** Ação extra, ao lado do fechar (ex.: "Ativar som"). */
  action?: ReactNode;
  children: ReactNode;
}

/** Aviso flutuante: aparece por cima da sala, sem mudar o layout. */
export function Toast({ role = "alert", onClose, action, children }: Props) {
  return (
    <div className="toast-card" role={role}>
      <div className="toast-body">{children}</div>
      <div className="toast-actions">
        {action}
        <button className="btn btn-small toast-close" onClick={onClose} aria-label="Fechar aviso">
          ✕
        </button>
      </div>
    </div>
  );
}

/**
 * Pilha de avisos no canto superior direito, abaixo do cabeçalho (não cobre o
 * "Copiar link" nem os controles de baixo). Cada tipo de aviso tem uma única
 * vaga: se aparecer de novo, substitui o anterior em vez de repetir.
 */
export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <section className="toasts" aria-label="Avisos">
      {children}
    </section>
  );
}
