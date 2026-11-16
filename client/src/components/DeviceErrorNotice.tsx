import type { Device, DeviceError } from "../media/useMedia";

const LABEL: Record<Device, { name: string; Name: string; button: string; missing: string }> = {
  mic: { name: "o microfone", Name: "Microfone", button: "Ligar microfone", missing: "um microfone (ou fone com microfone)" },
  cam: { name: "a câmera", Name: "Câmera", button: "Ligar câmera", missing: "uma webcam" },
};

function message(device: Device, error: DeviceError): { title: string; body: React.ReactNode } {
  const l = LABEL[device];
  switch (error) {
    case "denied":
      return {
        title: `O navegador bloqueou ${l.name}.`,
        body: (
          <>
            Para liberar, clique no ícone de <strong>cadeado</strong> (ou de câmera/microfone) à esquerda do
            endereço do site, mude <strong>{l.Name}</strong> para <strong>Permitir</strong> e clique em{" "}
            <strong>{l.button}</strong> de novo. Se não aparecer a opção, recarregue a página depois de permitir.
          </>
        ),
      };
    case "not_found":
      return {
        title: device === "mic" ? "Nenhum microfone encontrado." : "Nenhuma câmera encontrada.",
        body: `Conecte ${l.missing} e tente de novo.`,
      };
    case "in_use":
      return {
        title: `Não deu para usar ${l.name}.`,
        body: `${device === "mic" ? "Ele" : "Ela"} pode estar em uso por outro programa. Feche o outro programa e tente de novo.`,
      };
    case "insecure":
      return {
        title: `${l.Name} não está disponível nesta página.`,
        body: "O navegador só libera câmera e microfone em sites com HTTPS (ou em localhost).",
      };
    case "other":
      return { title: `Não deu para ligar ${l.name}.`, body: "Tente de novo. Se continuar, teste em outro navegador." };
  }
}

export function DeviceErrorNotice({ device, error, onDismiss }: { device: Device; error: DeviceError; onDismiss(): void }) {
  const msg = message(device, error);
  return (
    <div className="notice notice-row" role="alert">
      <div>
        <strong>{msg.title}</strong> {msg.body} Você continua na sala{device === "cam" ? ", vendo e ouvindo os outros." : " e ouvindo os outros."}
      </div>
      <button className="btn btn-small" onClick={onDismiss} aria-label="Fechar aviso">
        ✕
      </button>
    </div>
  );
}
