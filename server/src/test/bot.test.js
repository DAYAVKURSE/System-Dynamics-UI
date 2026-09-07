import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleUpdate, resetPending } from "../lib/bot.js";
import * as org from "../lib/orgStore.js";

/* Бот умеет одно: владелец пересылает сообщение от человека и выбирает
   роль. Всё остальное отклоняется. */

let tmp;
const sent = [];
const answered = [];
const deps = {
  org,
  send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); },
  answer: async (id, text) => { answered.push({ id, text }); },
};

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-bot-"));
  process.env.ORG_DIR = path.join(tmp, "org");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  sent.length = 0; answered.length = 0; resetPending();
  await org.identify("100", { name: "Владелец" });   // 100 — владелец
});

const msg = (from, patch = {}) => ({ update_id: 1, message: { from, ...patch } });
const owner = { id: 100, first_name: "Владелец" };
const guest = { id: 777, first_name: "Чужой" };
const forwarded = { id: 200, first_name: "Иван", username: "ivan" };
const lastText = () => sent[sent.length - 1]?.text || "";
const lastKeys = () => (sent[sent.length - 1]?.keyboard?.inline_keyboard || [])
  .flat().map((b) => b.text);

describe("кому бот отвечает", () => {
  it("постороннему — только отказ, без списка ролей", async () => {
    const r = await handleUpdate(msg(guest, { text: "привет" }), deps);
    expect(r.ignored).toBe("not owner");
    expect(lastText()).toMatch(/только владельцу/);
    expect(lastKeys()).toEqual([]);
  });

  it("посторонний не может добавить никого пересылкой", async () => {
    await handleUpdate(msg(guest, { forward_from: forwarded }), deps);
    expect((await org.listOrg()).users.map((u) => u.id)).not.toContain("200");
  });

  it("владельцу без пересылки — подсказка, что делать", async () => {
    await handleUpdate(msg(owner, { text: "привет" }), deps);
    expect(lastText()).toMatch(/Перешлите мне сообщение/);
  });
});

describe("приглашение пересылкой", () => {
  it("бот показывает роли кнопками и предлагает завести новую", async () => {
    await handleUpdate(msg(owner, { forward_from: forwarded }), deps);
    expect(lastText()).toMatch(/Иван/);
    expect(lastText()).toMatch(/id 200/);
    expect(lastKeys()).toContain("исполнитель");
    expect(lastKeys()).toContain("проверяющий");
    expect(lastKeys()).toContain("+ новая роль");
  });

  it("выбор роли добавляет человека именно с ней", async () => {
    await handleUpdate(msg(owner, { forward_from: forwarded }), deps);
    await handleUpdate({ update_id: 2,
      callback_query: { id: "cb1", from: owner, data: "r:reviewer" } }, deps);

    const users = (await org.listOrg()).users;
    const ivan = users.find((u) => u.id === "200");
    expect(ivan.roleId).toBe("reviewer");
    expect(ivan.name).toBe("Иван");
    expect(ivan.addedBy).toBe("100");
    expect((await org.identify("200", {})).tabs).toEqual(["review"]);
  });

  it("«новая роль» спрашивает название и заводит роль вместе с человеком", async () => {
    await handleUpdate(msg(owner, { forward_from: forwarded }), deps);
    await handleUpdate({ update_id: 2,
      callback_query: { id: "cb1", from: owner, data: "newrole" } }, deps);
    expect(lastText()).toMatch(/Как назвать роль/);

    await handleUpdate(msg(owner, { text: "Дизайнер" }), deps);
    const { roles, users } = await org.listOrg();
    const role = roles.find((r) => r.name === "Дизайнер");
    expect(role).toBeTruthy();
    expect(users.find((u) => u.id === "200").roleId).toBe(role.id);
    expect(lastText()).toMatch(/Готово/);
  });

  it("занятое название роли не ломает приглашение — бот просит другое", async () => {
    await handleUpdate(msg(owner, { forward_from: forwarded }), deps);
    await handleUpdate({ update_id: 2,
      callback_query: { id: "cb1", from: owner, data: "newrole" } }, deps);
    await handleUpdate(msg(owner, { text: "исполнитель" }), deps);
    expect(lastText()).toMatch(/Пришлите другое название/);
    // Человек ещё не добавлен, и приглашение не потеряно.
    expect((await org.listOrg()).users.map((u) => u.id)).not.toContain("200");
    await handleUpdate(msg(owner, { text: "Дизайнер" }), deps);
    expect((await org.listOrg()).users.map((u) => u.id)).toContain("200");
  });

  it("кнопка без начатого приглашения не добавляет никого", async () => {
    const r = await handleUpdate({ update_id: 2,
      callback_query: { id: "cb1", from: owner, data: "r:executor" } }, deps);
    expect(r.stale).toBe(true);
    expect((await org.listOrg()).users).toHaveLength(1);   // только владелец
  });
});

