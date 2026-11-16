# Telão

Salas de até 6 pessoas, sem cadastro, para conversar por voz, ligar a webcam e compartilhar a tela.

## Stack

- **Front:** React + Vite + TypeScript (`client/`)
- **Back:** Node + Fastify + TypeScript (`server/`) — API de salas e WebSocket de presença (depois, sinalização WebRTC)
- **Protocolo compartilhado:** `shared/protocol.ts` (tipos das mensagens, limite de 6 pessoas)
- **Testes:** Vitest + Testing Library

## Rodando localmente

Requer Node 22+.

```sh
npm install
npm run dev        # front em http://localhost:5173 (com proxy para a API em :3000)
```

Outros comandos:

```sh
npm test           # testes
npm run typecheck  # checagem de tipos
npm run build      # gera dist/client
npm start          # serve o build + API em http://localhost:3000 (PORT=xxxx para mudar)
```

> A área de transferência (e, mais à frente, câmera/microfone/tela) só funciona em
> `localhost` ou em HTTPS. Para testar de outro aparelho na rede, use um túnel HTTPS.
