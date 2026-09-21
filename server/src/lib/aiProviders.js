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
/* Разговор ведётся в ОБЩЕМ виде, а перекладывают его в вид провайдера
   адаптеры (владелец, 2026-09-20: помощник должен уметь делать то же, что
   человек). Три вида сообщений:

   · `{role:"user"|"assistant", content}` — слова;
   · `{role:"assistant", calls:[{id,name,args}]}` — модель зовёт инструмент;
   · `{role:"tool", callId, name, content}` — что инструмент ответил.

   У OpenAI и Anthropic это записано по-разному, и знать об этом должен
   только адаптер: иначе цикл «позвал — сделали — сказали» пришлось бы
   писать дважды. */
const cleanMessages = (messages) => (Array.isArray(messages) ? messages : [])
  .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "tool"))
  .map((m) => (m.role === "tool"
    ? { role: "tool", callId: String(m.callId || ""), name: String(m.name || ""),
      content: String(m.content ?? "") }
    : { role: m.role, content: String(m.content ?? ""),
      ...(Array.isArray(m.calls) && m.calls.length ? { calls: m.calls } : {}),
      ...(m.image?.data ? { image: m.image } : {}) }))
  .filter((m) => m.role === "tool" || m.content.trim() || m.calls || m.image);

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
  request({ model, system, messages, tools }) {
    const out = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", tool_call_id: m.callId, content: m.content };
      }
      if (m.calls) {
        return { role: "assistant", content: m.content || null,
          tool_calls: m.calls.map((c) => ({ id: c.id, type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) };
      }
      /* Картинка при сообщении (снимок экрана из приложения) — частями:
         текст и image_url с data-URI. */
      if (m.image?.data) {
        return { role: m.role, content: [
          { type: "text", text: m.content || "" },
          { type: "image_url", image_url: { url: `data:${m.image.mime || "image/png"};base64,${m.image.data}` } },
        ] };
      }
      return { role: m.role, content: m.content };
    });
    return { model, messages: [...(system ? [{ role: "system", content: system }] : []),
      ...out], max_tokens: MAX_TOKENS,
      ...(tools?.length ? { tools: tools.map((t) => ({ type: "function",
        function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}) };
  },
  calls(data) {
    return (data?.choices?.[0]?.message?.tool_calls || [])
      .filter((c) => c?.function?.name)
      .map((c) => ({ id: String(c.id || c.function.name), name: String(c.function.name),
        args: parseArgs(c.function.arguments) }));
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
  request({ model, system, messages, tools }) {
    const out = [];
    for (const m of messages) {
      if (m.role === "tool") {
        /* Ответы инструментов у Anthropic — части сообщения ЧЕЛОВЕКА, и
           подряд идущие складываются в одно: иначе на каждый инструмент
           приходило бы по сообщению, и порядок «позвал — ответили»
           разошёлся бы. */
        const last = out[out.length - 1];
        const part = { type: "tool_result", tool_use_id: m.callId, content: m.content };
        if (last?.role === "user" && Array.isArray(last.content)) last.content.push(part);
        else out.push({ role: "user", content: [part] });
        continue;
      }
      if (m.calls) {
        out.push({ role: "assistant", content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name,
            input: c.args || {} })),
        ] });
        continue;
      }
      if (m.image?.data) {
        out.push({ role: m.role, content: [
          { type: "image", source: { type: "base64", media_type: m.image.mime || "image/png", data: m.image.data } },
          { type: "text", text: m.content || "" },
        ] });
        continue;
      }
      out.push({ role: m.role, content: m.content });
    }
    return { model, max_tokens: MAX_TOKENS, ...(system ? { system } : {}), messages: out,
      ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name,
        description: t.description, input_schema: t.schema })) } : {}) };
  },
  calls(data) {
    return (Array.isArray(data?.content) ? data.content : [])
      .filter((p) => p?.type === "tool_use" && p.name)
      .map((p) => ({ id: String(p.id || p.name), name: String(p.name),
        args: p.input && typeof p.input === "object" ? p.input : {} }));
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

/* Аргументы у OpenAI приезжают СТРОКОЙ с JSON внутри. Порченый JSON —
   не повод ронять разговор: пустые аргументы инструмент отвергнет сам и
   скажет, чего не хватило. */
const parseArgs = (raw) => {
  if (raw && typeof raw === "object") return raw;
  try { const v = JSON.parse(String(raw || "{}")); return v && typeof v === "object" ? v : {}; }
  catch { return {}; }
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

  const body = adapter.request({ model, system: String(p?.system || ""), messages,
    tools: Array.isArray(p?.tools) ? p.tools : [] });
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
  const calls = p?.tools?.length ? (adapter.calls?.(data) || []) : [];
  /* С инструментами ответ бывает без слов вовсе — модель просто зовёт
     инструмент, и это не пустое сообщение, а ход в разговоре. */
  if (!text && !calls.length) throw new Error(`${name} ответил пустым сообщением`);
  return p?.tools?.length ? { text, calls } : text;
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
