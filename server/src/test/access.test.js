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
  /* Материалы — единицы ресурсов; чужого ресурса исполнитель не видит и
     здесь: код «тайны» — такая же тайна, как она сама. */
  materials: [{ id: "m9", trait: "t9", kind: "code", qty: 1, code: "SECRETCD" },
    { id: "m2", trait: "t2", kind: "text", qty: 3, text: "заявки с сайта" }],
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
    expect(JSON.stringify(res.body)).not.toContain("SECRETCD");
    expect(Array.isArray(res.body.materials)).toBe(true);
  });

  it("владельцу — модель целиком, материалы в ней", async () => {
    await saveModel();
    const res = await request(app).get("/api/workspace").set(as(100));
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.materials.map((m) => m.id)).toEqual(["m9", "m2"]);
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

describe("взять в работу через сервер", () => {
  /* Модель целиком пишет владелец, но брать работу должен тот, кто её
     делает: иначе нажатие «Взять в работу» жило бы только в его окне и
     пропадало при следующей загрузке. */
  const take = (id, who) => request(app).post(`/api/workspace/tasks/${id}/take`)
    .set(as(who));

  it("исполнитель берёт свою задачу из бэклога — она уходит в работу", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    // tk1 лежит в бэклоге у Ивана.
    await request(app).put("/api/workspace").set(as(100)).send({ model: {
      ...MODEL,
      tasks: MODEL.tasks.map((t) => (t.id === "tk1" ? { ...t, status: "backlog" } : t)) } });
    const res = await take("tk1", 200);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("progress");
    expect(res.body.taken).toBe(true);
    // И это сохранилось, а не осталось в ответе.
    const got = await request(app).get("/api/workspace").set(as(200));
    expect(got.body.tasks.find((t) => t.id === "tk1").taken).toBe(true);
  });

  it("просроченная остаётся в «Дедлайне»: срок назад не отматывается", async () => {
    await invite(200, "executor", "Иван");
    await request(app).put("/api/workspace").set(as(100)).send({ model: {
      ...MODEL,
      tasks: MODEL.tasks.map((t) => (t.id === "tk1"
        ? { ...t, status: "backlog", end: "2020-01-01T10:00" } : t)) } });
    expect((await take("tk1", 200)).body.status).toBe("deadline");
  });

  it("чужую задачу не взять, и взятую второй раз — тоже", async () => {
    await saveModel();
    await invite(300, "reviewer", "Пётр");
    // tk1 — Ивана, и Пётр её не берёт.
    expect((await take("tk1", 300)).status).toBe(403);
    // А сама она уже в работе: брать нечего.
    await invite(200, "executor", "Иван");
    expect((await take("tk1", 200)).status).toBe(400);
    expect((await take("нет-такой", 200)).status).toBe(404);
  });

  it("возврат из проверки снова кладёт задачу в бэклог невзятой", async () => {
    await saveModel();
    await invite(300, "reviewer", "Пётр");
    const res = await request(app).post("/api/workspace/tasks/tk1/review")
      .set(as(300)).send({ accept: false, comment: "доработать" });
    expect(res.body.status).toBe("backlog");
    expect(res.body.taken).toBe(false);
  });
});

/* ─────── отложить ───────

   «Отложено» — не полка «потом», а честная отметка: человека позвали, а
   работа не началась. Задача остаётся в бэклоге, и срок не сдвигается:
   срок ставит постановщик, и менять его нажатием исполнителя значило бы
   переписывать договорённость в одну сторону. */
