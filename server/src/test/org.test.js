import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addAgentUser, addForm, addRole, addUser, agentUserId, identify, listOrg, openRoles, renameRole,
  registerUser, removeForm, removeRole, removeUser, renameAgentUser, setForm, setProfile,
  setRoleContract, setRoleForm, setRoleTabs, setUserRole, setUserRoles,
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
/* Прежняя запись org.json — как она лежала на диске до нынешнего вида:
   проверяем, что её читают, а не теряют. */
const writeRaw = async (org) => {
  await fs.mkdir(process.env.ORG_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.ORG_DIR, "org.json"),
    JSON.stringify(org, null, 2), "utf8");
};
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

describe("переименование роли (владелец, 2026-09-18)", () => {
  it("имя меняется на месте; занятое другой ролью — отказ; чужой id — null", async () => {
    const role = await addRole({ name: "Дизайнер" });
    await addRole({ name: "Аналитик" });
    expect((await renameRole(role.id, "Верстальщик")).name).toBe("Верстальщик");
    expect((await listOrg()).roles.find((r) => r.id === role.id).name).toBe("Верстальщик");
    await expect(renameRole(role.id, "аналитик")).rejects.toThrow(/exists/);
    await expect(renameRole(role.id, "  ")).rejects.toThrow(/required/);
    expect(await renameRole("нет-такой", "x")).toBeNull();
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
    await setRoleTabs(role.id, ["tasks", "reports", "выдумка"]);
    await addUser({ id: "300", name: "Аня", roleId: role.id, addedBy: "100" });
    expect((await identify("300", {})).tabs).toEqual(["tasks", "reports"]);
  });

  it("прежние имена вкладок читаются как нынешние, а не теряются", async () => {
    /* «Таймлайн» и «Прогноз» стали разделами «Схемы», «выгрузка» и
       «звонки» — разделами «Инструментов». Роль, заведённая вчера, не
       должна проснуться без вкладки. */
    const role = await addRole({ name: "Плановик" });
    await setRoleTabs(role.id, ["timeline", "sim", "json", "calls"]);
    await addUser({ id: "301", name: "Пётр", roleId: role.id, addedBy: "100" });
    expect((await identify("301", {})).tabs).toEqual(["scheme", "tools"]);
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

  it("процесс приезжает вместе со своей функцией, чужой — нет", () => {
    /* Без процесса функция гипотезы читалась бы у позванного как
       принятая — «процесс неизвестен, значит принят» — и его прогноз
       считал бы то, чего владелец ещё не решил. */
    const fid = MODEL.tasks.find((t) => t.id === "tk1").funcId;
    const m = { ...MODEL,
      procs: [{ id: "pr1", text: "", status: "hypo" }, { id: "pr9", text: "", status: "on" }],
      funcs: MODEL.funcs.map((f) => (f.id === fid ? { ...f, proc: "pr1" } : f)) };
    expect(viewFor(m, { id: "200", isOwner: false }).procs.map((p) => p.id)).toEqual(["pr1"]);
    expect(viewFor(MODEL, { id: "200", isOwner: false }).procs).toEqual([]);
    expect(viewFor(m, { id: "100", isOwner: true }).procs).toHaveLength(2);
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
      submissions: [], chat: [] }],
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
      status: "progress", submissions: [], chat: [] }] });
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
    // Слова решения ложатся в обсуждение задачи.
    expect(r.task.chat).toHaveLength(1);
  });

  it("возврат отчёта отправляет задачу в бэклог с текстом доработки", async () => {
    await seed();
    const r = await reviewTask("300", "tk1", { accept: false, comment: "не хватает цифр" });
    expect(r.task.status).toBe("backlog");
    expect(r.task.chat[0].text).toBe("не хватает цифр");
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
    // И оценка вне шкалы (она десятибалльная) — не оценка.
    expect((await reviewTask("300", "tk1", { accept: true, comment: "ок", mark: 11 })).error)
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
    /* Поле анкеты одно: что о себе писать, решает человек. Рядом с ней —
       рабочий график и статус: они отвечают не «кто это», а «работает ли
       он сейчас», и спрашивают их раньше. */
    /* Имя едет вместе с анкетой: его правят там же, и везде, где
       приложение показывает человека, оно берётся отсюда. */
    expect(me.profile).toEqual({ name: "Первый", about: "", days: [], from: "", to: "",
      perDay: {}, status: "ready", statusAt: null, warnMin: 10, deferMin: 30, answers: {} });
  });

  /* ИМЯ — В АНКЕТЕ (владелец, 2026-09-20): человек называет себя сам, и
     этим именем он зовётся везде; телеграмное его больше не переписывает. */
  it("своё имя сильнее телеграмного и не затирается на входе", async () => {
    await identify("100", { name: "Из телеграма" });
    const saved = await setProfile("100", { name: "  Как я себя зову  " });
    expect(saved.name).toBe("Как я себя зову");
    // Следующий вход с прежним телеграмным именем его не возвращает.
    const me = await identify("100", { name: "Из телеграма" });
    expect(me.name).toBe("Как я себя зову");
    expect(me.profile.name).toBe("Как я себя зову");
    // И в списке людей — то же имя: оттуда его берут все остальные формы.
    expect((await listOrg()).users.find((u) => u.id === "100").name)
      .toBe("Как я себя зову");
  });

  it("пустое имя не принимается — безымянного человека не выберешь", async () => {
    await identify("100", { name: "Первый" });
    await setProfile("100", { name: "   " });
    expect((await identify("100", {})).name).toBe("Первый");
  });

  it("человек пишет свою анкету, и она приходит вместе с «кто я»", async () => {
    await identify("100", { name: "Первый" });
    const saved = await setProfile("100", { about: "делаю отчёты" });
    expect(saved).toMatchObject({ about: "делаю отчёты" });
    expect((await identify("100", {})).profile.about).toBe("делаю отчёты");
  });

  /* ─── рабочий график и статус ───

     Со слов самого человека, тем же маршрутом, что и анкета. Сюда приходит
     то, что прислал браузер, поэтому всё разбирается: «понедельник» или
     «25:00» в записи означали бы график, по которому нельзя сказать
     ничего. */
  it("график и статус человек пишет сам, и они разбираются, а не берутся", async () => {
    await identify("100", { name: "Первый" });
    const saved = await setProfile("100", {
      days: [1, 2, 3, 4, 5, 5, 9, -1, "вторник"], from: "09:00", to: "25:00",
      status: "выдумка",
    });
    expect(saved.days).toEqual([1, 2, 3, 4, 5]);
    expect(saved.from).toBe("09:00");
    // Час вне суток — это не час: пусто честнее выдуманного времени.
    expect(saved.to).toBe("");
    expect(saved.status).toBe("ready");
    expect((await identify("100", {})).profile.status).toBe("ready");
  });

  it("статус меняется отдельно от графика: одно постоянное, другое сиюминутное",
    async () => {
      await identify("100", {});
      await setProfile("100", { days: [1, 2, 3], from: "10:00", to: "19:00" });
      const saved = await setProfile("100", { status: "off" });
      expect(saved.status).toBe("off");
      // График при этом на месте: статус его не отменяет.
      expect(saved.days).toEqual([1, 2, 3]);
      expect(saved.to).toBe("19:00");
    });

  it("setProfile отвечает графиком целиком — клиенту есть что положить в «кто я»",
    async () => {
      /* Ответ на сохранение — то, что теперь записано, а не эхо запроса:
         клиент подставляет его в свою запись «кто я» и заново показывает
         анкету из него. Пришёл бы ответ без графика — вкладка, открытая
         повторно, показала бы пустые дни. */
      await identify("100", {});
      const saved = await setProfile("100", { days: [1, 3], from: "09:00", to: "18:00",
        status: "break", about: "аналитик" });
      expect(saved).toEqual({ name: "владелец", about: "аналитик", days: [1, 3],
        from: "09:00", to: "18:00", perDay: {}, status: "break",
        statusAt: expect.any(String), warnMin: 10, deferMin: 30, answers: {} });
      // И «кто я» после этого говорит то же самое.
      expect((await identify("100", {})).profile).toEqual(saved);
      /* Момент выбора: из запроса, если прислан, иначе — момент смены;
         повтор того же статуса без метки её не двигает. */
      const t0 = saved.statusAt;
      const same = await setProfile("100", { status: "break" });
      expect(same.statusAt).toBe(t0);
      const sent = await setProfile("100", { status: "break", statusAt: "2026-09-14T07:00:00.000Z" });
      expect(sent.statusAt).toBe("2026-09-14T07:00:00.000Z");
      const bad = await setProfile("100", { status: "ready", statusAt: "вчера" });
      expect(bad.statusAt).not.toBe("2026-09-14T07:00:00.000Z");
      expect(Date.parse(bad.statusAt)).toBeGreaterThan(Date.parse(t0) - 1);
    });

  /* ─── часы отдельного дня ───

     «В субботу с 10 до 14» — исключение из общих часов, записанное самому
     дню. Разбирается так же строго, как и общие часы, и живёт только у
     рабочего дня: выключили день — ушли и его часы. */
  it("часы дня сохраняются и разбираются, а не берутся как есть", async () => {
    await identify("100", {});
    const saved = await setProfile("100", {
      days: [1, 2, 6], from: "09:00", to: "18:00",
      perDay: { 6: { from: "10:00", to: "14:00" }, 2: { from: "9:00", to: "25:00" },
        3: { from: "11:00", to: "12:00" }, 9: { from: "10:00" }, вт: { from: "10:00" } },
    });
    // Суббота — рабочая, часы верные: записаны. Вторник — оба часа выдуманы,
    // записи нет. Среда — не рабочий день, и часов у неё быть не может.
    expect(saved.perDay).toEqual({ 6: { from: "10:00", to: "14:00" } });
    // И «кто я», и список людей отдают то же самое.
    expect((await identify("100", {})).profile.perDay)
      .toEqual({ 6: { from: "10:00", to: "14:00" } });
    expect((await listOrg()).users.find((u) => u.id === "100").perDay)
      .toEqual({ 6: { from: "10:00", to: "14:00" } });
  });

  it("день выключили — его часы ушли вместе с ним", async () => {
    await identify("100", {});
    await setProfile("100", { days: [1, 6], perDay: { 6: { from: "10:00", to: "14:00" } } });
    const saved = await setProfile("100", { days: [1] });
    expect(saved.perDay).toEqual({});
  });

  it("прежняя запись без часов дня читается как прежде", async () => {
    await identify("100", {});
    const saved = await setProfile("100", { days: [1, 2], from: "10:00", to: "19:00" });
    expect(saved.perDay).toEqual({});
    expect(saved).toMatchObject({ days: [1, 2], from: "10:00", to: "19:00" });
  });

  /* ─── за сколько предупреждать ───

     Настройка человека, а не задачи: напоминание приходит ему, и на
     сколько заранее ему удобно, знает он, а не постановщик. */
  it("«за сколько предупреждать» — своё у человека, по умолчанию 10 минут", async () => {
    await identify("100", {});
    expect((await setProfile("100", { warnMin: 30 })).warnMin).toBe(30);
    expect((await identify("100", {})).profile.warnMin).toBe(30);
    // Ноль — тоже ответ: «только в момент начала», а не «не названо».
    expect((await setProfile("100", { warnMin: 0 })).warnMin).toBe(0);
    // Анкета и график при этом не трогаются.
    await setProfile("100", { about: "аналитик" });
    expect((await identify("100", {})).profile).toMatchObject({ about: "аналитик", warnMin: 0 });
  });

  it("«за сколько» — целые минуты не дальше суток; не число — умолчание", async () => {
    await identify("100", {});
    expect((await setProfile("100", { warnMin: "45" })).warnMin).toBe(45);
    expect((await setProfile("100", { warnMin: 12.6 })).warnMin).toBe(13);
    // «За неделю» — это «за сутки, раньше не умеем», а не ошибка.
    expect((await setProfile("100", { warnMin: 99999 })).warnMin).toBe(1440);
    expect((await setProfile("100", { warnMin: -5 })).warnMin).toBe(0);
    expect((await setProfile("100", { warnMin: "скоро" })).warnMin).toBe(10);
  });

  it("график и статус приходят вместе со списком людей", async () => {
    /* Их спрашивают там же, где выбирают, кому поручить работу. Собирать
       их вторым запросом на каждого человека значило бы спрашивать по
       одному то, что уже лежит рядом. */
    await identify("100", { name: "Первый" });
    await setProfile("100", { days: [1, 2], from: "09:00", status: "break", warnMin: 20 });
    const org = await listOrg();
    expect(org.users.find((u) => u.id === "100"))
      .toMatchObject({ days: [1, 2], from: "09:00", status: "break", warnMin: 20 });
  });

  it("прежние четыре поля не пропадают: пустая анкета читается как их склейка", async () => {
    /* Молча выбросить то, что человек уже о себе написал, было бы хуже
       всего. Первое же сохранение перенесёт текст в анкету насовсем. */
    await identify("100", {});
    // Так выглядит запись, собранная прежней версией: четыре поля вместо
    // анкеты. Правим файл, потому что писать в эти поля больше нечем.
    const file = path.join(process.env.ORG_DIR, "org.json");
    const org = JSON.parse(await fs.readFile(file, "utf8"));
    Object.assign(org.users.find((u) => u.id === "100"),
      { title: "аналитик", contact: "@ivan" });
    await fs.writeFile(file, JSON.stringify(org));
    expect((await identify("100", {})).profile.about).toBe("аналитик\n@ivan");
    // А первое же сохранение переносит текст в анкету насовсем.
    await setProfile("100", { about: "аналитик, @ivan" });
    expect((await identify("100", {})).profile.about).toBe("аналитик, @ivan");
  });

  it("анкета лежит рядом с человеком — её видно в списке организации", async () => {
    await identify("100", { name: "Первый" });
    await addUser({ id: "200", name: "Второй", roleId: "worker", addedBy: "100" });
    await setProfile("200", { about: "верстает" });
    const org = await listOrg();
    expect(org.users.find((u) => u.id === "200").about).toBe("верстает");
  });

  it("человека, которого нет, анкетой не завести", async () => {
    await identify("100", {});
    expect(await setProfile("999", { about: "никто" })).toBeNull();
  });
});

