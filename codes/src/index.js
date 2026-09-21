import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle, setHooks } from "./service.js";
import { adminToken, notifyOwner, ownerId, paidText, startAdminBot } from "./adminBot.js";
import { checkChain, expireTick } from "./billing.js";

/* Сервер без зависимостей: ему нечего ставить на машине владельца, кроме
   Node. Слушает только localhost: наружу его выводит основной сервер
   через /api/codes и /admin — так и nginx, и HTTPS остаются одни на всех. */
const PORT = Number(process.env.CODES_PORT || 3010);
const HOST = process.env.CODES_HOST || "127.0.0.1";
const MAX_BODY = 16 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = path.join(__dirname, "..", "public", "admin.html");

/* О каждой оплате — владельцу через админ-бота. */
setHooks({
  adminToken, ownerId,
  onPaid: (p, u) => notifyOwner(paidText(p, u)).catch((e) => console.error(`[admin-bot] уведомление: ${e.message}`)),
});

const server = http.createServer((req, res) => {
  const url = String(req.url || "");
  // Панель — одна страница; отдаётся как есть, права проверяет её API.
  if (req.method === "GET" && /^\/admin\/?(\?.*)?$/.test(url)) {
    try {
      const html = fs.readFileSync(ADMIN_HTML);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    } catch { res.writeHead(404); return res.end(); }
  }
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
      : await handle(req.method, url, body, Date.now(), req.headers);
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(out.body));
  });
});
server.listen(PORT, HOST, () => {
  console.log(`codes service listening on ${HOST}:${PORT}`);
});

/* Раз в полминуты: истёкшие подписки — в free, ожидающие TON/USDT —
   сверка с цепочкой. Сеть упала — следующий раз. */
const tick = async () => {
  try { await expireTick(); } catch (e) { console.error(`[billing] срок: ${e.message}`); }
  try {
    const n = await checkChain({ onPaid: (p, u) => notifyOwner(paidText(p, u)).catch(() => {}) });
    if (n) console.log(`[billing] оплачено по цепочке: ${n}`);
  } catch (e) { console.error(`[billing] цепочка: ${e.message}`); }
};
setInterval(tick, 30000);
tick();

startAdminBot();
