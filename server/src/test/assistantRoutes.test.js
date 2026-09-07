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
  for (const d of ["ORG_DIR", "WORKSPACE_DIR", "REPORTS_DIR", "CALLS_DIR", "MEMORY_DIR"]) {
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

describe("настройки", () => {
  it("непозванному — 403, и никаких настроек", async () => {
    const res = await request(app).get("/api/assistant/settings").set(as(777, "Чужой"));
    expect(res.status).toBe(403);
  });

  it("позванный читает провайдера и hasKey, но ключа в ответе нет", async () => {
    await request(app).put("/api/assistant/settings").set(as(100))
      .send({ provider: "openai", key: "sk-openai-verysecret-1" });
    const res = await request(app).get("/api/assistant/settings").set(as(200));
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("openai");
    expect(res.body.hasKey).toEqual({ openai: true, claude: false, hf: false });
    expect(JSON.stringify(res.body)).not.toContain("verysecret");
  });

  it("PUT чужим — 403, ключ не записан", async () => {
    const res = await request(app).put("/api/assistant/settings").set(as(200))
      .send({ provider: "claude", key: "sk-ant-0123456789" });
    expect(res.status).toBe(403);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const view = await request(app).get("/api/assistant/settings").set(as(200));
    expect(view.body.hasKey.claude).toBe(false);
  });

  it("PUT владельцем с плохим провайдером — 400 словами", async () => {
    const res = await request(app).put("/api/assistant/settings").set(as(100))
      .send({ provider: "gemini" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be one of/);
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
    expect(r.body).toEqual({ status: "error", error: "Помощник не настроен: владелец должен указать ключ в Инструментах" });
  });

  it("настроен — ответ модели приходит вторым запросом", async () => {
    await request(app).put("/api/assistant/settings").set(as(100))
      .send({ provider: "openai", key: "sk-openai-0123456789" });
    const sent = [];
    globalThis.fetch = async (url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "Задач нет." } }] }) };
    };
    const asked = await request(app).post("/api/assistant/ask").set(as(200))
      .send({ question: "что у меня?", context: "открыт блок «заметка»" });
    expect(asked.status).toBe(202);
    const r = await poll(asked.body.id, 200);
    expect(r.body).toEqual({ status: "done", text: "Задач нет." });
    expect(sent[0].url).toContain("api.openai.com");
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
});
