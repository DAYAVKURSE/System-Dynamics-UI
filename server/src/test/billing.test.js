import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handle, setHooks } from "../../../codes/src/service.js";
import { resetKeys } from "../../../codes/src/store.js";
import * as billing from "../../../codes/src/billing.js";
import { setTonUsd } from "../../../codes/src/chain.js";
import { decodeComment } from "../../../codes/src/boc.js";

/* Биллинг сервиса кодов (владелец, 2026-09-21): планы, кошельки,
   платежи, подписки со сроком, напоминания, админ-панель. */

const ADMIN = "111:admin";
let tmp, prevFetch;
const sign = (id) => {
  const user = JSON.stringify({ id, first_name: "O" });
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), user };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(ADMIN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
};
const adm = (m, p, b, who = 7) => handle(m, p, b, Date.now(), { "x-admin-init-data": sign(who) });

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-billing-"));
  process.env.CODES_DIR = path.join(tmp, "codes");
  prevFetch = global.fetch;
  setHooks({ adminToken: () => ADMIN, ownerId: () => "7" });
  setTonUsd(5);
});
afterAll(async () => {
  global.fetch = prevFetch;
  delete process.env.CODES_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(process.env.CODES_DIR, { recursive: true, force: true });
  resetKeys();
});
const DAY = 86400000;

describe("планы", () => {
  it("три по умолчанию; новый — «новый план»; правка и удаление; free не удаляется", async () => {
    expect((await handle("GET", "/plans")).body.plans.map((p) => p.id)).toEqual(["free", "pro", "max"]);
    const added = (await adm("POST", "/admin/plans")).body.plan;
    expect(added).toMatchObject({ name: "новый план", price: 0, days: 30, level: "pro" });
    const saved = (await adm("PUT", `/admin/plans/${added.id}`, { name: "Команда", price: "49.5", days: "90", level: "max" })).body.plan;
    expect(saved).toMatchObject({ name: "Команда", price: 49.5, days: 90, level: "max" });
    expect((await adm("DELETE", `/admin/plans/${added.id}`)).status).toBe(200);
    expect((await adm("DELETE", "/admin/plans/free")).status).toBe(400);
    expect((await handle("GET", "/plans")).body.plans).toHaveLength(3);
  });
  /* Вкладки плана (владелец, 2026-09-21): выбираются в панели, вложенная
     тянет родителя, чужие имена — вон; не задали — по уровню. */
  it("у плана свои вкладки: по уровню, пока не выбрали; вложенная тянет родителя", async () => {
    const list = await billing.listPlans();
    expect(list.find((p) => p.id === "free").tabs).toEqual(["market", "me", "tasks"]);
    expect(list.find((p) => p.id === "max").tabs).toHaveLength(17);
    const saved = await billing.savePlan("pro", { tabs: ["tools:calls", "me", "nope"] });
    expect(saved.tabs).toEqual(["me", "tools", "tools:calls"]);
    // Правка без вкладок их не трогает.
    expect((await billing.savePlan("pro", { name: "Pro+" })).tabs).toEqual(["me", "tools", "tools:calls"]);
    expect((await billing.savePlan("pro", { tabs: [] })).tabs).toEqual([]);
  });

  it("панель — только владельцу и только с подписью админ-бота", async () => {
    expect((await handle("GET", "/admin/plans")).status).toBe(401);
    expect((await adm("GET", "/admin/plans", {}, 8)).status).toBe(403);
    expect((await adm("GET", "/admin/plans")).status).toBe(200);
  });
});

