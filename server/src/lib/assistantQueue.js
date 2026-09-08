import crypto from "node:crypto";
import { complete as completeDefault } from "./aiProviders.js";
import { contextFor as contextForDefault } from "./assistantContext.js";
import * as settings from "./assistantSettings.js";

/* ════════════════════════════════════════════════════════════════
   ОЧЕРЕДЬ ВОПРОСОВ

   Вопрос — в два шага: положить и спрашивать ответ короткими запросами.
   Один длинный запрос nginx и WebView Telegram рвут на минуте, и
   интерфейс видел только «Failed to fetch». Так уже было с черновиком
   задачи, и урок тот же.

   Живёт в памяти процесса. Ответ нужен тому, кто спросил, и прямо сейчас:
   переживать перезапуск ему незачем, а через три минуты он уже никому не
   нужен — забирается по id один раз и забывается (TTL).

   Обрабатывается по одному. Ключей теперь у каждого свои (v1.2), но
   очередь всё равно одна: провайдер держит один долгий запрос столько,
   сколько держит, и параллельные вопросы одного человека шли бы за его
   же счёт вразнобой. По порядку — предсказуемее.

   Чем отвечает — решает `modelFor(userId, task)` из настроек ЧЕЛОВЕКА, а
   не общий ключ владельца: спрашивает каждый своей моделью за свой счёт.
   `task` — какая строка таблицы «задача → модель» берётся ('chat',
   'space', 'bot'); не названа — по умолчанию 'chat'.

   Ничто здесь не ждёт вечно. Модели даётся ANSWER_TIMEOUT_MS, потом
   вопрос завершается ошибкой словами и очередь идёт дальше: один
   зависший провайдер иначе держал бы всех, кто спросил после. Вопрос,
   до которого очередь не дошла за TTL, тоже завершается ошибкой, а не
   стирается молча: у него есть тот, кто ждёт обещания (бот), и ему
   нужен отказ, а не тишина — на тишине вставал весь цикл опроса бота.

   Отмена — `cancel(id, userId)`: у каждого вопроса свой AbortController,
   и отмена ПРЕРЫВАЕТ запрос к провайдеру, а не просто прячет ответ:
   иначе человек, нажавший «Отменить», продолжал бы платить за ответ,
   который никому не нужен, и держал бы очередь для тех, кто спросил
   после. Отменённый завершается ошибкой словами «Отменено» — тем же
   путём, каким завершается всё остальное, чтобы бот и приложение не
   учили отдельный случай.

   Стадии — `onProgress(stage, info)`: 'context' (собираю данные),
   'model' (спрашиваю провайдера — в info его имя и модель), 'answer'
   (ответ получен). Бот показывает их в сообщении-статусе: пока модель
   думает, человек видит, что происходит, и решает, ждать ли.

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
export const CANCELLED_ERROR = "Отменено";
export const MAX_QUESTION = 4000;
// Что человек прислал вместе с вопросом (блок пространства, открытая
// задача) — своё, но всё же ограничено: контекст модели и так под 60 000.
export const MAX_CLIENT_CONTEXT = 20000;
export const DEFAULT_TASK = "chat";
export const STAGES = ["context", "model", "answer"];

export const SYSTEM_PROMPT = [
  "Ты — помощник в приложении, где ведётся модель живого дела: активы, их функции,",
  "ресурсы, цели, задачи и отчёты. Отвечай по-русски, коротко и по делу.",
  "Отвечай ТОЛЬКО по данным ниже. Чего в данных нет — так и говори: «в данных этого нет».",
  "Не придумывай числа, имена, сроки и содержание файлов. Не пересчитывай прогноз:",
  "если вопрос требует расчёта, которого в данных нет, скажи, что расчёт делает приложение.",
  "Слова «план», «вилка» и «факт» различай: план — то, что записано в модели, факт — сдачи.",
].join(" ");

const uid = () => crypto.randomUUID();

/* Модель человека — из его настроек (контракт C1: `modelFor(userId, task)`).
   Пока настройки на человека не влиты, того же имени в модуле нет, и
   очередь берёт прежние общие настройки из .env (`currentFor`): импорт
   пространством имён, а не именем, чтобы отсутствие одного из двух не
   ломало загрузку всего сервера. После слияния v1.2 остаётся первая ветка. */
