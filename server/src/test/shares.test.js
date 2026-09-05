import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ССЫЛКИ НА БЛОКИ КАРТЫ ОТЧЁТОВ.

   Отчёт нужен не себе: заказчику показывают, что сделано по его заданию, —
   ссылкой, без аккаунта и без приглашения в модель. Поэтому чтение по
   токену открыто, а заводит и отзывает ссылки только владелец. */

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

const MODEL = {
  entities: [{ id: "e1", name: "Мы" }],
  traits: [{ id: "t2", e: "e1", l: "макет" }],
  funcs: [{ id: "f1", e: "e1", name: "Собрать макет" }],
  tasks: [
    { id: "tk1", funcId: "f1", title: "Макет главной", status: "done", assignee: "200",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 4,
        takes: {}, gives: { t2: 1 }, text: "готово",
        file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }] },
    { id: "tk2", funcId: "f1", title: "Ещё не принято", status: "review", assignee: "200",
      submissions: [{ id: "s2", at: "2026-02-02T10:00:00Z", hours: 2,
        takes: {}, gives: { t2: 1 }, text: "жду проверки" }] },
  ],
  reports: [
    { id: "rp1", parent: null, name: "Заказ «Сайт»", brief: "сделать сайт", picks: [] },
    { id: "rs1", parent: "rp1", name: "Макеты", brief: "",
      picks: [{ id: "pk1", func: "f1", trait: "t2" }] },
  ],
};

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-shares-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.SHARES_DIR = path.join(tmp, "shares");
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
beforeEach(async () => {
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
  await fs.rm(process.env.SHARES_DIR, { recursive: true, force: true });
  await request(app).get("/api/org/me").set(as(100, "Владелец"));
  await request(app).put("/api/workspace").set(as(100)).send({ model: MODEL });
});

const share = (node) => request(app).post("/api/shares").set(as(100)).send({ node });

describe("кто заводит ссылки", () => {
  it("владелец заводит ссылку на блок и получает токен", async () => {
    const res = await share("rs1");
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.name).toBe("Макеты");
  });

  it("на один блок — одна ссылка: иначе отзыв доступа стал бы угадыванием", async () => {
    const a = await share("rs1");
    const b = await share("rs1");
    expect(b.body.token).toBe(a.body.token);
  });

  it("никто, кроме владельца, ссылок не заводит", async () => {
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: "200", name: "Иван", roleId: "worker" });
    expect((await request(app).post("/api/shares").set(as(200)).send({ node: "rs1" }))
      .status).toBe(403);
  });

  it("ссылку на несуществующий блок заводить не на что", async () => {
    expect((await share("нет-такого")).status).toBe(404);
  });
});

describe("что видно по ссылке", () => {
  it("открывается без подписи — в этом и смысл ссылки", async () => {
    const { body } = await share("rs1");
    const res = await request(app).get(`/api/shares/${body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.snapshot.block.name).toBe("Макеты");
  });

  it("в снимке — сделанное с именами, а не идентификаторы модели", async () => {
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: "200", name: "Иван", roleId: "worker" });
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    const rows = got.snapshot.block.results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Макет главной", func: "Собрать макет",
      trait: "макет", by: "Иван", hours: 4, qty: 1 });
    expect(rows[0].file.url).toBe("/api/reports/x/y");
  });

  it("непринятая сдача наружу не идёт: это заявление, а не результат", async () => {
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    expect(got.snapshot.block.results.map((r) => r.title)).not.toContain("Ещё не принято");
  });

  it("технического задания в снимке нет — только путь и сами результаты", async () => {
    /* Заказ, описанный полем, — пересказ, а наружу должно уходить то, что
       и правда сделано. Куда попал человек, говорит путь по карте. */
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    expect(got.snapshot.brief).toBeUndefined();
    expect(got.snapshot.block.brief).toBeUndefined();
    expect(got.snapshot.path).toEqual(["Заказ «Сайт»", "Макеты"]);
  });

  it("у результата есть номер — тот же, каким его зовут внутри", async () => {
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    expect(got.snapshot.block.results[0].no).toBe(1);
  });

  it("вложенные разделы едут вместе с блоком", async () => {
    const { body } = await share("rp1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    expect(got.snapshot.block.sections.map((s) => s.name)).toEqual(["Макеты"]);
  });

  it("чужой токен ничего не открывает", async () => {
    expect((await request(app).get(`/api/shares/${"a".repeat(64)}`)).status).toBe(404);
    expect((await request(app).get("/api/shares/коротышка")).status).toBe(404);
  });
});

describe("отзыв доступа", () => {
  it("удалённая ссылка перестаёт открываться сразу", async () => {
    const { body } = await share("rs1");
    expect((await request(app).delete(`/api/shares/${body.token}`).set(as(100)))
      .status).toBe(204);
    expect((await request(app).get(`/api/shares/${body.token}`)).status).toBe(404);
  });

  it("убрать ссылку может только владелец", async () => {
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: "200", name: "Иван", roleId: "worker" });
    const { body } = await share("rs1");
    expect((await request(app).delete(`/api/shares/${body.token}`).set(as(200)))
      .status).toBe(403);
  });

  it("владельцу видно, что вообще открыто наружу", async () => {
    await share("rs1");
    const res = await request(app).get("/api/shares").set(as(100));
    expect(res.body.shares).toHaveLength(1);
    expect(res.body.shares[0]).toMatchObject({ node: "rs1", name: "Макеты" });
    // Снимок в списке не отдаём: список — про то, что открыто, а не про
    // содержимое каждой ссылки.
    expect(res.body.shares[0].snapshot).toBeUndefined();
  });
});