describe("отложить через сервер", () => {
  const defer = (id, who) => request(app).post(`/api/workspace/tasks/${id}/defer`)
    .set(as(who));
  const backlog = async () => {
    await request(app).put("/api/workspace").set(as(100)).send({ model: {
      ...MODEL,
      tasks: MODEL.tasks.map((t) => (t.id === "tk1"
        ? { ...t, status: "backlog", taken: false } : t)) } });
  };

  it("отложенная остаётся в бэклоге — но уже отложенной", async () => {
    await invite(200, "executor", "Иван");
    await backlog();
    const res = await defer("tk1", 200);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("deferred");
    expect(res.body.taken).toBe(false);
    expect(res.body.deferredAt).toBeTruthy();
    // И это сохранилось, а не осталось в ответе.
    const got = await request(app).get("/api/workspace").set(as(200));
    expect(got.body.tasks.find((t) => t.id === "tk1").status).toBe("deferred");
  });

  it("отложенную можно взять, и отметка об отложенности снимается", async () => {
    await invite(200, "executor", "Иван");
    await backlog();
    await defer("tk1", 200);
    const res = await request(app).post("/api/workspace/tasks/tk1/take").set(as(200));
    expect(res.body.status).toBe("progress");
    expect(res.body.deferredAt).toBeNull();
  });

  /* «На сколько» — из бота: часы и минуты складываются с «сейчас», и в
     этот момент уведомление о начале приходит заново. Отложить «до вчера»
     значит не отложить вовсе: такая дата не записывается. */
  it("«до какого момента» записывается, если момент в будущем", async () => {
    await invite(200, "executor", "Иван");
    await backlog();
    const until = new Date(Date.now() + 2 * 3600000).toISOString();
    const res = await defer("tk1", 200).send({ until });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("deferred");
    expect(res.body.deferredUntil).toBe(until);
    const got = await request(app).get("/api/workspace").set(as(200));
    expect(got.body.tasks.find((t) => t.id === "tk1").deferredUntil).toBe(until);
  });

  it("момент в прошлом или не дата — задача отложена, но срока напоминания нет", async () => {
    await invite(200, "executor", "Иван");
    await backlog();
    const past = await defer("tk1", 200).send({ until: "2020-01-01T10:00:00.000Z" });
    expect(past.body.status).toBe("deferred");
    expect(past.body.deferredUntil).toBeNull();
    const junk = await defer("tk1", 200).send({ until: "потом" });
    expect(junk.body.deferredUntil).toBeNull();
  });

  it("взятая в работу больше не «отложена до»: напоминать о начале не за что", async () => {
    await invite(200, "executor", "Иван");
    await backlog();
    await defer("tk1", 200).send({ until: new Date(Date.now() + 3600000).toISOString() });
    const res = await request(app).post("/api/workspace/tasks/tk1/take").set(as(200));
    expect(res.body.deferredUntil).toBeNull();
  });

  it("просроченную откладывают, но она остаётся в «Дедлайне»", async () => {
    await invite(200, "executor", "Иван");
    await request(app).put("/api/workspace").set(as(100)).send({ model: {
      ...MODEL,
      tasks: MODEL.tasks.map((t) => (t.id === "tk1"
        ? { ...t, status: "backlog", taken: false, end: "2020-01-01T10:00" } : t)) } });
    expect((await defer("tk1", 200)).body.status).toBe("deadline");
  });

  it("чужую не отложить, и сданную — тоже", async () => {
    await saveModel();
    await invite(300, "reviewer", "Пётр");
    expect((await defer("tk1", 300)).status).toBe(403);
    await invite(200, "executor", "Иван");
    // tk1 уже в работе: откладывать нечего — за неё взялись.
    expect((await defer("tk1", 200)).status).toBe(400);
    expect((await defer("нет-такой", 200)).status).toBe(404);
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

  /* ─── результат — часть сдачи ───
     Функция обещала выдать «заявки» (минимум 1): без файла по этому выходу
     сдачи нет, и сказано, чего не хватает. Правило одно на бота и доску. */
  const WITH_FUNC = {
    ...MODEL,
    funcs: [{ id: "f1", e: "e1", name: "Сбор заявок", dur: 2, durUnit: "ч",
      takes: [{ id: "p1", trait: "t1", lo: 1, hi: 2 }],
      gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1 }] }],
    tasks: MODEL.tasks.map((t) => (t.id === "tk1" ? { ...t, funcId: "f1", setter: "100" } : t)),
  };
  const withFunc = () => request(app).put("/api/workspace").set(as(100))
    .send({ model: WITH_FUNC });
  const FILE = { name: "заявка.pdf", type: "application/pdf", size: 10, url: "/api/reports/x" };

  it("без файла по обязательному выходу сдача не принимается — 400 и список", async () => {
    await withFunc();
    await invite(200, "executor", "Иван");
    const res = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 2, text: "сделал" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "missing files", missing: ["t2"] });
    // И сдачи не появилось.
    const got = await request(app).get("/api/workspace").set(as(200));
    expect(got.body.tasks[0].submissions).toHaveLength(0);
  });

  it("сколько единиц сдают — столько и прикладывают", async () => {
    /* Одна запись на десять штук говорила «десять есть» и молчала о том,
       какие они. Сдал десять договоров — десять файлов. */
    await withFunc();
    await invite(200, "executor", "Иван");
    const half = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 2, text: "сделал", gives: { t2: 3 },
        units: { t2: [{ kind: "file", file: FILE }, { kind: "file", file: null },
          { kind: "file", file: FILE }] } });
    expect(half.status).toBe(400);
    expect(half.body).toEqual({ error: "missing files", missing: ["t2"] });

    const all = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 2, text: "сделал", gives: { t2: 3 },
        units: { t2: [1, 2, 3].map(() => ({ kind: "file", file: FILE })) } });
    expect(all.status).toBe(200);
    const got = await request(app).get("/api/workspace").set(as(100));
    const sb = got.body.tasks[0].submissions[0];
    expect(sb.units.t2).toHaveLength(3);
    sb.units.t2.forEach((u) => expect(u.file.url).toBe(FILE.url));
  });

  it("уникальные коды принимаются с подтверждением — одним на всю сдачу", async () => {
    /* Код создаёт программа, и показать его нечем, кроме бумаги о выдаче:
       без подтверждения сдачи нет, а с ним — одно на все единицы. */
    await withFunc();
    await invite(200, "executor", "Иван");
    const bare = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 1, text: "выдал", gives: { t2: 2 },
        units: { t2: [{ kind: "code", code: "AAAA1111" }, { kind: "code", code: "BBBB2222" }] } });
    expect(bare.status).toBe(400);
    expect(bare.body.missing).toEqual(["t2"]);

    const ok = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 1, text: "выдал", gives: { t2: 2 }, proof: FILE,
        units: { t2: [{ kind: "code", code: "AAAA1111" }, { kind: "code", code: "BBBB2222" }] } });
    expect(ok.status).toBe(200);
    const got = await request(app).get("/api/workspace").set(as(100));
    const sb = got.body.tasks[0].submissions[0];
    expect(sb.units.t2.map((u) => u.code)).toEqual(["AAAA1111", "BBBB2222"]);
    expect(sb.proof.url).toBe(FILE.url);
  });

  it("с файлами сдаётся, и оценка постановки хранится вместе со сдачей", async () => {
    await withFunc();
    await invite(200, "executor", "Иван");
    const res = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 2, files: { t2: FILE },
        setterRating: { mark: 4, comment: "срок был тесный", hidden: true } });
    expect(res.status).toBe(200);
    expect(res.body.submissions[0].files).toEqual({ t2: FILE });
    expect(res.body.submissions[0].setterRating)
      .toEqual({ mark: 4, comment: "срок был тесный", hidden: true });
  });

  it("оценка постановки не обязательна: без неё — null, а не нули", async () => {
    await withFunc();
    await invite(200, "executor", "Иван");
    const res = await request(app).post("/api/workspace/tasks/tk1/submit")
      .set(as(200)).send({ hours: 2, files: { t2: FILE } });
    expect(res.body.submissions[0].setterRating).toBeNull();
  });

  it("у решения проверяющего хранится «скрытый», и слова уходят в ленту с адресатом", async () => {
    await saveModel();
    await invite(300, "reviewer", "Пётр");
    const res = await request(app).post("/api/workspace/tasks/tk1/review")
      .set(as(300)).send({ accept: true, comment: "лично", mark: 5, hidden: true });
    expect(res.body.reviews[0]).toMatchObject({ hidden: true, mark: 5 });
    expect(res.body.comments[0]).toMatchObject({ text: "лично", by: "300", to: "200",
      hidden: true });
  });
});

