/* ════════════════════════════════════════════════════════════════
   ТРИ ВИДА API — ОДИН ВЫЗОВ

   Помощник не знает, чем он думает: он собирает системную подсказку,
   контекст и вопрос, а отсюда получает текст ответа. Что именно позвать —
   решает таблица «задача → модель» человека (assistantSettings.js), и
   менять провайдера не должно означать менять код помощника. Поэтому
   наружу торчат две функции — `complete` и `listModels`, — а различия
   API спрятаны здесь.

   Провайдер — это ВИД API, адрес и ключ, а не название компании. Видов
   три: совместимый с OpenAI (`/chat/completions`, `/models`; тем же видом
   подключаются OpenRouter, Groq, Together — у них тот же формат и другой
   адрес), Anthropic (Messages API) и Hugging Face (router, формат OpenAI).
   Адрес у вида есть по умолчанию, и человек меняет его только ради
   «ещё одного такого же» провайдера.

   Всё через глобальный fetch, без SDK: три зависимости ради трёх POST-
   запросов — это три источника несовместимых версий, а тесты и так
   подменяют fetch и проверяют, что ушло в сеть.

   Ошибки — словами и без ключа. Ответ провайдера может содержать что
   угодно, поэтому текст ошибки обрезается и из него вырезается сам ключ:
   в журнал и в чат человеку он попасть не должен ни при каких условиях.
   ════════════════════════════════════════════════════════════════ */

/* Вид API: название для экрана и адрес по умолчанию. Умолчания живут
   здесь и только здесь — экран получает их с сервера, а не держит копию. */
export const KINDS = [
  { id: "openai", name: "Совместимый с OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic (Claude)", defaultBaseUrl: "https://api.anthropic.com" },
  { id: "hf", name: "Hugging Face", defaultBaseUrl: "https://router.huggingface.co/v1" },
];

export const KIND_IDS = KINDS.map((k) => k.id);
export const KIND_NAMES = Object.fromEntries(KINDS.map((k) => [k.id, k.name]));
export const DEFAULT_BASE_URL = Object.fromEntries(KINDS.map((k) => [k.id, k.defaultBaseUrl]));

export const isKind = (k) => KIND_IDS.includes(String(k || ""));

/* Claude требует max_tokens, у OpenAI-совместимых он необязателен. Ставим
   один и тот же предел всем: ответ помощника — абзац-два в чате, а не
   статья, и одинаковый предел делает провайдеров взаимозаменяемыми. */
export const MAX_TOKENS = 2048;
const ERROR_TEXT_LIMIT = 300;
/* Предел ожидания ответа. Без него fetch ждёт заголовки столько, сколько
   решит undici (минуты), и всё это время очередь вопросов стоит, а бот
   не отвечает никому. Полторы минуты — с запасом больше, чем отвечает
   любая модель на абзац-два. */
export const FETCH_TIMEOUT_MS = 90 * 1000;
/* Список моделей — короткий GET; ждать его дольше нескольких секунд
   значит держать человека у кнопки «список у провайдера». */
export const LIST_TIMEOUT_MS = 15 * 1000;

export const CANCELLED = "Запрос отменён";

/**
 * Адрес без хвостового слэша и без своего «/v1» у Anthropic: человек
 * вставляет адрес как есть — «https://api.anthropic.com/v1/» — а пути
 * Messages API уже начинаются с /v1, и без этой правки выходило бы
 * «/v1/v1/messages».
 */
export function baseUrlFor(kind, baseUrl) {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "") || DEFAULT_BASE_URL[kind] || "";
  if (kind === "anthropic") base = base.replace(/\/v1$/, "");
  return base;
}

/** Куда идёт вопрос и откуда берётся список моделей — по виду API. */
export const endpoints = (kind, baseUrl) => {
  const base = baseUrlFor(kind, baseUrl);
  return kind === "anthropic"
    ? { chat: `${base}/v1/messages`, models: `${base}/v1/models` }
    : { chat: `${base}/chat/completions`, models: `${base}/models` };
};

/** Сообщения диалога — только две роли; системная подсказка едет отдельно. */
const cleanMessages = (messages) => (Array.isArray(messages) ? messages : [])
  .filter((m) => m && (m.role === "user" || m.role === "assistant"))
  .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
  .filter((m) => m.content.trim());

/* Ключ из текста ошибки вырезается ДО того, как ошибка станет ошибкой:
   провайдер может вернуть тело запроса обратно, а nginx перед ним —
   страницу с заголовками. Что именно пришло, мы не знаем, знаем только,
   что ключа там быть не должно. */
const scrub = (text, key) => {
  let t = String(text || "").replace(/\s+/g, " ").trim().slice(0, ERROR_TEXT_LIMIT);
  if (key && key.length >= 8) t = t.split(key).join("[ключ]");
  return t;
};

function providerError(name, status, body, key) {
  const text = scrub(body, key);
  const e = new Error(text ? `${name} ответил ${status}: ${text}` : `${name} ответил ${status}`);
  e.status = status;
  return e;
}

/* ─────── заголовки, тела запросов и разбор ответов ─────── */

const openaiLike = {
  headers: (key) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }),
  request({ model, system, messages }) {
    return { model, messages: [...(system ? [{ role: "system", content: system }] : []),
      ...messages], max_tokens: MAX_TOKENS };
  },
  answer(data) {
    const c = data?.choices?.[0]?.message?.content;
    // Некоторые OpenAI-совместимые серверы отдают content массивом частей.
    if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
    return typeof c === "string" ? c : "";
  },
  // GET /models: у OpenAI и совместимых — { data: [{id, …}] }.
  models(data) {
    return (Array.isArray(data?.data) ? data.data : [])
      .map((m) => ({ id: String(m?.id || ""), name: String(m?.name || m?.id || "") }))
      .filter((m) => m.id);
  },
};

