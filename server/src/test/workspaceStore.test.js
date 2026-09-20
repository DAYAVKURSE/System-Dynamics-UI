import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* Склад модели — один файл, а писателей у него много: владелец целиком,
   исполнитель — «взять»/«отложить»/сдача, проверяющий — приём, участники —
   комментарии, планировщик — публикация оценок. Каждый из них читает файл,
   меняет своё и пишет обратно; без очереди два таких нажатия, пришедшие
   в одну миллисекунду, затирают друг друга — и одно из них пропадает
   молча. Здесь проверяется, что не пропадает ни одно. */

let tmp, store;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-store-"));
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  store = await import("../lib/workspaceStore.js");
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
});

const task = (id, status = "backlog") => ({
  id, assignee: "200", reviewer: "300", setter: "100", title: `Задача ${id}`,
  status, submissions: [], comments: [], reviews: [],
});
const ids = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("одновременные правки модели", () => {
  it("сто параллельных «взять», «отложить» и комментариев не теряют ни одной записи", async () => {
    const toTake = ids(40, "take");
    const toDefer = ids(30, "defer");
    await store.writeModel({
      tasks: [...toTake, ...toDefer].map((id) => task(id)).concat([task("talk", "progress")]),
    });

    const results = await Promise.all([
      ...toTake.map((id) => store.takeTask("200", id)),
      ...toDefer.map((id) => store.deferTask("200", id)),
      ...ids(30, "слово ").map((text) => store.addComment("300", "talk", { text, to: null })),
    ]);
    results.forEach((r) => expect(r.error).toBeUndefined());

    const model = await store.readModel();
    const byId = Object.fromEntries(model.tasks.map((t) => [t.id, t]));
    toTake.forEach((id) => expect(byId[id]).toMatchObject({ taken: true, status: "progress" }));
    toDefer.forEach((id) => expect(byId[id]).toMatchObject({ taken: false, status: "deferred" }));
    expect(byId.talk.comments.map((c) => c.text).sort())
      .toEqual(ids(30, "слово ").sort());
  });

  it("сдача, приём и удаление комментария тоже стоят в той же очереди", async () => {
    await store.writeModel({
      tasks: [task("s1", "progress"), task("s2", "progress"), task("r1", "review"),
        { ...task("d1", "progress"),
          comments: ids(20, "c").map((id) => ({ id, text: id, at: "2026-01-01T00:00:00Z",
            by: "300", to: null, hidden: false })) }],
    });
    const results = await Promise.all([
      store.submitTask("200", "s1", { hours: 1 }),
      store.submitTask("200", "s2", { hours: 2 }),
      store.reviewTask("300", "r1", { accept: true, mark: 4, comment: "принято" }),
      ...ids(20, "c").map((cid) => store.dropComment("300", "d1", cid, { isOwner: false })),
    ]);
    results.forEach((r) => expect(r.error).toBeUndefined());

    const model = await store.readModel();
    const byId = Object.fromEntries(model.tasks.map((t) => [t.id, t]));
    expect(byId.s1.submissions).toHaveLength(1);
    expect(byId.s2.submissions).toHaveLength(1);
    expect(byId.r1).toMatchObject({ status: "done" });
    expect(byId.r1.reviews).toHaveLength(1);
    expect(byId.d1.comments).toEqual([]);
  });

  it("withModel выполняет работы по очереди, а не вперемешку", async () => {
    await store.writeModel({ tasks: [] });
    const order = [];
    const slow = store.withModel(async (model) => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("медленная");
      model.tasks = [task("a")];
      await store.writeModel(model);
      return "a";
    });
    const fast = store.withModel(async (model) => {
      order.push("быстрая");
      // Быстрая работа видит то, что записала медленная: очередь, а не гонка.
      expect(model.tasks.map((t) => t.id)).toEqual(["a"]);
      return "b";
    });
    expect(await Promise.all([slow, fast])).toEqual(["a", "b"]);
    expect(order).toEqual(["медленная", "быстрая"]);
  });

  it("упавшая работа не останавливает очередь", async () => {
    await store.writeModel({ tasks: [] });
    await expect(store.withModel(async () => { throw new Error("сломалась"); }))
      .rejects.toThrow("сломалась");
    expect(await store.withModel(async (m) => m.tasks.length)).toBe(0);
  });
});

describe("запись файла модели", () => {
  it("пишется через временный файл: после записи в папке только model.json", async () => {
    await store.writeModel({ tasks: [task("x")] });
    const names = (await fs.readdir(process.env.WORKSPACE_DIR)).sort();
    expect(names).toEqual(["model.json"]);
    expect((await store.readModel()).tasks.map((t) => t.id)).toEqual(["x"]);
  });

  it("параллельные записи целиком не оставляют обрезанного файла", async () => {
    // Сто записей подряд без очереди (PUT целиком владельцем): каждая —
    // отдельный временный файл, поэтому последнее переименование побеждает
    // целым файлом, а не половиной.
    const big = { tasks: ids(200, "t").map((id) => task(id)) };
    await Promise.all(ids(20, "w").map(() => store.writeModel(big)));
    const model = await store.readModel();
    expect(model.tasks).toHaveLength(200);
    expect((await fs.readdir(process.env.WORKSPACE_DIR))).toEqual(["model.json"]);
  });
});

