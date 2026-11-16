import { describe, expect, it } from "vitest";
import { withStartBitrate } from "./sdp";

const SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98",
  "a=rtpmap:96 VP8/90000",
  "a=rtpmap:97 rtx/90000",
  "a=fmtp:97 apt=96",
  "a=rtpmap:98 H264/90000",
  "a=fmtp:98 level-asymmetry-allowed=1;packetization-mode=1",
  "",
].join("\r\n");

describe("withStartBitrate", () => {
  const out = withStartBitrate(SDP, 2500).split("\r\n");

  it("acrescenta a banda inicial aos codecs de vídeo, com ou sem fmtp", () => {
    expect(out).toContain("a=fmtp:96 x-google-start-bitrate=2500");
    expect(out).toContain("a=fmtp:98 level-asymmetry-allowed=1;packetization-mode=1;x-google-start-bitrate=2500");
    expect(out.indexOf("a=fmtp:96 x-google-start-bitrate=2500")).toBe(out.indexOf("a=rtpmap:96 VP8/90000") + 1);
  });

  it("não mexe no áudio nem no rtx", () => {
    expect(out).toContain("a=fmtp:111 minptime=10;useinbandfec=1");
    expect(out).toContain("a=fmtp:97 apt=96");
  });

  it("é idempotente e preserva o fim de linha", () => {
    const twice = withStartBitrate(withStartBitrate(SDP, 2500), 2500);
    expect(twice).toBe(withStartBitrate(SDP, 2500));
    expect(twice.endsWith("\r\n")).toBe(true);
  });
});
