import crypto from "node:crypto";
import { complete as completeDefault } from "./aiProviders.js";
import { contextFor as contextForDefault } from "./assistantContext.js";
import { NOT_CONFIGURED, currentFor as currentForDefault } from "./assistantSettings.js";

/* ════════════════════════════════════════════════════════════════
   ОЧЕРЕДЬ ВОПРОСОВ

   Вопрос — в два шага: положить и спрашивать ответ короткими запросами.
   Один длинный запрос nginx и WebView Telegram рвут на минуте, и
   интерфейс видел только «Failed to fetch». Так уже было с черновиком
   задачи, и урок тот же.

   Живёт в памяти процесса. Ответ нужен тому, кто спросил, и прямо сейчас:
   переживать перезапуск ему незачем, а через три минуты он уже никому не
   нужен — забирается по id один раз и забывается (TTL).

   Обрабатывается по одному. Ключ один на организацию (владельца), и
   десять вопросов разом — это десять параллельных счетов ему же; очередь
   хотя бы делает это по порядку. Вопрос про плату — Q7 в роадмапе.

   Ничто здесь не ждёт вечно. Модели даётся ANSWER_TIMEOUT_MS, потом
   вопрос завершается ошибкой словами и очередь идёт дальше: один
   зависший провайдер иначе держал бы всех, кто спросил после. Вопрос,
   до которого очередь не дошла за TTL, тоже завершается ошибкой, а не
   стирается молча: у него есть тот, кто ждёт обещания (бот), и ему
   нужен отказ, а не тишина — на тишине вставал весь цикл опроса бота.

   Контекст собирается В МОМЕНТ обработки, а не в момент постановки
   вопроса: права проверяются при каждом обращении заново.
   ════════════════════════════════════════════════════════════════ */

export const TTL_MS = 3 * 60 * 1000;
/* Сколько ждать модель. Больше таймаута самого запроса к провайдеру
   (aiProviders.js), чтобы в обычном случае человек видел его слова —
   «OpenAI не ответил за 90 секунд», — а этот срок ловил только то, что
   провайдер пропустил. */
export const ANSWER_TIMEOUT_MS = 2 * 60 * 1000;
export const STALE_ERROR = "Вопрос устарел, очередь до него не дошла — задайте его ещё раз";
export const WAITED_ERROR = "Помощник не ответил за три минуты — спросите ещё раз";
export const MAX_QUESTION = 4000;
// Что человек прислал вместе с вопросом (блок пространства, открытая
// задача) — своё, но всё же ограничено: контекст модели и так под 60 000.
export const MAX_CLIENT_CONTEXT = 20000;

export const SYSTEM_PROMPT = [
  "Ты — помощник в приложении, где ведётся модель живого дела: активы, их функции,",
  "ресурсы, цели, задачи и отчёты. Отвечай по-русски, коротко и по делу.",
  "Отвечай ТОЛЬКО по данным ниже. Чего в данных нет — так и говори: «в данных этого нет».",
  "Не придумывай числа, имена, сроки и содержание файлов. Не пересчитывай прогноз:",
  "если вопрос требует расчёта, которого в данных нет, скажи, что расчёт делает приложение.",
  "Слова «план», «вилка» и «факт» различай: план — то, что записано в модели, факт — сдачи.",
].join(" ");

const uid = () => crypto.randomUUID();

/** Обещание с пределом: не успело — отказ словами. Таймер не держит процесс. */
function withTimeout(promise, ms, message) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Отдельная очередь со своими зависимостями — чтобы тесты подменяли
 * модель и контекст без подмены модулей. Приложение пользуется одной,
 * собранной ниже.
 */
