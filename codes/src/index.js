import http from "node:http";
import { handle } from "./service.js";

/* Сервер без зависимостей: ему нечего ставить на машине владельца, кроме
   Node. Слушает только localhost: наружу его выводит основной сервер
   через /api/codes — так и nginx, и HTTPS остаются одни на всех. */
const PORT = Number(process.env.CODES_PORT || 3010);
const HOST = process.env.CODES_HOST || "127.0.0.1";
const MAX_BODY = 16 * 1024;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); }
  });
  req.on("end", async () => {
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }
    const out = body === null
      ? { status: 400, body: { error: "bad json" } }
      : await handle(req.method, req.url, body);
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(out.body));
  });
});
server.listen(PORT, HOST, () => {
  console.log(`codes service listening on ${HOST}:${PORT}`);
});
