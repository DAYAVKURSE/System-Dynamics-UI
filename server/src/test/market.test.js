import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* РЫНОК УСЛУГ: заказы всем, отклики двоим, бриф — «Договорились» →
   «Есть предложение» → принять, сделка заводит задачу исполнителю. */

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
const NAMES = { 100: "Владелец", 200: "Заказчик", 300: "Мастер", 400: "Третий" };
const as = (id, name = NAMES[id]) => ({ "X-Telegram-Init-Data": initDataFor(id, name) });

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-market-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.MARKET_DIR = path.join(tmp, "market");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  await fs.rm(tmp, { recursive: true, force: true });
});

const { addRole, addUser } = await import("../lib/orgStore.js");
const { readModel, writeModel } = await import("../lib/workspaceStore.js");
const { aliasOf } = await import("../lib/alias.js");

let role;
beforeEach(async () => {
  for (const d of ["ORG_DIR", "WORKSPACE_DIR", "MARKET_DIR"]) {
    await fs.rm(process.env[d], { recursive: true, force: true });
  }
  await request(app).get("/api/org/me").set(as(100, "Владелец"));
  role = await addRole({ name: "подрядчик", tabs: ["tasks"] });
  await addUser({ id: "200", name: "Заказчик", roleId: role.id, addedBy: "100" });
  await addUser({ id: "300", name: "Мастер", roleId: role.id, addedBy: "100" });
});

const order = (who = 200, fields = {}) => request(app).post("/api/market/orders").set(as(who))
  .send({ name: "Сайт-визитка", text: "три страницы", price: 30000,
    resources: [{ name: "логотип", qty: 1 }, { name: "тексты", qty: 3 }], ...fields });

describe("заказы и услуги", () => {
  it("незваному рынка нет; позванный оставляет заказ, и его видят все", async () => {
    expect((await request(app).get("/api/market").set(as(999))).status).toBe(403);
    const r = await order();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "Сайт-визитка", price: 30000, status: "open", by: "200",
      resources: [{ name: "логотип", qty: 1 }, { name: "тексты", qty: 3 }] });
    const seen = await request(app).get("/api/market").set(as(300));
    expect(seen.body.orders.map((o) => o.name)).toEqual(["Сайт-визитка"]);
    /* Вместе они не работают — значит, незнакомы: автор представлен
       двумя словами, а не именем (владелец, 2026-09-20). */
    expect(seen.body.people["200"]).toBe(aliasOf("200"));
    expect(seen.body.faces["200"]).toEqual({ avatar: "", anon: true });
    expect(seen.body.me).toBe("300");
  });

  it("без названия заказа нет; правит и удаляет автор, удаляет и владелец", async () => {
    expect((await order(200, { name: "" })).status).toBe(400);
    const o = (await order()).body;
    expect((await request(app).put(`/api/market/orders/${o.id}`).set(as(300)).send({ name: "чужой" })).status).toBe(403);
    const upd = await request(app).put(`/api/market/orders/${o.id}`).set(as(200)).send({ name: "Лендинг", price: "25 000" });
    expect(upd.body.name).toBe("Лендинг");
    expect(upd.body.price).toBe(null);
    expect((await request(app).delete(`/api/market/orders/${o.id}`).set(as(300))).status).toBe(403);
    expect((await request(app).delete(`/api/market/orders/${o.id}`).set(as(100))).status).toBe(204);
  });

  it("услуга: название, описание, берёт, выдаёт, срок, функция", async () => {
    const r = await request(app).post("/api/market/services").set(as(300)).send({
      name: "Вёрстка", text: "по макету", takes: [{ name: "макет", qty: 1 }],
      gives: [{ name: "страница", qty: 3 }], days: 5, funcId: "f_1" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "Вёрстка", days: 5, funcId: "f_1", by: "300" });
    const list = await request(app).get("/api/market").set(as(200));
    expect(list.body.services).toHaveLength(1);
    expect((await request(app).put(`/api/market/services/${r.body.id}`).set(as(200)).send({ name: "x" })).status).toBe(403);
  });
});

