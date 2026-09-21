import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inStorage, listStorages, memberOf, ownStorageOf, storagesOf } from "../lib/storages.js";
import { readModel, writeModel } from "../lib/workspaceStore.js";
import { addVirtualUser, listOrg, readOrg } from "../lib/orgStore.js";
import { scheduleFor } from "../lib/scheduleTasks.js";

/* Личные хранилища (владелец, 2026-09-21): прежняя модель — хранилище
   владельца, у каждого зарегистрированного — своё, изолированное; чужое
   открывается только участнику. */

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-storages-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.SCHEDULES_DIR = path.join(tmp, "sch");
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
  delete process.env.OWNER_TELEGRAM_ID;
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
  // Первый вошедший — владелец MAIN.
  await request(app).get("/api/org/me").set(as(100, "Владелец"));
});

describe("своё хранилище", () => {
  it("у владельца — прежнее (MAIN), у нового человека — своё, и оба в реестре", async () => {
    expect(await ownStorageOf("100")).toBe("main");
    const me = await request(app).get("/api/org/me").set(as(200, "Иван"));
    expect(me.status).toBe(200);
    // В своём хранилище человек — владелец, и ему открыто всё.
    expect(me.body.isOwner).toBe(true);
    expect(me.body.storage).toBe("200");
    expect(me.body.ownStorage).toBe("200");
    expect(me.body.storages.map((s) => s.id)).toEqual(["200"]);
    expect((await listStorages()).map((s) => s.id)).toEqual(["main", "200"]);
    // Каталоги раздельные: организация Ивана лежит под storages/200.
    await fs.access(path.join(process.env.ORG_DIR, "storages", "200", "org.json"));
    // А MAIN Ивана не знает.
    expect((await listOrg()).users.some((u) => u.id === "200")).toBe(false);
  });

  it("модель Ивана — не модель владельца, и у обеих два неудаляемых актива", async () => {
    await writeModel({ entities: [{ id: "e1", name: "Моё" }], tasks: [] });
    const own = await readModel();
    expect(own.entities.map((e) => e.id)).toEqual(["e1", "owner", "system"]);
    expect(own.entities.find((e) => e.id === "owner")).toMatchObject({ name: "Владелец", fixed: true });
    expect(own.entities.find((e) => e.id === "system")).toMatchObject({ name: "Система", fixed: true });
    await request(app).get("/api/org/me").set(as(200, "Иван"));
    const ws = await request(app).get("/api/workspace").set(as(200, "Иван"));
    expect(ws.status).toBe(200);
    expect(ws.body.entities.map((e) => e.id)).toEqual(["owner", "system"]);
    // Иван пишет свою модель — модель владельца не трогается.
    await request(app).put("/api/workspace").set(as(200, "Иван"))
      .send({ model: { entities: [{ id: "x", name: "Ивана" }], tasks: [] } }).expect(200);
    expect((await readModel()).entities.map((e) => e.id)).toEqual(["e1", "owner", "system"]);
    const his = await inStorage("200", () => readModel());
    expect(his.entities.map((e) => e.id)).toEqual(["x", "owner", "system"]);
  });
});

describe("чужое хранилище", () => {
  it("открывается только участнику; ссылка ведёт в хранилище, где её выдали", async () => {
    // Иван не участник MAIN — не пускаем.
    await request(app).get("/api/org/me").set(as(200, "Иван"));
    const no = await request(app).get("/api/workspace").set(as(200, "Иван")).set("X-Storage", "main");
    expect(no.status).toBe(403);
    expect(await memberOf("main", "200")).toBe(false);

    // Владелец заводит страницу в MAIN и даёт ссылку; Иван вступает.
    const v = await addVirtualUser({ addedBy: "100" });
    const peek = await request(app).get(`/api/org/join/${v.token}`).set(as(200, "Иван"));
    expect(peek.status).toBe(200);
    expect(peek.body.storage).toBe("main");
    const joined = await request(app).post("/api/org/join").set(as(200, "Иван")).send({ token: v.token });
    expect(joined.status).toBe(200);
    expect(joined.body.storage).toBe("main");
    expect(joined.body.storages.map((s) => s.id)).toEqual(["200", "main"]);
    expect(joined.body.storages[1]).toMatchObject({ own: false, owner: "Владелец" });

    // Теперь MAIN открыт — под страницей, которую он забрал.
    const me = await request(app).get("/api/org/me").set(as(200, "Иван")).set("X-Storage", "main");
    expect(me.status).toBe(200);
    expect(me.body.isOwner).toBe(false);
    expect(me.body.id).toBe(v.id);
    expect(me.body.storage).toBe("main");
    // А в своём он по-прежнему владелец.
    const own = await request(app).get("/api/org/me").set(as(200, "Иван"));
    expect(own.body.isOwner).toBe(true);
    expect(own.body.id).toBe("200");
  });

  it("напоминания собирают задачи из всех хранилищ человека", async () => {
    await request(app).get("/api/org/me").set(as(200, "Иван"));
    const v = await addVirtualUser({ addedBy: "100" });
    await request(app).post("/api/org/join").set(as(200, "Иван")).send({ token: v.token });
    const start = new Date(Date.now() + 3600000).toISOString();
    // Задача Ивана в MAIN — под id его страницы там; и задача в своём.
    await writeModel({ tasks: [{ id: "t-main", title: "в MAIN", assignee: v.id, status: "backlog",
      start, funcId: "f" }], funcs: [{ id: "f", e: "owner", l: "ф" }] });
    await inStorage("200", () => writeModel({ tasks: [{ id: "t-own", title: "своя",
      assignee: "200", status: "backlog", start, funcId: "f" }],
    funcs: [{ id: "f", e: "owner", l: "ф" }] }));
    const own = await scheduleFor("200");
    expect(own.tasks.map((t) => t.id)).toContain("t-own");
    const there = await scheduleFor(v.id);
    expect(there.tasks.map((t) => t.id)).toContain("t-main");
    expect((await storagesOf("200")).map((s) => s.id)).toEqual(["200", "main"]);
  });

  it("владелец из переменной — только у MAIN", async () => {
    process.env.OWNER_TELEGRAM_ID = "100";
    await request(app).get("/api/org/me").set(as(200, "Иван"));
    const his = await inStorage("200", () => readOrg());
    expect(his.ownerId).toBe("200");
    expect((await readOrg()).ownerId).toBe("100");
  });
});
