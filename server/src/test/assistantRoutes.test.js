import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { resetQueue } from "../lib/assistantQueue.js";

/* Маршруты помощника — на боевом режиме, с подписью: иначе владельца от
   гостя не отличить. Роутер монтируется сам по себе, как его смонтирует
   app.js (координатор): app.use("/api/assistant", assistantRouter). */

const TOKEN = "test-token";
let app, tmp, prev;

function initDataFor(id, name = "Кто-то") {
  const user = JSON.stringify({ id, first_name: name });
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), user };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}
const as = (id, name) => ({ "X-Telegram-Init-Data": initDataFor(id, name) });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const AI_VARS = ["AI_PROVIDER", "AI_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "HF_API_KEY"];

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-assistant-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN,
    fetch: globalThis.fetch };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.REPORTS_DIR = path.join(tmp, "reports");
  process.env.CALLS_DIR = path.join(tmp, "calls");
  process.env.MEMORY_DIR = path.join(tmp, "memory");
  process.env.ASSISTANT_DIR = path.join(tmp, "assistant");
  process.env.ENV_FILE = path.join(tmp, ".env");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  const { default: assistantRouter } = await import("../routes/assistant.js");
  const { default: orgRouter } = await import("../routes/org.js");
  app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/org", orgRouter);
  app.use("/api/assistant", assistantRouter);
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  globalThis.fetch = prev.fetch;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const d of ["ORG_DIR", "WORKSPACE_DIR", "REPORTS_DIR", "CALLS_DIR", "MEMORY_DIR", "ASSISTANT_DIR"]) {
    await fs.rm(process.env[d], { recursive: true, force: true });
  }
  await fs.rm(process.env.ENV_FILE, { force: true });
  AI_VARS.forEach((v) => delete process.env[v]);
  resetQueue();
  // Первый вошедший — владелец; делаем им 100 в каждом тесте.
  await request(app).get("/api/org/me").set(as(100, "Владелец"));
  await request(app).post("/api/org/users").set(as(100))
    .send({ id: "200", name: "Иван", roleId: "executor" });
});
afterEach(() => { globalThis.fetch = prev.fetch; });

/* Провайдеры и ключи — у каждого свои: маршруты отдают и меняют только
   настройки того, кто подписал запрос, и ни в одном ответе нет ключа. */
const KEY = "sk-openai-verysecret-1";
const addProvider = (who, over = {}) => request(app).post("/api/assistant/providers").set(as(who))
  .send({ name: "OpenAI", kind: "openai", key: KEY, ...over });

