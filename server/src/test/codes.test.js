import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handle } from "../../../codes/src/service.js";
import { resetKeys } from "../../../codes/src/store.js";
import { savePlan } from "../../../codes/src/billing.js";
import { decodeToken, verifyToken } from "../../../codes/src/token.js";
import * as codes from "../lib/codes.js";
import { PLAN_TABS, planAllows } from "../lib/plans.js";

/* Сервис кодов (codes/) и его проверка на сервере хранилища.

   Сервис тут не поднимается по сети: его обработчик вызывается напрямую,
   а `fetch` сервера сведён к нему же. Так проверяется и сам сервис, и
   то, что сервер умеет с ним говорить, — без порта. */

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-codes-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN,
    fetch: global.fetch };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.CODES_DIR = path.join(tmp, "codes");
  process.env.CODES_URL = "http://codes.test";
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  // Сеть до сервиса — это его обработчик.
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.origin !== "http://codes.test") throw new Error(`unexpected fetch ${url}`);
    const body = opts.body ? JSON.parse(opts.body) : {};
    const out = await handle(opts.method || "GET", u.pathname, body);
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  });
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  delete process.env.CODES_URL;
  delete process.env.CODES_DIR;
  global.fetch = prev.fetch;
  codes.reset();
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
  await fs.rm(process.env.CODES_DIR, { recursive: true, force: true });
  resetKeys();
  codes.reset();
});

const register = (plan = "free", method) =>
  handle("POST", "/register", { plan, ...(method ? { method } : {}) }).then((r) => r.body);

describe("сервис кодов", () => {
  it("выдаёт ключ, uid и токен на час; ключ подходит для нового токена", async () => {
    const r = await handle("POST", "/register", { plan: "free" });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(r.body.uid).toMatch(/^[0-9a-z]{16}$/);
    expect(r.body.plan).toBe("free");
    const t = decodeToken(r.body.token);
    expect(t.uid).toBe(r.body.uid);
    expect(t.exp - t.iat).toBe(3600);

    const again = await handle("POST", "/token", { key: r.body.key.toLowerCase() });
    expect(again.status).toBe(200);
    expect(again.body.uid).toBe(r.body.uid);
  });

  it("платный план требует способ оплаты; регистрируют free, план включает оплата", async () => {
    const no = await handle("POST", "/register", { plan: "pro" });
    expect(no.status).toBe(400);
    const ok = await handle("POST", "/register", { plan: "max", method: "stars" });
    expect(ok.status).toBe(201);
    expect(ok.body.plan).toBe("free");
    expect(ok.body.payment).toMatchObject({ planId: "max", method: "stars", currency: "XTR", status: "pending" });
    const users = JSON.parse(await fs.readFile(path.join(process.env.CODES_DIR, "users.json"), "utf8"));
    // Сам ключ на диске не лежит — только его хэш.
    expect(JSON.stringify(users)).not.toContain(ok.body.key);
    const paid = await handle("POST", "/internal/paid", { id: ok.body.payment.id, tx: "tg-charge" });
    expect(paid.status).toBe(200);
    expect(decodeToken((await handle("POST", "/token", { key: ok.body.key })).body.token).plan).toBe("max");
  });

  it("чужой ключ, чужая подпись и истёкший срок не проходят", async () => {
    const r = await register();
    const pk = (await handle("GET", "/public-key")).body.key;
    expect(verifyToken(r.token, pk)).toMatchObject({ uid: r.uid });
    expect(verifyToken(r.token, pk, Date.now() + 3601 * 1000)).toBeNull();
    const other = crypto.generateKeyPairSync("ed25519").publicKey
      .export({ type: "spki", format: "pem" });
    expect(verifyToken(r.token, other)).toBeNull();
    expect((await handle("POST", "/token", { key: "0000-0000-0000-0000-0000-0000-0000-0000" })).status).toBe(401);
  });

  it("смена плана и новый ключ взамен прежнего", async () => {
    const r = await register();
    const up = await handle("POST", "/plan", { key: r.key, plan: "pro", method: "stars" });
    expect(up.status).toBe(200);
    expect(up.body.payment).toMatchObject({ planId: "pro", status: "pending" });
    await handle("POST", "/internal/paid", { id: up.body.payment.id });
    expect(decodeToken((await handle("POST", "/token", { key: r.key })).body.token).plan).toBe("pro");
    const rot = await handle("POST", "/rotate", { key: r.key });
    expect(rot.status).toBe(200);
    expect(rot.body.key).not.toBe(r.key);
    expect((await handle("POST", "/token", { key: r.key })).status).toBe(401);
    expect((await handle("POST", "/token", { key: rot.body.key })).status).toBe(200);
  });
});

