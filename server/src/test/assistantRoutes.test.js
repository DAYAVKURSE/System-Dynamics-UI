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
const as = (id, name) => ({ "X-Telegram-Init-Data": initDataFor(id, name), "X-Storage": "main" });
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

  it("пусто — виды API, список задач и встроенный агент есть, провайдеров нет", async () => {
    const res = await request(app).get("/api/assistant/settings").set(as(200));
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([]);
    expect(res.body.tasks).toEqual({ chat: null, bot: null, transcribe: null });
    expect(res.body.agents).toEqual([{ id: "assistant", name: "Ассистент", builtin: true, models: [], transcribe: null, uses: { main: null, voice: null, draw: null, vision: null, transcribe: null }, mcp: {}, ask: true, skill: "", bot: null }]);
    expect(res.body.kinds.map((k) => k.id)).toEqual(["openai", "anthropic", "hf"]);
    expect(res.body.kinds[0].defaultBaseUrl).toBe("https://api.openai.com/v1");
    expect(res.body.taskList.map((t) => t.id)).toEqual(["chat", "bot", "transcribe"]);
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

/* Выбор модели расшифровки — не только на будущее: записи без текста
   (модели не было, не удалось) расшифровываются ей в фоне сразу. Раньше
   они оставались без текста навсегда: расшифровка звалась только при
   сохранении записи. */
describe("выбор модели расшифровки дорасшифровывает записи без текста", () => {
  const settled = async (fileId, want) => {
    const { transcriptFor } = await import("../lib/callStore.js");
    for (let i = 0; i < 50; i += 1) {
      const t = await transcriptFor(fileId);
      if (t && t.status === want) return t;
      await new Promise((r) => setTimeout(r, 40));
    }
    return transcriptFor(fileId);
  };

  it("PUT /tasks со строкой transcribe → запись без текста расшифрована этой моделью", async () => {
    const { saveReport } = await import("../lib/reportStore.js");
    const { putTranscript, transcriptFor } = await import("../lib/callStore.js");
    const none = await saveReport("200", { name: "звонок-1.webm", type: "video/webm", kind: "call", bytes: Buffer.from("раз") });
    const failed = await saveReport("200", { name: "звонок-2.webm", type: "video/webm", kind: "call", bytes: Buffer.from("два") });
    await putTranscript({ fileId: failed.id, by: "200", status: "error", error: "провайдер ответил 400" });
    const sent = [];
    globalThis.fetch = async (url, opts) => {
      sent.push({ url, model: opts.body.get("model") });
      return { ok: true, status: 200, text: async () => `текст ${await opts.body.get("file").text()}` };
    };
    const { body: p } = await addProvider(200, { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" });
    await request(app).put(`/api/assistant/providers/${p.id}`).set(as(200)).send({ models: ["whisper-large-v3-turbo"] });
    // Строка чата модели не даёт: расшифровка идёт только своей строкой.
    await request(app).put("/api/assistant/tasks").set(as(200)).send({ chat: { providerId: p.id, model: "whisper-large-v3-turbo" } });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toEqual([]);
    expect(await transcriptFor(none.id)).toBeNull();

    const res = await request(app).put("/api/assistant/tasks").set(as(200))
      .send({ transcribe: { providerId: p.id, model: "whisper-large-v3-turbo" } });
    expect(res.status).toBe(200);
    expect(res.body.transcribe).toEqual({ providerId: p.id, model: "whisper-large-v3-turbo" });
    expect(await settled(none.id, "done")).toMatchObject({ text: "текст раз", model: "Groq / whisper-large-v3-turbo" });
    expect(await settled(failed.id, "done")).toMatchObject({ text: "текст два" });
    expect(sent.map((c) => c.url)).toEqual(Array(2).fill("https://api.groq.com/openai/v1/audio/transcriptions"));
    // Снять строку — ничего не запускается.
    await request(app).put("/api/assistant/tasks").set(as(200)).send({ transcribe: null });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toHaveLength(2);
  });

  it("PUT /agents/assistant с парой transcribe — то же самое; у своего агента — нет", async () => {
    const { saveReport } = await import("../lib/reportStore.js");
    const none = await saveReport("200", { name: "звонок-3.webm", type: "video/webm", kind: "call", bytes: Buffer.from("три") });
    const sent = [];
    globalThis.fetch = async (url, opts) => {
      sent.push(url);
      return { ok: true, status: 200, text: async () => `текст ${await opts.body.get("file").text()}` };
    };
    const { body: p } = await addProvider(200, { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" });
    await request(app).put(`/api/assistant/providers/${p.id}`).set(as(200)).send({ models: ["whisper-large-v3-turbo"] });
    const { body: a } = await request(app).post("/api/assistant/agents").set(as(200)).send({ name: "Свой" });
    await request(app).put(`/api/assistant/agents/${a.id}`).set(as(200)).send({ transcribe: { providerId: p.id, model: "whisper-large-v3-turbo" } });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toEqual([]);
    const res = await request(app).put("/api/assistant/agents/assistant").set(as(200))
      .send({ transcribe: { providerId: p.id, model: "whisper-large-v3-turbo" } });
    expect(res.status).toBe(200);
    expect(await settled(none.id, "done")).toMatchObject({ text: "текст три", model: "Groq / whisper-large-v3-turbo" });
    expect(sent).toEqual(["https://api.groq.com/openai/v1/audio/transcriptions"]);
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
    expect(r.body).toEqual({ status: "error", error: "Помощник не настроен: добавьте провайдера и ключ в Инструментах → Агенты" });
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
      .send({ question: "что у меня?", context: "открыта задача «Сбор заявок»", task: "bot" });
    expect(asked.status).toBe(202);
    const r = await poll(asked.body.id, 100);
    expect(r.body).toEqual({ status: "done", text: "Задач нет." });
    expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0].body.model).toBe("gpt-4o-mini");
    expect(sent[0].body.messages[0].content).toContain("открыта задача «Сбор заявок»");
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

/* ─────── агенты ───────
   Агент — в настройках человека; у владельца он ещё и участник
   организации (`ag_<id>`), чтобы выбирать его в ролях. */
describe("агенты", () => {
  const orgUsers = async () => (await request(app).get("/api/org").set(as(100))).body.users;

  it("владелец: 201 и участник-агент в организации; переименование и удаление идут за ним", async () => {
    const created = await request(app).post("/api/assistant/agents").set(as(100)).send({ name: "Юрист" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: created.body.id, name: "Юрист", builtin: false, models: [], transcribe: null, uses: { main: null, voice: null, draw: null, vision: null, transcribe: null }, mcp: {}, ask: true, skill: "", bot: null });
    const uid = `ag_${created.body.id}`;
    let user = (await orgUsers()).find((u) => u.id === uid);
    expect(user).toMatchObject({ id: uid, name: "Юрист", agent: true, roles: [], addedBy: "100" });
    expect(user.about).toBe("");

    const renamed = await request(app).put(`/api/assistant/agents/${created.body.id}`).set(as(100)).send({ name: "Юрист по договорам" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Юрист по договорам");
    user = (await orgUsers()).find((u) => u.id === uid);
    expect(user.name).toBe("Юрист по договорам");

    // Роль агенту — без договора и без pending.
    const role = await request(app).put(`/api/org/users/${uid}/roles`).set(as(100)).send({ roles: ["worker"] });
    expect(role.status).toBe(200);
    expect(role.body.roles).toEqual(["worker"]);
    expect(role.body.pending).toBeUndefined();

    const settings = await request(app).get("/api/assistant/settings").set(as(100));
    expect(settings.body.agents.map((a) => a.id)).toEqual(["assistant", created.body.id]);

    const gone = await request(app).delete(`/api/assistant/agents/${created.body.id}`).set(as(100));
    expect(gone.status).toBe(204);
    expect((await orgUsers()).some((u) => u.id === uid)).toBe(false);
    expect((await request(app).delete(`/api/assistant/agents/${created.body.id}`).set(as(100))).status).toBe(404);
  });

  it("токен бота агента: проверяется у Telegram, наружу уходит только username; пустой — снять; ассистенту — нельзя", async () => {
    const { body: a } = await request(app).post("/api/assistant/agents").set(as(100)).send({ name: "Юрист" });
    const TOK = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TVsBYq3zR7A";
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ ok: true, result: { id: 123456789, username: "lawyer_bot" } }) };
    };
    const bad = await request(app).put(`/api/assistant/agents/${a.id}`).set(as(100)).send({ botToken: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/BotFather/);
    expect(calls).toEqual([]);

    const ok = await request(app).put(`/api/assistant/agents/${a.id}`).set(as(100)).send({ botToken: TOK });
    expect(ok.status).toBe(200);
    expect(ok.body.bot).toEqual({ username: "lawyer_bot", botId: "123456789" });
    expect(JSON.stringify(ok.body)).not.toContain("AAHfiqks");
    expect(calls[0]).toBe(`https://api.telegram.org/bot${TOK}/getMe`);
    const view = await request(app).get("/api/assistant/settings").set(as(100));
    expect(view.body.agents.find((x) => x.id === a.id).bot).toEqual({ username: "lawyer_bot", botId: "123456789" });

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false }) });
    const refused = await request(app).put(`/api/assistant/agents/${a.id}`).set(as(100)).send({ botToken: "123456789:BBHfiqksKZ8WmR2zSjiQ7_v4TVsBYq3zR7A" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/не признал/);

    const builtin = await request(app).put("/api/assistant/agents/assistant").set(as(100)).send({ botToken: TOK });
    expect(builtin.status).toBe(400);

    const off = await request(app).put(`/api/assistant/agents/${a.id}`).set(as(100)).send({ botToken: "" });
    expect(off.body.bot).toBeNull();
    await request(app).delete(`/api/assistant/agents/${a.id}`).set(as(100));
  });

  it("не-владелец: агент только в своих настройках, участника нет; чужого агента не найти", async () => {
    const created = await request(app).post("/api/assistant/agents").set(as(200)).send({ name: "Свой" });
    expect(created.status).toBe(201);
    expect((await orgUsers()).some((u) => u.id === `ag_${created.body.id}`)).toBe(false);
    expect((await request(app).put(`/api/assistant/agents/${created.body.id}`).set(as(100)).send({ name: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/assistant/agents/${created.body.id}`).set(as(100))).status).toBe(404);
    expect((await request(app).get("/api/assistant/settings").set(as(200))).body.agents).toHaveLength(2);
    expect((await request(app).get("/api/assistant/settings").set(as(100))).body.agents).toHaveLength(1);
  });

  it("встроенного не удалить — 400 словами; пустое имя и чужая модель — 400", async () => {
    const builtin = await request(app).delete("/api/assistant/agents/assistant").set(as(200));
    expect(builtin.status).toBe(400);
    expect(builtin.body.error).toBe("Ассистента удалить нельзя");
    const empty = await request(app).post("/api/assistant/agents").set(as(200)).send({ name: " " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/Название агента обязательно/);
    const { body: p } = await addProvider(200);
    await request(app).put(`/api/assistant/providers/${p.id}`).set(as(200)).send({ models: ["gpt-4.1"] });
    const bad = await request(app).put("/api/assistant/agents/assistant").set(as(200))
      .send({ models: [{ providerId: p.id, model: "gpt-5" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/модели «gpt-5» нет в списке провайдера «OpenAI»/);
    const ok = await request(app).put("/api/assistant/agents/assistant").set(as(200))
      .send({ models: [{ providerId: p.id, model: "gpt-4.1" }], transcribe: { providerId: p.id, model: "gpt-4.1" } });
    expect(ok.status).toBe(200);
    expect(ok.body.models).toEqual([{ providerId: p.id, model: "gpt-4.1" }]);
    expect(ok.body.transcribe).toEqual({ providerId: p.id, model: "gpt-4.1" });
    // Модель ассистента — и есть модель помощника: бот и вопросы идут ей.
    const settings = await request(app).get("/api/assistant/settings").set(as(200));
    expect(settings.body.agents[0].models).toEqual([{ providerId: p.id, model: "gpt-4.1" }]);
  });

  it("память — по агенту: JSON полем agent, файл — заголовком; ?agent= в списке; неизвестный агент — 400", async () => {
    const { body: a } = await request(app).post("/api/assistant/agents").set(as(200)).send({ name: "Свой" });
    const t = await request(app).post("/api/assistant/memory").set(as(200)).send({ text: "заметка своего", agent: a.id });
    expect(t.status).toBe(201);
    expect(t.body.agent).toBe(a.id);
    const f = await request(app).post("/api/assistant/memory").set(as(200))
      .set("X-Memory-Name", b64("файл.txt")).set("X-Memory-Agent", a.id)
      .set("Content-Type", "text/plain").send("файл своего");
    expect(f.status).toBe(201);
    expect(f.body.agent).toBe(a.id);
    const common = await request(app).post("/api/assistant/memory").set(as(200)).send({ text: "заметка ассистента" });
    expect(common.body.agent).toBe("assistant");

    const byDefault = await request(app).get("/api/assistant/memory").set(as(200));
    expect(byDefault.body.map((m) => m.text)).toEqual(["заметка ассистента"]);
    const own = await request(app).get(`/api/assistant/memory?agent=${a.id}`).set(as(200));
    expect(own.body.map((m) => m.text).sort()).toEqual(["заметка своего", "файл своего"]);
    const unknown = await request(app).get("/api/assistant/memory?agent=a_nope").set(as(200));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/Агент «a_nope» не найден/);
    const badPost = await request(app).post("/api/assistant/memory").set(as(200)).send({ text: "x", agent: "a_nope" });
    expect(badPost.status).toBe(400);
    // Чужой агент — для меня неизвестный.
    expect((await request(app).get(`/api/assistant/memory?agent=${a.id}`).set(as(100))).status).toBe(400);
    // Удаление — по id, без агента.
    expect((await request(app).delete(`/api/assistant/memory/${t.body.id}`).set(as(200))).status).toBe(204);
    expect((await request(app).get(`/api/assistant/memory?agent=${a.id}`).set(as(200))).body).toHaveLength(1);
  });
});

/* ВХОД НА MCP-СЕРВЕР (владелец, 2026-09-21): «MCP-сервер ответил 401: он
   требует авторизации, а войти в него приложение пока не умеет. Вход
   должен появляться в виде модального окна». Отказ «нужен вход» приходит
   отдельным признаком: экран открывает на него окно, а не показывает
   строчку с номером. */
describe("mcp: сервер требует входа", () => {
  it("401 приходит признаком, вход сохраняется, и после него инструменты спрашиваются", async () => {
    const add = await request(app).post("/api/assistant/mcp").set(as(200))
      .send({ name: "Погода", url: "https://x/mcp" });
    expect(add.status).toBe(201);
    const id = add.body.id;
    expect(add.body.auth).toBe("none");

    globalThis.fetch = async () => ({ ok: false, status: 401,
      headers: { get: (k) => (String(k).toLowerCase() === "www-authenticate"
        ? 'Bearer resource_metadata="https://x/login"' : null) },
      json: async () => ({}), text: async () => "" });
    const no = await request(app).post(`/api/assistant/mcp/${id}/tools`).set(as(200));
    expect(no.status).toBe(401);
    expect(no.body.needsAuth).toBe(true);
    expect(no.body.where).toBe("https://x/login");
    expect(no.body.server).toBe("Погода");
    // Схема — как сказал сервер: окно на экране строится по ней.
    expect(no.body.scheme).toBe("oauth");
    expect(no.body.hint).toBe('Bearer resource_metadata="https://x/login"');

    const put = await request(app).put(`/api/assistant/mcp/${id}/auth`).set(as(200))
      .send({ kind: "bearer", token: "sk-1" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id, auth: "bearer", hasAuth: true });
    // Ключ обратно не приходит ни здесь, ни в общих настройках.
    expect(JSON.stringify(put.body)).not.toContain("sk-1");
    const view = await request(app).get("/api/assistant/settings").set(as(200));
    expect(JSON.stringify(view.body)).not.toContain("sk-1");

    const sent = [];
    globalThis.fetch = async (url, opts = {}) => {
      sent.push({ url: String(url), headers: opts.headers || {} });
      return { ok: true, status: 200, headers: { get: () => "application/json" },
        json: async () => ({ jsonrpc: "2.0", id: 1,
          result: { tools: [{ name: "forecast", description: "погода" }] } }),
        text: async () => "" };
    };
    const ok = await request(app).post(`/api/assistant/mcp/${id}/tools`).set(as(200));
    expect(ok.status).toBe(200);
    expect(ok.body.tools).toEqual(["forecast"]);
    // Ключ ушёл серверу — заголовком, в каждом запросе.
    expect(sent.every((r) => r.headers.Authorization === "Bearer sk-1")).toBe(true);

    // Чужому сервера не видно.
    expect((await request(app).put(`/api/assistant/mcp/${id}/auth`).set(as(100))
      .send({ kind: "bearer", token: "sk-2" })).status).toBe(404);
    // Пустой ключ — отказ словами, а не молчаливое «вошли».
    const empty = await request(app).put(`/api/assistant/mcp/${id}/auth`).set(as(200))
      .send({ kind: "bearer", token: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/[Кк]люч/);
  });
});

/* ВОПРОС ИЗ ПРИЛОЖЕНИЯ (владелец, 2026-09-21): маршрут принимает вопрос,
   экран, действия и снимок; вопрос и снимок уходят в чат Telegram, ответ
   — туда же. Здесь Telegram подменён: смотрим, что ему послали. */
describe("вопрос из приложения", () => {
  it("202, в чат уходят вопрос и снимок, экран с действиями идут в подсказку", async () => {
    const tg = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("api.telegram.org")) {
        const body = opts.body instanceof FormData ? Object.fromEntries([...opts.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `<${v.size || 0}>`])) : JSON.parse(opts.body || "{}");
        tg.push({ method: u.split("/").pop(), body });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: tg.length } }) };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
    };
    const shot = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;
    const r = await request(app).post("/api/assistant/ask-from-app").set(as(200))
      .send({ question: "Почему тут пусто?", screen: "Вкладки: [Задачи]\nПРОГНОЗ", log: "12:00 кнопка «сохранить»", shot });
    expect(r.status).toBe(202);
    await new Promise((res) => setTimeout(res, 50));
    // Снимок и вопрос — одним сообщением: вопрос подписью к картинке.
    const photo = tg.find((c) => c.method === "sendPhoto");
    expect(photo.body.photo).toBe("<9>");
    expect(photo.body.caption).toBe("Вопрос из приложения:\nПочему тут пусто?");
    const texts = tg.filter((c) => c.method === "sendMessage").map((c) => c.body.text);
    expect(texts).not.toContain("Вопрос из приложения:\nПочему тут пусто?");
    // Пустой вопрос — 400.
    expect((await request(app).post("/api/assistant/ask-from-app").set(as(200)).send({ question: " " })).status).toBe(400);
  });

  it("экран и действия складываются в подсказку модели отдельными разделами", async () => {
    const { appContextOf } = await import("../routes/assistant.js");
    const ctx = appContextOf({ screen: "ПРОГНОЗ\nмесяцы: 3", log: "12:00 кнопка «сохранить»" });
    expect(ctx).toMatch(/## Что человек видел на экране приложения в момент вопроса\nПРОГНОЗ\nмесяцы: 3/);
    expect(ctx).toMatch(/## Последние действия человека в приложении\n12:00 кнопка «сохранить»/);
    expect(appContextOf({})).toBe("");
  });
});