describe("когда пересылка не сообщает id", () => {
  it("бот объясняет, что делать, а не молчит", async () => {
    const r = await handleUpdate(msg(owner, { forward_sender_name: "Скрытный" }), deps);
    expect(r.blocked).toBe("hidden");
    // Ответ именно про этого человека, а не общая подсказка: в подсказке
    // про закрытый перенос тоже сказано, и по одному слову их не отличить.
    expect(lastText()).toMatch(/Скрытный/);
    expect(lastText()).toMatch(/id 123456789 Имя/);
    expect(lastKeys()).toEqual([]);
  });

  it("запасной путь «id 123 Имя» доводит до тех же ролей", async () => {
    await handleUpdate(msg(owner, { text: "id 456 Пётр" }), deps);
    expect(lastKeys()).toContain("исполнитель");
    await handleUpdate({ update_id: 2,
      callback_query: { id: "cb1", from: owner, data: "r:executor" } }, deps);
    const petr = (await org.listOrg()).users.find((u) => u.id === "456");
    expect(petr.name).toBe("Пётр");
  });

  it("человеку бот сообщает его номер по /id", async () => {
    // Это единственное, что бот делает для не-владельца, — и оно безопасно:
    // свой собственный id человек и так видит в любом клиенте.
    await handleUpdate(msg(owner, { text: "/id" }), deps);
    expect(lastText()).toMatch(/Ваш id: 100/);
  });
});

/* ─────── отдельное мини-приложение звонка ───────
   Завести его можно только руками в @BotFather, а вот запомнить короткое
   имя владелец может отсюда — не открывая GitHub и не трогая сервер. */

describe("приложение звонка", () => {
  let stored;
  const settings = {
    getCallApp: () => stored,
    setCallApp: (v) => { stored = v; return v; },
  };
  const deps3 = { ...deps, settings, botName: "sdbot", publicUrl: "https://x.test" };

  beforeEach(() => { stored = ""; });

  it("«/callapp» без имени объясняет, что делать в @BotFather", async () => {
    await handleUpdate(msg(owner, { text: "/callapp" }), deps3);
    expect(lastText()).toMatch(/newapp/);
    expect(lastText()).toContain("https://x.test/call");
  });

  it("имя запоминается и попадает в ссылку", async () => {
    const r = await handleUpdate(msg(owner, { text: "/callapp call" }), deps3);
    expect(r).toEqual({ callApp: "call" });
    expect(stored).toBe("call");
    expect(lastText()).toContain("t.me/sdbot/call");
  });

  it("негодное имя отклоняется с объяснением, а не молча", async () => {
    await handleUpdate(msg(owner, { text: "/callapp зво нок" }), deps3);
    expect(stored).toBe("");
    expect(lastText()).toMatch(/латиница/i);
  });

  it("«/callapp» с уже заведённым именем показывает нынешнюю ссылку", async () => {
    stored = "call";
    await handleUpdate(msg(owner, { text: "/callapp" }), deps3);
    expect(lastText()).toContain("t.me/sdbot/call?startapp=call_…");
  });

  it("удалённое приложение можно забыть — «/callapp -»", async () => {
    // Приложение удаляют в @BotFather, и тогда прежнее имя — прямой путь к
    // «приложение не найдено» вместо звонка.
    stored = "call";
    const r = await handleUpdate(msg(owner, { text: "/callapp -" }), deps3);
    expect(r).toEqual({ callApp: "" });
    expect(stored).toBe("");
    expect(lastText()).toMatch(/забыл/i);
  });

  it("посторонний имя не меняет", async () => {
    await handleUpdate(msg(guest, { text: "/callapp call" }), deps3);
    expect(stored).toBe("");
    expect(lastText()).toMatch(/только владельцу/);
  });
});

/* ─────── звонок главным приложением бота ───────

   Ради высоты окна: отдельное приложение Telegram открывает только на весь
   экран (почему — в lib/links.js). Включать вслепую нельзя: если главного
   приложения в @BotFather нет, ссылка t.me/<бот>?startapp=… открывает
   просто чат с ботом, и по приглашению не открывается НИЧЕГО. Поэтому
   сперва спрашиваем у Telegram. */