describe("планы", () => {
  it("free — анкета, рынок, задачи; pro — плюс проверка, звонки и агенты; max — всё", () => {
    expect(PLAN_TABS.free).toEqual(["market", "me", "tasks"]);
    expect(planAllows("free", "review")).toBe(false);
    expect(planAllows("pro", "review")).toBe(true);
    expect(planAllows("pro", "tools:calls")).toBe(true);
    expect(planAllows("pro", "tools:people")).toBe(false);
    expect(planAllows("max", "tools:people")).toBe(true);
    expect(planAllows(null, "tools:people")).toBe(true);
  });
});

describe("сервер хранилища с включённым сервисом кодов", () => {
  it("без токена «кто я» просит код, а остальное закрыто", async () => {
    const me = await request(app).get("/api/org/me").set(as(100, "Владелец"));
    expect(me.status).toBe(200);
    expect(me.body.needsCode).toBe(true);
    expect(me.body.tabs).toEqual([]);
    const ws = await request(app).get("/api/workspace").set(as(100, "Владелец"));
    expect(ws.status).toBe(401);
    expect(ws.body.needsCode).toBe(true);
  });

  it("с токеном узнаёт человека по подписи и говорит его план", async () => {
    const r0 = await register("pro", "stars");
    await handle("POST", "/internal/paid", { id: r0.payment.id });
    const r = { ...r0, ...(await handle("POST", "/token", { key: r0.key })).body };
    const me = await request(app).get("/api/org/me")
      .set(as(100, "Владелец")).set("X-User-Token", r.token);
    expect(me.status).toBe(200);
    expect(me.body.needsCode).toBeUndefined();
    expect(me.body.isOwner).toBe(true);
    expect(me.body.plan).toBe("pro");
    expect(me.body.code).toMatchObject({ uid: r.uid, plan: "pro", planId: "pro" });
    expect(Date.parse(me.body.code.until)).toBeGreaterThan(Date.now());
    expect(me.body.planTabs).toEqual(PLAN_TABS.pro);
    // Отозванный — не проходит.
    await request(app).get("/api/workspace").set(as(100)).set("X-User-Token", r.token).expect(200);
    await request(app).get("/api/workspace").set(as(100)).set("X-User-Token", `${r.token}x`).expect(401);
  });

  it("вкладки плана из панели едут в токене и приходят в «кто я»", async () => {
    await savePlan("free", { tabs: ["me", "scheme:edit"] });
    const r = await register();
    expect(r.tabs).toEqual(["me", "scheme", "scheme:edit"]);
    expect(decodeToken(r.token).tabs).toEqual(["me", "scheme", "scheme:edit"]);
    const me = await request(app).get("/api/org/me")
      .set(as(100, "Владелец")).set("X-User-Token", r.token);
    expect(me.body.planTabs).toEqual(["me", "scheme", "scheme:edit"]);
  });

  it("код ведёт к той же записи с любого Telegram", async () => {
    const r = await register();
    const first = await request(app).get("/api/org/me")
      .set(as(100, "Владелец")).set("X-User-Token", r.token);
    expect(first.body.id).toBe("100");
    const other = await request(app).get("/api/org/me")
      .set(as(200, "Он же с телефона")).set("X-User-Token", r.token);
    expect(other.body.id).toBe("100");
    expect(other.body.isOwner).toBe(true);
    const links = JSON.parse(await fs.readFile(path.join(process.env.ORG_DIR, "identity.json"), "utf8"));
    expect(links.links[0]).toMatchObject({ uid: r.uid, id: "100", tg: ["100", "200"] });
  });

  it("сервис доступен через /api/codes без подписи, список отозванных — нет", async () => {
    const reg = await request(app).post("/api/codes/register").send({ plan: "free" });
    expect(reg.status).toBe(201);
    expect(reg.body.key).toBeTruthy();
    const tok = await request(app).post("/api/codes/token").send({ key: reg.body.key });
    expect(tok.status).toBe(200);
    await request(app).get("/api/codes/public-key").expect(200);
    await request(app).get("/api/codes/revoked").expect(404);
  });
});