/* ─────── оценки без имени ───────

   Оценка публикуется без автора и только когда автора нельзя вычислить.
   Свои оценки человек не видит — ни цифрой, ни в задаче. */
describe("рейтинги через сервер", () => {
  // Две задачи Ивана с двумя разными проверяющими: порог набран.
  const RATED = {
    ...MODEL,
    tasks: [
      { id: "tk1", assignee: "200", reviewer: "300", setter: "100", status: "done",
        title: "Задача Ивана", submissions: [], comments: [],
        reviews: [{ id: "r1", at: "2026-01-01T10:00:00Z", by: "300", accept: true,
          mark: 5, comment: "чётко", hidden: false }] },
      { id: "tk2", assignee: "200", reviewer: "400", setter: "100", status: "done",
        title: "Вторая Ивана", submissions: [], comments: [],
        reviews: [{ id: "r2", at: "2026-01-02T10:00:00Z", by: "400", accept: true,
          mark: 3, comment: "лично", hidden: true }] },
    ],
  };
  const rated = () => request(app).put("/api/workspace").set(as(100)).send({ model: RATED });
  const ratings = (who) => request(app).get("/api/workspace/ratings").set(as(who));

  it("чтение публикует по одной за раз, и в ответе нет автора", async () => {
    await rated();
    await invite(200, "executor", "Иван");
    const first = await ratings(100);
    expect(first.status).toBe(200);
    expect(first.body.others["200"]).toMatchObject({ mark: 5, count: 1 });
    const second = await ratings(100);
    expect(second.body.others["200"]).toMatchObject({ mark: 4, count: 2 });
    expect(JSON.stringify(second.body)).not.toContain('"by"');
  });

  it("про себя — только адресованные слова, без единой цифры", async () => {
    await rated();
    await invite(200, "executor", "Иван");
    await ratings(100); await ratings(100);
    const res = await ratings(200);
    expect(res.body.others).not.toHaveProperty("200");
    expect(res.body.mine.comments.map((c) => c.text).sort()).toEqual(["лично", "чётко"]);
    // И в задаче исполнитель своей оценки тоже не видит.
    const got = await request(app).get("/api/workspace").set(as(200));
    got.body.tasks.forEach((t) => t.reviews.forEach((r) => expect(r.mark).toBeNull()));
  });

  it("реестр опубликованного не стирается моделью владельца", async () => {
    await rated();
    await ratings(100);
    // Владелец сохраняет модель без реестра (клиент его не ведёт).
    await rated();
    const res = await ratings(100);
    // Была бы стёрта — опубликовалась бы заново одна; а их уже две.
    expect(res.body.others["200"].count).toBe(2);
  });

  it("незваному рейтингов нет", async () => {
    await rated();
    expect((await ratings(777)).status).toBe(403);
  });
});

