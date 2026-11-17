import type { ReactNode } from "react";
import { Toast } from "./Toast";
import type { Device, DeviceError } from "../media/useMedia";

type Msg = { title: string; body: ReactNode };

const LABEL = {
  mic: { name: "o microfone", Name: "Microfone", button: "Ligar microfone", missing: "um microfone (ou fone com microfone)", pron: "Ele" },
  cam: { name: "a câmera", Name: "Câmera", button: "Ligar câmera", missing: "uma webcam", pron: "Ela" },
};

function deviceMessage(device: "mic" | "cam", error: DeviceError): Msg {
  const l = LABEL[device];
  switch (error) {
    case "denied":
    case "system_denied":
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
        body: `${l.pron} pode estar em uso por outro programa. Feche o outro programa e tente de novo.`,
      };
    case "insecure":
      return {
        title: `${l.Name} não está disponível nesta página.`,
        body: "O navegador só libera câmera e microfone em sites com HTTPS (ou em localhost).",
      };
    case "unsupported":
      return { title: `Este navegador não dá acesso a ${l.name}.`, body: "Tente em outro navegador." };
    case "other":
      return { title: `Não deu para ligar ${l.name}.`, body: "Tente de novo. Se continuar, teste em outro navegador." };
  }
}

function screenMessage(error: DeviceError): Msg {
  switch (error) {
    case "denied":
      return {
        title: "A tela não foi compartilhada.",
        body: (
          <>
            Se você cancelou a escolha, tudo certo — é só clicar em <strong>Compartilhar tela</strong> de novo. Se o
            navegador bloqueou, clique no ícone de <strong>cadeado</strong> à esquerda do endereço do site e
            verifique se o compartilhamento de tela está permitido.
          </>
        ),
      };
    case "system_denied":
      return {
        title: "O sistema bloqueou a captura de tela.",
        body: (
          <>
            No macOS, abra <strong>Ajustes do Sistema › Privacidade e Segurança › Gravação de Tela</strong>, ative
            o seu navegador e reabra o navegador. Depois clique em <strong>Compartilhar tela</strong> de novo.
          </>
        ),
      };
    case "unsupported":
      return {
        title: "Este navegador não permite compartilhar a tela.",
        body: "Celulares e tablets não oferecem essa função. Para compartilhar, use Chrome, Edge ou Firefox no computador.",
      };
    case "insecure":
      return {
        title: "Compartilhar tela não está disponível nesta página.",
        body: "O navegador só libera o compartilhamento em sites com HTTPS (ou em localhost).",
      };
    case "not_found":
    case "in_use":
    case "other":
      return {
        title: "Não deu para compartilhar a tela.",
        body: "Tente de novo escolhendo outra tela ou janela. Se continuar, teste em outro navegador.",
      };
  }
}

export function DeviceErrorNotice({ device, error, onDismiss }: { device: Device; error: DeviceError; onDismiss(): void }) {
  const msg = device === "screen" ? screenMessage(error) : deviceMessage(device, error);
  const stillWorks =
    device === "mic"
      ? "Você continua na sala e ouvindo os outros."
      : device === "cam"
        ? "Você continua na sala, vendo e ouvindo os outros."
        : "Você continua na sala e pode assistir normalmente.";
  return (
    <Toast onClose={onDismiss}>
      <strong>{msg.title}</strong> {msg.body} {stillWorks}
    </Toast>
  );
}
