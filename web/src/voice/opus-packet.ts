/** Return an Opus packet's decoded duration in microseconds, or null if malformed. */
export function opusPacketDurationUs(packet: Uint8Array): number | null {
  if (packet.length < 1) return null;
  const toc = packet[0]!;
  const config = toc >>> 3;
  const frameDurationUs = config < 12
    ? [10_000, 20_000, 40_000, 60_000][config & 3]!
    : config < 16
      ? [10_000, 20_000][config & 1]!
      : [2_500, 5_000, 10_000, 20_000][config & 3]!;
  const code = toc & 3;
  let frameCount = 1;
  if (code === 1 || code === 2) frameCount = 2;
  else if (code === 3) {
    if (packet.length < 2) return null;
    frameCount = packet[1]! & 0x3f;
    if (frameCount < 1 || frameCount > 48) return null;
  }
  const duration = frameDurationUs * frameCount;
  return duration <= 120_000 ? duration : null;
}
