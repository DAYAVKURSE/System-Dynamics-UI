import { describe, expect, it } from "vitest";
import {
  CANCELLED, DEFAULT_BASE_URL, FETCH_TIMEOUT_MS, KINDS, MAX_TOKENS, baseUrlFor, complete,
  endpoints, listModels,
} from "../lib/aiProviders.js";

/* Три вида API — один вызов. Проверяем то, что видно снаружи: куда ушёл
   запрос, с какими заголовками и телом, что вернулось человеку, что
   отмена режет запрос и что ключ не попал в текст ошибки ни при каком
   ответе провайдера. */

const KEY = "sk-secret-key-0123456789";

/** Подменный fetch: запоминает вызов и отдаёт заготовленный ответ. */
function fakeFetch(status, body, calls = []) {
  return async (url, opts) => {
    calls.push({ url, ...opts, json: opts.body ? JSON.parse(opts.body) : null });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
}

const ask = (kind, status, body, extra = {}) => {
  const calls = [];
  const p = complete({ kind, key: KEY, model: "m-1", system: "будь краток",
    messages: [{ role: "user", content: "что у меня сегодня?" }], ...extra },
  fakeFetch(status, body, calls));
  return { p, calls };
};

describe("вид OpenAI", () => {
  it("chat/completions по адресу вида с Bearer-ключом, системная подсказка — первым сообщением", async () => {
    const { p, calls } = ask("openai", 200,
      { choices: [{ message: { content: "Сегодня две задачи." } }] });
    expect(await p).toBe("Сегодня две задачи.");
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].json.model).toBe("m-1");
    expect(calls[0].json.messages[0]).toEqual({ role: "system", content: "будь краток" });
    expect(calls[0].json.messages[1].role).toBe("user");
  });

  it("свой адрес — OpenRouter, Groq: тот же вид, другой baseUrl; хвостовой слэш не удваивается", async () => {
    const { p, calls } = ask("openai", 200,
      { choices: [{ message: { content: "ок" } }] }, { baseUrl: "https://openrouter.ai/api/v1/", model: "openai/gpt-4.1" });
    await p;
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].json.model).toBe("openai/gpt-4.1");
  });
});

describe("вид Anthropic", () => {
  it("messages с x-api-key и версией, system отдельно, max_tokens обязателен", async () => {
    const { p, calls } = ask("anthropic", 200,
      { content: [{ type: "text", text: "Одна задача " }, { type: "text", text: "на проверке." }] });
    expect(await p).toBe("Одна задача на проверке.");
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].json.system).toBe("будь краток");
    expect(calls[0].json.max_tokens).toBe(MAX_TOKENS);
    // В messages системной роли нет — Anthropic её не принимает.
    expect(calls[0].json.messages.every((m) => m.role !== "system")).toBe(true);
  });

  it("адрес с «/v1» на конце не даёт «/v1/v1»", () => {
    expect(baseUrlFor("anthropic", "https://api.anthropic.com/v1/")).toBe("https://api.anthropic.com");
    expect(endpoints("anthropic", "https://proxy.local/v1").models).toBe("https://proxy.local/v1/models");
    expect(endpoints("openai", "").chat).toBe(`${DEFAULT_BASE_URL.openai}/chat/completions`);
  });
});

describe("вид Hugging Face", () => {
  it("идёт через router в формате OpenAI: имя модели в теле, а не в адресе", async () => {
    const { p, calls } = ask("hf", 200,
      { choices: [{ message: { content: "Задач нет." } }] }, { model: "meta-llama/Llama-3.1-8B-Instruct" });
    expect(await p).toBe("Задач нет.");
    expect(calls[0].url).toBe("https://router.huggingface.co/v1/chat/completions");
    expect(calls[0].url).not.toContain("meta-llama");
    expect(calls[0].json.model).toBe("meta-llama/Llama-3.1-8B-Instruct");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
  });
});