export function createQueue({
  complete = completeDefault,
  contextFor = contextForDefault,
  currentSettings = currentForDefault,
  now = () => Date.now(),
  ttlMs = TTL_MS,
  answerTimeoutMs = ANSWER_TIMEOUT_MS,
  log = (m) => console.warn(`[assistant] ${m}`),
} = {}) {
  const items = new Map();   // id → { id, userId, question, context, status, text, error, at, doneAt, resolve, reject }
  let running = false;

  const finish = (it, patch) => {
    Object.assign(it, patch, { doneAt: now() });
    if (patch.status === "done") it.resolve?.(it.text);
    else it.reject?.(new Error(it.error));
  };

  const sweep = () => {
    const t = now();
    for (const [id, it] of items) {
      if (it.doneAt == null) {
        // Начатый закончится сам — модели дан предел. Не начатый за TTL —
        // завершается отказом, чтобы тот, кто ждёт обещание, его дождался.
        if (it.started || t - it.at <= ttlMs) continue;
        finish(it, { status: "error", error: STALE_ERROR });
      } else if (t - it.doneAt <= ttlMs) continue;
      items.delete(id);
    }
  };

  const handle = async (it) => {
    const settings = currentSettings();
    if (!settings) { finish(it, { status: "error", error: NOT_CONFIGURED }); return; }
    let context;
    try {
      context = await contextFor(it.userId);
    } catch (e) {
      finish(it, { status: "error", error: e.message || "контекст не собрался" });
      return;
    }
    const extra = it.context
      ? `\n\n## Что человек прислал вместе с вопросом\n${it.context}`
      : "";
    try {
      const text = await withTimeout(complete({
        ...settings,
        system: `${SYSTEM_PROMPT}\n\n# Данные\n${context}${extra}`,
        messages: [{ role: "user", content: it.question }],
      }), answerTimeoutMs, `Модель не ответила за ${Math.round(answerTimeoutMs / 60000)} мин`);
      finish(it, { status: "done", text });
    } catch (e) {
      log(`вопрос не отвечен: ${e.message}`);
      finish(it, { status: "error", error: e.message || "модель не ответила" });
    }
  };

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = [...items.values()].find((it) => it.status === "pending" && !it.started);
        if (!next) break;
        next.started = true;
        // eslint-disable-next-line no-await-in-loop
        await handle(next);
      }
    } finally {
      running = false;
    }
  };

  /** Кладёт вопрос. Ответ — по id, у того же человека. */
  function ask({ userId, question, context = "" }) {
    sweep();
    const q = String(question || "").trim().slice(0, MAX_QUESTION);
    if (!q) throw new Error("question is required");
    const it = {
      id: uid(), userId: String(userId), question: q,
      context: String(context || "").slice(0, MAX_CLIENT_CONTEXT),
      status: "pending", text: "", error: "", at: now(), doneAt: null, started: false,
    };
    it.promise = new Promise((resolve, reject) => { it.resolve = resolve; it.reject = reject; });
    // Никто не ждёт обещание — отказ не должен становиться необработанным.
    it.promise.catch(() => {});
    items.set(it.id, it);
    pump();
    return { id: it.id };
  }

  /** Состояние вопроса — только его автору: чужой id даёт «не найдено». */
  function find(id, userId) {
    sweep();
    const it = items.get(String(id));
    if (!it || (userId != null && it.userId !== String(userId))) return null;
    if (it.status === "done") return { status: "done", text: it.text };
    if (it.status === "error") return { status: "error", error: it.error };
    return { status: "pending" };
  }

  /** Тот же путь, но ответ обещанием — для бота. Обещание завершается
      всегда, не позже TTL: бот на нём ждёт, и вечное ожидание здесь
      останавливало бы обработку чужих сообщений. */
  function askNow(userId, question, context = "") {
    const { id } = ask({ userId, question, context });
    const it = items.get(id);
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => {
        // До не начатого очередь так и не дошла — снимаем его, чтобы модель
        // не отвечала потом в пустоту. Начатый доработает сам.
        if (!it.started && it.status === "pending") {
          finish(it, { status: "error", error: WAITED_ERROR });
        } else reject(new Error(WAITED_ERROR));
      }, ttlMs);
      timer.unref?.();
    });
    return Promise.race([it.promise, late]).finally(() => clearTimeout(timer));
  }

  function reset() { items.clear(); running = false; }
  const size = () => items.size;

  return { ask, find, askNow, reset, size };
}

const queue = createQueue();
export const ask = queue.ask;
export const find = queue.find;
export const askNow = queue.askNow;
export const resetQueue = queue.reset;
