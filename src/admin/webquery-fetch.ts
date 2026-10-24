import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebQueryHttpError } from "@honeybbq/teamspeak/query";

/** Keep the SDK's WebQuery protocol, but bound HTTP requests to this admin operation.
 * Node's global fetch blocks WebQuery's default port 10080. */
export function webQueryFetch(lifetime: AbortSignal): typeof fetch {
  return ((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const request = new URL(url).protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      method: init.method, headers: init.headers as Record<string, string>,
      signal: AbortSignal.any([lifetime, AbortSignal.timeout(8_000)]),
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { res.destroy(new Error("WebQuery response too large")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        const body = Buffer.concat(chunks), status = res.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          // SDK beta.19 accepts status.code=0 even on HTTP failures. Keep genuine TS errors,
          // but never turn a proxy's failed HTTP response into a successful empty result.
          let tsError = false;
          try {
            const code: unknown = JSON.parse(body.toString("utf8"))?.status?.code;
            tsError = typeof code === "number" && Number.isSafeInteger(code) && code > 0;
          } catch { /* HTTP status is authoritative when no TS error is present. */ }
          if (!tsError) { reject(new WebQueryHttpError(status, res.statusMessage ?? "")); return; }
        }
        resolve(new Response(body, { status, statusText: res.statusMessage ?? "" }));
      });
    });
    req.on("error", reject);
    req.end(init.body as string);
  })) as typeof fetch;
}