/* ─────── комментарии ───────

   Скрытый — только автору и адресату; публичный — всем участникам. */
describe("комментарии к задаче", () => {
  const comment = (who, body) => request(app).post("/api/workspace/tasks/tk1/comments")
    .set(as(who)).send(body);

  it("участник пишет, скрытое видят только автор и адресат", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    const res = await comment(300, { text: "между нами", to: "200", hidden: true });
    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({ text: "между нами", by: "300", to: "200",
      hidden: true });
    // Адресат видит, а постановщик (владелец) — свою модель целиком; чужой
    // участник — нет. Проверяем через срез третьего участника.
    const asIvan = await request(app).get("/api/workspace").set(as(200));
    expect(asIvan.body.tasks[0].comments.map((c) => c.text)).toEqual(["между нами"]);
  });

  it("публичный виден всем участникам, а посторонний писать не может", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    await invite(500, "executor", "Чужой");
    expect((await comment(200, { text: "всем", to: null, hidden: false })).status).toBe(201);
    expect((await comment(500, { text: "мимо" })).status).toBe(403);
    const asPetr = await request(app).get("/api/workspace").set(as(300));
    expect(asPetr.body.tasks[0].comments.map((c) => c.text)).toEqual(["всем"]);
  });

  it("скрытому нужен адресат, и адресат — из участников", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    expect((await comment(200, { text: "тайна", hidden: true })).status).toBe(400);
    expect((await comment(200, { text: "тайна", to: "999", hidden: true })).status).toBe(400);
    expect((await comment(200, { text: "   " })).status).toBe(400);
  });

  /* Убрать комментарий — операция сервера, а не окна: иначе после
     перезагрузки он возвращался бы. Владелец убирает любой, остальные —
     только свой. */
  const drop = (who, cid) => request(app)
    .delete(`/api/workspace/tasks/tk1/comments/${cid}`).set(as(who));
  const texts = async (who) => (await request(app).get("/api/workspace").set(as(who)))
    .body.tasks[0].comments.map((c) => c.text);

  it("автор убирает свой комментарий, и после перечитывания его нет", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    const mine = (await comment(200, { text: "передумал" })).body.comment;
    const res = await drop(200, mine.id);
    expect(res.status).toBe(200);
    expect(res.body.comments).toEqual([]);
    expect(await texts(200)).toEqual([]);
  });

  it("чужой комментарий участнику не убрать — 403, и он остаётся", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    const petrs = (await comment(300, { text: "замечание", to: "200" })).body.comment;
    expect((await drop(200, petrs.id)).status).toBe(403);
    expect(await texts(200)).toEqual(["замечание"]);
  });

  it("владелец убирает любой", async () => {
    await saveModel();
    await invite(300, "reviewer", "Пётр");
    const petrs = (await comment(300, { text: "замечание", to: "200" })).body.comment;
    expect((await drop(100, petrs.id)).status).toBe(200);
    expect(await texts(300)).toEqual([]);
  });

  it("нет задачи или комментария — 404", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    expect((await drop(200, "нет-такого")).status).toBe(404);
    expect((await request(app).delete("/api/workspace/tasks/нет/comments/c1")
      .set(as(100))).status).toBe(404);
  });

  it("в ответе на удаление — срез: чужих скрытых слов участник не получает", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    await comment(100, { text: "только Петру", to: "300", hidden: true });
    const mine = (await comment(200, { text: "своё" })).body.comment;
    const res = await drop(200, mine.id);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("только Петру");
  });
});

