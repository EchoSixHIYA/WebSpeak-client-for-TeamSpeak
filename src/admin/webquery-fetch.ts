import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: res.statusCode ?? 502, statusText: res.statusMessage ?? "",
      })));
    });
    req.on("error", reject);
    req.end(init.body as string);
  })) as typeof fetch;
}
