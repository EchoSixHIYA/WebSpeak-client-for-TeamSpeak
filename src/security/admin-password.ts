import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_PARAMETERS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export interface AdminCredential {
  version: 1;
  salt: string;
  hash: string;
  parameters: {
    N: number;
    r: number;
    p: number;
  };
}

export function validateAdminPassword(password: string): string | null {
  if (password.length < 12) return "Admin password must contain at least 12 characters";
  if (password.length > 1024) return "Admin password is too long";
  return null;
}

export async function hashAdminPassword(password: string): Promise<AdminCredential> {
  const validationError = validateAdminPassword(password);
  if (validationError) throw new Error(validationError);
  const salt = randomBytes(16);
  const hash = await derive(password, salt, SCRYPT_PARAMETERS);
  return {
    version: 1,
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
    parameters: {
      N: SCRYPT_PARAMETERS.N,
      r: SCRYPT_PARAMETERS.r,
      p: SCRYPT_PARAMETERS.p,
    },
  };
}

export async function verifyAdminPassword(password: string, credential: AdminCredential): Promise<boolean> {
  if (credential.version !== 1 || typeof password !== "string" || password.length > 1024) return false;
  try {
    const expected = Buffer.from(credential.hash, "base64url");
    const actual = await derive(password, Buffer.from(credential.salt, "base64url"), {
      ...credential.parameters,
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function derive(
  password: string,
  salt: Buffer,
  parameters: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, parameters, (error, result) => {
      if (error) reject(error);
      else resolve(Buffer.from(result));
    });
  });
}