describe("настройки", () => {
  it("непозванному — 403, и никаких настроек", async () => {
    const res = await request(app).get("/api/assistant/settings").set(as(777, "Чужой"));
    expect(res.status).toBe(403);
    expect((await addProvider(777)).status).toBe(403);
  });

  it("пусто — виды API и список задач есть, провайдеров нет", async () => {
    const res = await request(app).get("/api/assistant/settings").set(as(200));
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([]);
    expect(res.body.tasks).toEqual({ chat: null, space: null, bot: null, transcribe: null });
    expect(res.body.kinds.map((k) => k.id)).toEqual(["openai", "anthropic", "hf"]);
    expect(res.body.kinds[0].defaultBaseUrl).toBe("https://api.openai.com/v1");
    expect(res.body.taskList.map((t) => t.id)).toEqual(["chat", "space", "bot", "transcribe"]);
  });

  it("свой провайдер виден только себе, ключа нет ни в одном ответе", async () => {
    const created = await addProvider(200, { name: "Мой OpenRouter", baseUrl: "https://openrouter.ai/api/v1" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Мой OpenRouter", kind: "openai", hasKey: true, models: [] });
    expect(JSON.stringify(created.body)).not.toContain("verysecret");
    const mine = await request(app).get("/api/assistant/settings").set(as(200));
    expect(mine.body.providers.map((p) => p.name)).toEqual(["Мой OpenRouter"]);
    expect(JSON.stringify(mine.body)).not.toContain("verysecret");
    const owner = await request(app).get("/api/assistant/settings").set(as(100));
    expect(owner.body.providers).toEqual([]);
  });

  it("чужого провайдера нельзя ни поправить, ни удалить, ни спросить список моделей", async () => {
    const { body: p } = await addProvider(200);
    expect((await request(app).put(`/api/assistant/providers/${p.id}`).set(as(100)).send({ name: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/assistant/providers/${p.id}`).set(as(100))).status).toBe(404);
    expect((await request(app).get(`/api/assistant/providers/${p.id}/models`).set(as(100))).status).toBe(404);
    const still = await request(app).get("/api/assistant/settings").set(as(200));
    expect(still.body.providers[0].name).toBe("OpenAI");
  });

  it("правка: модели списком, пустой ключ не трогает ключ; удаление — 204 и строки таблицы пусты", async () => {
    const { body: p } = await addProvider(200);
    const upd = await request(app).put(`/api/assistant/providers/${p.id}`).set(as(200))
      .send({ models: ["gpt-4.1", "gpt-4o-mini"], key: "" });
    expect(upd.status).toBe(200);
    expect(upd.body.models).toEqual(["gpt-4.1", "gpt-4o-mini"]);
    expect(upd.body.hasKey).toBe(true);
    const tasks = await request(app).put("/api/assistant/tasks").set(as(200))
      .send({ chat: { providerId: p.id, model: "gpt-4.1" } });
    expect(tasks.status).toBe(200);
    expect(tasks.body.chat).toEqual({ providerId: p.id, model: "gpt-4.1" });
    const gone = await request(app).delete(`/api/assistant/providers/${p.id}`).set(as(200));
    expect(gone.status).toBe(204);
    const after = await request(app).get("/api/assistant/settings").set(as(200));
    expect(after.body.providers).toEqual([]);
    expect(after.body.tasks.chat).toBeNull();
  });

  it("плохой ввод — 400 словами по-русски", async () => {
    const bad = await addProvider(200, { kind: "gemini" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Неизвестный вид API/);
    const { body: p } = await addProvider(200);
    const row = await request(app).put("/api/assistant/tasks").set(as(200))
      .send({ chat: { providerId: p.id, model: "gpt-5" } });
    expect(row.status).toBe(400);
    expect(row.body.error).toMatch(/модель, которой нет/);
  });

  it("список моделей — через провайдера по его ключу; ошибка провайдера — 400 словами", async () => {
    const { body: p } = await addProvider(200, { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" });
    const sent = [];
    globalThis.fetch = async (url, opts) => {
      sent.push({ url, opts });
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "llama-3.3-70b" }] }) };
    };
    const list = await request(app).get(`/api/assistant/providers/${p.id}/models`).set(as(200));
    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id: "llama-3.3-70b", name: "llama-3.3-70b" }]);
    expect(sent[0].url).toBe("https://api.groq.com/openai/v1/models");
    expect(sent[0].opts.headers.Authorization).toBe(`Bearer ${KEY}`);
    globalThis.fetch = async () => ({ ok: false, status: 401,
      text: async () => JSON.stringify({ error: { message: "bad key" } }) });
    const err = await request(app).get(`/api/assistant/providers/${p.id}/models`).set(as(200));
    expect(err.status).toBe(400);
    expect(err.body.error).toBe("Groq ответил 401: bad key");
  });
});

describe("вопрос в два шага", () => {
  const poll = async (id, who) => {
    for (let i = 0; i < 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).get(`/api/assistant/ask/${id}`).set(as(who));
      if (r.status !== 200 || r.body.status !== "pending") return r;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 5));
    }
    return null;
  };

  it("не настроен — 202, а потом статус error теми самыми словами", async () => {
    const asked = await request(app).post("/api/assistant/ask").set(as(200))
      .send({ question: "что у меня?" });
    expect(asked.status).toBe(202);
    expect(asked.body.id).toBeTruthy();
    const r = await poll(asked.body.id, 200);
    expect(r.body).toEqual({ status: "error", error: "Помощник не настроен: добавьте провайдера и ключ в Инструментах → Помощник" });
  });

  it("настроен — ответ модели приходит вторым запросом, task уходит в очередь", async () => {
    const { body: p } = await addProvider(100, { name: "OpenAI" });
    await request(app).put(`/api/assistant/providers/${p.id}`).set(as(100)).send({ models: ["gpt-4o-mini"] });
    const sent = [];
    globalThis.fetch = async (url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "Задач нет." } }] }) };
    };
    const asked = await request(app).post("/api/assistant/ask").set(as(100))
      .send({ question: "что у меня?", context: "открыт блок «заметка»", task: "space" });
    expect(asked.status).toBe(202);
    const r = await poll(asked.body.id, 100);
    expect(r.body).toEqual({ status: "done", text: "Задач нет." });
    expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0].body.model).toBe("gpt-4o-mini");
    expect(sent[0].body.messages[0].content).toContain("открыт блок «заметка»");
    expect(sent[0].body.messages[1].content).toBe("что у меня?");
  });

  it("чужой ответ по id не читается, пустой вопрос не принимается", async () => {
    const asked = await request(app).post("/api/assistant/ask").set(as(200))
      .send({ question: "?" });
    const other = await request(app).get(`/api/assistant/ask/${asked.body.id}`).set(as(100));
    expect(other.status).toBe(404);
    const empty = await request(app).post("/api/assistant/ask").set(as(200)).send({ question: " " });
    expect(empty.status).toBe(400);
  });

  it("непозванный спросить не может", async () => {
    const res = await request(app).post("/api/assistant/ask").set(as(777)).send({ question: "?" });
    expect(res.status).toBe(403);
  });
});

describe("память", () => {
  it("текст — JSON; файл — сырые байты с именем в заголовке; список только свой", async () => {
    const t = await request(app).post("/api/assistant/memory").set(as(200))
      .send({ title: "памятка", text: "звонить утром" });
    expect(t.status).toBe(201);
    expect(t.body.title).toBe("памятка");

    const f = await request(app).post("/api/assistant/memory").set(as(200))
      .set("X-Memory-Name", b64("договор.txt"))
      .set("X-Memory-Title", b64("договор с клиентом"))
      .set("Content-Type", "text/plain")
      .send("пункт 1: оплата до пятницы");
    expect(f.status).toBe(201);
    expect(f.body.file.name).toBe("договор.txt");
    expect(f.body.title).toBe("договор с клиентом");
    expect(f.body.text).toBe("пункт 1: оплата до пятницы");

    const mine = await request(app).get("/api/assistant/memory").set(as(200));
    expect(mine.body.map((m) => m.title).sort()).toEqual(["договор с клиентом", "памятка"]);
    const owner = await request(app).get("/api/assistant/memory").set(as(100));
    expect(owner.body).toEqual([]);
  });

  it("удалить можно только своё", async () => {
    const t = await request(app).post("/api/assistant/memory").set(as(200)).send({ text: "моё" });
    const foreign = await request(app).delete(`/api/assistant/memory/${t.body.id}`).set(as(100));
    expect(foreign.status).toBe(404);
    const own = await request(app).delete(`/api/assistant/memory/${t.body.id}`).set(as(200));
    expect(own.status).toBe(204);
    expect((await request(app).get("/api/assistant/memory").set(as(200))).body).toEqual([]);
  });

  it("пустая запись — 400 словами", async () => {
    const res = await request(app).post("/api/assistant/memory").set(as(200)).send({ title: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it(".json-файл как байты ложится файлом с текстом; как application/json — 400 словами", async () => {
    /* JSON-тела разбираются на уровне приложения для всех маршрутов разом:
       файл, присланный как application/json, доезжал сюда разобранной
       записью и становился заметкой с полями из содержимого. Клиент шлёт
       файл как octet-stream (тип — в X-Memory-Type), а старому клиенту
       отвечаем словами, а не подменой. */
    const ok = await request(app).post("/api/assistant/memory").set(as(200))
      .set("X-Memory-Name", b64("данные.json"))
      .set("X-Memory-Type", "application/json")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from('{"title":"из файла","text":"тело файла"}'));
    expect(ok.status).toBe(201);
    expect(ok.body.file.name).toBe("данные.json");
    expect(ok.body.file.type).toBe("application/json");
    expect(ok.body.text).toBe('{"title":"из файла","text":"тело файла"}');
    // Содержимое файла — текст записи, а не её поля.
    expect(ok.body.title).toBe('{"title":"из файла","text":"тело файла"}');

    const bad = await request(app).post("/api/assistant/memory").set(as(200))
      .set("X-Memory-Name", b64("данные.json"))
      .set("Content-Type", "application/json")
      .send('{"title":"из файла","text":"тело файла"}');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/octet-stream/);
    const mine = await request(app).get("/api/assistant/memory").set(as(200));
    expect(mine.body).toHaveLength(1);
  });
});
