import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/* ═══════════════════════════════════════════════════════════════
   КТО МОЖЕТ ВОЙТИ В ЗВОНОК

   Главное требование владельца: по ссылке звонок открывается у любого,
   кому она попала, — без регистрации в боте и вообще без Telegram. При
   этом заводить встречи и видеть их список по-прежнему может только свой.

   Проверяется на боевом режиме: с токеном бота и NODE_ENV=production,
   ровно как на сервере. В dev-режиме все запросы приходят от одного
   «разработчика», и различить своего и гостя было бы нечем.
   ═══════════════════════════════════════════════════════════════ */

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
const GUEST = "b7f1c2d3e4a5b6c7";
const asGuest = { "X-Call-Guest": GUEST };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-callaccess-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN,
    owner: process.env.OWNER_TELEGRAM_ID, turn: process.env.TURN_URL };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.CALLS_DIR = path.join(tmp, "calls");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TURN_URL = "turn:example.test:3478";
  delete process.env.OWNER_TELEGRAM_ID;
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  if (prev.owner === undefined) delete process.env.OWNER_TELEGRAM_ID;
  else process.env.OWNER_TELEGRAM_ID = prev.owner;
  if (prev.turn === undefined) delete process.env.TURN_URL;
  else process.env.TURN_URL = prev.turn;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.CALLS_DIR, { recursive: true, force: true });
  const { resetRooms } = await import("../lib/callStore.js");
  resetRooms();
});

/** Встреча, заведённая владельцем (он же — первый вошедший). */
const meetingByOwner = async () => {
  const res = await request(app).post("/api/calls").set(as(100, "Хозяин"))
    .send({ title: "Разбор" });
  expect(res.status).toBe(201);
  return res.body;
};

describe("вход по ссылке", () => {
  it("гость без Telegram открывает встречу — ссылка и есть приглашение", async () => {
    const m = await meetingByOwner();
    const res = await request(app).get(`/api/calls/${m.id}`).set(asGuest);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Разбор");
  });

  it("гость получает серверы соединения — но только к существующей встрече", async () => {
    const m = await meetingByOwner();
    const ok = await request(app).get(`/api/calls/${m.id}/ice`).set(asGuest);
    expect(ok.status).toBe(200);
    expect(ok.body.turn).toBe(true);
    // TURN — наш канал: без знания id встречи его учётные данные не выдаются,
    // иначе это открытый ретранслятор за наш счёт.
    const no = await request(app).get("/api/calls/несуществующая/ice").set(asGuest);
    expect(no.status).toBe(404);
  });

  it("гость обменивается сигналами и виден в комнате", async () => {
    const m = await meetingByOwner();
    const mine = await request(app).get(`/api/calls/${m.id}`).set(asGuest);
    const alias = mine.body.me;
    expect(alias).toBeTruthy();

    const sent = await request(app).post(`/api/calls/${m.id}/signal`).set(asGuest)
      .send({ data: { type: "hello", name: "Гость" } });
    expect(sent.status).toBe(200);

    const seen = await request(app).get(`/api/calls/${m.id}/signal?since=0&wait=0`)
      .set(as(100, "Хозяин"));
    expect(seen.status).toBe(200);
    expect(seen.body.signals[0].data.type).toBe("hello");
    expect(seen.body.peers).toContain(alias);
    expect(seen.body.signals[0].from).toBe(alias);
  });

  it("участники не узнают друг о друге номеров Telegram", async () => {
    // Войти может любой со ссылкой — значит, список участников видит тоже
    // любой. Номер Telegram в нём был бы чужими личными данными.
    const m = await meetingByOwner();
    await request(app).post(`/api/calls/${m.id}/signal`).set(as(100, "Хозяин"))
      .send({ data: { type: "hello" } });

    const seen = await request(app).get(`/api/calls/${m.id}`).set(asGuest);
    const body = JSON.stringify(seen.body);
    expect(seen.body.peers).toHaveLength(1);
    expect(body).not.toContain("100");            // ни номера
    expect(body).not.toContain(GUEST);            // ни номера гостя
    expect(seen.body.me).not.toContain(GUEST);
  });

  it("не звавший себя никак — вежливый отказ, а не пустая страница", async () => {
    const m = await meetingByOwner();
    const res = await request(app).get(`/api/calls/${m.id}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/ссылк/i);
  });

  it("случайный номер гостя не сходит за встречу: чужого id мало", async () => {
    const res = await request(app).get("/api/calls/чужой-id").set(asGuest);
    expect(res.status).toBe(404);
  });
});

describe("ссылка-приглашение", () => {
  it("собирается сервером: он один знает имя бота и приложения звонка", async () => {
    process.env.BOT_NAME = "sdbot";
    process.env.TELEGRAM_CALL_APP = "call";
    try {
      const m = await meetingByOwner();
      expect(m.link).toBe(`https://t.me/sdbot/call?startapp=call_${m.id}&mode=compact`);
      const list = await request(app).get("/api/calls").set(as(100, "Хозяин"));
      expect(list.body[0].link).toBe(m.link);
    } finally {
      delete process.env.BOT_NAME;
      delete process.env.TELEGRAM_CALL_APP;
    }
  });

  it("без заведённого приложения звонка — на страницу, а не в модель", async () => {
    process.env.BOT_NAME = "sdbot";
    process.env.PUBLIC_URL = "https://x.test";
    try {
      const m = await meetingByOwner();
      expect(m.link).toBe(`https://x.test/call?call=${m.id}`);
      expect(m.link).not.toContain("t.me");
    } finally {
      delete process.env.BOT_NAME;
      delete process.env.PUBLIC_URL;
    }
  });
});

