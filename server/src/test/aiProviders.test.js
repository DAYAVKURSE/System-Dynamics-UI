import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, ENDPOINTS, FETCH_TIMEOUT_MS, MAX_TOKENS, complete } from "../lib/aiProviders.js";

/* Три провайдера — один вызов. Проверяем то, что видно снаружи: куда ушёл
   запрос, с какими заголовками и телом, что вернулось человеку, и что
   ключ не попал в текст ошибки ни при каком ответе провайдера. */

const KEY = "sk-secret-key-0123456789";

/** Подменный fetch: запоминает вызов и отдаёт заготовленный ответ. */
function fakeFetch(status, body, calls = []) {
  return async (url, opts) => {
    calls.push({ url, ...opts, json: JSON.parse(opts.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
}

const ask = (provider, status, body, extra = {}) => {
  const calls = [];
  const p = complete({ provider, apiKey: KEY, system: "будь краток",
    messages: [{ role: "user", content: "что у меня сегодня?" }], ...extra },
  fakeFetch(status, body, calls));
  return { p, calls };
};

describe("OpenAI", () => {
  it("chat/completions с Bearer-ключом, системная подсказка — первым сообщением", async () => {
    const { p, calls } = ask("openai", 200,
      { choices: [{ message: { content: "Сегодня две задачи." } }] });
    expect(await p).toBe("Сегодня две задачи.");
    expect(calls[0].url).toBe(ENDPOINTS.openai);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].json.model).toBe(DEFAULT_MODELS.openai);
    expect(calls[0].json.messages[0]).toEqual({ role: "system", content: "будь краток" });
    expect(calls[0].json.messages[1].role).toBe("user");
  });

  it("своя модель уходит как есть", async () => {
    const { p, calls } = ask("openai", 200,
      { choices: [{ message: { content: "ок" } }] }, { model: "gpt-4.1" });
    await p;
    expect(calls[0].json.model).toBe("gpt-4.1");
  });
});

describe("Claude", () => {
  it("messages с x-api-key и версией, system отдельно, max_tokens обязателен", async () => {
    const { p, calls } = ask("claude", 200,
      { content: [{ type: "text", text: "Одна задача " }, { type: "text", text: "на проверке." }] });
    expect(await p).toBe("Одна задача на проверке.");
    expect(calls[0].url).toBe(ENDPOINTS.claude);
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].json.system).toBe("будь краток");
    expect(calls[0].json.max_tokens).toBe(MAX_TOKENS);
    expect(calls[0].json.model).toBe(DEFAULT_MODELS.claude);
    // В messages системной роли нет — Claude её не принимает.
    expect(calls[0].json.messages.every((m) => m.role !== "system")).toBe(true);
  });
});

describe("Hugging Face", () => {
  it("идёт через router в формате OpenAI: имя модели в теле, а не в адресе", async () => {
    const { p, calls } = ask("hf", 200,
      { choices: [{ message: { content: "Задач нет." } }] });
    expect(await p).toBe("Задач нет.");
    expect(calls[0].url).toBe(ENDPOINTS.hf);
    expect(calls[0].url).not.toContain("meta-llama");
    expect(calls[0].json.model).toBe(DEFAULT_MODELS.hf);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
  });
});

/* Без предела fetch ждал заголовки минутами, и всё это время стояла
   очередь вопросов, а бот не отвечал никому. */
describe("предел ожидания", () => {
  it("запрос уходит с сигналом таймаута", async () => {
    const { p, calls } = ask("openai", 200, { choices: [{ message: { content: "ок" } }] });
    await p;
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("истёкший предел — по-русски и без слова «aborted»", async () => {
    const timedOut = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    await expect(complete({ provider: "claude", apiKey: KEY,
      messages: [{ role: "user", content: "?" }] }, timedOut))
      .rejects.toThrow(/^Claude не ответил за \d+ секунд$/);
  });
});

describe("ошибки — словами и без ключа", () => {
  it("статус и объяснение провайдера", async () => {
    const { p } = ask("openai", 401,
      { error: { message: "Incorrect API key provided" } });
    await expect(p).rejects.toThrow(/OpenAI ответил 401: Incorrect API key/);
  });

  it("ключ вырезается, даже если провайдер вернул его обратно", async () => {
    const { p } = ask("claude", 400, { error: { message: `bad key ${KEY} rejected` } });
    let err;
    try { await p; } catch (e) { err = e; }
    expect(err.message).toMatch(/Claude ответил 400/);
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

  it("сеть не ответила — тоже слова", async () => {
    const boom = async () => { throw new Error(`ECONNRESET ${KEY}`); };
    await expect(complete({ provider: "openai", apiKey: KEY,
      messages: [{ role: "user", content: "?" }] }, boom))
      .rejects.toThrow(/OpenAI недоступен/);
    let err;
    try { await complete({ provider: "openai", apiKey: KEY,
      messages: [{ role: "user", content: "?" }] }, boom); } catch (e) { err = e; }
    expect(err.message).not.toContain(KEY);
  });

  it("пустой ответ модели — не пустая строка человеку", async () => {
    const { p } = ask("openai", 200, { choices: [{ message: { content: "" } }] });
    await expect(p).rejects.toThrow(/пустым сообщением/);
  });

  it("без ключа и с неизвестным провайдером — отказ до сети", async () => {
    let hit = 0;
    const spy = async () => { hit += 1; };
    await expect(complete({ provider: "openai", apiKey: "",
      messages: [{ role: "user", content: "?" }] }, spy)).rejects.toThrow(/не задан/);
    await expect(complete({ provider: "gemini", apiKey: KEY,
      messages: [{ role: "user", content: "?" }] }, spy)).rejects.toThrow(/Неизвестный провайдер/);
    expect(hit).toBe(0);
  });
});
