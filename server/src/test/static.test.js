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
  await fs.writeFile(path.join(tmp, "board.html"), "<title>Доска</title>");
  await fs.writeFile(path.join(tmp, "privacy.html"), "<title>Политика конфиденциальности</title>");
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

  /* Брейншторм-доска (владелец, 2026-09-25) — своя страница, как звонок:
     ссылка из чата без мини-приложения ведёт на /board?board=<id>. */
  it("/board, /board/ и /board?board=… отдают страницу доски без кеша", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    for (const p of ["/board", "/board/", "/board?board=abc", "/board/abc"]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Доска");
      expect(res.headers["cache-control"]).toMatch(/no-store/);
    }
    // «/boards» — не доска: это адрес модели.
    expect((await request(app).get("/boards")).text).toContain("Схема");
  });

  it("/privacy и /privacy/ отдают политику конфиденциальности без кеша", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    for (const p of ["/privacy", "/privacy/"]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Политика конфиденциальности");
      expect(res.headers["cache-control"]).toMatch(/no-store/);
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
    // Мини-приложение приходит без «?call=…» (id Telegram кладёт во
    // фрагмент), прямая ссылка — с ним. В сумме они неразличимы, поэтому
    // запоминаются ИМЕНА параметров: иначе не понять, что не открылось.
    expect(after.recent.map((h) => h.query).slice(0, 2)).toEqual(["call", ""]);
  });

  it("id встречи в /api/health не попадает — адрес открыт наружу", async () => {
    // По id встречи в комнату входит кто угодно: она на то и рассчитана на
    // гостей без регистрации. Раньше строка запроса писалась целиком, и
    // каждый, кто открыл /api/health, получал ключи от чужих переговоров.
    const { createApp } = await import("../app.js");
    const app = createApp();
    await request(app).get("/call?call=секретная-встреча&tgWebAppStartParam=call_тоже");
    const { recent } = (await request(app).get("/api/health")).body.callPage;
    expect(recent[0].query).toBe("call,tgWebAppStartParam");
    expect(JSON.stringify(recent)).not.toContain("секретная-встреча");
    expect(JSON.stringify(recent)).not.toContain("тоже");
  });

  it("последних открытий хранится немного — это отладка, а не статистика", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    for (let i = 0; i < 12; i += 1) await request(app).get(`/call?call=m${i}`);
    const { recent } = (await request(app).get("/api/health")).body.callPage;
    expect(recent).toHaveLength(8);
    expect(recent[0].query).toBe("call");
  });

  it("в /api/health видно, какую ссылку бот кладёт в приглашение", async () => {
    // Веток три — отдельное приложение, главное, просто страница, — и
    // переключается она молча, значением в .env. Не видя её, спор о том,
    // «почему окно не такое», не разрешить ничем.
    const { createApp } = await import("../app.js");
    const keep = { ...process.env };
    process.env.BOT_NAME = "sdbot";
    process.env.TELEGRAM_CALL_APP = "call";
    delete process.env.TELEGRAM_CALL_MAIN;
    let res = await request(createApp()).get("/api/health");
    expect(res.body.callLink).toBe("https://t.me/sdbot/call?startapp=call_ID&mode=compact");

    process.env.TELEGRAM_CALL_MAIN = "1";
    res = await request(createApp()).get("/api/health");
    expect(res.body.callLink).toBe("https://t.me/sdbot?startapp=call_ID&mode=compact");
    process.env = keep;
  });

  /* Окно звонка глазами самой страницы.

     Со стороны сервера высоту окна не видно вовсе: и половина, и весь
     экран — один и тот же запрос. А у Telegram три разных «полных
     экрана», и лечатся они по-разному, поэтому спорить о высоте вслепую
     бессмысленно — пусть страница скажет, что ей сообщил SDK. */
  it("страница может рассказать, в каком окне её открыли", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    await request(app).post("/api/call-view")
      .send({ when: "старт", expanded: true, height: 800.4, screenHeight: 800,
        ratio: 100, platform: "android", version: "8.0", start: "call" });
    const { views } = (await request(app).get("/api/health")).body.callPage;
    expect(views[0]).toMatchObject({ when: "старт", expanded: true, height: 800,
      platform: "android", ratio: 100 });
    expect(Date.parse(views[0].at)).toBeGreaterThan(0);
  });

  it("в отчёт об окне попадают только названные поля, и обрезанными", async () => {
    // Адрес открыт наружу: складывать в память что попало нельзя.
    const { createApp } = await import("../app.js");
    const app = createApp();
    await request(app).post("/api/call-view")
      .send({ platform: "я".repeat(200), initData: "user=...", cookie: "тайна",
        start: "call" });
    const { views } = (await request(app).get("/api/health")).body.callPage;
    expect(views[0].platform).toHaveLength(40);
    expect(views[0].initData).toBeUndefined();
    expect(views[0].cookie).toBeUndefined();
    expect(JSON.stringify(views[0])).not.toContain("тайна");
  });

  it("отчётов об окне хранится немного", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    for (let i = 0; i < 9; i += 1) {
      await request(app).post("/api/call-view").send({ when: `раз-${i}` });
    }
    const { views } = (await request(app).get("/api/health")).body.callPage;
    expect(views).toHaveLength(6);
    expect(views[0].when).toBe("раз-8");
  });

  it("без call.html страница звонка не выдумывается — отдаётся модель", async () => {
    await fs.rm(path.join(tmp, "call.html"));
    const { createApp } = await import("../app.js");
    const res = await request(createApp()).get("/call");
    expect(res.text).toContain("Схема");
    await fs.writeFile(path.join(tmp, "call.html"), "<title>Звонок</title>");
  });
});
describe("кеширование: страница свежая, бандлы вечные", () => {
  /* Выкат проходит, а человек продолжает видеть старое приложение — это
     не выдумка, а то, что случилось на живом сервере: Telegram WebView
     держал закешированный index.html, а тот тянул прежние бандлы. */
  it("HTML не кешируется вовсе — иначе выкат не доезжает до человека", async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    for (const p of ["/", "/call", "/что-угодно"]) {
      const res = await request(app).get(p);
      expect(res.headers["cache-control"]).toMatch(/no-store/);
    }
  });

  it("файл с хешем в имени кешируется навсегда — его содержимое не меняется", async () => {
    await fs.mkdir(path.join(tmp, "assets"), { recursive: true });
    await fs.writeFile(path.join(tmp, "assets", "main-abc123.js"), "console.log(1)");
    const { createApp } = await import("../app.js");
    const res = await request(createApp()).get("/assets/main-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/immutable/);
  });
});