describe("что гостю не разрешено", () => {
  it("список встреч гостю не отдаётся", async () => {
    await meetingByOwner();
    const res = await request(app).get("/api/calls").set(asGuest);
    expect(res.status).toBe(401);
  });

  it("завести встречу гость не может", async () => {
    const res = await request(app).post("/api/calls").set(asGuest).send({ title: "Своя" });
    expect(res.status).toBe(401);
  });

  it("удалить чужую встречу гость не может", async () => {
    const m = await meetingByOwner();
    const res = await request(app).delete(`/api/calls/${m.id}`).set(asGuest);
    expect(res.status).toBe(401);
    expect((await request(app).get(`/api/calls/${m.id}`).set(asGuest)).status).toBe(200);
  });

  it("человек с Telegram, но не позванный в модель, встреч не заводит", async () => {
    await meetingByOwner();                       // владельцем стал 100
    const res = await request(app).post("/api/calls").set(as(777, "Посторонний"))
      .send({ title: "Своя" });
    expect(res.status).toBe(403);
  });
});

describe("посторонний со ссылкой не становится владельцем", () => {
  it("вход в комнату не заводит запись о владельце", async () => {
    // Прежде каждый маршрут звонка проходил через identify(), а тот
    // назначает владельцем первого встречного, если владелец не задан.
    // По ссылке на звонок приходит кто угодно — и становился бы хозяином
    // всей модели.
    const { createMeeting } = await import("../lib/callStore.js");
    const m = await createMeeting({ title: "Разбор", by: "100" });
    const orgFile = path.join(process.env.ORG_DIR, "org.json");
    expect(fsSync.existsSync(orgFile)).toBe(false);

    for (const req of [
      request(app).get(`/api/calls/${m.id}`).set(as(777, "Посторонний")),
      request(app).get(`/api/calls/${m.id}/ice`).set(as(777, "Посторонний")),
      request(app).post(`/api/calls/${m.id}/signal`).set(as(777, "Посторонний"))
        .send({ data: { type: "hello" } }),
    ]) expect((await req).status).toBe(200);

    expect(fsSync.existsSync(orgFile)).toBe(false);
  });
});