describe("звонок главным приложением", () => {
  let stored;
  let main;
  let ready;
  const settings = {
    getCallApp: () => stored,
    setCallApp: (v) => { stored = v; return v; },
    getCallMain: () => main,
    setCallMain: (v) => { main = v; return v; },
    mainAppReady: async () => ready,
  };
  const deps4 = { ...deps, settings, botName: "sdbot", publicUrl: "https://x.test" };

  beforeEach(() => { stored = "call"; main = false; ready = true; });

  it("«/callmain» без слова объясняет, зачем это и что нажать в @BotFather", async () => {
    const r = await handleUpdate(msg(owner, { text: "/callmain" }), deps4);
    expect(r).toEqual({ callMain: false });
    expect(lastText()).toMatch(/Configure Mini App/);
    expect(lastText()).toContain("https://x.test/call");
    expect(main).toBe(false);
  });

  it("«on» включает — и приглашение начинает открывать пол-экрана", async () => {
    const r = await handleUpdate(msg(owner, { text: "/callmain on" }), deps4);
    expect(r).toEqual({ callMain: true });
    expect(main).toBe(true);
    expect(lastText()).toContain("t.me/sdbot?startapp=call_…");
  });

  it("если главного приложения нет — НЕ включает: иначе ссылка перестанет открывать что-либо",
    async () => {
      ready = false;
      const r = await handleUpdate(msg(owner, { text: "/callmain on" }), deps4);
      expect(r).toEqual({ error: "no main app" });
      expect(main).toBe(false);
      expect(lastText()).toMatch(/главного приложения у бота нет/i);
      expect(lastText()).toMatch(/Configure Mini App/);
    });

  it("Telegram не ответил — тоже не включает, и говорит об этом", async () => {
    ready = null;
    const r = await handleUpdate(msg(owner, { text: "/callmain on" }), deps4);
    expect(r).toEqual({ error: "no answer" });
    expect(main).toBe(false);
    expect(lastText()).toMatch(/повторите/i);
  });

  it("«off» возвращает отдельное приложение", async () => {
    main = true;
    const r = await handleUpdate(msg(owner, { text: "/callmain off" }), deps4);
    expect(r).toEqual({ callMain: false });
    expect(main).toBe(false);
    expect(lastText()).toContain("t.me/sdbot/call");
  });

  it("включённое состояние показывается словами, а не молчанием", async () => {
    main = true;
    await handleUpdate(msg(owner, { text: "/callmain" }), deps4);
    expect(lastText()).toContain("t.me/sdbot?startapp=call_…");
    expect(lastText()).toMatch(/callmain off/);
  });

  it("посторонний ничего не включает", async () => {
    await handleUpdate(msg(guest, { text: "/callmain on" }), deps4);
    expect(main).toBe(false);
    expect(lastText()).toMatch(/только владельцу/);
  });
});

/* ─────── «Начать» и «Отложить» под уведомлением ───────

   Уведомление приходит тому, кому работа поручена, — значит и кнопка под
   ним обязана работать у него, а не у одного владельца. Нажатие должно
   ДВИГАТЬ задачу: иначе доска показывала бы её лежащей в бэклоге и когда
   за неё взялись, и когда её отложили. */
describe("кнопки задачи под уведомлением", () => {
  const worker = { id: 200, first_name: "Иван" };
  const press = (from, data) => handleUpdate(
    { update_id: 9, callback_query: { id: "cb1", from, data } },
    { ...deps, work },
  );
  let calls;
  let work;
  beforeEach(async () => {
    calls = [];
    work = {
      take: async (u, id) => { calls.push(["take", String(u), id]);
        return { task: { id, title: "Сбор заявок" } }; },
      defer: async (u, id) => { calls.push(["defer", String(u), id]);
        return { task: { id, title: "Сбор заявок" } }; },
    };
    await org.addRole("Исполнитель").catch(() => {});
    const roles = (await org.listOrg()).roles;
    await org.addUser({ id: "200", name: "Иван", roleId: roles[0].id, addedBy: "100" });
  });

  it("«Начать» переводит задачу в работу — и у не-владельца тоже", async () => {
    const r = await press(worker, "task:start:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "take" });
    expect(calls).toEqual([["take", "200", "tk1"]]);
    // Подтверждение на кнопке гаснет через секунду — говорим и в переписке.
    expect(lastText()).toMatch(/Взял в работу: Сбор заявок/);
  });

  it("«Отложить» оставляет задачу в бэклоге, и это сказано словами", async () => {
    const r = await press(worker, "task:defer:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "defer" });
    expect(calls).toEqual([["defer", "200", "tk1"]]);
    expect(lastText()).toMatch(/Осталась в бэклоге как отложенная/);
    // Отложить — не перенести: срок ставит постановщик, а не исполнитель.
    expect(lastText()).toMatch(/срок при этом не сдвинулся/);
  });

  it("отказ называется словами, а не молча гасит часики", async () => {
    work.take = async () => ({ error: "not yours" });
    const r = await press(worker, "task:start:tk1");
    expect(r).toMatchObject({ error: "not yours" });
    expect(answered[answered.length - 1].text).toBe("Эта задача не ваша");
    expect(lastText()).toMatch(/ничего не поменял/);
  });

  it("непозванному кнопки не отвечают: модель ему не показывали", async () => {
    const r = await press({ id: 777, first_name: "Чужой" }, "task:start:tk1");
    expect(r).toMatchObject({ ignored: "not invited" });
    expect(calls).toEqual([]);
  });
});
