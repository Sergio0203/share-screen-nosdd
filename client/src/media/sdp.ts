/**
 * Banda inicial (kbps) que o Chrome assume ao começar a enviar vídeo.
 *
 * Sem isso o WebRTC parte de ~300 kbps e sobe ~8% por segundo: uma tela em
 * 1080p levava 20–30 s para sair do borrão (o encoder reduz a resolução
 * enquanto a banda estimada é baixa). Se a rede não aguentar, a estimativa
 * cai sozinha em poucos segundos.
 */
export const START_BITRATE_KBPS = 2500;

const VIDEO_CODEC = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i;

/**
 * Acrescenta `x-google-start-bitrate` aos codecs de vídeo de um SDP.
 * Extensão do Chrome; os outros navegadores ignoram o parâmetro.
 */
export function withStartBitrate(sdp: string, kbps = START_BITRATE_KBPS): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const out: string[] = [];
  let inVideo = false;
  for (const line of lines) {
    if (line.startsWith("m=")) inVideo = line.startsWith("m=video");
    if (inVideo && line.startsWith("a=fmtp:") && !line.includes("x-google-start-bitrate")) {
      const pt = line.slice("a=fmtp:".length).split(" ")[0];
      const isVideoCodec = lines.some((l) => VIDEO_CODEC.test(l) && l.match(VIDEO_CODEC)![1] === pt);
      out.push(isVideoCodec ? `${line};x-google-start-bitrate=${kbps}` : line);
      continue;
    }
    out.push(line);
    const codec = inVideo ? line.match(VIDEO_CODEC) : null;
    if (codec && !lines.some((l) => l.startsWith(`a=fmtp:${codec[1]} `))) {
      out.push(`a=fmtp:${codec[1]} x-google-start-bitrate=${kbps}`);
    }
  }
  return out.join(eol);
}
