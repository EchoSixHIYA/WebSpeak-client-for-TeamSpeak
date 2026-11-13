/** Add Opus channel negotiation parameters to audio payloads in an SDP document. */
export function addOpusFmtpParameters(sdp: string, parameters: readonly string[]): string {
  if (!sdp || parameters.length === 0) return sdp;
  const lines = sdp.split(/\r?\n/);
  const output: string[] = [];
  let section: string[] = [];
  const flush = () => {
    if (section[0]?.startsWith("m=audio ")) patchAudioSection(section, parameters);
    output.push(...section);
    section = [];
  };
  for (const line of lines) {
    if (line.startsWith("m=")) {
      if (section.length) flush();
    }
    section.push(line);
  }
  if (section.length) flush();
  return output.join("\r\n");
}

function patchAudioSection(section: string[], parameters: readonly string[]): void {
  const payloads = new Set(section[0]!.trim().split(/\s+/).slice(3));
  const opusPayloads = section.flatMap(line => {
    const match = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?\s*$/i.exec(line);
    return match && payloads.has(match[1]!) ? [match[1]!] : [];
  });
  for (const payload of opusPayloads) {
    const prefix = `a=fmtp:${payload}`;
    const index = section.findIndex(line => new RegExp(`^${prefix}(?:\\s|$)`).test(line));
    if (index < 0) {
      const rtpmap = section.findIndex(line => line.startsWith(`a=rtpmap:${payload} `));
      if (rtpmap >= 0) section.splice(rtpmap + 1, 0, `${prefix} ${parameters.join(";")}`);
      continue;
    }
    const parts = section[index]!.slice(prefix.length).trim().split(";").filter(Boolean);
    for (const parameter of parameters) {
      const name = parameter.split("=", 1)[0]!.trim().toLowerCase();
      const existing = parts.findIndex(part => part.split("=", 1)[0]!.trim().toLowerCase() === name);
      if (existing < 0) parts.push(parameter);
      else parts[existing] = parameter;
    }
    section[index] = `${prefix} ${parts.join(";")}`;
  }
}
