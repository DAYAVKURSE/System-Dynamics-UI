/* ════════════════════════════════════════════════════════════════
   MCP-СЕРВЕРЫ · приложение ходит к ним само (владелец, 2026-09-20)

   MCP — это JSON-RPC поверх HTTP: клиент здоровается (`initialize`),
   спрашивает список инструментов (`tools/list`) и зовёт нужный
   (`tools/call`). Ответ приходит либо обычным JSON, либо потоком событий
   (`text/event-stream`) — поэтому читаются оба вида: сервер выбирает сам,
   и требовать от него одного было бы требованием к чужому коду.

   Запускать чужой код у себя мы не беремся: в настройках хранится АДРЕС
   сервера, а не рецепт запуска. Адрес репозитория — рядом, чтобы было
   видно, откуда сервер взялся, но по нему никто ничего не выполняет.

   Всё, что приходит от MCP-сервера, — ЧУЖИЕ ДАННЫЕ: имена инструментов,
   описания, результаты. Они попадают в подсказку агента как данные, а не
   как указания, и режутся по длине: чужой сервер не должен ни раздуть
   контекст, ни продиктовать поведение.
   ════════════════════════════════════════════════════════════════ */

const PROTOCOL = "2024-11-05";
const TIMEOUT_MS = 20000;
export const MAX_TOOLS = 100;
export const MAX_RESULT_CHARS = 8000;

const str = (v, limit) => String(v == null ? "" : v).slice(0, limit);

/* Ответ бывает двух видов. В потоке событий нас интересует первая строка
   `data:` с ответом на наш запрос — остальное относится к другим. */
async function readBody(res) {
  const type = String(res.headers.get("content-type") || "");
  if (type.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim());
        if (msg && (msg.result !== undefined || msg.error !== undefined)) return msg;
      } catch { /* не наш кусок потока */ }
    }
    return null;
  }
  return res.json().catch(() => null);
}

let seq = 0;
async function rpc(url, method, params, { session = "", signal } = {}) {
  seq += 1;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: seq, method, params: params || {} }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`MCP-сервер ответил ${res.status}${res.status === 404 ? ": проверьте адрес" : ""}`);
  }
  const body = await readBody(res);
  if (body?.error) throw new Error(str(body.error.message || "ошибка MCP-сервера", 300));
  return { result: body?.result ?? null, session: res.headers.get("mcp-session-id") || session };
}

const withTimeout = async (job) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try { return await job(c.signal); }
  catch (e) {
    if (e.name === "AbortError") throw new Error("MCP-сервер не ответил вовремя");
    throw e;
  } finally { clearTimeout(t); }
};

/** Здороваемся и получаем ключ сессии, если сервер его выдаёт. */
async function hello(url, signal) {
  const { session } = await rpc(url, "initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "Blocktree", version: "1.0" },
  }, { signal });
  return session;
}

/**
 * Что умеет сервер: имя, описание и схема входа каждого инструмента.
 * Схема нужна модели, чтобы позвать инструмент правильно.
 */
export async function listTools(url) {
  return withTimeout(async (signal) => {
    const session = await hello(url, signal);
    const { result } = await rpc(url, "tools/list", {}, { session, signal });
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.slice(0, MAX_TOOLS).map((t) => ({
      name: str(t?.name, 120),
      description: str(t?.description, 500),
      schema: t?.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : null,
    })).filter((t) => t.name);
  });
}

/** Зовём инструмент. Результат — текстом: агенту он приходит как данные. */
export async function callTool(url, name, args = {}) {
  return withTimeout(async (signal) => {
    const session = await hello(url, signal);
    const { result } = await rpc(url, "tools/call",
      { name: String(name), arguments: args && typeof args === "object" ? args : {} },
      { session, signal });
    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts
      .map((c) => (c?.type === "text" ? String(c.text || "")
        : c?.type ? `[${c.type}]` : ""))
      .filter(Boolean).join("\n");
    return {
      ok: result?.isError !== true,
      text: str(text || (result == null ? "" : JSON.stringify(result)), MAX_RESULT_CHARS),
    };
  });
}
