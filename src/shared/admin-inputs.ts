export interface AdminSettingsInput {
  target: string;
  serverPassword?: string;
  passwordAction?: "keep" | "replace" | "remove";
  accessMode: "fixed" | "open";
  siteName: string;
  welcomeText: string;
  welcomeTextEn?: string;
  welcomeTextDe?: string;
  welcomeTextRu?: string;
  welcomeTextJa?: string;
  webRtcEnabled: boolean;
  webRtcPublicHost?: string;
  webRtcIpv6Enabled?: boolean;
  webRtcStunServer?: string;
  webRtcUdpStart?: number;
  webRtcUdpEnd?: number;
  relaySettingsAction?: "keep" | "replace" | "remove";
  relayEnabled?: boolean;
  relayName?: string;
  relayTarget?: string;
  relayToken?: string;
  relayTokenAction?: "keep" | "replace" | "remove";
  relayNodes?: RelayNodeInput[];
}

export interface RelayNodeInput {
  id?: string;
  name: string;
  target: string;
  /** HTTPS origin of the WebSpeak voice gateway hosted on this relay. */
  voiceEndpoint?: string;
  enabled: boolean;
  token?: string;
  tokenAction?: "keep" | "replace" | "remove";
}

export interface ManagedInviteInput {
  channel: string;
  expiresInHours: number;
  maxUses: number;
}

export interface TsAdminSettingsInput {
  enabled: boolean;
  transport?: "web" | "ssh" | "tcp";
  queryHost?: string;
  webQueryUrl?: string;
  apiKey?: string;
  apiKeyAction?: "keep" | "replace" | "remove";
  /** 0 selects the fixed instance by its voice port. */
  serverId?: number;
  queryPort: number;
  username: string;
  password?: string;
  passwordAction?: "keep" | "replace" | "remove";
  hostKeyFingerprint: string;
}

export type TsAdminAction =
  | { action: "server.update"; name: string; welcomeMessage: string; maxClients: number }
  | { action: "channel.create"; name: string; parentId: string; description: string; permanent: boolean; password?: string }
  | { action: "channel.update"; channelId: string; name: string }
  | { action: "channel.delete"; channelId: string }
  | { action: "client.move"; clientId: number; clientUid: string; channelId: string }
  | { action: "client.kick"; clientId: number; clientUid: string; reason: string }
  | { action: "client.ban"; clientId: number; clientUid: string; reason: string; durationSeconds: number }
  | { action: "client.group"; clientId: number; clientUid: string; groupId: string; remove: boolean }
  | { action: "ban.delete"; banId: string };

export interface TsAdminActionRequest {
  /** Revision of the management configuration used to read the selected objects. */
  configurationRevision: string;
  operation: TsAdminAction;
}
