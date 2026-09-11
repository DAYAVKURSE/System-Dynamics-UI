import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ПОРУЧЕНИЯ ЧЕЛОВЕКА.

   Роли функции записаны ДОЛЖНОСТЯМИ: работу берёт любой воркер актива с
   такой ролью. Настройки актива позванный не видит — значит список
   того, что на нём висит, собирает сервер, по всем активам сразу.

   Выбрать себе работу нельзя. Можно только отказаться от того, в чём уже
   выбрали, — и вернуть отказ назад тем же нажатием. */

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

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-duty-"));
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

const MODEL = {
  entities: [{ id: "e1", name: "Продажи", crew: ["200", "300"] },
    { id: "e2", name: "Склад", crew: ["300"] }],
  traits: [], edges: [], kinds: [], tasks: [],
  funcs: [
    { id: "f1", e: "e1", name: "Звонок лиду", posts: { owners: ["дизайнер"] } },
    { id: "f2", e: "e1", name: "Проверка счёта", posts: { reviewers: ["бухгалтер"] } },
    { id: "f3", e: "e2", name: "Приёмка", posts: { owners: ["дизайнер"] } },
  ],
};

beforeEach(async () => {
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
  await request(app).get("/api/org/me").set(as(100, "Владелец"));
  for (const [id, name] of [[200, "Иван"], [300, "Пётр"]]) {
    await request(app).post("/api/org/users").set(as(100))
      .send({ id: String(id), name, roleId: "executor" });
  }
  for (const name of ["дизайнер", "бухгалтер"]) {
    await request(app).post("/api/org/roles").set(as(100)).send({ name, tabs: [] });
  }
  await request(app).put("/api/org/users/200/roles").set(as(100))
    .send({ roles: ["executor", "дизайнер"] });
  await request(app).put("/api/org/users/300/roles").set(as(100))
    .send({ roles: ["executor", "бухгалтер"] });
  await request(app).put("/api/workspace").set(as(100)).send({ model: MODEL });
});

describe("список поручений", () => {
  it("собирает все активы, где человек воркер и его выбрали ролью", async () => {
    const res = await request(app).get("/api/workspace/duty").set(as(200));
    expect(res.status).toBe(200);
    expect(res.body.duty.map((d) => d.func)).toEqual(["f1"]);
    expect(res.body.duty[0]).toMatchObject({ asset: "e1", assetName: "Продажи",
      name: "Звонок лиду", roles: ["owners"], off: false });
  });

  it("другая роль — другой список, и что он там делает, названо словом", async () => {
    const res = await request(app).get("/api/workspace/duty").set(as(300));
    expect(res.body.duty.map((d) => d.func)).toEqual(["f2"]);
    expect(res.body.duty[0].words).toEqual(["проверяет"]);
    // Воркер «Склада», но роль там чужая — «Приёмки» в списке нет.
    expect(res.body.duty.some((d) => d.func === "f3")).toBe(false);
  });

  it("непозванному не отвечаем вовсе", async () => {
    expect((await request(app).get("/api/workspace/duty").set(as(999))).status).toBe(403);
  });
});

describe("отказ", () => {
  it("снимает с человека функцию и возвращается тем же нажатием", async () => {
    expect((await request(app).post("/api/workspace/funcs/f1/duty")
      .set(as(200)).send({ off: true })).body).toMatchObject({ func: "f1", off: true });

    const off = await request(app).get("/api/workspace/duty").set(as(200));
    expect(off.body.duty[0].off).toBe(true);
    const model = await request(app).get("/api/workspace").set(as(100));
    expect(model.body.funcs.find((f) => f.id === "f1").except).toEqual(["200"]);

    await request(app).post("/api/workspace/funcs/f1/duty").set(as(200)).send({ off: false });
    const back = await request(app).get("/api/workspace/duty").set(as(200));
    expect(back.body.duty[0].off).toBe(false);
  });

  it("отказаться можно только от своего: чужая функция — не его дело", async () => {
    const res = await request(app).post("/api/workspace/funcs/f2/duty")
      .set(as(200)).send({ off: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Эта функция вам не поручена.");
    const model = await request(app).get("/api/workspace").set(as(100));
    expect(model.body.funcs.find((f) => f.id === "f2").except || []).toEqual([]);
  });

  it("нет такой функции — так и сказано", async () => {
    expect((await request(app).post("/api/workspace/funcs/нет/duty")
      .set(as(200)).send({ off: true })).status).toBe(404);
  });
});
