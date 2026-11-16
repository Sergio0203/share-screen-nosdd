import type { MicError } from "../media/useVoice";

const MESSAGES: Record<MicError, { title: string; body: React.ReactNode }> = {
  denied: {
    title: "O navegador bloqueou o microfone.",
    body: (
      <>
        Para liberar, clique no ícone de <strong>cadeado</strong> (ou de microfone) à esquerda do endereço do
        site, mude <strong>Microfone</strong> para <strong>Permitir</strong> e clique em{" "}
        <strong>Ligar microfone</strong> de novo. Se não aparecer a opção, recarregue a página depois de
        permitir.
      </>
    ),
  },
  not_found: {
    title: "Nenhum microfone encontrado.",
    body: "Conecte um microfone (ou fone com microfone) e tente de novo.",
  },
  in_use: {
    title: "Não deu para usar o microfone.",
    body: "Ele pode estar em uso por outro programa. Feche o outro programa e tente de novo.",
  },
  insecure: {
    title: "O microfone não está disponível nesta página.",
    body: "O navegador só libera o microfone em sites com HTTPS (ou em localhost).",
  },
  other: {
    title: "Não deu para ligar o microfone.",
    body: "Tente de novo. Se continuar, teste em outro navegador.",
  },
};

export function MicErrorNotice({ error, onDismiss }: { error: MicError; onDismiss(): void }) {
  const msg = MESSAGES[error];
  return (
    <div className="notice notice-row" role="alert">
      <div>
        <strong>{msg.title}</strong> {msg.body} Você continua na sala e ouvindo os outros.
      </div>
      <button className="btn btn-small" onClick={onDismiss} aria-label="Fechar aviso">
        ✕
      </button>
    </div>
  );
}
