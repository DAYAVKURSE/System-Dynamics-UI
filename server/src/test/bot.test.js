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
  // Шаги сдачи пишутся на диск — не в каталог проекта.
  process.env.BOT_STEPS_FILE = path.join(tmp, "bot-steps.json");
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

  it("незваному бот сообщает его номер по /id — именно его об этом и просят", async () => {
    // Безопасно: свой собственный id человек и так видит в любом клиенте,
    // а ничего чужого ответ не содержит.
    const r = await handleUpdate(msg(guest, { text: "/id" }), deps);
    expect(r).toEqual({ told: "777" });
    expect(lastText()).toBe("Ваш id: 777");
    expect(lastText()).not.toMatch(/только владельцу/);
    await handleUpdate(msg(owner, { text: "/id" }), deps);
    expect(lastText()).toBe("Ваш id: 100");
  });
});

/* ─────── позванный не-владелец ───────
   Бот ему отвечает — кнопками, помощником, памятью, — поэтому «только
   владельцу» на стикер или фото было бы неправдой. Незваному — по-прежнему
   отказ без подробностей. */
describe("позванному не-владельцу", () => {
  const invited = { id: 200, first_name: "Иван" };
  beforeEach(async () => {
    const roles = (await org.listOrg()).roles;
    await org.addUser({ id: "200", name: "Иван", roleId: roles[0].id, addedBy: "100" });
  });

  it("на стикер — что бот умеет для него, а не «только владельцу»", async () => {
    const r = await handleUpdate(msg(invited, { sticker: { file_id: "s1" } }), { ...deps, work: {} });
    expect(r).toEqual({ helped: "invited" });
    expect(lastText()).toMatch(/Отложить/);
    expect(lastText()).toMatch(/помощник/);
    expect(lastText()).toMatch(/запомни/);
    expect(lastText()).not.toMatch(/только владельцу/);
  });

  it("незваному на тот же стикер — отказ без подробностей", async () => {
    const r = await handleUpdate(msg(guest, { sticker: { file_id: "s1" } }), deps);
    expect(r).toEqual({ ignored: "not owner" });
    expect(lastText()).toMatch(/только владельцу/);
    expect(lastText()).not.toMatch(/Отложить/);
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
      taskFor: async (u, id) => ({ task: { id, title: "Сбор заявок", status: "backlog" }, func: null, traits: [] }),
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
    expect(lastText()).toMatch(/Взял в работу: «Сбор заявок»/);
  });

  it("«Отложить» сначала спрашивает, на сколько: часы, потом минуты", async () => {
    const r = await press(worker, "task:defer:tk1");
    expect(r).toMatchObject({ task: "tk1", stage: "hour" });
    // Задача ещё не тронута: «на сколько» человек пока не сказал.
    expect(calls).toEqual([]);
    expect(lastKeys()).toContain("23");
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

/* ─── группы: слушать и молчать ───
   Всё, что бот видит в группе, записывается (lib/chatStore.js) и НИЧЕМ не
   отвечается: чат общий, а бот отвечает каждому про своё. Без записи —
   тоже молчание: подсказка «только владельцу» в группе была бы спамом. */
describe("сообщения из групп", () => {
  const group = { id: -100123, type: "supergroup", title: "Команда" };
  const inGroup = (from, patch = {}) => msg(from, { chat: group, ...patch });

  it("записываются и не получают ответа — ни от владельца, ни от чужого", async () => {
    const recorded = [];
    const chats = { record: async (m) => { recorded.push(m); } };
    expect(await handleUpdate(inGroup(owner, { text: "решили: счёт в пятницу" }), { ...deps, chats }))
      .toEqual({ recorded: true });
    expect(await handleUpdate(inGroup(guest, { text: "/id" }), { ...deps, chats })).toEqual({ recorded: true });
    expect(recorded.map((m) => m.text)).toEqual(["решили: счёт в пятницу", "/id"]);
    expect(recorded[0].chat).toEqual(group);
    expect(sent).toEqual([]);
  });

  it("правка сообщения в группе — тоже запись; в личке правка не отвечается", async () => {
    const recorded = [];
    const chats = { record: async (m) => { recorded.push(m); } };
    const r = await handleUpdate({ update_id: 3, edited_message: { from: owner, chat: group, text: "поправил" } },
      { ...deps, chats });
    expect(r).toEqual({ recorded: true });
    expect(recorded[0].text).toBe("поправил");
    expect(await handleUpdate({ update_id: 4, edited_message: { from: owner, chat: { id: 100, type: "private" },
      text: "поправил" } }, { ...deps, chats })).toEqual({ ignored: "edited" });
    expect(sent).toEqual([]);
  });

  it("записи нет — всё равно молчит, и ничего не заводит", async () => {
    const r = await handleUpdate(inGroup(guest, { text: "привет" }), deps);
    expect(r).toEqual({ ignored: "group" });
    expect(sent).toEqual([]);
    // Обычная группа — тоже группа; личка — нет: помощник в личке отвечает как прежде.
    expect(await handleUpdate(msg(guest, { chat: { id: 5, type: "group" }, text: "x" }), deps))
      .toEqual({ ignored: "group" });
    expect(sent).toEqual([]);
  });
});

/* ─── кнопки под пересланным в группу сообщением ───
   Telegram сохраняет инлайн-клавиатуру при пересылке и доставляет нажатие
   исходному боту. Отвечать в группу нельзя ничем, а ход сдачи — личное
   дело исполнителя: ответ только на само нажатие, в чат — ничего. */
describe("кнопки из группы", () => {
  const group = { id: -100123, type: "supergroup", title: "Команда" };
  const worker = { id: 200, first_name: "Иван" };
  let touched;
  const work = {
    take: async () => { touched.push("take"); return { task: { id: "tk1", title: "Макет" } }; },
    defer: async () => { touched.push("defer"); return { task: { id: "tk1", title: "Макет" } }; },
    taskFor: async () => ({ task: { id: "tk1", title: "Макет", status: "backlog" }, func: null, traits: [] }),
  };
  const assistant = { ask: () => { const p = new Promise(() => {}); p.id = "q1"; return p; }, cancel: () => true };
  const pressInGroup = (from, data) => handleUpdate({ update_id: 9, callback_query: {
    id: "cb9", from, data, message: { message_id: 7, chat: group, text: "Начинается: Макет" } } },
  { ...deps, work, assistant, edit: async () => {} });
  beforeEach(async () => {
    touched = [];
    const roles = (await org.listOrg()).roles;
    await org.addUser({ id: "200", name: "Иван", roleId: roles[0].id, addedBy: "100" });
  });

  it("«Начать», «Отложить» и кнопки помощника из группы: ответ на нажатие, в группу — ничего, задача не тронута",
    async () => {
      for (const data of ["task:start:tk1", "task:defer:tk1", "ai:refine:q1", "r:executor"]) {
        expect(await pressInGroup(worker, data)).toEqual({ ignored: "group callback" });
        expect(answered[answered.length - 1].text).toBe("Кнопки работают только в личном чате с ботом");
      }
      expect(await pressInGroup(owner, "task:start:tk1")).toEqual({ ignored: "group callback" });
      expect(sent).toEqual([]);
      expect(touched).toEqual([]);
    });

  it("та же кнопка в личном чате работает как прежде", async () => {
    const r = await handleUpdate({ update_id: 9, callback_query: {
      id: "cb9", from: worker, data: "task:start:tk1", message: { message_id: 7, chat: { id: 200, type: "private" } } } },
    { ...deps, work, edit: async () => {} });
    expect(r).toMatchObject({ task: "tk1", action: "take" });
    expect(touched).toEqual(["take"]);
  });
});

/* ─── кнопки под статусом помощника ───
   «✖ Отменить» и «✎ Уточнить» — у любого позванного, не только у
   владельца: вопрос задавал он. Чужой вопрос помощник не отменяет. */
describe("кнопки помощника под статусом", () => {
  const worker = { id: 200, first_name: "Иван" };
  let cancelled;
  const assistant = () => ({
    ask: (userId, q) => { const p = new Promise(() => {}); p.id = "q1"; return p; },
    cancel: (id, userId) => { cancelled.push([id, userId]); return true; },
  });
  const pressAi = (from, data) => handleUpdate(
    { update_id: 9, callback_query: { id: "cb2", from, data, message: { message_id: 7, chat: { id: from.id } } } },
    { ...deps, assistant: assistant(), edit: async () => {} },
  );
  beforeEach(async () => {
    cancelled = [];
    const roles = (await org.listOrg()).roles;
    await org.addUser({ id: "200", name: "Иван", roleId: roles[0].id, addedBy: "100" });
  });

  it("позванный не-владелец отменяет свой вопрос через очередь", async () => {
    const asked = await handleUpdate(msg(worker, { text: "что у меня?" }), { ...deps, assistant: assistant(), edit: async () => {} });
    expect(asked.answered).toBe("queued");
    expect(lastKeys()).toEqual(["✖ Отменить", "✎ Уточнить"]);
    const r = await pressAi(worker, "ai:cancel:q1");
    expect(r).toEqual({ cancelled: true, id: "q1" });
    expect(cancelled).toEqual([["q1", "200"]]);
    expect(answered[answered.length - 1].text).toBe("Отменил");
  });

  it("владелец чужой вопрос не отменяет, незваному кнопки не отвечают", async () => {
    await handleUpdate(msg(worker, { text: "что у меня?" }), { ...deps, assistant: assistant(), edit: async () => {} });
    expect(await pressAi(owner, "ai:cancel:q1")).toEqual({ stale: true });
    expect(answered[answered.length - 1].text).toMatch(/не ваш/);
    expect(await pressAi(guest, "ai:cancel:q1")).toEqual({ ignored: "not invited" });
    expect(cancelled).toEqual([]);
  });
});
