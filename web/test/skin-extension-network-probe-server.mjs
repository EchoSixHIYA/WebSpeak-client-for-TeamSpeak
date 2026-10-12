import http from "node:http";

let hits = 0;
const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/reset") {
    hits = 0;
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ hits }));
    return;
  }
  if (request.url === "/count") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ hits }));
    return;
  }
  if (request.url?.startsWith("/probe")) {
    hits += 1;
    response.writeHead(200, { "Content-Type": "text/plain" }).end("network request reached the probe server");
    return;
  }
  response.writeHead(404).end();
});

server.listen(5176, "127.0.0.1", () => {
  process.stdout.write("Skin extension network probe listening at http://127.0.0.1:5176\n");
});
