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
  it("отвечает на /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
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
