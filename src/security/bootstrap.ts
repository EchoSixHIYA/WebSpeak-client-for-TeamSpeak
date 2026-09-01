import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

export class BootstrapManager {
  private code: string | null = null;

  constructor(private readonly path: string) {}

  ensure(): string {
    if (this.code) return this.code;
    try {
      const stored = readFileSync(this.path, "utf8").trim();
      if (normalize(stored).length >= 20) {
        this.code = stored;
        return stored;
      }
    } catch {
      // A missing or invalid bootstrap file is replaced below.
    }

    const raw = randomBytes(16).toString("hex").toUpperCase();
    this.code = raw.match(/.{1,4}/g)!.join("-");
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${this.code}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // POSIX permissions are best-effort on non-POSIX filesystems.
    }
    return this.code;
  }

  verify(candidate: string): boolean {
    const expected = normalize(this.ensure());
    const actual = normalize(candidate);
    const expectedBytes = Buffer.from(expected, "utf8");
    const actualBytes = Buffer.from(actual, "utf8");
    return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
  }

  consume(): void {
    this.code = null;
    try {
      unlinkSync(this.path);
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

function normalize(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}
