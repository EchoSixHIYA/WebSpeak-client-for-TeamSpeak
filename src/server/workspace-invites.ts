import { createHash, randomBytes } from "node:crypto";
import type { WebSpeakDatabase } from "../persistence/database.js";
import { decryptSecret, encryptSecret } from "../security/secret-crypto.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";

export interface WorkspaceInviteCredentials {
  target: TeamSpeakTarget;
  serverPassword: string;
  channelId: string;
  channelPassword: string;
}
export type WorkspaceInviteAccess = WorkspaceInviteCredentials & { expiresAt: number };
const purpose = "webspeak:workspace-invite:v1";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Both normal and relay gateways keep invitation credentials in their own persistent data directory. */
export class WorkspaceInvites {
  constructor(private readonly database: WebSpeakDatabase, private readonly key: Buffer) {}

  create(credentials: WorkspaceInviteCredentials, expiresInMinutes: number, now = Date.now()): { token: string; expiresAt: number } {
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 43200) throw new Error("INVALID_INVITE_EXPIRY");
    const token = "wi_" + randomBytes(32).toString("base64url");
    const expiresAt = now + expiresInMinutes * 60000;
    this.database.saveWorkspaceInvite(hash(token), encryptSecret(JSON.stringify({ ...credentials, expiresAt }), this.key, purpose), expiresAt, now);
    return { token, expiresAt };
  }

  get(token: string, now = Date.now()): WorkspaceInviteAccess | null {
    if (!/^wi_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const encrypted = this.database.getWorkspaceInvite(hash(token), now);
    if (!encrypted) return null;
    try { return JSON.parse(decryptSecret(encrypted, this.key, purpose)) as WorkspaceInviteAccess; }
    catch { return null; }
  }
}
