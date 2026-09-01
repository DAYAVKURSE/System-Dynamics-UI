import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addRole, addUser, identify, listOrg, removeRole, removeUser, setRoleTabs, setUserRole,
} from "../lib/orgStore.js";
import {
  readModel, reviewTask, submitTask, tasksFor, viewFor, writeModel,
} from "../lib/workspaceStore.js";

/* Кто ты, что тебе видно и что ты можешь изменить. */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-org-"));
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
});

describe("владелец", () => {
  it("первый вошедший становится владельцем и остаётся им", async () => {
    const first = await identify("100", { name: "Первый" });
    expect(first.isOwner).toBe(true);
    // Второй — уже не владелец, сколько бы раз ни заходил.
    expect((await identify("200", { name: "Второй" })).isOwner).toBe(false);
    expect((await identify("100", {})).isOwner).toBe(true);
  });

  it("переменная окружения перебивает записанного владельца", async () => {
    await identify("100", { name: "Первый" });
    process.env.OWNER_TELEGRAM_ID = "999";
    expect((await identify("100", {})).isOwner).toBe(false);
    expect((await identify("999", {})).isOwner).toBe(true);
  });

  it("владельцу видны все вкладки, и роль ему не нужна", async () => {
    const me = await identify("100", { name: "Первый" });
    expect(me.tabs).toContain("scheme");
    expect(me.tabs).toContain("json");
    expect(me.role).toBeNull();
  });

  it("владелец появляется в списке людей — иначе его не назначить", async () => {
    await identify("100", { name: "Первый" });
    const org = await listOrg();
    expect(org.users.map((u) => u.id)).toContain("100");
  });

  it("незваный гость не знаком системе и вкладок не получает", async () => {
    await identify("100", { name: "Владелец" });
    const guest = await identify("777", { name: "Чужой" });
    expect(guest.known).toBe(false);
    expect(guest.tabs).toEqual([]);
  });
});

describe("роли", () => {
  beforeEach(async () => { await identify("100", { name: "Владелец" }); });

  it("роль решает, какие вкладки видны", async () => {
    await addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
    expect((await identify("200", {})).tabs).toEqual(["tasks"]);
    await setUserRole("200", "reviewer");
    expect((await identify("200", {})).tabs).toEqual(["review"]);
  });

  it("новая роль по умолчанию только исполняет, а не проверяет", async () => {
    const role = await addRole({ name: "Дизайнер" });
    expect(role.tabs).toEqual(["tasks"]);
    expect(role.builtin).toBe(false);
  });

  it("роль с чужим именем не заводится дважды", async () => {
    await addRole({ name: "Дизайнер" });
    await expect(addRole({ name: "дизайнер" })).rejects.toThrow(/exists/);
  });

  it("набор вкладок роли правится, и несуществующие вкладки отсекаются", async () => {
    const role = await addRole({ name: "Аналитик" });
    await setRoleTabs(role.id, ["tasks", "sim", "выдумка"]);
    await addUser({ id: "300", name: "Аня", roleId: role.id, addedBy: "100" });
    expect((await identify("300", {})).tabs).toEqual(["tasks", "sim"]);
  });

  it("встроенную роль удалить нельзя — иначе приглашать станет некем", async () => {
    expect(await removeRole("executor")).toBe(false);
  });

  it("удаление роли оставляет людей без роли, а не раздаёт другую молча", async () => {
    const role = await addRole({ name: "Стажёр" });
    await addUser({ id: "400", name: "Стас", roleId: role.id, addedBy: "100" });
    expect(await removeRole(role.id)).toBe(true);
    const me = await identify("400", {});
    expect(me.role).toBeNull();
    expect(me.tabs).toEqual([]);
  });

  it("несуществующая роль при добавлении человека отвергается", async () => {
    await expect(addUser({ id: "500", roleId: "нет-такой" })).rejects.toThrow(/unknown role/);
  });

  it("владельца из списка не удалить", async () => {
    expect(await removeUser("100")).toBe(false);
    expect(await removeUser("200")).toBe(false);   // и несуществующего тоже
  });
});

