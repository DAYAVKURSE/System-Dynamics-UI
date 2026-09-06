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
  traits: [{ id: "t1", e: "e1", l: "заявка" }, { id: "t2", e: "e1", l: "макет" }],
  funcs: [{ id: "f1", e: "e1", name: "Собрать макет", dur: 1, durHi: 1, durUnit: "дн",
    takes: [{ id: "p1", trait: "t1", lo: 1, hi: 1 }],
    gives: [{ id: "g1", trait: "t2", lo: 1, hi: 1 }] }],
  tasks: [
    { id: "tk1", funcId: "f1", title: "Макет главной", status: "done", assignee: "200",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 4,
        takes: { t1: 1 }, gives: { t2: 1 }, text: "готово",
        file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }] },
    { id: "tk2", funcId: "f1", title: "Ещё не принято", status: "review", assignee: "200",
      submissions: [{ id: "s2", at: "2026-02-02T10:00:00Z", hours: 2,
        takes: { t1: 1 }, gives: { t2: 1 }, text: "жду проверки" }] },
  ],
  // Раздел называет две вещи: с какого ресурса и до какого звена.
  reports: [
    { id: "rp1", parent: null, name: "Заказ «Сайт»", trait: "", upto: "" },
    { id: "rs1", parent: "rp1", name: "Макеты", trait: "t1", upto: "" },
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

/* Раздел, где прослеживают ОПРЕДЕЛЁННЫЕ вещи. Снимок, как и экран,
   показывает работу по ним, а не весь поток по функциям цепочки: чужая
   работа над другими вещами заказчика не касается и в отчёт не идёт. */
const pickUnits = (units) => request(app).put("/api/workspace").set(as(100))
  .send({ model: { ...MODEL,
    reports: [MODEL.reports[0], { ...MODEL.reports[1], units }] } });

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

  it("в снимке — то же, что и на экране: оценка, шаги, созданное и факт", async () => {
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: "200", name: "Иван", roleId: "worker" });
    await pickUnits(["s1~t2", "s2~t2"]);
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    const b = got.snapshot.block;
    // С какого ресурса и до какого звена — словами, а не идентификаторами.
    expect(b.from).toBe("заявка");
    expect(b.upto).toBe("");
    // Предварительная оценка посчитана сервером, а не принята от браузера.
    expect(b.plan.steps).toHaveLength(1);
    // Выбраны две вещи — значит два выполнения, а не одно на двоих.
    expect(b.plan.steps[0]).toMatchObject({ name: "Собрать макет", runs: 2 });
    // Два выполнения по дню идут друг за другом: два дня, а не один.
    expect(b.plan.calendarHours[1]).toBe(48);
    // Созданное — с номером, именем и файлом.
    expect(b.made).toHaveLength(1);
    expect(b.made[0]).toMatchObject({ no: 1, title: "Макет главной",
      trait: "макет", by: "Иван" });
    expect(b.made[0].file.url).toBe("/api/reports/x/y");
    // Факт — только по принятым сдачам.
    expect(b.actual).toMatchObject({ done: 1, total: 2, hours: 4 });
  });

  it("непринятая сдача в числа не идёт: это заявление, а не результат", async () => {
    await pickUnits(["s1~t2", "s2~t2"]);
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    expect(got.snapshot.block.made.map((r) => r.title)).not.toContain("Ещё не принято");
    // Но и не пропадает: заказчик видит, что работа идёт.
    expect(got.snapshot.block.tasks.map((t) => t.title)).toContain("Ещё не принято");
  });

  it("вещь не выбрана — наружу уходит вся работа цепочки, а не пустота", async () => {
    /* Выбраны определённые единицы — снаружи видна работа только по ним:
       заказчик спросил про своё задание, и чужие выполнения тех же функций
       он прочитал бы как работу по нему.

       Не выбрано ничего — вопрос другой: «что вообще делается по этой
       цепочке». Отвечать на него пустотой нельзя: задачи есть, вещи из них
       вышли, часы посчитаны. Прогноз при этом остаётся прогнозом на
       гипотетические единицы — и так и подписан. Правило то же, что в
       приложении. */
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    const b = got.snapshot.block;
    expect(b.hypothetical).toBe(true);
    expect(b.tasks.map((t) => t.title)).toContain("Макет главной");
    expect(b.made.map((r) => r.title)).toContain("Макет главной");
    expect(b.actual.done).toBeGreaterThan(0);
    // Созданное лежит и у своего шага: шаг — это раздел, и в нём оно первое.
    expect(b.plan.steps[0].made.map((r) => r.title)).toContain("Макет главной");
    // У шага есть якорь: ссылка снаружи ведёт в то же место, что и внутри.
    expect(b.plan.steps[0].anchor).toBe("shag-rs1-f1");
    // Оценка при этом считается: прогноз — то, ради чего раздел и заводят.
    expect(b.plan.steps).toHaveLength(1);
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

  it("снимок по одной единице показывает её и то, что из неё выросло", async () => {
    /* Заказчик спрашивает не «покажи всё», а «что с моим заданием». */
    await request(app).put("/api/workspace").set(as(100)).send({ model: {
      ...MODEL,
      reports: [MODEL.reports[0],
        { ...MODEL.reports[1], trait: "t2", unit: "s1~t2" }] } });
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    const b = got.snapshot.block;
    expect(b.unit).toMatchObject({ no: 1, trait: "макет" });
    // Родословную никто не записывал — снимок об этом честно говорит.
    expect(b.traced).toBe(false);
    expect(b.made.map((r) => r.no)).toEqual([1]);
  });

  it("у созданного есть номер — тот же, каким его зовут внутри", async () => {
    await pickUnits(["s1~t2", "s2~t2"]);
    const { body } = await share("rs1");
    const { body: got } = await request(app).get(`/api/shares/${body.token}`);
    expect(got.snapshot.block.made[0].no).toBe(1);
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
