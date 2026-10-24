import type { ChannelInfo } from "./voice-models.js";

export interface ChannelSpacer {
  text: string;
  alignment: "left" | "center" | "right" | "repeat";
  style: "text" | "solid" | "dashed" | "dotted" | "dash-dot" | "dash-dot-dot";
}

const LINE_STYLES: Readonly<Record<string, ChannelSpacer["style"]>> = {
  "___": "solid", "---": "dashed", "...": "dotted", "-.-": "dash-dot", "-..": "dash-dot-dot",
};

/** Spacers are a presentation convention for permanent, root-level TS channels. */
export function getChannelSpacer(channel: Pick<ChannelInfo, "name" | "parentID" | "isPermanent">): ChannelSpacer | null {
  if (channel.parentID !== "0" || channel.isPermanent !== true) return null;
  const match = /^\[([clr*]?)spacer[^\]\r\n]*\]([\s\S]*)$/i.exec(channel.name);
  if (!match) return null;
  const text = match[2];
  const alignment = ({ c: "center", r: "right", "*": "repeat" } as const)[match[1].toLowerCase() as "c" | "r" | "*"] ?? "left";
  return { text, alignment, style: Object.hasOwn(LINE_STYLES, text) ? LINE_STYLES[text] : "text" };
}

export function channelDisplayName(channel: Pick<ChannelInfo, "name" | "parentID" | "isPermanent">): string {
  return getChannelSpacer(channel)?.text ?? channel.name;
}
