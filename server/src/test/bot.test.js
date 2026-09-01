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
