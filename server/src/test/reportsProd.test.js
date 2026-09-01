import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* Тот же API, но в боевом режиме: с токеном бота и NODE_ENV=production.
   Ровно так он и работает на сервере, и ровно здесь ломается наивная
   защита — картинку браузер грузит сам, без заголовка с подписью. */

let app;
let tmpDir;
let prevEnv;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sd-reports-prod-"));
  prevEnv = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN };
  process.env.REPORTS_DIR = tmpDir;
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  const { createApp } = await import("../app.js");
  app = createApp();
});

afterAll(async () => {
  process.env.NODE_ENV = prevEnv.node;
  if (prevEnv.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevEnv.token;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("файлы отчётов в боевом режиме", () => {
  it("загрузка без подписи Telegram отвергается", async () => {
    const res = await request(app).post("/api/reports")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("x"));
    expect(res.status).toBe(401);
  });

  it("удаление без подписи отвергается", async () => {
    const scope = "0".repeat(32);
    const res = await request(app).delete(`/api/reports/${scope}/какой-то-id`);
    expect(res.status).toBe(401);
  });

  it("чтение по ссылке подписи не требует — иначе <img src> был бы пустым",
    async () => {
      // Файл кладём мимо API: подписать запрос в тесте нечем, а проверяем
      // здесь именно путь чтения.
      const { saveReport } = await import("../lib/reportStore.js");
      const saved = await saveReport("u1", {
        name: "снимок.png", type: "image/png", bytes: Buffer.from([1, 2, 3]),
      });
      const res = await request(app).get(saved.url);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
    });
});