/* ─────── договор как акцепт ───────

   Участником человек становится не потому, что его добавили, а потому,
   что подписал договор. Шаблон лежит у роли, подписанный экземпляр
   приносит сам человек — и по нему система выдаёт ему роль. */
const DOC = { name: "договор.pdf", type: "application/pdf", size: 10,
  url: "/api/reports/u/1" };
const SIGNED = { name: "подписан.pdf", type: "application/pdf", size: 12,
  url: "/api/reports/u/2" };

describe("договор роли", () => {
  it("незваный подписал договор — это заявка, а не роль", async () => {
    await identify("100", { name: "Владелец" });
    const role = await addRole({ name: "Курьер", tabs: ["tasks"] });
    await setRoleContract(role.id, DOC);
    // Что подписывать, видно всякому, кто открыл приложение.
    const open = await openRoles();
    expect(open.find((r) => r.id === role.id).contract.name).toBe("договор.pdf");

    await registerUser("700", { name: "Новый" }, { roleId: role.id, file: SIGNED, start: "2026-01-01", end: "2026-12-31" });
    const me = await identify("700", { name: "Новый" });
    // Роли и доступа нет: впустить решает владелец (владелец, 2026-09-20).
    expect(me.roles).toEqual([]);
    expect(me.tabs).toEqual([]);
    expect(me.waiting).toEqual({ id: role.id, name: "Курьер" });
    const user = (await listOrg()).users.find((u) => u.id === "700");
    expect(user.contracts[role.id].name).toBe("подписан.pdf");
    expect(user.contracts[role.id].at).toBeTruthy();

    // Владелец добавил — заявки больше нет, вкладки открылись.
    await setUserRoles("700", [role.id]);
    const done = await identify("700", {});
    expect(done.waiting).toBe(null);
    expect(done.roles.map((r) => r.id)).toEqual([role.id]);
    expect(done.tabs).toEqual(["tasks"]);
  });

  it("без подписанного экземпляра роль не выдаётся", async () => {
    await identify("100", { name: "Владелец" });
    const role = await addRole({ name: "Юрист", tabs: ["tasks"] });
    await setRoleContract(role.id, DOC);
    await expect(registerUser("701", {}, { roleId: role.id }))
      .rejects.toThrow(/contract is required/);
    expect((await identify("701", {})).known).toBe(false);
  });

  /* У ДОГОВОРА ВСЕГДА ЕСТЬ СРОК (владелец, 2026-09-20): у принесённого
     файлом плейсхолдеров нет, и даты называет тот, кто его подписал. */
  it("подписанный экземпляр без дат не принимается", async () => {
    await identify("100", { name: "Владелец" });
    const role = await addRole({ name: "Курьер", tabs: ["tasks"] });
    await setRoleContract(role.id, DOC);
    await expect(registerUser("705", {}, { roleId: role.id, file: SIGNED }))
      .rejects.toThrow(/dates are required/);
    await expect(registerUser("705", {}, { roleId: role.id, file: SIGNED, start: "2026-01-01" }))
      .rejects.toThrow(/dates are required/);
    await registerUser("705", {}, { roleId: role.id, file: SIGNED,
      start: "2026-01-01", end: "2026-12-31" });
    const user = (await listOrg()).users.find((u) => u.id === "705");
    expect(user.contracts[role.id].start).toBe("2026-01-01");
    expect(user.contracts[role.id].end).toBe("2026-12-31");
  });

  it("роль без договора подписывать нечем — но владельца всё равно ждут", async () => {
    await identify("100", { name: "Владелец" });
    const role = await addRole({ name: "Гость", tabs: ["tasks"] });
    await registerUser("702", { name: "Гость" }, { roleId: role.id });
    const me = await identify("702", {});
    expect(me.roles).toEqual([]);
    expect(me.waiting.id).toBe(role.id);
  });

  it("вторая роль добавляется к первой, а не заменяет её", async () => {
    await identify("100", { name: "Владелец" });
    const a = await addRole({ name: "Первая", tabs: ["tasks"] });
    const b = await addRole({ name: "Вторая", tabs: ["review"] });
    await setRoleContract(a.id, DOC);
    await setRoleContract(b.id, DOC);
    await registerUser("703", { name: "Оба" }, { roleId: a.id, file: SIGNED, start: "2026-01-01", end: "2026-12-31" });
    // Первую роль открыл владелец; дальше человек уже участник, и вторую
    // ему выдаёт сама подпись.
    await setUserRoles("703", [a.id]);
    await registerUser("703", { name: "Оба" }, { roleId: b.id, file: SIGNED, start: "2026-01-01", end: "2026-12-31" });
    const me = await identify("703", {});
    expect(me.roles.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(me.tabs).toEqual(["tasks", "review"]);
  });

  it("приглашение владельца ждёт договора, а не выдаёт роль молча", async () => {
    /* «Акцептом добавления участника является договор»: позвали — значит
       приготовили роль, а получит он её, когда подпишет. */
    await identify("100", { name: "Владелец" });
    const role = await addRole({ name: "Подрядчик", tabs: ["tasks"] });
    await setRoleContract(role.id, DOC);
    await addUser({ id: "704", name: "Ждущий", roleId: role.id, addedBy: "100" });
    const waiting = await identify("704", {});
    expect(waiting.roles).toEqual([]);
    expect(waiting.pending).toBe(role.id);
    expect(waiting.tabs).toEqual([]);
    // Подписал — роль есть, и ждать больше нечего.
    await registerUser("704", {}, { roleId: role.id, file: SIGNED, start: "2026-01-01", end: "2026-12-31" });
    const done = await identify("704", {});
    expect(done.roles.map((r) => r.id)).toEqual([role.id]);
    expect(done.pending).toBe("");
  });

  it("роль без договора приглашением выдаётся сразу — подписывать нечего", async () => {
    await identify("100", { name: "Владелец" });
    await addUser({ id: "705", name: "Простой", roleId: "executor", addedBy: "100" });
    expect((await identify("705", {})).roles.map((r) => r.id)).toEqual(["executor"]);
  });
});

/* ─────── роли человека ───────
   Должностей больше нет: роль и есть ответ на «кто он здесь». Ролей у
   человека бывает несколько — тогда вкладки складываются. */
describe("роли человека", () => {
  it("их несколько, и вкладки складываются", async () => {
    await identify("100", { name: "Владелец" });
    const design = await addRole({ name: "Дизайнер", tabs: [] });
    await addUser({ id: "500", name: "Иван", roleId: "executor", addedBy: "100" });
    await setUserRoles("500", ["executor", design.id]);
    const org = await listOrg();
    expect(org.users.find((u) => u.id === "500").roles).toEqual(["executor", design.id]);
    // «Дизайнер» вкладок не даёт, «исполнитель» даёт «Задачи» — вместе это «Задачи».
    expect((await identify("500", {})).tabs).toEqual(["tasks"]);
    await setRoleTabs(design.id, ["reports"]);
    expect((await identify("500", {})).tabs).toEqual(["tasks", "reports"]);
    expect((await identify("500", {})).roles.map((r) => r.id))
      .toEqual(["executor", design.id]);
  });

  it("чужая роль не назначается, а пустой список — это «без ролей»", async () => {
    await identify("100", { name: "Владелец" });
    await addUser({ id: "501", name: "Пётр", roleId: "executor", addedBy: "100" });
    await expect(setUserRoles("501", ["нет-такой"])).rejects.toThrow(/unknown role/);
    await setUserRoles("501", []);
    expect((await identify("501", {})).tabs).toEqual([]);
  });

  it("удалённая роль уходит у всех, а остальные остаются", async () => {
    await identify("100", { name: "Владелец" });
    const design = await addRole({ name: "Бухгалтер", tabs: [] });
    await addUser({ id: "502", name: "Ольга", roleId: "executor", addedBy: "100" });
    await setUserRoles("502", ["executor", design.id]);
    expect(await removeRole(design.id)).toBe(true);
    const olga = (await listOrg()).users.find((u) => u.id === "502");
    expect(olga.roles).toEqual(["executor"]);
  });

  it("прежние записи читаются как роли: одиночная роль и должность", async () => {
    /* В org.json лежали `roleId` (что показывать) и `position` (кем
       числится). Это один вопрос, и теперь он один: обе записи читаются
       как роли, и человек не теряет ни доступа, ни своего дела. */
    await writeRaw({
      ownerId: "100",
      roles: [{ id: "executor", name: "исполнитель", tabs: ["tasks"] }],
      positions: [{ id: "дизайнер", name: "Дизайнер" }],
      users: [{ id: "600", name: "Старый", roleId: "executor", position: "дизайнер" }],
    });
    const org = await listOrg();
    expect(org.roles.map((r) => r.id)).toEqual(["executor", "дизайнер"]);
    expect(org.roles.find((r) => r.id === "дизайнер").tabs).toEqual([]);
    expect(org.users[0].roles).toEqual(["executor", "дизайнер"]);
    expect((await identify("600", {})).tabs).toEqual(["tasks"]);
  });
});

/* ─────── АНКЕТЫ КАК СЛОВАРИ ───────

   Анкета — словарь вопросов, и назначается она РОЛИ: дизайнера спрашивают
   про стек, курьера — про район. Ответы лежат у человека по идентификатору
   вопроса, а не по тексту: владелец поправил формулировку — ответ остался
   при вопросе. Старые записи без анкет читаются как прежде. */
describe("анкеты как словари", () => {
  beforeEach(async () => { await identify("100", { name: "Владелец" }); });

  it("анкета заводится пустой, и вопросы правятся списком строк", async () => {
    const form = await addForm({ name: "Анкета дизайнера" });
    expect(form.questions).toEqual([]);
    const set = await setForm(form.id, { questions: ["Стек", "Уровень", "   "] });
    // Пустой текст — это не вопрос.
    expect(set.questions.map((q) => q.text)).toEqual(["Стек", "Уровень"]);
    expect(set.questions.every((q) => /^q[0-9a-f]{8}$/.test(q.id))).toBe(true);
    expect((await listOrg()).forms).toEqual([set]);
  });

  it("без названия анкета не заводится, а одинаковые названия получают разные id", async () => {
    await expect(addForm({ name: "  " })).rejects.toThrow(/required/);
    // Список вопросов принимается сразу, с новыми идентификаторами.
    const loaded = await addForm({ name: "Курьер", questions: ["Район", "", { text: "Транспорт" }] });
    expect(loaded.questions.map((q) => q.text)).toEqual(["Район", "Транспорт"]);
    expect(new Set(loaded.questions.map((q) => q.id)).size).toBe(2);
    const a = await addForm({ name: "Общая" });
    const b = await addForm({ name: "Общая" });
    expect(a.id).not.toBe(b.id);
  });

  it("идентификатор вопроса переживает правку текста, а удалённый вопрос уносит свой", async () => {
    const form = await addForm({ name: "Анкета" });
    const v1 = await setForm(form.id, { questions: ["Стек", "Уровень"] });
    const [stack, level] = v1.questions;
    // Переформулировали первый, убрали второй, добавили третий.
    const v2 = await setForm(form.id, { name: "Анкета разработчика",
      questions: [{ id: stack.id, text: "Стек и инструменты" }, "Языки"] });
    expect(v2.name).toBe("Анкета разработчика");
    expect(v2.questions[0]).toEqual({ id: stack.id, text: "Стек и инструменты" });
    expect(v2.questions[1].id).not.toBe(level.id);
    // Чужой идентификатор в присланном вопросе не принимается: это новый вопрос.
    const v3 = await setForm(form.id, { questions: [{ id: "qdeadbeef", text: "Новый" }] });
    expect(v3.questions[0].id).not.toBe("qdeadbeef");
    expect(await setForm("нет-такой", { questions: [] })).toBeNull();
  });

  it("роль получает анкету, и «кто я» отдаёт вопросы по всем ролям без повторов", async () => {
    const dev = await addForm({ name: "Разработчик" });
    await setForm(dev.id, { questions: ["Стек"] });
    const common = await addForm({ name: "Общая" });
    await setForm(common.id, { questions: ["Город"] });
    await setRoleForm("executor", common.id);
    await setRoleForm("reviewer", common.id);
    const role = await addRole({ name: "Дизайнер" });
    await setRoleForm(role.id, dev.id);
    await addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
    await setUserRoles("200", ["executor", "reviewer", role.id]);
    const me = await identify("200", {});
    // Две роли с одной анкетой — анкета одна; порядок — по ролям человека.
    expect(me.forms.map((f) => f.name)).toEqual(["Общая", "Разработчик"]);
    expect(me.forms[0].questions.map((q) => q.text)).toEqual(["Город"]);
    // Роль без анкеты вопросов не добавляет; снятая анкета — тоже.
    await setRoleForm(role.id, null);
    expect((await identify("200", {})).forms.map((f) => f.name)).toEqual(["Общая"]);
    expect((await listOrg()).roles.find((r) => r.id === role.id).form).toBeNull();
  });

  it("чужая анкета роли не назначается, а несуществующая роль — null", async () => {
    await expect(setRoleForm("executor", "нет-такой")).rejects.toThrow(/unknown form/);
    expect(await setRoleForm("нет-такой", null)).toBeNull();
  });

  it("ответы лежат по вопросу, ложатся поверх прежних и обрезаются до лимита", async () => {
    const form = await addForm({ name: "Анкета" });
    const { questions: [a, b] } = await setForm(form.id, { questions: ["Стек", "Уровень"] });
    await setRoleForm("executor", form.id);
    await addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
    const saved = await setProfile("200",
      { answers: { [a.id]: "React", [b.id]: "x".repeat(2500) } });
    expect(saved.answers[a.id]).toBe("React");
    expect(saved.answers[b.id]).toHaveLength(2000);
    // Второй запрос с одним ответом не стирает другой.
    const again = await setProfile("200", { answers: { [b.id]: "middle" } });
    expect(again.answers).toEqual({ [a.id]: "React", [b.id]: "middle" });
    expect((await identify("200", {})).profile.answers).toEqual(again.answers);
    // И владелец видит ответы вместе с вопросами в списке людей.
    const ivan = (await listOrg()).users.find((u) => u.id === "200");
    expect(ivan.answers).toEqual(again.answers);
    expect(ivan.forms.map((f) => f.id)).toEqual([form.id]);
    // Поле «о себе» при этом живёт как прежде.
    expect((await setProfile("200", { about: "верстаю" })).about).toBe("верстаю");
  });

  it("удалённая анкета снимается с ролей, а ответы человека остаются", async () => {
    const form = await addForm({ name: "Анкета" });
    const { questions: [q] } = await setForm(form.id, { questions: ["Стек"] });
    await setRoleForm("executor", form.id);
    await addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
    await setProfile("200", { answers: { [q.id]: "React" } });
    expect(await removeForm(form.id)).toBe(true);
    expect(await removeForm(form.id)).toBe(false);
    const org = await listOrg();
    expect(org.forms).toEqual([]);
    expect(org.roles.find((r) => r.id === "executor").form).toBeNull();
    expect((await identify("200", {})).forms).toEqual([]);
    expect(org.users.find((u) => u.id === "200").answers).toEqual({ [q.id]: "React" });
  });

  it("старые записи читаются: анкет нет — пусто, ответов нет — пусто, «о себе» на месте", async () => {
    await writeRaw({
      ownerId: "100",
      roles: [{ id: "executor", name: "исполнитель", tabs: ["tasks"] }],
      users: [{ id: "600", name: "Старый", roles: ["executor"], about: "делаю макеты" }],
    });
    const org = await listOrg();
    expect(org.forms).toEqual([]);
    expect(org.roles[0].form).toBeNull();
    expect(org.users[0]).toMatchObject({ about: "делаю макеты", answers: {}, forms: [] });
    const me = await identify("600", {});
    expect(me.forms).toEqual([]);
    expect(me.profile).toMatchObject({ about: "делаю макеты", answers: {} });
    // Мусор в ответах старой записи не читается как ответы.
    await writeRaw({ ownerId: "100", roles: [{ id: "executor", name: "и", tabs: [] }],
      users: [{ id: "601", name: "С", roles: [], answers: "строка" }] });
    expect((await identify("601", {})).profile.answers).toEqual({});
  });
});

/* ─────── агенты как участники ───────
   Агент помощника — в списке наравне с людьми (`agent: true`), чтобы его
   можно было выбрать в роли и сделать воркером. Договора ему не нужно. */
describe("агенты как участники", () => {
  beforeEach(async () => { await identify("100", { name: "Владелец" }); });

  it("заводится с ag_-id и меткой, виден в списке с пустой анкетой", async () => {
    const u = await addAgentUser({ id: "a_1", name: "Юрист", addedBy: "100" });
    expect(u).toMatchObject({ id: "ag_a_1", name: "Юрист", agent: true, roles: [], contracts: {}, addedBy: "100" });
    expect(agentUserId("a_1")).toBe("ag_a_1");
    const org = await listOrg();
    const me = org.users.find((x) => x.id === "ag_a_1");
    expect(me).toMatchObject({ agent: true, name: "Юрист", about: "", status: "ready", forms: [] });
    // Люди — без метки.
    expect(org.users.find((x) => x.id === "100").agent).toBeUndefined();
    await expect(addAgentUser({ name: "без id" })).rejects.toThrow(/id is required/);
  });

  it("роль с договором выдаётся агенту сразу, без pending", async () => {
    const role = await addRole({ name: "Подрядчик", tabs: ["tasks"] });
    await setRoleContract(role.id, DOC);
    await addAgentUser({ id: "a_1", name: "Юрист", addedBy: "100" });
    const u = await setUserRoles("ag_a_1", [role.id, "worker"]);
    expect(u.roles).toEqual([role.id, "worker"]);
    expect(u.pending).toBeUndefined();
    const me = await identify("ag_a_1", {});
    expect(me).toMatchObject({ known: true, name: "Юрист", pending: "", tabs: ["tasks", "review"] });
    expect(me.roles.map((r) => r.id)).toEqual([role.id, "worker"]);
  });

  it("переименование, повторное заведение (роли остаются) и удаление", async () => {
    await addAgentUser({ id: "a_1", name: "Юрист", addedBy: "100" });
    await setUserRoles("ag_a_1", ["worker"]);
    expect((await renameAgentUser("a_1", "Юрист по договорам")).name).toBe("Юрист по договорам");
    expect(await renameAgentUser("a_nope", "x")).toBeNull();
    // Человека под этим именем не переименовать: функция — только для агентов.
    expect(await renameAgentUser("100", "x")).toBeNull();
    const again = await addAgentUser({ id: "a_1", name: "Юрист 2", addedBy: "100" });
    expect(again.roles).toEqual(["worker"]);
    expect((await listOrg()).users.filter((x) => x.id === "ag_a_1")).toHaveLength(1);
    expect((await listOrg()).users.find((x) => x.id === "ag_a_1").name).toBe("Юрист 2");
    expect(await removeUser("ag_a_1")).toBe(true);
    expect(await removeUser("ag_a_1")).toBe(false);
    expect((await listOrg()).users.some((x) => x.id === "ag_a_1")).toBe(false);
  });
});
