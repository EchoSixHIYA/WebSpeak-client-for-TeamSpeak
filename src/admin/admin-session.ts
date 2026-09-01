import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { TLSSocket } from "node:tls";

const COOKIE_NAME = "webspeak_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface AdminSession {
  csrfToken: string;
  expiresAt: number;
}

export class AdminSessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  create(response: Response, secure: boolean, now = Date.now()): { csrfToken: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    const expiresAt = now + SESSION_TTL_MS;
    this.sessions.set(hashToken(token), { csrfToken, expiresAt });
    response.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
    return { csrfToken, expiresAt };
  }

  get(request: Request, now = Date.now()): AdminSession | null {
    const token = readCookie(request.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(key);
      return null;
    }
    return session;
  }

  destroy(request: Request, response: Response, secure: boolean): void {
    const token = readCookie(request.headers.cookie, COOKIE_NAME);
    if (token) this.sessions.delete(hashToken(token));
    response.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "strict", secure, path: "/" });
  }

  clear(): void {
    this.sessions.clear();
  }
}

export function isSecureRequest(request: Request): boolean {
  return (request.socket as TLSSocket).encrypted === true;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
