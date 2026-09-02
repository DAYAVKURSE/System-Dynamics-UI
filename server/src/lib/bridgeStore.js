import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   МОСТ К CLAUDE CODE

   Владелец пишет боту, ответ приходит от Claude Code, работающего под его
   собственной подпиской. Ключ API при этом не нужен и нигде не хранится.

   Устроено как очередь, а не как вызов: сервер кладёт вопрос, воркер на
   машине владельца забирает его, запускает Claude Code и приносит ответ.
   Почему так, а не «сервер сам запускает claude»:

   · вход в Claude Code — интерактивный, привязанный к аккаунту. Перенести
     его на VPS нельзя, и не нужно: учётные данные остаются там, где им
     место — на машине владельца;
   · воркер сам ходит наружу, поэтому дома не надо открывать ни одного
     порта;
   · сервер не исполняет ничего — он только передаёт текст. Дыра «кто
     написал боту, тот запустил код на сервере» не появляется в принципе.

   Очередь живёт в памяти: вопрос без ответа переживать перезапуск не
   должен — спросят заново.
   ════════════════════════════════════════════════════════════════ */

const MAX_QUEUE = 100;
const ANSWER_TTL_MS = 60 * 60 * 1000;
export const MAX_PROMPT = 8000;

const queue = [];   // {id, chatId, from, text, status, answer, error, at, sid}

export function resetBridge() { queue.length = 0; }

const sweep = (now = Date.now()) => {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].status === "done" && now - queue[i].at > ANSWER_TTL_MS) queue.splice(i, 1);
  }
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
};

/** Вопрос в очередь. Возвращает запись — по её id придёт ответ. */
export function ask({ text, from, chatId, sid = null }, now = Date.now()) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("text is required");
  if (clean.length > MAX_PROMPT) throw new Error(`text must be at most ${MAX_PROMPT} characters`);
  sweep(now);
  const item = {
    id: crypto.randomBytes(8).toString("hex"),
    text: clean, from: String(from), chatId: chatId == null ? null : String(chatId),
    sid, status: "pending", answer: "", error: "", at: now,
  };
  queue.push(item);
  return item;
}

/**
 * Ждёт ответа на вопрос — для запросов из приложения, где ответ нужен
 * в том же HTTP-запросе, а не в чат. Не дождались — null, а не вечное
 * ожидание: интерфейс скажет «не вышло», человек напишет сам.
 */
export function waitFor(id, timeoutMs = 90000, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const look = () => {
      const item = find(id);
      if (!item) return resolve(null);
      if (item.status === "done") { item.sent = true; return resolve(item); }
      if (Date.now() >= deadline) return resolve(null);
      return setTimeout(look, stepMs);
    };
    look();
  });
}

/** Что взять в работу. Воркер один, поэтому берётся самый старый вопрос. */
export function takeNext(now = Date.now()) {
  sweep(now);
  const item = queue.find((q) => q.status === "pending");
  if (!item) return null;
  item.status = "taken";
  item.takenAt = now;
  return item;
}

/** Ответ от воркера. Возвращает запись, чтобы бот знал, кому отвечать. */
export function answer(id, { text, error, sid } = {}, now = Date.now()) {
  const item = queue.find((q) => q.id === id);
  if (!item) return null;
  item.status = "done";
  item.answer = String(text || "");
  item.error = String(error || "");
  if (sid) item.sid = sid;
  item.doneAt = now;
  return item;
}

export const find = (id) => queue.find((q) => q.id === id) || null;
export const pending = () => queue.filter((q) => q.status === "pending").length;

/** Отвеченное, но ещё не отправленное в чат. Помечает как отправленное сразу:
 *  повторная отправка одного ответа хуже, чем его потеря при сбое. */
export function takeAnswered() {
  const ready = queue.filter((q) => q.status === "done" && !q.sent);
  ready.forEach((q) => { q.sent = true; });
  return ready;
}

/* Вопросы, взятые в работу и не отвеченные слишком долго, возвращаются в
   очередь: воркер мог упасть посреди ответа, и вопрос не должен зависнуть
   навсегда. */
export function requeueStale(ttlMs = 10 * 60 * 1000, now = Date.now()) {
  let n = 0;
  queue.forEach((q) => {
    if (q.status === "taken" && now - (q.takenAt || q.at) > ttlMs) {
      q.status = "pending"; n += 1;
    }
  });
  return n;
}

/** Ответ длиннее одного сообщения Telegram — режем по абзацам. */
export function chunk(text, limit = 3800) {
  const s = String(text || "");
  if (s.length <= limit) return [s];
  const out = [];
  let rest = s;
  while (rest.length > limit) {
    // Рвём по границе абзаца или строки: разрез посреди блока кода делает
    // ответ нечитаемым.
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/** Годится ли секрет для заголовка HTTP. Заголовки — латиница: секрет с
 *  кириллицей не отправится вовсе, и мост молча перестанет работать. */
export const asciiSecret = (v) => /^[\x21-\x7e]{8,}$/.test(String(v || ""));

/** Сравнение секретов постоянного времени: длина сама по себе не секрет. */
export function sameSecret(got, want) {
  if (!want) return false;
  const a = Buffer.from(String(got || ""));
  const b = Buffer.from(String(want));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