describe("кошельки и оплата", () => {
  it("без кошелька TON платить нечем; с кошельками берётся случайный; USDT один к одному, TON по курсу", async () => {
    const r = await handle("POST", "/register", { plan: "pro", method: "ton" });
    expect(r.status).toBe(400);
    await adm("POST", "/admin/wallets", { currency: "ton", name: "Первый", address: "UQA1" });
    await adm("POST", "/admin/wallets", { currency: "ton", name: "Второй", address: "UQA2" });
    await adm("POST", "/admin/wallets", { currency: "usdt", address: "UQU1" });
    expect((await handle("GET", "/plans")).body.methods).toEqual(["stars", "ton", "usdt"]);
    const seen = new Set();
    for (let i = 0; i < 12; i += 1) {
      const p = (await handle("POST", "/register", { plan: "pro", method: "ton" })).body.payment;
      seen.add(p.address);
      expect(p).toMatchObject({ currency: "TON", amount: 2, status: "pending" });
      expect(p.comment).toMatch(/^SD-[0-9A-F]{6}$/);
    }
    expect(seen).toEqual(new Set(["UQA1", "UQA2"]));
    const u = (await handle("POST", "/register", { plan: "max", method: "usdt" })).body.payment;
    expect(u).toMatchObject({ currency: "USDT", amount: 30, address: "UQU1" });
  });

  it("платёж по цепочке: тот же комментарий и сумма не меньше — подписка включена, владельцу сказано", async () => {
    await adm("POST", "/admin/wallets", { currency: "ton", address: "UQA1" });
    const reg = (await handle("POST", "/register", { plan: "pro", method: "ton", tg: { id: "500", username: "ivan" } })).body;
    const p = reg.payment;
    global.fetch = vi.fn(async (url) => ({ ok: true, json: async () => ({ transactions: [
      { hash: "h1", in_msg: { value: String(1.5e9), message_content: { decoded: { comment: p.comment } } } },
      { hash: "h2", in_msg: { value: String(2e9), message_content: { decoded: { comment: p.comment } } } },
    ] }) }));
    const told = [];
    expect(await billing.checkChain({ onPaid: (pay, user) => told.push([pay.amount, user.tg.username]) })).toBe(1);
    expect(told).toEqual([[2, "ivan"]]);
    const t = (await handle("POST", "/token", { key: reg.key })).body;
    expect(t.plan).toBe("pro");
    expect(Date.parse(t.until) - Date.now()).toBeGreaterThan(29 * DAY);
    expect((await handle("GET", `/payment/${p.id}`)).body.payment).toMatchObject({ status: "paid" });
    // Второй раз тот же платёж не включается.
    expect(await billing.checkChain()).toBe(0);
  });

  it("срок вышел — план free; напоминания за 5, 3 и 1 день по одному разу", async () => {
    const reg = (await handle("POST", "/register", { plan: "pro", method: "stars", tg: { id: "500" } })).body;
    await handle("POST", "/internal/paid", { id: reg.payment.id });
    const now = Date.now();
    const at = (daysLeft) => now + (30 - daysLeft) * DAY + 1000;
    expect((await handle("GET", "/internal/expiring", {}, at(10))).body.expiring).toEqual([]);
    const five = (await handle("GET", "/internal/expiring", {}, at(4.5))).body.expiring;
    expect(five).toHaveLength(1);
    expect(five[0]).toMatchObject({ uid: reg.uid, mark: 5, daysLeft: 5, tg: { id: "500" } });
    await handle("POST", "/internal/reminded", { uid: reg.uid, mark: 5 });
    expect((await handle("GET", "/internal/expiring", {}, at(4.5))).body.expiring).toEqual([]);
    expect((await handle("GET", "/internal/expiring", {}, at(2.5))).body.expiring[0].mark).toBe(3);
    await handle("POST", "/internal/reminded", { uid: reg.uid, mark: 3 });
    expect((await handle("GET", "/internal/expiring", {}, at(0.5))).body.expiring[0].mark).toBe(1);
    // Истекла — токен уже free.
    const t = (await handle("POST", "/token", { key: reg.key }, at(-1))).body;
    expect(t.plan).toBe("free");
  });

  it("выдать подписку по @username или id; отменить; участники с остатком дней", async () => {
    await handle("POST", "/register", { plan: "free", tg: { id: "500", username: "Ivan" } });
    const byName = await adm("POST", "/admin/issue", { user: "@ivan", planId: "max", price: "25", days: "10" });
    expect(byName.status).toBe(200);
    expect(byName.body.user).toMatchObject({ planId: "max", price: 25, days: 10 });
    expect(byName.body.user.keyHash).toBeUndefined();
    const byId = await adm("POST", "/admin/issue", { user: "500", planId: "pro" });
    expect(byId.body.user).toMatchObject({ planId: "pro", days: 30 });
    const users = (await adm("GET", "/admin/users")).body.users;
    expect(users[0]).toMatchObject({ planName: "Pro", daysLeft: 30, tg: { username: "Ivan" } });
    const w = (await adm("GET", "/admin/wallets")).body;
    expect(w.stars).toMatchObject({ currency: "XTR", balance: 0 });
    await adm("POST", `/admin/users/${users[0].uid}/cancel`);
    expect((await adm("GET", "/admin/users")).body.users[0]).toMatchObject({ planId: "free", until: null });
    // Удалить участника (владелец, 2026-09-21): из списка уходит, uid — в отозванных.
    expect((await adm("DELETE", `/admin/users/${users[0].uid}`)).status).toBe(200);
    expect((await adm("GET", "/admin/users")).body.users).toEqual([]);
    expect((await handle("GET", "/revoked")).body.uids).toContain(users[0].uid);
    expect((await adm("DELETE", "/admin/users/nope")).status).toBe(404);
  });
});

/* Ключ из панели — кому угодно (владелец, 2026-09-22): кого ещё нет,
   тому новый ключ, и подписка начинается с первого ввода ключа. */