/* ─────── ответ на нажатие — тоже срез ───────

   Ответ на POST виден в отладчике так же, как ответ на GET, поэтому
   задача в нём — глазами нажавшего: без своих оценок и чужих скрытых слов.
   Владельцу — целиком. */
describe("что приходит в ответ на нажатие", () => {
  const post = (who, action, body = {}) => request(app)
    .post(`/api/workspace/tasks/tk1/${action}`).set(as(who)).send(body);
  const marks = (task) => task.reviews.map((r) => r.mark);
  const hiddenNotMine = (task, me) => task.comments
    .filter((c) => c.hidden && String(c.by) !== me && String(c.to) !== me);

  it("исполнитель в ответах на «взять», «отложить» и сдачу не видит оценок и чужих скрытых слов", async () => {
    await saveModel();
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    // Проверяющий вернул задачу с оценкой; владелец шепнул проверяющему.
    expect((await post(300, "review", { accept: false, comment: "доработать", mark: 2 })).status)
      .toBe(200);
    await post(100, "comments", { text: "между нами", to: "300", hidden: true });

    const defer = await post(200, "defer");
    expect(defer.status).toBe(200);
    expect(marks(defer.body)).toEqual([null]);
    expect(hiddenNotMine(defer.body, "200")).toEqual([]);
    // Публичные слова возврата исполнителю видны — они ему и адресованы.
    expect(defer.body.comments.map((c) => c.text)).toEqual(["доработать"]);

    const take = await post(200, "take");
    expect(take.status).toBe(200);
    expect(marks(take.body)).toEqual([null]);
    expect(hiddenNotMine(take.body, "200")).toEqual([]);

    const submit = await post(200, "submit", { hours: 1, text: "готово" });
    expect(submit.status).toBe(200);
    expect(marks(submit.body)).toEqual([null]);
    expect(hiddenNotMine(submit.body, "200")).toEqual([]);
    expect(JSON.stringify(submit.body)).not.toContain("между нами");
  });

  it("постановщик-проверяющий в ответе на приём не видит оценки своей постановки", async () => {
    // Пётр поставил задачу и он же принимает: оценка постановки — про
    // него, и до публикации ему не показывается.
    await request(app).put("/api/workspace").set(as(100)).send({ model: { ...MODEL,
      tasks: MODEL.tasks.map((t) => (t.id === "tk1" ? { ...t, setter: "300" } : t)) } });
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    const sub = await post(200, "submit", { hours: 1,
      setterRating: { mark: 2, comment: "поставлено плохо", hidden: true } });
    // Исполнителю своя оценка постановки видна — он её и написал.
    expect(sub.body.submissions[0].setterRating).toMatchObject({ mark: 2 });

    const res = await post(300, "review", { accept: true, comment: "принято", mark: 5 });
    expect(res.status).toBe(200);
    expect(res.body.submissions[0].setterRating).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("поставлено плохо");
    // Своё решение автор видит целиком.
    expect(res.body.reviews[0].mark).toBe(5);
  });

  it("владельцу — целиком", async () => {
    await request(app).put("/api/workspace").set(as(100)).send({ model: { ...MODEL,
      tasks: MODEL.tasks.map((t) => (t.id === "tk1" ? { ...t, setter: "100" } : t)) } });
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
    await post(300, "review", { accept: false, comment: "доработать", mark: 2, hidden: true });
    const res = await post(100, "comments", { text: "вижу всё" });
    expect(res.status).toBe(201);
    expect(res.body.task.reviews[0].mark).toBe(2);
    expect(res.body.task.comments.map((c) => c.text)).toEqual(["доработать", "вижу всё"]);
  });
});

