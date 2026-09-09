import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let app;
let store;
let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sd-schedules-"));
  process.env.SCHEDULES_DIR = tmpDir;
  process.env.NODE_ENV = "test";
  ({ createApp: app } = await import("../app.js"));
  app = app();
  store = await import("../lib/scheduleStore.js");
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const f of await fs.readdir(tmpDir)) await fs.rm(path.join(tmpDir, f), { force: true });
});

const task = (over = {}) => ({
  id: "t1", title: "Задача", body: "Детали", status: "backlog",
  start: "2026-09-15T10:00", repeat: "once", days: [], time: "", warn: 10, ...over,
});

describe("API расписания", () => {
  it("пустое расписание отдаётся без ошибки", async () => {
    const res = await request(app).get("/api/schedule");
    expect(res.status).toBe(200);
    expect(res.body.tasks).toBe(0);
  });

  it("сохраняет задачи и часовой пояс", async () => {
    const res = await request(app).put("/api/schedule")
      .send({ tzOffset: -180, tasks: [task(), task({ id: "t2" })] });

    expect(res.status).toBe(200);
    expect(res.body.tasks).toBe(2);

    const saved = await store.readSchedule("dev-user");
    expect(saved.tzOffset).toBe(-180);
    expect(saved.tasks).toHaveLength(2);
    // chatId берётся из подписи, а не из тела запроса.
    expect(saved.chatId).toBe("dev-user");
  });

  it("chatId нельзя подменить через тело запроса", async () => {
    await request(app).put("/api/schedule")
      .send({ tzOffset: 0, tasks: [task()], chatId: "999999" });

    const saved = await store.readSchedule("dev-user");
    expect(saved.chatId).toBe("dev-user");
  });

  it("отклоняет tasks не массивом", async () => {
    const res = await request(app).put("/api/schedule").send({ tzOffset: 0, tasks: "нет" });
    expect(res.status).toBe(400);
  });

  it("отклоняет слишком длинный список задач", async () => {
    const many = Array.from({ length: 501 }, (_, i) => task({ id: `t${i}` }));
    const res = await request(app).put("/api/schedule").send({ tzOffset: 0, tasks: many });
    expect(res.status).toBe(400);
  });

  it("health сообщает, что напоминания выключены без токена бота", async () => {
    const res = await request(app).get("/api/health");
    expect(res.body.reminders).toBe(false);
  });
});

describe("хранилище расписаний", () => {
  it("оставляет только поля, нужные для отправки", async () => {
    await store.saveSchedule("u1", {
      chatId: "u1", tzOffset: 0,
      tasks: [{ ...task(), comments: [{ text: "секрет" }], goalId: "g1", okrId: "kr1" }],
    });
    const saved = await store.readSchedule("u1");
    expect(saved.tasks[0]).not.toHaveProperty("comments");
    expect(saved.tasks[0]).not.toHaveProperty("goalId");
    expect(saved.tasks[0].title).toBe("Задача");
  });

  it("исполнителя оставляет — по нему решается, кому кнопки под уведомлением", async () => {
    await store.saveSchedule("u6", {
      chatId: "u6", tzOffset: 0,
      tasks: [task({ assignee: 200 }), task({ id: "t2" }), task({ id: "t3", assignee: "" })],
    });
    const saved = await store.readSchedule("u6");
    expect(saved.tasks.map((t) => t.assignee)).toEqual(["200", null, null]);
  });

  /* «До какого момента отложена» едет с доски вместе с задачей, а бот,
     отложив задачу, ставит его в расписание сам — не дожидаясь, пока
     человек откроет приложение. */
  it("переносит «отложено до» и не принимает за дату что попало", async () => {
    await store.saveSchedule("u4", {
      chatId: "u4", tzOffset: 0,
      tasks: [task({ deferredUntil: "2026-09-15T12:00:00.000Z" }),
        task({ id: "t2", deferredUntil: "потом" }), task({ id: "t3" })],
    });
    const saved = await store.readSchedule("u4");
    expect(saved.tasks[0].deferredUntil).toBe("2026-09-15T12:00:00.000Z");
    expect(saved.tasks[1].deferredUntil).toBeNull();
    expect(saved.tasks[2].deferredUntil).toBeNull();
  });

  it("бот ставит «отложено до» в расписание сразу, и снимает тоже", async () => {
    await store.saveSchedule("u5", { chatId: "u5", tzOffset: 0, tasks: [task()] });
    expect(await store.setDeferredUntil("u5", "t1", "2026-09-15T12:00:00.000Z")).toBe(true);
    expect((await store.readSchedule("u5")).tasks[0].deferredUntil)
      .toBe("2026-09-15T12:00:00.000Z");
    expect(await store.setDeferredUntil("u5", "t1", null)).toBe(true);
    expect((await store.readSchedule("u5")).tasks[0].deferredUntil).toBeNull();
    // Задачи, которой доска не присылала, в расписании не заводится.
    expect(await store.setDeferredUntil("u5", "нет-такой", "2026-09-15T12:00:00.000Z")).toBe(false);
  });

  it("отметки об отправленном переживают пересохранение расписания", async () => {
    await store.saveSchedule("u2", { chatId: "u2", tzOffset: 0, tasks: [task()] });
    await store.markSent("u2", "t1:2026-09-15T10:00:start");

    // Пользователь поправил задачу — расписание пришло заново.
    await store.saveSchedule("u2", { chatId: "u2", tzOffset: 0, tasks: [task({ warn: 30 })] });

    const saved = await store.readSchedule("u2");
    expect(saved.sent["t1:2026-09-15T10:00:start"]).toBeTruthy();
  });

  it("старые отметки вычищаются, чтобы файл не рос вечно", async () => {
    await store.saveSchedule("u3", { chatId: "u3", tzOffset: 0, tasks: [task()] });
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await store.markSent("u3", "древняя", old);
    await store.markSent("u3", "свежая", Date.now());

    const saved = await store.readSchedule("u3");
    expect(saved.sent["древняя"]).toBeUndefined();
    expect(saved.sent["свежая"]).toBeTruthy();
  });

  it("обход всех расписаний находит сохранённых пользователей", async () => {
    await store.saveSchedule("a", { chatId: "a", tzOffset: 0, tasks: [task()] });
    await store.saveSchedule("b", { chatId: "b", tzOffset: 0, tasks: [task()] });

    const all = await store.allSchedules();
    expect(all.map((x) => x.userId).sort()).toEqual(["a", "b"]);
  });

  it("id пользователя не даёт вырваться из каталога расписаний", async () => {
    await store.saveSchedule("../../etc/passwd", { chatId: "x", tzOffset: 0, tasks: [task()] });
    const files = await fs.readdir(tmpDir);
    expect(files.every((f) => !f.includes("/") && f.endsWith(".json"))).toBe(true);
  });
});