const anthropic = {
  headers: (key) => ({
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  }),
  request({ model, system, messages }) {
    return { model, max_tokens: MAX_TOKENS, ...(system ? { system } : {}), messages };
  },
  answer(data) {
    return (Array.isArray(data?.content) ? data.content : [])
      .filter((p) => p?.type === "text").map((p) => p.text || "").join("");
  },
  // GET /v1/models: { data: [{id, display_name, …}] }.
  models(data) {
    return (Array.isArray(data?.data) ? data.data : [])
      .map((m) => ({ id: String(m?.id || ""), name: String(m?.display_name || m?.id || "") }))
      .filter((m) => m.id);
  },
};

const ADAPTERS = { openai: openaiLike, anthropic, hf: openaiLike };

/**
 * Сигнал на запрос: свой предел ожидания ПЛЮС сигнал того, кто спросил.
 * Без второго «Отменить» в боте снимало бы кнопки, а запрос к провайдеру
 * всё равно шёл бы до конца — и платил бы за него человек.
 */
const signalFor = (signal, ms) => (signal
  ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
  : AbortSignal.timeout(ms));

/* Отмена и истёкший предел приходят одной и той же AbortError; различаем
   по тому, кто дёрнул: если сигнал спросившего взведён — это отмена. */
function networkError(e, { name, key, signal, ms }) {
  if (signal?.aborted) return new Error(CANCELLED);
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new Error(`${name} не ответил за ${Math.round(ms / 1000)} секунд`);
  }
  // Сеть, DNS: у ошибки нет статуса, но есть слова.
  return new Error(`${name} недоступен: ${scrub(e?.message, key) || "сеть не ответила"}`);
}

/** Тело ответа: JSON, если он там есть, иначе сырой текст (страница nginx). */
async function readBody(res) {
  const raw = await res.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { raw, data };
}

/** Что проверяется у любого вызова до сети: вид, ключ и имя для ошибок. */
function check(p) {
  const kind = String(p?.kind || "");
  if (!isKind(kind)) throw new Error(`Неизвестный вид API: «${kind || "не выбран"}»`);
  const key = String(p?.key || "").trim();
  const name = String(p?.providerName || "").trim() || KIND_NAMES[kind];
  if (!key) throw new Error(`Ключ провайдера «${name}» не задан`);
  return { kind, key, name, adapter: ADAPTERS[kind] };
}

/**
 * Один вопрос — один ответ текстом.
 *
 * @param {{kind, baseUrl?, key, model, providerName?, system?, messages:[{role,content}], signal?}} p
 * @param {typeof fetch} doFetch — подменяется в тестах
 */
export async function complete(p, doFetch = globalThis.fetch) {
  const { kind, key, name, adapter } = check(p);
  const model = String(p?.model || "").trim();
  if (!model) throw new Error(`Модель у провайдера «${name}» не выбрана`);
  const messages = cleanMessages(p?.messages);
  if (!messages.length) throw new Error("Вопрос пуст");
  // Уже отменённый запрос в сеть не идёт: платить за ответ, который
  // никто не прочитает, незачем.
  if (p?.signal?.aborted) throw new Error(CANCELLED);

  const body = adapter.request({ model, system: String(p?.system || ""), messages });
  let res;
  try {
    res = await doFetch(endpoints(kind, p?.baseUrl).chat, { method: "POST",
      headers: adapter.headers(key), body: JSON.stringify(body),
      signal: signalFor(p?.signal, FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw networkError(e, { name, key, signal: p?.signal, ms: FETCH_TIMEOUT_MS });
  }

  const { raw, data } = await readBody(res);
  if (!res.ok) {
    // Сначала объяснение из тела (у всех троих это error.message), потом
    // само тело, если оно не JSON, — иначе человек видел бы голое «401».
    const explained = data?.error?.message || data?.error?.type || data?.message || raw;
    throw providerError(name, res.status, explained, key);
  }

  const text = adapter.answer(data).trim();
  if (!text) throw new Error(`${name} ответил пустым сообщением`);
  return text;
}

/**
 * Какие модели есть у провайдера — для кнопки «список у провайдера».
 * Hugging Face список не спрашиваем: у router тысячи моделей на любой
 * вкус, и выбирать из них выпадающим списком нельзя — имя вводится руками.
 * Пустой список экран так и называет: «введите вручную».
 *
 * @returns {Promise<[{id, name}]>}
 */
export async function listModels(p, doFetch = globalThis.fetch) {
  const { kind, key, name, adapter } = check(p);
  if (kind === "hf") return [];
  let res;
  try {
    res = await doFetch(endpoints(kind, p?.baseUrl).models, { method: "GET",
      headers: adapter.headers(key), signal: signalFor(p?.signal, LIST_TIMEOUT_MS) });
  } catch (e) {
    throw networkError(e, { name, key, signal: p?.signal, ms: LIST_TIMEOUT_MS });
  }
  const { raw, data } = await readBody(res);
  if (!res.ok) {
    throw providerError(name, res.status,
      data?.error?.message || data?.error?.type || data?.message || raw, key);
  }
  return adapter.models(data).sort((a, b) => a.id.localeCompare(b.id));
}