/* Анкета — единственное, что человек меняет о себе сам. Поэтому маршрут
   открыт всем позванным, а не одному владельцу: чинить свою анкету через
   владельца значило бы просить его пересказывать твои же слова. */
describe("своя анкета", () => {
  it("позванный человек пишет свою анкету, не будучи владельцем", async () => {
    await invite(200, "executor", "Иван");
    const res = await request(app).put("/api/org/me/profile")
      .set(as(200, "Иван")).send({ about: "исполнитель, верстает" });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ about: "исполнитель, верстает" });
    const me = await request(app).get("/api/org/me").set(as(200, "Иван"));
    expect(me.body.profile.about).toBe("исполнитель, верстает");
  });

  it("маршрут отвечает графиком и «за сколько», и «кто я» их повторяет", async () => {
    /* Весь путь, каким идёт клиент: сохранил → получил в ответ запись →
       открыл вкладку заново и спросил «кто я». Обе точки должны говорить
       одно и то же, иначе после перехода между вкладками покажутся
       прежние дни. */
    await invite(200, "executor", "Иван");
    const res = await request(app).put("/api/org/me/profile").set(as(200, "Иван"))
      .send({ days: [1, 2, 5], from: "10:00", to: "19:00", status: "off", warnMin: 30 });
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({ about: "", days: [1, 2, 5], from: "10:00",
      to: "19:00", status: "off", warnMin: 30, deferMin: 30 });
    const me = await request(app).get("/api/org/me").set(as(200, "Иван"));
    expect(me.body.profile).toEqual(res.body.profile);
    // И владелец видит то же в списке людей — там выбирают, кому поручить.
    const org = await request(app).get("/api/org").set(as(100));
    expect(org.body.users.find((u) => u.id === "200"))
      .toMatchObject({ days: [1, 2, 5], status: "off", warnMin: 30 });
  });

  it("непозванному писать нечего: его в организации нет", async () => {
    expect((await request(app).put("/api/org/me/profile")
      .set(as(777, "Чужой")).send({ about: "кто-то" })).status).toBe(403);
  });

  it("чужую анкету не переписать — маршрут только про свою", async () => {
    await invite(200, "executor", "Иван");
    await request(app).put("/api/org/me/profile").set(as(200)).send({ about: "Иван" });
    await request(app).put("/api/org/me/profile").set(as(100)).send({ about: "Владелец" });
    const org = await request(app).get("/api/org").set(as(100));
    expect(org.body.users.find((u) => u.id === "200").about).toBe("Иван");
    expect(org.body.users.find((u) => u.id === "100").about).toBe("Владелец");
  });
});

/* ─────── ПОСТАНОВКА ЧЕРЕЗ СЕРВЕР ───────

   Форма постановки — для постановщика, не для владельца (ROADMAP v1.2).
   Модель целиком пишет владелец, поэтому у позванного постановщика своя
   операция, как «взять» у исполнителя: без неё его правки жили бы только
   в его окне, а «Поставить» меняло бы статус в памяти и нигде больше. */
