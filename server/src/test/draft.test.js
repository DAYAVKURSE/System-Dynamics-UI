import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetBridge, takeNext, answer } from "../lib/bridgeStore.js";

/* Черновик задачи от Claude — только владельцу, только через мост, и с
   честным отказом, когда моста нет. */

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
    bridge: process.env.BRIDGE_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.BRIDGE_DRAFT_TIMEOUT_MS = "800";
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  if (prev.bridge === undefined) delete process.env.BRIDGE_TOKEN;
  else process.env.BRIDGE_TOKEN = prev.bridge;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  resetBridge();
  await request(app).get("/api/org/me").set(as(100, "Владелец"));   // 100 — владелец
});

const draft = (id, body = { title: "Позвонить", assignee: "Иван", reviewer: "Пётр" }) =>
  request(app).post("/api/workspace/draft").set(as(id)).send(body);

describe("черновик задачи", () => {
  it("без моста — 503 словами, а не пустой текст", async () => {
    delete process.env.BRIDGE_TOKEN;
    const res = await draft(100);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/disabled/);
  });

  it("не-владельцу черновик не выдаётся", async () => {
    process.env.BRIDGE_TOKEN = "worker-secret-123";
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: "200", name: "Иван", roleId: "executor" });
    expect((await draft(200)).status).toBe(403);
  });

  it("владелец получает текст, который вернул воркер", async () => {
    process.env.BRIDGE_TOKEN = "worker-secret-123";
    // Воркер отвечает сам, как только вопрос появился в очереди.
    const worker = (async () => {
      for (let i = 0; i < 40; i++) {
        const item = takeNext();
        if (item) {
          expect(item.text).toMatch(/Позвонить/);
          expect(item.text).toMatch(/Иван/);
          expect(item.text).toMatch(/Пётр/);
          answer(item.id, { text: "Позвонить трём клиентам. Готово — когда есть три ответа." });
          return;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const res = await draft(100);
    await worker;
    expect(res.status).toBe(200);
    expect(res.body.text).toMatch(/трём клиентам/);
  });

  it("воркер молчит — 504, и человек пишет сам", async () => {
    process.env.BRIDGE_TOKEN = "worker-secret-123";
    const res = await draft(100);
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/не ответил/);
  });

  it("ошибка воркера доезжает как ошибка, а не как текст задачи", async () => {
    process.env.BRIDGE_TOKEN = "worker-secret-123";
    const worker = (async () => {
      for (let i = 0; i < 40; i++) {
        const item = takeNext();
        if (item) { answer(item.id, { error: "не залогинен" }); return; }
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const res = await draft(100);
    await worker;
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/не залогинен/);
  });
});
