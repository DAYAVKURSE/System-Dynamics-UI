import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* Проверки доступа — на боевом режиме: с токеном бота и подписью, ровно
   так, как это работает на сервере. В dev-режиме все запросы приходят от
   одного «разработчика», и различить владельца и гостя было бы нечем. */

const TOKEN = "test-token";
let app, tmp, prev;

// Подпись initData по алгоритму Telegram — иначе middleware не пропустит.
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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-access-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
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
  // Первый вошедший — владелец; делаем им 100 в каждом тесте.
  await request(app).get("/api/org/me").set(as(100, "Владелец"));
});

const MODEL = {
  entities: [{ id: "e1", name: "Я" }, { id: "e2", name: "Клиенты" }],
  traits: [{ id: "t1", e: "e1", l: "время" }, { id: "t2", e: "e2", l: "заявки" },
    { id: "t9", e: "e2", l: "тайна" }],
  edges: [{ id: "ed1", from: "e1", fromTrait: "t1", to: "t2", gives: 5 }],
  kinds: [], okrs: [], hypos: [],
  tasks: [
    { id: "tk1", goalId: "t2", edgeId: "ed1", assignee: "200", reviewer: "300",
      title: "Задача Ивана", status: "progress", submissions: [], comments: [] },
    { id: "tk9", goalId: "t9", assignee: "100", reviewer: "100",
      title: "Задача владельца", status: "backlog", submissions: [], comments: [] },
  ],
};
const saveModel = () => request(app).put("/api/workspace")
  .set(as(100)).send({ model: MODEL });
const invite = (id, roleId, name) => request(app).post("/api/org/users")
  .set(as(100)).send({ id: String(id), name, roleId });

describe("кто может звать людей", () => {
  it("владелец зовёт, и человек получает вкладки своей роли", async () => {
    expect((await invite(200, "executor", "Иван")).status).toBe(201);
    const me = await request(app).get("/api/org/me").set(as(200, "Иван"));
    expect(me.body.tabs).toEqual(["tasks"]);
    expect(me.body.isOwner).toBe(false);
  });

  it("не-владелец не может позвать никого", async () => {
    await invite(200, "executor", "Иван");
    const res = await request(app).post("/api/org/users")
      .set(as(200, "Иван")).send({ id: "400", roleId: "executor" });
    expect(res.status).toBe(403);
  });

  it("не-владелец не видит список людей и ролей", async () => {
    await invite(200, "executor", "Иван");
    expect((await request(app).get("/api/org").set(as(200))).status).toBe(403);
  });

  it("не-владелец не может завести роль и раздать себе вкладки", async () => {
    await invite(200, "executor", "Иван");
    expect((await request(app).post("/api/org/roles")
      .set(as(200)).send({ name: "Главный", tabs: ["scheme", "json"] })).status).toBe(403);
    expect((await request(app).put("/api/org/roles/executor/tabs")
      .set(as(200)).send({ tabs: ["scheme", "json"] })).status).toBe(403);
  });

  it("без подписи не проходит даже «кто я»", async () => {
    expect((await request(app).get("/api/org/me")).status).toBe(401);
  });
});

describe("что приходит с сервера", () => {
  it("исполнителю — только его задача и то, на что она ссылается", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    const res = await request(app).get("/api/workspace").set(as(200, "Иван"));

    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t) => t.id)).toEqual(["tk1"]);
    // Чужой задачи нет ни под каким ключом ответа.
    expect(JSON.stringify(res.body)).not.toContain("Задача владельца");
    expect(JSON.stringify(res.body)).not.toContain("тайна");
  });

  it("владельцу — модель целиком", async () => {
    await saveModel();
    const res = await request(app).get("/api/workspace").set(as(100));
    expect(res.body.tasks).toHaveLength(2);
  });

  it("незваному — отказ, а не пустая модель", async () => {
    await saveModel();
    expect((await request(app).get("/api/workspace").set(as(777, "Чужой"))).status)
      .toBe(403);
  });

  it("модель целиком пишет только владелец", async () => {
    await invite(200, "executor", "Иван");
    const res = await request(app).put("/api/workspace")
      .set(as(200)).send({ model: { tasks: [] } });
    expect(res.status).toBe(403);
    // И модель осталась прежней.
    await saveModel();
    expect((await request(app).get("/api/workspace").set(as(100)))
      .body.tasks).toHaveLength(2);
  });
});

describe("сдача и приём через сервер", () => {
  it("исполнитель сдаёт свою задачу", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    const res = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ amount: 4, text: "сделал" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("review");
  });

  it("чужую задачу не сдать и чужую не принять", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    expect((await request(app).post("/api/workspace/tasks/tk9/submit")
      .set(as(200)).send({ amount: 1 })).status).toBe(403);
    expect((await request(app).post("/api/workspace/tasks/tk9/review")
      .set(as(300)).send({ accept: true })).status).toBe(403);
  });

  it("проверяющий принимает — задача становится готовой", async () => {
    await saveModel();
    await invite(300, "reviewer", "Пётр");
    const res = await request(app).post("/api/workspace/tasks/tk1/review")
      .set(as(300)).send({ accept: true, comment: "принято", mark: 5 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("done");
  });

  it("исполнитель не принимает собственную сдачу", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    expect((await request(app).post("/api/workspace/tasks/tk1/review")
      .set(as(200)).send({ accept: true, comment: "ок", mark: 5 })).status).toBe(403);
  });
});

/* Анкета — единственное, что человек меняет о себе сам. Поэтому маршрут
   открыт всем позванным, а не одному владельцу: чинить свою анкету через
   владельца значило бы просить его пересказывать твои же слова. */
describe("своя анкета", () => {
  it("позванный человек пишет свою анкету, не будучи владельцем", async () => {
    await invite(200, "executor", "Иван");
    const res = await request(app).put("/api/org/me/profile")
      .set(as(200, "Иван")).send({ title: "исполнитель", skills: "верстает" });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ title: "исполнитель", skills: "верстает" });
    const me = await request(app).get("/api/org/me").set(as(200, "Иван"));
    expect(me.body.profile.skills).toBe("верстает");
  });

  it("непозванному писать нечего: его в организации нет", async () => {
    expect((await request(app).put("/api/org/me/profile")
      .set(as(777, "Чужой")).send({ title: "кто-то" })).status).toBe(403);
  });

  it("чужую анкету не переписать — маршрут только про свою", async () => {
    await invite(200, "executor", "Иван");
    await request(app).put("/api/org/me/profile").set(as(200)).send({ title: "Иван" });
    await request(app).put("/api/org/me/profile").set(as(100)).send({ title: "Владелец" });
    const org = await request(app).get("/api/org").set(as(100));
    expect(org.body.users.find((u) => u.id === "200").title).toBe("Иван");
    expect(org.body.users.find((u) => u.id === "100").title).toBe("Владелец");
  });
});