describe("список моделей у провайдера", () => {
  it("вид OpenAI: GET /models по адресу вида, ответ — [{id, name}] по алфавиту", async () => {
    const calls = [];
    const list = await listModels({ kind: "openai", key: KEY, baseUrl: "https://api.groq.com/openai/v1" },
      fakeFetch(200, { data: [{ id: "llama-3.3-70b" }, { id: "gemma2-9b" }] }, calls));
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/models");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(list).toEqual([{ id: "gemma2-9b", name: "gemma2-9b" }, { id: "llama-3.3-70b", name: "llama-3.3-70b" }]);
  });

  it("вид Anthropic: GET /v1/models с x-api-key, имя — display_name", async () => {
    const calls = [];
    const list = await listModels({ kind: "anthropic", key: KEY },
      fakeFetch(200, { data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] }, calls));
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models");
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(list).toEqual([{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }]);
  });

  it("вид Hugging Face: пусто и без запроса — имя вводится вручную", async () => {
    let hit = 0;
    const list = await listModels({ kind: "hf", key: KEY }, async () => { hit += 1; });
    expect(list).toEqual([]);
    expect(hit).toBe(0);
  });

  it("ошибка провайдера — словами, с его именем и без ключа", async () => {
    await expect(listModels({ kind: "openai", key: KEY, providerName: "Мой OpenRouter" },
      fakeFetch(401, { error: { message: `bad key ${KEY}` } })))
      .rejects.toThrow(/^Мой OpenRouter ответил 401: bad key \[ключ\]$/);
    await expect(listModels({ kind: "openai", key: "" }, fakeFetch(200, {})))
      .rejects.toThrow(/не задан/);
  });

  it("виды API — три, у каждого адрес по умолчанию", () => {
    expect(KINDS.map((k) => k.id)).toEqual(["openai", "anthropic", "hf"]);
    KINDS.forEach((k) => expect(k.defaultBaseUrl).toMatch(/^https:\/\//));
  });
});

/* Без предела fetch ждал заголовки минутами, и всё это время стояла
   очередь вопросов, а бот не отвечал никому. Сигнал спросившего нужен,
   чтобы «Отменить» в боте резало и сам запрос: иначе за ответ, который
   никто не прочитает, платил бы человек. */
describe("предел ожидания и отмена", () => {
  it("запрос уходит с сигналом: свой предел плюс сигнал спросившего", async () => {
    const ctrl = new AbortController();
    const { p, calls } = ask("openai", 200, { choices: [{ message: { content: "ок" } }] }, { signal: ctrl.signal });
    await p;
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal.aborted).toBe(false);
    ctrl.abort();
    expect(calls[0].signal.aborted).toBe(true);
    expect(FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("отмена во время запроса — fetch прерван, ошибка «Запрос отменён»", async () => {
    const ctrl = new AbortController();
    const hanging = (_url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const p = complete({ kind: "openai", key: KEY, model: "m", messages: [{ role: "user", content: "?" }],
      signal: ctrl.signal }, hanging);
    ctrl.abort();
    await expect(p).rejects.toThrow(CANCELLED);
  });

  it("уже отменённый запрос в сеть не идёт", async () => {
    let hit = 0;
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(complete({ kind: "openai", key: KEY, model: "m", messages: [{ role: "user", content: "?" }],
      signal: ctrl.signal }, async () => { hit += 1; })).rejects.toThrow(CANCELLED);
    expect(hit).toBe(0);
  });

  it("истёкший предел — по-русски и без слова «aborted»", async () => {
    const timedOut = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    await expect(complete({ kind: "anthropic", key: KEY, model: "m", providerName: "Claude",
      messages: [{ role: "user", content: "?" }] }, timedOut))
      .rejects.toThrow(/^Claude не ответил за \d+ секунд$/);
  });
});

describe("ошибки — словами и без ключа", () => {
  it("имя провайдера человека, статус и объяснение", async () => {
    const { p } = ask("openai", 401,
      { error: { message: "Incorrect API key provided" } }, { providerName: "Мой OpenAI" });
    await expect(p).rejects.toThrow(/Мой OpenAI ответил 401: Incorrect API key/);
  });

  it("без имени — название вида", async () => {
    const { p } = ask("anthropic", 500, { error: { type: "overloaded" } });
    await expect(p).rejects.toThrow(/Anthropic \(Claude\) ответил 500: overloaded/);
  });

  it("ключ вырезается, даже если провайдер вернул его обратно", async () => {
    const { p } = ask("anthropic", 400, { error: { message: `bad key ${KEY} rejected` } });
    let err;
    try { await p; } catch (e) { err = e; }
    expect(err.message).toMatch(/ответил 400/);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain("[ключ]");
  });

  it("не-JSON ответ (страница nginx) обрезается, а не валит разбор", async () => {
    const { p } = ask("hf", 502, `<html>${"x".repeat(2000)}</html>`);
    let err;
    try { await p; } catch (e) { err = e; }
    expect(err.message).toMatch(/Hugging Face ответил 502/);
    expect(err.message.length).toBeLessThan(400);
  });

  it("сеть не ответила — тоже слова, и ключа в них нет", async () => {
    const boom = async () => { throw new Error(`ECONNRESET ${KEY}`); };
    let err;
    try {
      await complete({ kind: "openai", key: KEY, model: "m", messages: [{ role: "user", content: "?" }] }, boom);
    } catch (e) { err = e; }
    expect(err.message).toMatch(/недоступен/);
    expect(err.message).not.toContain(KEY);
  });

  it("пустой ответ модели — не пустая строка человеку", async () => {
    const { p } = ask("openai", 200, { choices: [{ message: { content: "" } }] });
    await expect(p).rejects.toThrow(/пустым сообщением/);
  });

  it("без ключа, без модели и с неизвестным видом — отказ до сети", async () => {
    let hit = 0;
    const spy = async () => { hit += 1; };
    const msgs = [{ role: "user", content: "?" }];
    await expect(complete({ kind: "openai", key: "", model: "m", messages: msgs }, spy)).rejects.toThrow(/не задан/);
    await expect(complete({ kind: "openai", key: KEY, model: "", messages: msgs }, spy)).rejects.toThrow(/не выбрана/);
    await expect(complete({ kind: "gemini", key: KEY, model: "m", messages: msgs }, spy)).rejects.toThrow(/Неизвестный вид API/);
    expect(hit).toBe(0);
  });
});