describe("что видно в общей модели", () => {
  const MODEL = {
    entities: [{ id: "e1", name: "Я" }, { id: "e2", name: "Клиенты" },
      { id: "e3", name: "Секретный актив" }],
    traits: [
      { id: "t1", e: "e1", l: "рабочее время" },
      { id: "t2", e: "e2", l: "заявки" },
      { id: "t9", e: "e3", l: "тайна" },
    ],
    edges: [
      { id: "ed1", from: "e1", fromTrait: "t1", to: "t2", gives: 5 },
      { id: "ed9", from: "e3", fromTrait: "t9", to: "t9", gives: 1 },
    ],
    kinds: [{ id: "growth", name: "рост" }],
    okrs: [{ id: "kr1", goalId: "t2" }, { id: "kr9", goalId: "t9" }],
    tasks: [
      { id: "tk1", goalId: "t2", edgeId: "ed1", assignee: "200", reviewer: "300",
        title: "Моя задача", submissions: [] },
      { id: "tk9", goalId: "t9", edgeId: "ed9", assignee: "999", reviewer: "999",
        title: "Чужая задача", submissions: [] },
    ],
    hypos: [{ id: "h1", tokens: [] }],
  };

  it("владелец видит модель целиком", () => {
    const v = viewFor(MODEL, { id: "100", isOwner: true });
    expect(v.tasks).toHaveLength(2);
    expect(v.entities).toHaveLength(3);
  });

  it("исполнитель видит только свои задачи", () => {
    const v = viewFor(MODEL, { id: "200", isOwner: false });
    expect(v.tasks.map((t) => t.id)).toEqual(["tk1"]);
  });

  it("проверяющий видит то, что проверяет он", () => {
    const v = viewFor(MODEL, { id: "300", isOwner: false });
    expect(v.tasks.map((t) => t.id)).toEqual(["tk1"]);
  });

  it("посторонний не видит ни одной задачи", () => {
    expect(viewFor(MODEL, { id: "555", isOwner: false }).tasks).toEqual([]);
  });

  it("вместе с задачей приезжает только то, на что она ссылается", () => {
    const v = viewFor(MODEL, { id: "200", isOwner: false });
    // Цель, концы движения и их активы — да; чужой актив и его ресурс — нет.
    expect(v.traits.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(v.entities.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    expect(v.edges.map((e) => e.id)).toEqual(["ed1"]);
    expect(v.okrs.map((o) => o.id)).toEqual(["kr1"]);
  });

  it("черновики гипотез остаются у владельца", () => {
    expect(viewFor(MODEL, { id: "200", isOwner: false }).hypos).toEqual([]);
    expect(viewFor(MODEL, { id: "100", isOwner: true }).hypos).toHaveLength(1);
  });

  it("tasksFor не путает исполнителя с проверяющим по типу id", () => {
    // id приходит строкой из подписи и числом из бота — сравнение должно
    // выдерживать оба написания.
    const m = { tasks: [{ id: "a", assignee: 200 }, { id: "b", reviewer: "300" }] };
    expect(tasksFor(m, "200").map((t) => t.id)).toEqual(["a"]);
    expect(tasksFor(m, 300).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("что можно изменить", () => {
  const seed = () => writeModel({
    tasks: [{ id: "tk1", assignee: "200", reviewer: "300", status: "progress",
      submissions: [], comments: [] }],
  });

  it("исполнитель сдаёт свою задачу, и она уходит на проверку", async () => {
    await seed();
    const r = await submitTask("200", "tk1", { amount: 5, text: "готово" });
    expect(r.task.status).toBe("review");
    expect(r.task.submissions).toHaveLength(1);
    expect(r.task.submissions[0].amount).toBe(5);
  });

  it("чужую задачу сдать нельзя", async () => {
    await seed();
    expect((await submitTask("777", "tk1", { amount: 5 })).error).toBe("not yours");
    // И проверяющий не сдаёт за исполнителя.
    expect((await submitTask("300", "tk1", { amount: 5 })).error).toBe("not yours");
  });

  it("проверяющий принимает отчёт — задача становится готовой", async () => {
    await seed();
    const r = await reviewTask("300", "tk1", { accept: true, comment: "принято" });
    expect(r.task.status).toBe("done");
    expect(r.task.comments).toHaveLength(1);
  });

  it("возврат отчёта отправляет задачу обратно в работу", async () => {
    await seed();
    expect((await reviewTask("300", "tk1", { accept: false })).task.status).toBe("progress");
  });

  it("принять свою же задачу исполнитель не может", async () => {
    await seed();
    expect((await reviewTask("200", "tk1", { accept: true })).error).toBe("not yours");
  });

  it("несуществующая задача — «не найдено», а не тихий успех", async () => {
    await seed();
    expect((await submitTask("200", "нет", {})).error).toBe("not found");
    expect((await reviewTask("300", "нет", {})).error).toBe("not found");
  });

  it("модель на диске переживает запись и чтение", async () => {
    await writeModel({ traits: [{ id: "t1" }], tasks: [], лишнее: 1 });
    const m = await readModel();
    expect(m.traits).toHaveLength(1);
    expect(m.savedAt).toBeTruthy();
    // Посторонние ключи не сохраняются: документ модели — семь массивов.
    expect(m).not.toHaveProperty("лишнее");
  });
});
