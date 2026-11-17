# Telão

Salas de até 6 pessoas, sem cadastro, para conversar por voz, ligar a webcam e compartilhar a tela.

## Stack

- **Front:** React + Vite + TypeScript (`client/`)
- **Back:** Node + Fastify + TypeScript (`server/`) — API de salas e WebSocket de presença (depois, sinalização WebRTC)
- **Protocolo compartilhado:** `shared/protocol.ts` (tipos das mensagens, limite de 6 pessoas)
- **Mídia:** WebRTC em malha (cada pessoa conecta direto com as outras) — `client/src/media/`
- **Testes:** Vitest + Testing Library (unidade) e Playwright (ponta a ponta, com microfone falso do Chromium)

## Rodando localmente

Requer Node 22+.

```sh
npm install
npm run dev        # front em http://localhost:5173 (com proxy para a API em :3000)
```

Outros comandos:

```sh
npm test           # testes de unidade
npm run test:e2e   # ponta a ponta no Chromium (1ª vez: npx playwright install chromium)
npm run typecheck  # checagem de tipos
npm run build      # gera dist/client
npm start          # serve o build + API em http://localhost:3000 (PORT=xxxx para mudar)
```

> A área de transferência (e, mais à frente, câmera/microfone/tela) só funciona em
> `localhost` ou em HTTPS. Para testar de outro aparelho na rede, use um túnel HTTPS.

> Conexão entre pessoas usa só STUN público (sem TURN). Em redes muito restritivas
> (algumas corporativas / 4G com CGNAT simétrico) o áudio pode não conectar; a
> solução é adicionar um servidor TURN em `client/src/media/peerMesh.ts`.

> **Jogos:** ao compartilhar só a janela de um jogo em *tela cheia exclusiva*, o
> vídeo pode sair preto (limitação do sistema/navegador). Use o modo **janela sem
> bordas** no jogo, ou compartilhe a tela inteira.

> **Janela flutuante** (para quem transmite ver os recados enquanto joga): usa a
> Document Picture-in-Picture API, disponível só no **Chrome e Edge 116+** no
> computador. Em outros navegadores o botão aparece desabilitado com explicação.
