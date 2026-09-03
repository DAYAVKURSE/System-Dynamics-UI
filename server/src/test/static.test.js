import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* Раздача фронтенда: у звонка своя страница /call, у всего остального —
   index.html. Проверяется на временном каталоге, как на сервере после деплоя. */

let tmp, prev;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-static-"));
  prev = process.env.STATIC_DIR;
  process.env.STATIC_DIR = tmp;
  await fs.writeFile(path.join(tmp, "index.html"), "<title>Схема</title>");
  await fs.writeFile(path.join(tmp, "call.html"), "<title>Звонок</title>");
});
afterAll(async () => {
  if (prev === undefined) delete process.env.STATIC_DIR; else process.env.STATIC_DIR = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("страницы", () => {
  it("/call и /call/ отдают страницу звонка", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    for (const p of ["/call", "/call/"]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Звонок");
    }
  });

  it("любой другой адрес вне /api — модель (SPA)", async () => {
    const { createApp } = await import("../app.js");
    const res = await request(createApp()).get("/что-угодно?call=m1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Схема");
  });

  it("открытия страницы звонка видны в /api/health", async () => {
    // Единственный способ отличить «страница не открылась» от «Telegram её
    // и не запрашивал»: во втором случае счётчик не сдвинется.
    const { createApp } = await import("../app.js");
    const app = createApp();
    // Счёт ведётся на весь процесс, а не на приложение: в этом файле
    // страницу уже открывали выше, поэтому смотрим прирост, а не число.
    const before = (await request(app).get("/api/health")).body.callPage;
    await request(app).get("/call");
    await request(app).get("/call?call=m1");
    const after = (await request(app).get("/api/health")).body.callPage;
    expect(after.hits - before.hits).toBe(2);
    expect(Date.parse(after.lastAt)).toBeGreaterThan(0);
  });

  it("без call.html страница звонка не выдумывается — отдаётся модель", async () => {
    await fs.rm(path.join(tmp, "call.html"));
    const { createApp } = await import("../app.js");
    const res = await request(createApp()).get("/call");
    expect(res.text).toContain("Схема");
    await fs.writeFile(path.join(tmp, "call.html"), "<title>Звонок</title>");
  });
});
