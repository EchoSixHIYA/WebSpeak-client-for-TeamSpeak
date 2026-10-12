import type { ChannelMember } from "../composables/useVoiceWebSocket.js";

/** A client already present in the channel is online unless explicitly away. */
export function memberPresenceKey(member: Pick<ChannelMember, "away" | "isSelf">, speaking: boolean): string {
  if (member.away === true) return "away";
  if (speaking) return "speaking";
  return member.isSelf ? "yourDevice" : "memberOnline";
}