describe("ключ, выданный из панели", () => {
  it("тому, кого ещё нет, — ключ; подписка ждёт первого ввода и начинается с него", async () => {
    const r = await adm("POST", "/admin/issue", { user: "@Petr_1", planId: "pro", price: "7", days: "10" });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(r.body.user).toMatchObject({ planId: "free", until: null,
      pending: { planId: "pro", planName: "Pro", days: 10, price: 7, for: { username: "petr_1" } } });
    // Не тот Telegram — ключ не открывается и подписку не трогает.
    const wrong = await handle("POST", "/token", { key: r.body.key, tg: { id: "900", username: "other" } });
    expect(wrong).toMatchObject({ status: 403, body: { error: "Этот ключ выдан другому пользователю Telegram." } });
    expect((await handle("POST", "/token", { key: r.body.key })).status).toBe(403);
    // Тот — подписка с этой минуты.
    const at = Date.now() + 3 * DAY;
    const ok = await handle("POST", "/token", { key: r.body.key, tg: { id: "901", username: "petr_1" } }, at);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ plan: "pro", planId: "pro" });
    expect(Math.round((Date.parse(ok.body.until) - Date.now()) / DAY)).toBe(10);
    const users = (await adm("GET", "/admin/users")).body.users;
    expect(users[0]).toMatchObject({ pending: null, planId: "pro", price: 7, tg: { id: "901" } });
    // Второй ввод — подписка не выдаётся заново.
    await handle("POST", "/token", { key: r.body.key, tg: { id: "901", username: "petr_1" } });
    const pays = (await billing.readPayments()).filter((p) => p.method === "issued");
    expect(pays).toHaveLength(1);
  });

  it("по id и без имени; уже с ключом — подписка сразу, без нового ключа; неверный ввод — объяснение", async () => {
    const byId = await adm("POST", "/admin/issue", { user: "12345", planId: "max" });
    expect(byId.body.user.pending.for).toEqual({ id: "12345" });
    expect((await handle("POST", "/token", { key: byId.body.key, tg: { id: "12345" } })).body.plan).toBe("max");
    const anyone = await adm("POST", "/admin/issue", { user: "", planId: "pro" });
    expect(anyone.body.user.pending.for).toBeNull();
    expect((await handle("POST", "/token", { key: anyone.body.key })).body.plan).toBe("pro");
    const again = await adm("POST", "/admin/issue", { user: "12345", planId: "pro" });
    expect(again.status).toBe(200);
    expect(again.body.key).toBeUndefined();
    expect(again.body.user).toMatchObject({ planId: "pro" });
    expect((await adm("POST", "/admin/issue", { user: "@a b", planId: "pro" })).body.error)
      .toBe("пользователь: @username или числовой Telegram-id");
    expect((await adm("POST", "/admin/issue", { user: "@x", planId: "nope" })).status).toBe(404);
    expect((await adm("POST", "/admin/issue", { user: "@someone", planId: "pro", days: "x" })).status).toBe(400);
  });
});

describe("комментарий из BOC", () => {
  it("текстовый комментарий читается из forward_payload jetton-перевода, чужие тела — пусто", () => {
    // Настоящий forward_payload из цепочки: «100 Telegram Stars \n\nRef#MVt».
    expect(decodeComment("te6cckEBAQEAKAAATAAAAAAxMDAgVGVsZWdyYW0gU3RhcnMgCgpSZWYjTVZ0")).toBe("100 Telegram Stars \n\nRef#MVt".trim());
    expect(decodeComment("")).toBe("");
    expect(decodeComment("not a boc")).toBe("");
  });
  it("платёж по USDT узнаётся по комментарию в forward_payload", async () => {
    await adm("POST", "/admin/wallets", { currency: "usdt", address: "UQU1" });
    const reg = (await handle("POST", "/register", { plan: "pro", method: "usdt" })).body;
    const p = reg.payment;
    // Комментарий платежа — в BOC текстового комментария: op 0 + текст.
    const text = Buffer.concat([Buffer.alloc(4), Buffer.from(p.comment, "utf8")]);
    const cell = Buffer.concat([Buffer.from([0x00, text.length * 2]), text]);
    const boc = Buffer.concat([Buffer.from("b5ee9c72", "hex"), Buffer.from([0x01, 0x01, 0x01, 0x01, 0x00, cell.length, 0x00]), cell]);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ jetton_transfers: [
      { transaction_hash: "j1", amount: String(10 * 1e6), forward_payload: boc.toString("base64") },
    ] }) }));
    expect(await billing.checkChain()).toBe(1);
    expect((await handle("GET", `/payment/${p.id}`)).body.payment.status).toBe("paid");
  });
});