describe("отклики, чат, бриф, сделка", () => {
  it("отклик видят только заказчик и его автор; на свой заказ не откликаются", async () => {
    const o = (await order()).body;
    expect((await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(200)).send({ text: "сам" })).status).toBe(400);
    const off = await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(300)).send({ text: "сделаю за 4 дня" });
    expect(off.status).toBe(201);
    await addUser({ id: "400", name: "Третий", roleId: role.id, addedBy: "100" });
    const third = await request(app).get("/api/market").set(as(400));
    expect(third.body.orders[0].offers).toEqual([]);
    expect(third.body.orders[0].offerCount).toBe(1);
    const owner = await request(app).get("/api/market").set(as(200));
    expect(owner.body.orders[0].offers).toHaveLength(1);
    expect(owner.body.people["300"]).toBe(aliasOf("300"));
    // Повторный отклик того же человека — правка первого, а не второй.
    await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(300)).send({ text: "за 3 дня" });
    const again = await request(app).get("/api/market").set(as(300));
    expect(again.body.orders[0].offers).toHaveLength(1);
    expect(again.body.orders[0].offers[0].text).toBe("за 3 дня");
  });

  it("чат — между двумя сторонами; третьему — отказ", async () => {
    const o = (await order()).body;
    const off = (await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(300)).send({ text: "могу" })).body;
    const url = `/api/market/orders/${o.id}/offers/${off.id}/chat`;
    expect((await request(app).post(url).set(as(200)).send({ text: "когда?" })).status).toBe(200);
    expect((await request(app).post(url).set(as(300)).send({ text: "завтра" })).body.chat.map((c) => c.text))
      .toEqual(["когда?", "завтра"]);
    expect((await request(app).post(url).set(as(100)).send({ text: "я владелец" })).status).toBe(403);
    expect((await request(app).post(url).set(as(200)).send({ text: "  " })).status).toBe(400);
  });

  it("бриф пишет любая сторона, принимает другая; сделка заводит задачу исполнителю", async () => {
    const o = (await order()).body;
    const svc = (await request(app).post("/api/market/services").set(as(300))
      .send({ name: "Вёрстка", funcId: "f_1", days: 5 })).body;
    const off = (await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(300))
      .send({ text: "могу", serviceId: svc.id })).body;
    const base = `/api/market/orders/${o.id}/offers/${off.id}`;
    // Принять до брифа нельзя.
    expect((await request(app).post(`${base}/accept`).set(as(200))).status).toBe(400);
    const brief = await request(app).put(`${base}/brief`).set(as(200))
      .send({ gives: [{ name: "логотип", qty: 1 }], gets: { name: "сайт", qty: 1 }, days: 4 });
    expect(brief.status).toBe(200);
    expect(brief.body.brief).toMatchObject({ by: "200", rev: 1, days: 4 });
    // Своё предложение не принимают.
    expect((await request(app).post(`${base}/accept`).set(as(200))).status).toBe(400);
    // Правка другой стороной — новая версия за ней.
    const edit = await request(app).put(`${base}/brief`).set(as(300))
      .send({ gives: [{ name: "логотип", qty: 1 }], gets: { name: "сайт", qty: 1 }, days: 6 });
    expect(edit.body.brief).toMatchObject({ by: "300", rev: 2, days: 6 });
    const acc = await request(app).post(`${base}/accept`).set(as(200));
    expect(acc.status).toBe(200);
    expect(acc.body.offer.accepted).toBe(true);
    expect(acc.body.task).toMatchObject({ funcId: "f_1", title: "Сайт-визитка", status: "backlog",
      setter: "200", assignee: "300", reviewer: "200", endBy: "hand" });
    expect(acc.body.task.body).toContain("Заказчик отдаёт: логотип × 1");
    // Задача — в модели владельца, и исполнитель видит её в своём срезе.
    const model = await readModel();
    expect(model.tasks.map((t) => t.id)).toContain(acc.body.task.id);
    const ws = await request(app).get("/api/workspace").set(as(300));
    expect(ws.body.tasks.map((t) => t.id)).toContain(acc.body.task.id);
    // Заказ закрыт для новых откликов и правок брифа.
    const m = await request(app).get("/api/market").set(as(200));
    expect(m.body.orders[0].status).toBe("deal");
    expect((await request(app).put(`${base}/brief`).set(as(300)).send({ days: 1, gets: { name: "x" } })).status).toBe(400);
    expect((await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(100)).send({ text: "поздно" })).status).toBe(400);
  });

  it("ресурсы по сделке загружает заказчик, и только после сделки", async () => {
    const o = (await order()).body;
    const off = (await request(app).post(`/api/market/orders/${o.id}/offers`).set(as(300)).send({ text: "могу" })).body;
    const base = `/api/market/orders/${o.id}/offers/${off.id}`;
    expect((await request(app).post(`${base}/deliveries`).set(as(200)).send({ name: "логотип" })).status).toBe(400);
    await request(app).put(`${base}/brief`).set(as(300)).send({ gets: { name: "сайт" }, days: 2 });
    await request(app).post(`${base}/accept`).set(as(200));
    expect((await request(app).post(`${base}/deliveries`).set(as(300)).send({ name: "логотип" })).status).toBe(403);
    const d = await request(app).post(`${base}/deliveries`).set(as(200))
      .send({ name: "логотип", file: { id: "r1", name: "logo.png", url: "/api/reports/x/r1" } });
    expect(d.status).toBe(200);
    expect(d.body.deliveries[0]).toMatchObject({ name: "логотип", file: { id: "r1", name: "logo.png" } });
    // Исполнитель видит, что ему отдали.
    const seen = await request(app).get("/api/market").set(as(300));
    expect(seen.body.orders[0].offers[0].deliveries).toHaveLength(1);
  });
});

