import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ОБ ОШИБКАХ (владелец, 2026-09-21)

   «Кнопка со значком восклицательного знака… модальное окно с просьбой
   „Напишите сообщение об ошибке"… вкладка „issues", где будут в списке
   показаны отправленные пользователями сообщения, и кнопка „Удалить"
   рядом с каждым».

   Отсюда и проверки: написать может любой позванный; список и удаление —
   у того, кому открыта вкладка; пустое сообщение не принимается; имя
   автора подставляется при ответе, а не хранится.
   ════════════════════════════════════════════════════════════════ */

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
const NAMES = { 100: "Владелец", 200: "Иван", 300: "Чужой" };
const as = (id) => ({ "X-Telegram-Init-Data": initDataFor(id, NAMES[id]), "X-Storage": "main" });

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-issues-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.ISSUES_DIR = path.join(tmp, "issues");
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

const { addUser, identify, setRoleTabs } = await import("../lib/orgStore.js");

beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.ISSUES_DIR, { recursive: true, force: true });
  await identify("100", { name: "Владелец" });        // 100 — владелец
  await addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
});

describe("сообщения об ошибках", () => {
  it("пишет любой позванный, и имя автора приходит в списке", async () => {
    const r = await request(app).post("/api/issues").set(as(200))
      .send({ text: "не жмётся кнопка" });
    expect(r.status).toBe(201);
    expect(r.body.text).toBe("не жмётся кнопка");
    expect(r.body.id).toMatch(/^is_/);
    // Имени в самой записи нет — только id: кто есть кто, спрашивается
    // у организации в момент ответа.
    expect(r.body.name).toBeUndefined();

    const list = await request(app).get("/api/issues").set(as(100));
    expect(list.status).toBe(200);
    expect(list.body.issues).toHaveLength(1);
    expect(list.body.issues[0]).toMatchObject({ text: "не жмётся кнопка", name: "Иван" });
  });

  it("незваный не пишет и не читает", async () => {
    expect((await request(app).post("/api/issues").set(as(300))
      .send({ text: "привет" })).status).toBe(403);
    expect((await request(app).get("/api/issues").set(as(300))).status).toBe(403);
  });

  it("пустое сообщение не принимается: жаловаться молча не на что", async () => {
    const r = await request(app).post("/api/issues").set(as(200)).send({ text: "   " });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Напишите/);
    expect((await request(app).get("/api/issues").set(as(100))).body.issues).toEqual([]);
  });

  it("новые — сверху: свежая ошибка нужнее позавчерашней", async () => {
    await request(app).post("/api/issues").set(as(200)).send({ text: "первая" });
    await request(app).post("/api/issues").set(as(100)).send({ text: "вторая" });
    const list = await request(app).get("/api/issues").set(as(100));
    expect(list.body.issues.map((x) => x.text)).toEqual(["вторая", "первая"]);
  });

  it("«Удалить» убирает одно сообщение, а не список", async () => {
    const a = await request(app).post("/api/issues").set(as(200)).send({ text: "первая" });
    await request(app).post("/api/issues").set(as(200)).send({ text: "вторая" });
    expect((await request(app).delete(`/api/issues/${a.body.id}`).set(as(100))).status).toBe(204);
    const list = await request(app).get("/api/issues").set(as(100));
    expect(list.body.issues.map((x) => x.text)).toEqual(["вторая"]);
    // Второй раз — «такого нет», и это ответ, а не поломка.
    expect((await request(app).delete(`/api/issues/${a.body.id}`).set(as(100))).status).toBe(404);
  });

  it("список и удаление — по вкладке: написавший чужих жалоб не видит", async () => {
    const mine = await request(app).post("/api/issues").set(as(200))
      .send({ text: "моя" });
    // У роли «исполнитель» названа только «Задачи» — «Инструментов» нет.
    expect((await request(app).get("/api/issues").set(as(200))).status).toBe(403);
    expect((await request(app).delete(`/api/issues/${mine.body.id}`).set(as(200))).status)
      .toBe(403);

    // Открыли вкладку роли — и список открылся вместе с ней.
    await setRoleTabs("executor", { tasks: "rw", "tools:issues": "rw" });
    const list = await request(app).get("/api/issues").set(as(200));
    expect(list.status).toBe(200);
    expect(list.body.issues.map((x) => x.text)).toEqual(["моя"]);
    expect((await request(app).delete(`/api/issues/${mine.body.id}`).set(as(200))).status)
      .toBe(204);
  });

  it("право «r» смотреть даёт, а удалять — нет", async () => {
    const a = await request(app).post("/api/issues").set(as(200)).send({ text: "моя" });
    await setRoleTabs("executor", { tasks: "rw", "tools:issues": "r" });
    expect((await request(app).get("/api/issues").set(as(200))).status).toBe(200);
    expect((await request(app).delete(`/api/issues/${a.body.id}`).set(as(200))).status).toBe(403);
  });
});
