import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleUpdate, resetPending } from "../lib/bot.js";
import * as org from "../lib/orgStore.js";

/* Бот умеет одно: «/id». Всё остальное словами — помощнику; кнопки под
   уведомлениями — сдача работы и ход вопроса. */

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

/* ════════════════════════════════════════════════════════════════
   ОДНА КОМАНДА И ПОМОЩНИК (владелец, 2026-09-21)

   «„Я умею одно: добавлять людей в модель…" — это сообщение удали. Оно не
   должно отправляться, и все команды, которые с ним связаны, тоже. Должна
   работать только команда /id из них. Если пользователь пишет что-то
   словами, значит реагировать должен ассистент».
   ════════════════════════════════════════════════════════════════ */

describe("что осталось от команд", () => {
  it("«/id» отвечает всем — и незваному, и владельцу", async () => {
    // Безопасно: свой собственный id человек и так видит в любом клиенте.
    expect(await handleUpdate(msg(guest, { text: "/id" }), deps)).toEqual({ told: "777" });
    expect(lastText()).toBe("Ваш id: 777");
    await handleUpdate(msg(owner, { text: "/id" }), deps);
    expect(lastText()).toBe("Ваш id: 100");
  });

  it("подсказки «Я умею одно…» больше нет ни на одно сообщение", async () => {
    await handleUpdate(msg(owner, { text: "привет" }), deps);
    expect(lastText()).not.toMatch(/Я умею одно/);
    expect(lastText()).not.toMatch(/Перешлите мне сообщение/);
    expect(lastKeys()).toEqual([]);
  });

  it("пересылка больше никого не добавляет и ролей не показывает", async () => {
    await handleUpdate(msg(owner, { forward_from: forwarded }), deps);
    expect((await org.listOrg()).users.map((u) => u.id)).not.toContain("200");
    expect(lastKeys()).toEqual([]);
  });

  it("«id 123 Имя» — обычные слова, а не команда: никого не заводит", async () => {
    await handleUpdate(msg(owner, { text: "id 456 Пётр" }), deps);
    expect((await org.listOrg()).users.map((u) => u.id)).not.toContain("456");
    expect(lastKeys()).toEqual([]);
  });

  it("«/callapp» и «/callmain» ничего не настраивают", async () => {
    let stored = "";
    const settings = { getCallApp: () => stored, setCallApp: (v) => { stored = v; return v; },
      getCallMain: () => false, setCallMain: () => {}, mainAppReady: async () => true };
    const d = { ...deps, settings, botName: "sdbot", publicUrl: "https://x.test" };
    await handleUpdate(msg(owner, { text: "/callapp call" }), d);
    expect(stored).toBe("");
    expect(lastText()).not.toMatch(/newapp/);
    await handleUpdate(msg(owner, { text: "/callmain on" }), d);
    expect(lastText()).not.toMatch(/BotFather/);
  });

  it("кнопка выбора роли больше ничего не значит", async () => {
    const r = await handleUpdate({ update_id: 2,
      callback_query: { id: "cb1", from: owner, data: "r:executor" } }, deps);
    expect(r).toEqual({ ignored: "unknown callback" });
    expect((await org.listOrg()).users).toHaveLength(1);   // только владелец
  });
});

describe("слова — помощнику, и владельцу тоже", () => {
  const asked = [];
  const assistant = { ask: async (q) => { asked.push(q); return { id: "q1" }; } };

  beforeEach(async () => {
    asked.length = 0;
    const roles = (await org.listOrg()).roles;
    await org.addUser({ id: "200", name: "Иван", roleId: roles[0].id, addedBy: "100" });
  });

  it("владелец пишет словами — вопрос уходит помощнику, а не в подсказку", async () => {
    const r = await handleUpdate(msg(owner, { text: "какие у меня задачи?" }), { ...deps, assistant });
    expect(r).toBeTruthy();
    expect(r.helped).toBeUndefined();
    expect(asked).toHaveLength(1);
  });

  it("позванный — так же", async () => {
    await handleUpdate(msg({ id: 200, first_name: "Иван" }, { text: "что мне делать?" }),
      { ...deps, assistant });
    expect(asked).toHaveLength(1);
  });

  it("незваному помощник не отвечает: отвечать ему не из чего", async () => {
    const r = await handleUpdate(msg(guest, { text: "что тут у вас?" }), { ...deps, assistant });
    expect(asked).toEqual([]);
    expect(r).toEqual({ ignored: "not invited" });
    expect(lastText()).toMatch(/только участникам/);
  });

  it("не слова — одна строка, а не список умений", async () => {
    const r = await handleUpdate(msg(owner, { sticker: { file_id: "s1" } }), { ...deps, assistant });
    expect(r).toEqual({ helped: true });
    expect(lastText()).toMatch(/Напишите словами/);
    expect(lastText()).not.toMatch(/Отложить/);
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

  it("«Отложить» спрашивает, на сколько, и откладывает на выбранное", async () => {
    const ask = await press(worker, "task:defer:tk1");
    expect(ask).toMatchObject({ task: "tk1", action: "defer-ask" });
    expect(calls.map((c) => c[0])).not.toContain("defer");
    const r = await press(worker, "task:deferfor:30:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "defer" });
    expect(calls.map((c) => c[0])).toContain("defer");
    expect(lastText()).toMatch(/Отложил/);
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
