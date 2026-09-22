/* ════════════════════════════════════════════════════════════════
   ОЖИДАНИЕ ОТВЕТА ЧЕЛОВЕКА (владелец, 2026-09-22)

   Агент по ходу работы спрашивает человека и ждёт ответа. Вопрос уходит
   в чат (бот агента или основной), а следующее сообщение того человека
   в тот же чат считается ответом: его забирает ждущий, а не помощник.

   Живёт в памяти процесса: ждёт конкретный разговор, и после перезапуска
   ждать некому. Ключ — `<ключ бота>:<чат>`.
   ════════════════════════════════════════════════════════════════ */

export const DEFAULT_WAIT_MS = 10 * 60 * 1000;
export const MAX_WAIT_MS = 60 * 60 * 1000;

const waiting = new Map();   // key → { resolve, timer }
const keyOf = (botKey, chatId) => `${botKey}:${String(chatId)}`;

/** Ждать ответ; null — не дождались. Новый вопрос тому же человеку снимает прежнее ожидание. */
export function waitReply(botKey, chatId, ms = DEFAULT_WAIT_MS) {
  const k = keyOf(botKey, chatId);
  const prev = waiting.get(k);
  if (prev) { clearTimeout(prev.timer); prev.resolve(null); waiting.delete(k); }
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(k); resolve(null); },
      Math.min(Math.max(1000, Number(ms) || DEFAULT_WAIT_MS), MAX_WAIT_MS));
    timer.unref?.();
    waiting.set(k, { resolve, timer });
  });
}

/** Сообщение пришло: если его ждали — отдать ждущему и сказать true. */
export function takeReply(botKey, chatId, text) {
  const k = keyOf(botKey, chatId);
  const w = waiting.get(k);
  if (!w) return false;
  clearTimeout(w.timer);
  waiting.delete(k);
  w.resolve(String(text || ""));
  return true;
}

export const isWaiting = (botKey, chatId) => waiting.has(keyOf(botKey, chatId));
export function resetWaiting() { waiting.forEach((w) => clearTimeout(w.timer)); waiting.clear(); }
