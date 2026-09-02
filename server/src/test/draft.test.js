import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetBridge, takeNext, answer, ask } from "../lib/bridgeStore.js";

/* Черновик задачи от Claude — только владельцу, только через мост, и в два
   шага: POST ставит вопрос, GET опрашивает. Один длинный запрос nginx и
   WebView рвали раньше, чем отвечал Claude. */

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

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-draft-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN,
    bridge: process.env.BRIDGE_TOKEN, ttl: process.env.BRIDGE_DRAFT_TIMEOUT_MS };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  delete process.env.BRIDGE_DRAFT_TIMEOUT_MS;
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  for (const [k, v] of [["TELEGRAM_BOT_TOKEN", prev.token], ["BRIDGE_TOKEN", prev.bridge],
    ["BRIDGE_DRAFT_TIMEOUT_MS", prev.ttl]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  resetBridge();
  delete process.env.BRIDGE_DRAFT_TIMEOUT_MS;
  process.env.BRIDGE_TOKEN = "worker-secret-123";
  await request(app).get("/api/org/me").set(as(100, "Владелец"));   // 100 — владелец
});

const start = (id, body = { title: "Позвонить", assignee: "Иван", reviewer: "Пётр" }) =>
  request(app).post("/api/workspace/draft").set(as(id)).send(body);
const poll = (id, draftId) =>
  request(app).get(`/api/workspace/draft/${draftId}`).set(as(id));

describe("черновик задачи", () => {
  it("без моста — 503 словами, а не пустой текст", async () => {
    delete process.env.BRIDGE_TOKEN;
    const res = await start(100);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/disabled/);
  });

  it("не-владельцу черновик не выдаётся — ни поставить, ни прочитать", async () => {
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: "200", name: "Иван", roleId: "executor" });
    expect((await start(200)).status).toBe(403);
    const { body } = await start(100);
    expect((await poll(200, body.id)).status).toBe(403);
  });

  it("POST отвечает сразу, не дожидаясь Claude: 202 и id", async () => {
    const t0 = Date.now();
    const res = await start(100);
    expect(res.status).toBe(202);
    expect(res.body.id).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.status).toBe("pending");
    expect(Date.now() - t0).toBeLessThan(1000);
    // Вопрос лежит в очереди с тем, что нужно воркеру.
    const item = takeNext();
    expect(item.text).toMatch(/Позвонить/);
    expect(item.text).toMatch(/Иван/);
    expect(item.text).toMatch(/Пётр/);
  });

  it("пока воркер думает — pending; ответил — текст", async () => {
    const { body: { id } } = await start(100);
    let st = await poll(100, id);
    expect(st.status).toBe(200);
    expect(st.body.status).toBe("pending");

    const item = takeNext();
    answer(item.id, { text: "Позвонить трём клиентам. Готово — когда есть три ответа." });
    st = await poll(100, id);
    expect(st.body.status).toBe("done");
    expect(st.body.text).toMatch(/трём клиентам/);
  });

  it("ошибка воркера доезжает как ошибка, а не как текст задачи", async () => {
    const { body: { id } } = await start(100);
    answer(takeNext().id, { error: "не залогинен" });
    const st = await poll(100, id);
    expect(st.body.status).toBe("error");
    expect(st.body.error).toMatch(/не залогинен/);
    expect(st.body.text).toBeUndefined();
  });

  it("воркер молчит дольше срока — timeout, и человек пишет сам", async () => {
    process.env.BRIDGE_DRAFT_TIMEOUT_MS = "1";
    const { body: { id } } = await start(100);
    await new Promise((r) => setTimeout(r, 5));
    const st = await poll(100, id);
    expect(st.body.status).toBe("timeout");
    expect(st.body.error).toMatch(/не ответил/);
  });

  it("чужой или выдуманный id — 404", async () => {
    expect((await poll(100, "deadbeefdeadbeef")).status).toBe(404);
    // Вопрос из чата бота (с chatId) через черновик не читается: у него
    // другой адресат.
    const chat = ask({ text: "что в логах?", from: "100", chatId: "555" });
    expect((await poll(100, chat.id)).status).toBe(404);
  });

  it("ответ на черновик не уходит в чат: у него нет chatId", async () => {
    const { body: { id } } = await start(100);
    const item = takeNext();
    expect(item.id).toBe(id);
    expect(item.chatId).toBeNull();
  });
});