describe("удаление комментария", () => {
  const withComments = () => store.writeModel({
    tasks: [{ ...task("t1"),
      comments: [
        { id: "c1", text: "своё", at: "2026-01-01T00:00:00Z", by: "200", to: null, hidden: false },
        { id: "c2", text: "чужое", at: "2026-01-01T00:00:00Z", by: "300", to: "200", hidden: true },
      ] }],
  });

  it("автор убирает своё, а чужое — нет", async () => {
    await withComments();
    expect(await store.dropComment("200", "t1", "c2", { isOwner: false }))
      .toEqual({ error: "not yours" });
    const r = await store.dropComment("200", "t1", "c1", { isOwner: false });
    expect(r.task.comments.map((c) => c.id)).toEqual(["c2"]);
    expect((await store.readModel()).tasks[0].comments.map((c) => c.id)).toEqual(["c2"]);
  });

  it("владелец убирает любое", async () => {
    await withComments();
    const r = await store.dropComment("100", "t1", "c2", { isOwner: true });
    expect(r.task.comments.map((c) => c.id)).toEqual(["c1"]);
  });

  it("нет задачи или комментария — «не найдено», а не тихий успех", async () => {
    await withComments();
    expect(await store.dropComment("100", "нет", "c1", { isOwner: true })).toEqual({ error: "not found" });
    expect(await store.dropComment("100", "t1", "нет", { isOwner: true })).toEqual({ error: "not found" });
  });
});

/* КОГО В ЗАДАЧЕ МОЖНО НЕ НАЗЫВАТЬ (владелец, 2026-09-19): постановщика
   заменяет исполнитель, проверяющего — постановщик, и передавать работу в
   этом месте некому. Правило одно с доской (`selfReview` в
   `web/src/components/TasksBoard.jsx`) — иначе бот и доска показывали бы
   разное про одну и ту же задачу. */
describe("подразумеваемые роли", () => {
  it("проверяющего не назвали — сдача принимается сама", async () => {
    await store.writeModel({ tasks: [{ ...task("n1", "progress"), reviewer: null }] });
    const { task: t } = await store.submitTask("200", "n1", { hours: 1 });
    expect(t.status).toBe("done");
  });

  it("принимает постановщик, когда проверяющего нет", async () => {
    await store.writeModel({ tasks: [{ ...task("n2", "review"), reviewer: "" }] });
    const bad = await store.reviewTask("300", "n2", { accept: true, mark: 5, comment: "нет" });
    expect(bad.error).toBe("not yours");
    const ok = await store.reviewTask("100", "n2", { accept: true, mark: 5, comment: "принято" });
    expect(ok.error).toBeUndefined();
    expect(ok.task.status).toBe("done");
  });

  it("задача без постановщика видна исполнителю как своя", async () => {
    const model = { tasks: [{ ...task("n3"), setter: null }] };
    expect(store.tasksFor(model, "200").map((t) => t.id)).toEqual(["n3"]);
  });
});

/* ОТЗЫВ ИЗ БЭКЛОГА (владелец, 2026-09-19): «на вкладке проверки должна
   быть возможность отозвать те задачи, которые в бэклоге, для
   редактирования». Правило одно с доской — иначе окно и сервер говорили
   бы о задаче разное. */
describe("отзыв задачи", () => {
  const lying = (over = {}) => ({ id: "r1", funcId: "f1", title: "Лежит", status: "backlog",
    setter: "100", assignee: "200", reviewer: "300", end: "2030-03-01T11:00",
    submissions: [], reviews: [], comments: [], ...over });

  it("из бэклога — в «ждут постановки», с пометкой «отозвана»", async () => {
    await store.writeModel({ tasks: [lying()], funcs: [], entities: [] });
    const { task } = await store.setupTask("100", "r1", { status: "wait" }, { isOwner: true });
    expect(task).toMatchObject({ status: "wait", held: true, taken: false });
  });

  it("взятую в работу и сданную не отзывают", async () => {
    await store.writeModel({ tasks: [lying({ taken: true })], funcs: [], entities: [] });
    expect((await store.setupTask("100", "r1", { status: "wait" }, { isOwner: true })).error)
      .toBe("already set");
    await store.writeModel({ tasks: [lying({ submissions: [{ id: "s", hours: 1 }] })],
      funcs: [], entities: [] });
    expect((await store.setupTask("100", "r1", { status: "wait" }, { isOwner: true })).error)
      .toBe("already set");
  });

  it("поставили заново — пометка снимается", async () => {
    await store.writeModel({
      entities: [{ id: "e1", crew: ["200"] }],
      funcs: [{ id: "f1", e: "e1", name: "Ф", takes: [], gives: [], owners: ["200"] }],
      tasks: [lying({ status: "wait", held: true })],
    });
    const { task } = await store.setupTask("100", "r1", { status: "backlog" }, { isOwner: true });
    expect(task).toMatchObject({ status: "backlog", held: false });
  });

  /* КОГДА ПОСТАВИЛИ — ЧАС СЕРВЕРА (владелец, 2026-09-20): «даты, когда была
     поставлена задача, когда должна быть дана». Присланную клиентом дату
     не берём: её читают все, и подсунуть её задним числом нельзя. */
  it("момент постановки записывается сервером, а не берётся из запроса", async () => {
    await store.writeModel({
      entities: [{ id: "e1", crew: ["200"] }],
      funcs: [{ id: "f1", e: "e1", name: "Ф", takes: [], gives: [], owners: ["200"] }],
      tasks: [lying({ status: "wait" })],
    });
    const before = Date.now();
    const { task } = await store.setupTask("100", "r1",
      { status: "backlog", setAt: "2000-01-01T00:00:00.000Z" }, { isOwner: true });
    expect(Date.parse(task.setAt)).toBeGreaterThanOrEqual(before);
  });
});
