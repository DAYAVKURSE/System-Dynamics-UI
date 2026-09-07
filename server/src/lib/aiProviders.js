/* ════════════════════════════════════════════════════════════════
   ТРИ ПРОВАЙДЕРА — ОДИН ВЫЗОВ

   Помощник не знает, чем он думает: он собирает системную подсказку,
   контекст и вопрос, а отсюда получает текст ответа. Провайдер — настройка
   владельца (см. assistantSettings.js), и менять его не должно означать
   менять код помощника. Поэтому наружу торчит одна функция `complete`,
   а различия трёх API спрятаны здесь.

   Всё через глобальный fetch, без SDK: три зависимости ради трёх POST-
   запросов — это три источника несовместимых версий, а тесты и так
   подменяют fetch и проверяют, что ушло в сеть.

   Ошибки — словами и без ключа. Ответ провайдера может содержать что
   угодно, поэтому текст ошибки обрезается и из него вырезается сам ключ:
   в журнал и в чат человеку он попасть не должен ни при каких условиях.
   ════════════════════════════════════════════════════════════════ */

export const PROVIDERS = ["openai", "claude", "hf"];

export const PROVIDER_NAMES = { openai: "OpenAI", claude: "Claude", hf: "Hugging Face" };

/* Модели по умолчанию — дешёвые и быстрые: помощник отвечает в чате, и
   ждать полминуты ради вопроса «что у меня сегодня» никто не станет. */
export const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  claude: "claude-sonnet-4-5",
  hf: "meta-llama/Llama-3.1-8B-Instruct",
};

/* Hugging Face: выбран router, а не api-inference.

   У Hugging Face два входа. Старый — api-inference.huggingface.co/models/
   {model}: у каждой модели свой формат тела, модель грузится по требованию
   и первые запросы отвечают «загружается, подождите», а имя модели стоит
   в пути URL — то есть настройка владельца попадала бы в адрес запроса.
   Новый — router.huggingface.co/v1/chat/completions: тело и ответ те же,
   что у OpenAI, имя модели едет в теле, а какой из провайдеров Hugging
   Face её обслуживает, решает сам router. Один разбор ответа на двоих
   и ни одного «подождите» — поэтому router. */
export const ENDPOINTS = {
  openai: "https://api.openai.com/v1/chat/completions",
  claude: "https://api.anthropic.com/v1/messages",
  hf: "https://router.huggingface.co/v1/chat/completions",
};

/* Claude требует max_tokens, у OpenAI-совместимых он необязателен. Ставим
   один и тот же предел всем: ответ помощника — абзац-два в чате, а не
   статья, и одинаковый предел делает провайдеров взаимозаменяемыми. */
export const MAX_TOKENS = 2048;
const ERROR_TEXT_LIMIT = 300;

export const isProvider = (p) => PROVIDERS.includes(String(p || ""));

/** Сообщения диалога — только две роли; системная подсказка едет отдельно. */
const cleanMessages = (messages) => (Array.isArray(messages) ? messages : [])
  .filter((m) => m && (m.role === "user" || m.role === "assistant"))
  .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
  .filter((m) => m.content.trim());

/* Ключ из текста ошибки вырезается ДО того, как ошибка станет ошибкой:
   провайдер может вернуть тело запроса обратно, а nginx перед ним —
   страницу с заголовками. Что именно пришло, мы не знаем, знаем только,
   что ключа там быть не должно. */
const scrub = (text, apiKey) => {
  let t = String(text || "").replace(/\s+/g, " ").trim().slice(0, ERROR_TEXT_LIMIT);
  if (apiKey && apiKey.length >= 8) t = t.split(apiKey).join("[ключ]");
  return t;
};

function providerError(provider, status, body, apiKey) {
  const name = PROVIDER_NAMES[provider] || provider;
  const text = scrub(body, apiKey);
  const e = new Error(text ? `${name} ответил ${status}: ${text}` : `${name} ответил ${status}`);
  e.status = status;
  return e;
}

/* ─────── тела запросов и разбор ответов ─────── */

const openaiLike = {
  request({ model, apiKey, system, messages }) {
    return {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model, messages: [...(system ? [{ role: "system", content: system }] : []),
        ...messages], max_tokens: MAX_TOKENS },
    };
  },
  answer(data) {
    const c = data?.choices?.[0]?.message?.content;
    // Некоторые OpenAI-совместимые серверы отдают content массивом частей.
    if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
    return typeof c === "string" ? c : "";
  },
};

const anthropic = {
  request({ model, apiKey, system, messages }) {
    return {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: { model, max_tokens: MAX_TOKENS, ...(system ? { system } : {}), messages },
    };
  },
  answer(data) {
    return (Array.isArray(data?.content) ? data.content : [])
      .filter((p) => p?.type === "text").map((p) => p.text || "").join("");
  },
};

const ADAPTERS = { openai: openaiLike, claude: anthropic, hf: openaiLike };

/**
 * Один вопрос — один ответ текстом.
 *
 * @param {{provider, model?, apiKey, system?, messages:[{role,content}]}} p
 * @param {typeof fetch} doFetch — подменяется в тестах
 */
export async function complete(p, doFetch = globalThis.fetch) {
  const provider = String(p?.provider || "");
  if (!isProvider(provider)) throw new Error(`Неизвестный провайдер: «${provider || "не выбран"}»`);
  const apiKey = String(p?.apiKey || "").trim();
  if (!apiKey) throw new Error(`Ключ ${PROVIDER_NAMES[provider]} не задан`);
  const model = String(p?.model || "").trim() || DEFAULT_MODELS[provider];
  const messages = cleanMessages(p?.messages);
  if (!messages.length) throw new Error("Вопрос пуст");

  const adapter = ADAPTERS[provider];
  const { headers, body } = adapter.request({ model, apiKey, system: String(p?.system || ""),
    messages });

  let res;
  try {
    res = await doFetch(ENDPOINTS[provider], { method: "POST", headers,
      body: JSON.stringify(body) });
  } catch (e) {
    // Сеть, DNS, таймаут: у ошибки нет статуса, но есть слова.
    throw new Error(`${PROVIDER_NAMES[provider]} недоступен: ${scrub(e?.message, apiKey) || "сеть не ответила"}`);
  }

  const raw = await res.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!res.ok) {
    // Сначала объяснение из тела (у всех троих это error.message), потом
    // само тело, если оно не JSON, — иначе человек видел бы голое «401».
    const explained = data?.error?.message || data?.error?.type || data?.message || raw;
    throw providerError(provider, res.status, explained, apiKey);
  }

  const text = adapter.answer(data).trim();
  if (!text) throw new Error(`${PROVIDER_NAMES[provider]} ответил пустым сообщением`);
  return text;
}