describe("постановка через сервер", () => {
  const setup = (id, who, body) => request(app)
    .post(`/api/workspace/tasks/${id}/setup`).set(as(who)).send(body);
  // Актив с воркерами 500 (постановщик функции), 200, 300; 900 — в другом активе.
  const SETUP_MODEL = {
    entities: [{ id: "e1", name: "Я", crew: ["500", "200", "300"] },
      { id: "e2", name: "Чужой актив", crew: ["900"] }],
    traits: [{ id: "t1", e: "e1", l: "спрос" }],
    // «Есть» — по материалам (`lib/stock.js`), а не по числу в ресурсе.
    materials: [{ id: "m1", trait: "t1", kind: "text", qty: 100 }],
    funcs: [{ id: "f1", e: "e1", name: "Сбор заявок", dur: 2, durUnit: "ч",
      takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }], gives: [],
      setters: ["500"], owners: ["200"], reviewers: ["300"] }],
    kinds: [], okrs: [], hypos: [], edges: [],
    tasks: [{ id: "w1", funcId: "f1", title: "Из цели", status: "wait", setter: "500",
      assignee: null, reviewer: null, start: null, end: "2030-03-01T11:00", endBy: "auto",
      submissions: [], reviews: [], comments: [] }],
  };
  const saveSetupModel = (over = {}) => request(app).put("/api/workspace").set(as(100))
    .send({ model: { ...SETUP_MODEL, ...over } });
  const inviteAll = async () => {
    await invite(500, "reviewer", "Ольга");
    await invite(200, "executor", "Иван");
    await invite(300, "reviewer", "Пётр");
  };

  it("постановщик задачи ставит её: люди, срок — и она уходит в бэклог", async () => {
    await saveSetupModel();
    await inviteAll();
    // Позванному постановщику задача видна — со своим же активом и его людьми.
    const view = await request(app).get("/api/workspace").set(as(500, "Ольга"));
    expect(view.body.tasks.map((t) => t.id)).toEqual(["w1"]);
    expect(view.body.people.map((p) => p.name).sort()).toEqual(["Иван", "Ольга", "Пётр"]);
    expect(JSON.stringify(view.body.people)).not.toContain("900");

    const people = await setup("w1", 500, { assignee: "200", reviewer: "300",
      title: "Собрать заявки за неделю", body: "по трём каналам" });
    expect(people.status).toBe(200);
    expect(people.body).toMatchObject({ assignee: "200", reviewer: "300",
      title: "Собрать заявки за неделю", status: "wait" });

    const put = await setup("w1", 500, { status: "backlog" });
    expect(put.status).toBe(200);
    expect(put.body.status).toBe("backlog");
    // И это сохранилось: исполнитель видит задачу у себя в бэклоге.
    const ivan = await request(app).get("/api/workspace").set(as(200, "Иван"));
    expect(ivan.body.tasks.find((t) => t.id === "w1"))
      .toMatchObject({ status: "backlog", title: "Собрать заявки за неделю" });
  });

  it("чужую задачу не поставить — ни исполнителю, ни проверяющему", async () => {
    await saveSetupModel();
    await inviteAll();
    expect((await setup("w1", 200, { title: "моя" })).status).toBe(403);
    expect((await setup("w1", 300, { status: "backlog" })).status).toBe(403);
    expect((await setup("нет-такой", 500, { title: "x" })).status).toBe(404);
    expect((await setup("w1", 777, { title: "x" })).status).toBe(403);
    // Ничего не изменилось.
    const owner = await request(app).get("/api/workspace").set(as(100));
    expect(owner.body.tasks[0]).toMatchObject({ title: "Из цели", status: "wait" });
  });

  it("без исполнителя — отказ словами, теми же, что в форме", async () => {
    await saveSetupModel();
    await inviteAll();
    const res = await setup("w1", 500, { reviewer: "300", status: "backlog" });
    expect(res.status).toBe(400);
    expect(res.body.why).toBe("Не хватает: исполнитель");
    // Задача осталась ждать постановки, а проверяющий — не записан: отказ
    // ничего не пишет, иначе половина постановки жила бы без второй.
    const owner = await request(app).get("/api/workspace").set(as(100));
    expect(owner.body.tasks[0]).toMatchObject({ status: "wait", reviewer: null });
  });

  it("ресурсов не хватает — та же проверка, что у кнопки «Поставить»", async () => {
    await saveSetupModel({ materials: [{ id: "m1", trait: "t1", kind: "text", qty: 1 }] });
    await inviteAll();
    const res = await setup("w1", 500, { assignee: "200", reviewer: "300", status: "backlog" });
    expect(res.status).toBe(400);
    expect(res.body.why).toBe("Не хватает ресурсов: спрос — есть 1, нужно 4");
  });

  it("назначить можно только воркера актива этой функции", async () => {
    await saveSetupModel();
    await inviteAll();
    const res = await setup("w1", 500, { assignee: "900" });
    expect(res.status).toBe(400);
    expect(res.body.why).toMatch(/не из воркеров актива/);
    // Дата, которая не дата, — тоже отказ словами, а не «Invalid Date» в модели.
    const bad = await setup("w1", 500, { start: "потом" });
    expect(bad.status).toBe(400);
    expect(bad.body.why).toMatch(/не дата/);
  });

  it("исполнитель — только тот, у кого функция отмечена «может выполнять»", async () => {
    /* 300 — воркер актива и проверяющий, но функцию выполнять не может:
       у неё исполнитель только 200. Та же проверка, что в форме. */
    await saveSetupModel();
    await inviteAll();
    const res = await setup("w1", 500, { assignee: "300" });
    expect(res.status).toBe(400);
    expect(res.body.why).toMatch(/не может выполнять эту функцию/);
    const ok = await setup("w1", 500, { assignee: "200" });
    expect(ok.status).toBe(200);
  });

  it("поставленную отсюда не переписать: постановка закрыта", async () => {
    await saveSetupModel({ tasks: SETUP_MODEL.tasks.map((t) => ({ ...t, status: "backlog",
      assignee: "200", reviewer: "300" })) });
    await inviteAll();
    const res = await setup("w1", 500, { assignee: "300" });
    expect(res.status).toBe(400);
    expect(res.body.why).toMatch(/уже поставлена/);
  });

  it("владельцу маршрут тоже открыт — модель его", async () => {
    await saveSetupModel();
    const res = await setup("w1", 100, { assignee: "200", reviewer: "300", status: "backlog" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("backlog");
  });
});

