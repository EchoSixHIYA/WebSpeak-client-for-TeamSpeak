import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const MASTER_KEY_BYTES = 32;

/** Create or load the installation-local key used to protect secrets at rest. */
export function loadOrCreateMasterSecret(path: string): Buffer {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, randomBytes(MASTER_KEY_BYTES));
    } finally {
      closeSync(descriptor);
    }
  } catch (error: unknown) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  const key = readFileSync(path);
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(`Invalid WebSpeak master secret: expected ${MASTER_KEY_BYTES} bytes`);
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows and some container filesystems do not expose POSIX permissions.
  }
  return key;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
