import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const AAD = Buffer.from("webspeak:teamspeak-password:v1", "utf8");

export function encryptSecret(value: string, masterKey: Buffer): string {
  if (!value) return "";
  assertMasterKey(masterKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, masterKey, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(payload: string | null | undefined, masterKey: Buffer): string {
  if (!payload) return "";
  assertMasterKey(masterKey);
  const [version, nonceText, tagText, ciphertextText, ...extra] = payload.split(":");
  if (version !== VERSION || !nonceText || !tagText || ciphertextText === undefined || extra.length) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(nonceText, "base64url"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.length !== 32) throw new Error("Invalid master key length");
}
