import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let app;
let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sd-scenarios-"));
  process.env.SCENARIOS_DIR = tmpDir;
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../app.js");
  app = createApp();
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("scenarios API (dev-режим, без Telegram initData)", () => {
  it("отвечает на /api/health и сообщает, включено ли серверное хранилище", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Без TELEGRAM_BOT_TOKEN серверное хранилище выключено — фронтенд по
    // этому флагу уходит в облако Telegram.
    expect(res.body.scenarios).toBe(false);
  });

  it("при заданном токене бота health сообщает scenarios: true", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:TEST";
    try {
      const res = await request(app).get("/api/health");
      expect(res.body.scenarios).toBe(true);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });

  it("начинает с пустого списка", async () => {
    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("сохраняет, находит в списке, загружает и удаляет сценарий", async () => {
    const payload = { name: "Тестовый сценарий", data: { entities: [], traits: [], edges: [] } };

    const created = await request(app).post("/api/scenarios").send(payload);
    expect(created.status).toBe(201);
    expect(created.body.name).toBe(payload.name);
    expect(created.body.id).toBeTruthy();

    const list = await request(app).get("/api/scenarios");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.body.id);

    const loaded = await request(app).get(`/api/scenarios/${created.body.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data).toEqual(payload.data);

    const updated = await request(app)
      .put(`/api/scenarios/${created.body.id}`)
      .send({ name: "Переименовано", data: payload.data });
    expect(updated.status).toBe(200);
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.name).toBe("Переименовано");

    const del = await request(app).delete(`/api/scenarios/${created.body.id}`);
    expect(del.status).toBe(204);

    const listAfter = await request(app).get("/api/scenarios");
    expect(listAfter.body).toHaveLength(0);
  });

  it("отклоняет сохранение без имени", async () => {
    const res = await request(app).post("/api/scenarios").send({ data: {} });
    expect(res.status).toBe(400);
  });

  it("возвращает 404 для несуществующего id", async () => {
    const res = await request(app).get("/api/scenarios/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("не позволяет обойти каталог через id с ../", async () => {
    const res = await request(app).get("/api/scenarios/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(404);
  });
});

describe("scenarios API требует initData в production", () => {
  it("отклоняет запрос без initData, когда NODE_ENV=production", async () => {
    // middleware/telegramUser.js читает process.env.NODE_ENV на каждый запрос,
    // так что достаточно переключить окружение вокруг одного вызова.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).get("/api/scenarios");
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});

describe("какая схема открывалась последней", () => {
  /* Приложение открывается на той схеме, с которой работали в прошлый раз.
     Помнить это только в браузере нельзя: сценарии лежат на сервере, а
     память о них была бы в WebView, который Telegram чистит без
     предупреждения. Отметка живёт рядом с самим сценарием. */
  const make = (name) => request(app).post("/api/scenarios")
    .send({ name, data: { entities: [] } });

  it("отметка об открытии ставится и видна в списке", async () => {
    const { body: a } = await make("первая");
    const res = await request(app).post(`/api/scenarios/${a.id}/open`).send();
    expect(res.status).toBe(200);
    expect(res.body.openedAt).toBeTruthy();

    const list = await request(app).get("/api/scenarios");
    expect(list.body.find((s) => s.id === a.id).openedAt).toBe(res.body.openedAt);
  });

  it("сохранение — тоже работа со схемой: отметка обновляется", async () => {
    const { body: a } = await make("вторая");
    expect(a.openedAt).toBeTruthy();
    expect(a.openedAt).toBe(a.savedAt);
  });

  it("отметить несуществующую схему нельзя — это 404, а не тихий успех", async () => {
    const res = await request(app).post("/api/scenarios/нет-такой/open").send();
    expect(res.status).toBe(404);
  });
});

describe("версии сценария (владелец, 2026-09-19)", () => {
  it("каждое сохранение — версия; версия отдаётся снимком, удаление уносит и её", async () => {
    const first = await request(app).post("/api/scenarios")
      .send({ name: "Схема версий", data: { entities: [{ id: "e1", name: "Первый" }] } });
    expect(first.status).toBe(201);
    const id = first.body.id;
    const second = await request(app).post("/api/scenarios")
      .send({ id, name: "Схема версий", data: { entities: [{ id: "e1", name: "Второй" }] } });
    expect(second.status).toBe(201);

    const list = await request(app).get(`/api/scenarios/${id}/versions`);
    expect(list.status).toBe(200);
    expect(list.body.map((v) => v.v)).toEqual([1, 2]);

    const v1 = await request(app).get(`/api/scenarios/${id}/versions/1`);
    expect(v1.body.data.entities[0].name).toBe("Первый");
    const v2 = await request(app).get(`/api/scenarios/${id}/versions/2`);
    expect(v2.body.data.entities[0].name).toBe("Второй");
    expect((await request(app).get(`/api/scenarios/${id}/versions/9`)).status).toBe(404);

    await request(app).delete(`/api/scenarios/${id}`);
    expect((await request(app).get(`/api/scenarios/${id}/versions`)).status).toBe(404);
  });
});