const modelForDefault = async (userId, task) => {
  if (typeof settings.modelFor === "function") return settings.modelFor(userId, task);
  return typeof settings.currentFor === "function" ? settings.currentFor() : null;
};

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
  modelFor = modelForDefault,
  now = () => Date.now(),
  ttlMs = TTL_MS,
  answerTimeoutMs = ANSWER_TIMEOUT_MS,
  log = (m) => console.warn(`[assistant] ${m}`),
} = {}) {
  // id → { id, userId, question, context, task, status, text, error, at, doneAt,
  //        started, abort, onProgress, resolve, reject }
  const items = new Map();
  let running = false;

  /* Завершение — один раз. Отмена завершает вопрос сразу, а обработчик,
     поймав прерванный fetch, приходит сюда второй раз — и не должен
     переписать «Отменено» на «Запрос отменён» или чем ответил провайдер. */
  const finish = (it, patch) => {
    if (it.doneAt != null) return;
    Object.assign(it, patch, { doneAt: now() });
    if (patch.status === "done") it.resolve?.(it.text);
    else it.reject?.(new Error(it.error));
  };

  /* Стадия — тому, кто просил её показывать. Его ошибка (Telegram не дал
     поправить сообщение) — не ошибка вопроса: ответ важнее статуса. */
  const progress = (it, stage, info) => {
    if (it.doneAt != null || !it.onProgress) return;
    try {
      const r = it.onProgress(stage, info);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch { /* статус не показался — ответ всё равно придёт */ }
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
    let model = null;
    try {
      model = await modelFor(it.userId, it.task);
    } catch (e) {
      finish(it, { status: "error", error: e.message || "настройки помощника не прочитались" });
      return;
    }
    if (!model) { finish(it, { status: "error", error: settings.NOT_CONFIGURED }); return; }
    progress(it, "context");
    let context;
    try {
      context = await contextFor(it.userId);
    } catch (e) {
      finish(it, { status: "error", error: e.message || "контекст не собрался" });
      return;
    }
    // Отменили, пока собирался контекст, — модель не спрашиваем.
    if (it.doneAt != null) return;
    const extra = it.context
      ? `\n\n## Что человек прислал вместе с вопросом\n${it.context}`
      : "";
    progress(it, "model", { providerName: model.providerName || model.provider || "модель",
      model: model.model || "" });
    try {
      const text = await withTimeout(complete({
        ...model,
        system: `${SYSTEM_PROMPT}\n\n# Данные\n${context}${extra}`,
        messages: [{ role: "user", content: it.question }],
        signal: it.abort.signal,
      }), answerTimeoutMs, `Модель не ответила за ${Math.round(answerTimeoutMs / 60000)} мин`);
      progress(it, "answer");
      finish(it, { status: "done", text });
    } catch (e) {
      // Отменённый уже завершён словами «Отменено»; прерванный fetch — не новость.
      if (it.doneAt != null) return;
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
  function ask({ userId, question, context = "", task = DEFAULT_TASK, onProgress = null }) {
    sweep();
    const q = String(question || "").trim().slice(0, MAX_QUESTION);
    if (!q) throw new Error("question is required");
    const it = {
      id: uid(), userId: String(userId), question: q,
      context: String(context || "").slice(0, MAX_CLIENT_CONTEXT),
      task: String(task || DEFAULT_TASK),
      status: "pending", text: "", error: "", at: now(), doneAt: null, started: false,
      abort: new AbortController(),
      onProgress: typeof onProgress === "function" ? onProgress : null,
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

  /**
   * Отмена — только автором. Начатый — прерывается запрос к провайдеру,
   * не начатый — снимается с очереди. Уже завершённый или чужой — false:
   * бот на это отвечает «уже завершён», а не делает вид, что отменил.
   */
  function cancel(id, userId) {
    const it = items.get(String(id));
    if (!it || (userId != null && it.userId !== String(userId))) return false;
    if (it.doneAt != null) return false;
    finish(it, { status: "error", error: CANCELLED_ERROR });
    it.abort.abort();
    return true;
  }

  /** Тот же путь, но ответ обещанием — для бота. Обещание завершается
      всегда, не позже TTL: бот на нём ждёт, и вечное ожидание здесь
      останавливало бы обработку чужих сообщений. У обещания есть `id` —
      по нему бот рисует кнопку «Отменить». `signal` снаружи — тот же
      cancel, но от AbortController вызывающего. */
  function askNow(userId, question, context = "", { task = DEFAULT_TASK, onProgress, signal } = {}) {
    const { id } = ask({ userId, question, context, task, onProgress });
    const it = items.get(id);
    if (signal) {
      if (signal.aborted) cancel(id, userId);
      else signal.addEventListener("abort", () => cancel(id, userId), { once: true });
    }
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
    const p = Promise.race([it.promise, late]).finally(() => clearTimeout(timer));
    p.id = id;
    return p;
  }

  function reset() { items.clear(); running = false; }
  const size = () => items.size;

  return { ask, find, askNow, cancel, reset, size };
}

const queue = createQueue();
export const ask = queue.ask;
export const find = queue.find;
export const askNow = queue.askNow;
export const cancel = queue.cancel;
export const resetQueue = queue.reset;