/* ─────── КТО ЗДЕСЬ ЗНАКОМ (владелец, 2026-09-20) ───────

   На рынке автор, с которым смотрящий вместе не работает, представляется
   двумя словами, и лица у него нет — вместо него приложение показывает
   свой знак. Знаком — тот, кто виден в рабочей области. */
describe("имя и лицо автора", () => {
  it("владельцу видны все имена: модель его", async () => {
    await order(200);
    const seen = await request(app).get("/api/market").set(as(100));
    expect(seen.body.people["200"]).toBe("Заказчик");
    expect(seen.body.faces["200"].anon).toBe(false);
  });

  it("свою запись человек видит своим именем", async () => {
    await order(200);
    const seen = await request(app).get("/api/market").set(as(200));
    expect(seen.body.people["200"]).toBe("Заказчик");
  });

  it("с кем работаешь вместе — тот с именем и лицом", async () => {
    /* Одна задача на двоих — и они уже не чужие: тот же список людей, по
       которому рабочая область решает, чьи имена показывать. */
    const model = await readModel();
    await writeModel({ ...model,
      tasks: [{ id: "tk1", title: "Вместе", status: "progress",
        setter: "200", assignee: "300", reviewer: "200", submissions: [] }] });
    await order(200);
    const seen = await request(app).get("/api/market").set(as(300));
    expect(seen.body.people["200"]).toBe("Заказчик");
    expect(seen.body.faces["200"].anon).toBe(false);
  });

  it("два слова у одного человека всегда одни и те же", async () => {
    expect(aliasOf("200")).toBe(aliasOf("200"));
    expect(aliasOf("200")).not.toBe(aliasOf("201"));
    expect(aliasOf("200").split(" ")).toHaveLength(2);
  });

  it("страница автора: незнакомому — два слова и без лица, остальное то же",
    async () => {
      await request(app).put("/api/org/me/profile").set(as(200))
        .send({ about: "делаю сайты", avatar: "/api/reports/ab/cd" });
      const far = await request(app).get("/api/market/people/200").set(as(300));
      expect(far.status).toBe(200);
      expect(far.body.name).toBe(aliasOf("200"));
      expect(far.body.anon).toBe(true);
      expect(far.body.avatar).toBe("");
      // Всё остальное на странице — как у воркера: анкета на месте.
      expect(far.body.profile.about).toBe("делаю сайты");
      expect(far.body.profile.name).toBe(aliasOf("200"));

      const near = await request(app).get("/api/market/people/200").set(as(100));
      expect(near.body.name).toBe("Заказчик");
      expect(near.body.anon).toBe(false);
      expect(near.body.avatar).toBe("/api/reports/ab/cd");
    });

  it("нет такого человека — так и сказано", async () => {
    expect((await request(app).get("/api/market/people/777").set(as(300))).status).toBe(404);
  });
});