/* Должности правит только владелец: кем человек числится — вопрос того,
   кто собирает организацию, а не самого человека. */
describe("должности через сервер", () => {
  it("владелец заводит и назначает, позванный — нет", async () => {
    await invite(200, "executor", "Иван");
    const made = await request(app).post("/api/org/positions").set(as(100))
      .send({ name: "Дизайнер" });
    expect(made.status).toBe(201);
    const set = await request(app).put("/api/org/users/200/position").set(as(100))
      .send({ position: made.body.id });
    expect(set.status).toBe(200);
    const org = await request(app).get("/api/org").set(as(100));
    expect(org.body.positions.map((p) => p.name)).toEqual(["Дизайнер"]);
    expect(org.body.users.find((u) => u.id === "200").position).toBe(made.body.id);

    // Позванному этот путь закрыт целиком — как и остальной список людей.
    expect((await request(app).post("/api/org/positions").set(as(200))
      .send({ name: "Свой" })).status).toBe(403);
    expect((await request(app).put("/api/org/users/200/position").set(as(200))
      .send({ position: "" })).status).toBe(403);
  });

  it("отказы называются словами", async () => {
    await invite(200, "executor", "Иван");
    const made = await request(app).post("/api/org/positions").set(as(100))
      .send({ name: "Аналитик" });
    expect((await request(app).post("/api/org/positions").set(as(100))
      .send({ name: "аналитик" })).status).toBe(400);
    expect((await request(app).put("/api/org/users/200/position").set(as(100))
      .send({ position: "нет-такой" })).status).toBe(400);
    expect((await request(app).put("/api/org/users/999/position").set(as(100))
      .send({ position: made.body.id })).status).toBe(404);
    expect((await request(app).delete("/api/org/positions/нет-такой").set(as(100))).status)
      .toBe(404);
    expect((await request(app).delete(`/api/org/positions/${made.body.id}`).set(as(100))).status)
      .toBe(204);
  });
});
