import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addRole, addUser, identify, listOrg, removeRole, removeUser, setProfile,
  setRoleTabs, setUserRole,
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
    expect(me.tabs).toContain("tools");
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

  it("удалить можно любую роль, кроме последней — иначе приглашать станет некем", async () => {
    expect(await removeRole("executor")).toBe(true);     // встроенные тоже
    expect(await removeRole("reviewer")).toBe(true);
    expect(await removeRole("worker")).toBe(true);
    // Осталась одна — она не удаляется.
    const { roles } = await listOrg();
    expect(roles).toHaveLength(1);
    expect(await removeRole(roles[0].id)).toBe(false);
  });

  it("удалённая встроенная роль не воскресает при следующем чтении", async () => {
    await removeRole("executor");
    expect((await listOrg()).roles.map((r) => r.id)).not.toContain("executor");
  });

  it("старые имена вкладок в сохранённой роли читаются как «инструменты»", async () => {
    const role = await addRole({ name: "Архивная", tabs: ["json", "calls", "tasks"] });
    expect(role.tabs.sort()).toEqual(["tasks", "tools"]);
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
    kinds: [{ id: "growth", name: "рост" }],
    // Задача — выполнение функции; функция живёт в активе и связана с
    // ресурсами входами и выходами.
    funcs: [
      { id: "fn1", e: "e1", name: "Обработка",
        takes: [{ trait: "t1" }], gives: [{ trait: "t2", to: "e2" }] },
      { id: "fn9", e: "e3", name: "Тайная",
        takes: [{ trait: "t9" }], gives: [{ trait: "t9" }] },
    ],
    tasks: [
      { id: "tk1", funcId: "fn1", assignee: "200", reviewer: "300",
        title: "Моя задача", submissions: [] },
      { id: "tk9", funcId: "fn9", assignee: "999", reviewer: "999",
        title: "Чужая задача", submissions: [] },
    ],
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
    // Функция задачи, её ресурсы и активы — да; чужая функция, чужой актив
    // и его ресурс — нет.
    expect(v.funcs.map((f) => f.id)).toEqual(["fn1"]);
    expect(v.traits.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(v.entities.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("частей прежнего расчёта в срезе нет вовсе", () => {
    // Стрелки, OKR и гипотезы убраны из модели: их больше не считает
    // никто, и отдавать их незачем.
    const v = viewFor(MODEL, { id: "200", isOwner: false });
    expect(v.edges).toBeUndefined();
    expect(v.okrs).toBeUndefined();
    expect(v.hypos).toBeUndefined();
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
    const r = await submitTask("200", "tk1",
      { hours: 5, takes: { t1: 2 }, gives: { t2: 3 }, text: "готово" });
    expect(r.task.status).toBe("review");
    expect(r.task.submissions).toHaveLength(1);
    // Сдача — это факт выполнения: часы и сколько чего взяли и выдали.
    expect(r.task.submissions[0]).toMatchObject({ hours: 5, takes: { t1: 2 },
      gives: { t2: 3 } });
  });

  it("сдал и принял один человек — задача сразу готова", async () => {
    /* Проверка — это передача решения другому человеку. Совпали — принимать
       не у кого, и просить его нажать «принято» значило бы просить сообщить
       самому себе то, что он и так знает. Правило то же, что в интерфейсе:
       разойдись они — бот и доска говорили бы разное про одну задачу. */
    await writeModel({ tasks: [{ id: "tk2", assignee: "200", reviewer: "200",
      status: "progress", submissions: [], comments: [] }] });
    const r = await submitTask("200", "tk2", { hours: 3 });
    expect(r.task.status).toBe("done");
    expect(r.task.submissions).toHaveLength(1);
  });

  it("чужую задачу сдать нельзя", async () => {
    await seed();
    expect((await submitTask("777", "tk1", { hours: 5 })).error).toBe("not yours");
    // И проверяющий не сдаёт за исполнителя.
    expect((await submitTask("300", "tk1", { hours: 5 })).error).toBe("not yours");
  });

  it("проверяющий принимает отчёт — задача становится готовой", async () => {
    await seed();
    const r = await reviewTask("300", "tk1",
      { accept: true, comment: "принято", mark: 5 });
    expect(r.task.status).toBe("done");
    expect(r.task.comments).toHaveLength(1);
  });

  it("возврат отчёта отправляет задачу в бэклог с текстом доработки", async () => {
    await seed();
    const r = await reviewTask("300", "tk1", { accept: false, comment: "не хватает цифр" });
    expect(r.task.status).toBe("backlog");
    expect(r.task.comments[0].text).toBe("не хватает цифр");
  });

  it("вернуть без текста доработки нельзя — исполнителю нечего исправлять", async () => {
    await seed();
    expect((await reviewTask("300", "tk1", { accept: false })).error).toBe("comment required");
    // Принять молча тоже нельзя: без слов непонятно, за что оценка.
    expect((await reviewTask("300", "tk1", { accept: true, mark: 5 })).error)
      .toBe("comment required");
  });

  it("принять без оценки нельзя — она часть истории исполнителя", async () => {
    await seed();
    expect((await reviewTask("300", "tk1", { accept: true, comment: "ок" })).error)
      .toBe("mark required");
    // И оценка вне шкалы — не оценка.
    expect((await reviewTask("300", "tk1", { accept: true, comment: "ок", mark: 9 })).error)
      .toBe("mark required");
  });

  it("решение проверяющего ложится в историю задачи: кто, когда, сколько и за что", async () => {
    await seed();
    const { task } = await reviewTask("300", "tk1",
      { accept: true, comment: "чисто", mark: 4 });
    expect(task.reviews).toHaveLength(1);
    expect(task.reviews[0]).toMatchObject({ by: "300", accept: true, mark: 4,
      comment: "чисто" });
  });

  it("принять свою же задачу исполнитель не может", async () => {
    await seed();
    expect((await reviewTask("200", "tk1",
      { accept: true, comment: "ок", mark: 5 })).error).toBe("not yours");
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

/* АНКЕТА ЧЕЛОВЕКА.

   Рейтинг говорит, как человек работал, но не говорит, кто он. Анкету
   пишет он сам: заполненная кем-то другим, она была бы чужим мнением под
   чужим именем. */
describe("анкета", () => {
  it("новый человек начинается с пустой анкеты, а не с её отсутствия", async () => {
    const me = await identify("100", { name: "Первый" });
    expect(me.profile).toEqual({ title: "", about: "", skills: "", contact: "" });
  });

  it("человек пишет свою анкету, и она приходит вместе с «кто я»", async () => {
    await identify("100", { name: "Первый" });
    const saved = await setProfile("100", { title: "аналитик", about: "делаю отчёты" });
    expect(saved).toMatchObject({ title: "аналитик", about: "делаю отчёты" });
    expect((await identify("100", {})).profile.title).toBe("аналитик");
  });

  it("незаполненные поля не стираются: правится то, что прислали", async () => {
    await identify("100", {});
    await setProfile("100", { title: "аналитик", contact: "@ivan" });
    await setProfile("100", { title: "инженер" });
    const me = await identify("100", {});
    expect(me.profile.title).toBe("инженер");
    expect(me.profile.contact).toBe("@ivan");
  });

  it("анкета лежит рядом с человеком — её видно в списке организации", async () => {
    await identify("100", { name: "Первый" });
    await addUser({ id: "200", name: "Второй", roleId: "worker", addedBy: "100" });
    await setProfile("200", { skills: "верстает" });
    const org = await listOrg();
    expect(org.users.find((u) => u.id === "200").skills).toBe("верстает");
  });

  it("человека, которого нет, анкетой не завести", async () => {
    await identify("100", {});
    expect(await setProfile("999", { title: "никто" })).toBeNull();
  });
});
