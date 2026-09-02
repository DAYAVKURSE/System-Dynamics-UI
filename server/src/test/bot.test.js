import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleUpdate, resetBridgeMode, resetPending } from "../lib/bot.js";
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

/* ─────── вход в Claude Code из чата ───────
   Сам разговор с `claude` проверяется в loginFlow.test.js; здесь — что бот
   зовёт его в нужный момент и не путает код подтверждения с вопросом. */

describe("вход в Claude Code", () => {
  const calls = [];
  let awaiting = false;
  let startFails = "";
  const login = {
    hasLogin: () => false,
    awaitingCode: () => awaiting,
    startLogin: async () => {
      calls.push({ start: true });
      if (startFails) throw new Error(startFails);
      awaiting = true;
      return { url: "https://claude.com/cai/oauth/authorize?code_challenge=c&state=s" };
    },
    finishLogin: async (code) => {
      calls.push({ code });
      awaiting = false;
      return { saved: true, restarted: true };
    },
    cancelLogin: () => { calls.push({ cancel: true }); awaiting = false; return true; },
  };
  const asked = [];
  const bridge = { ask: ({ text }) => { asked.push(text); return { id: "q1" }; } };
  const deps2 = { ...deps, bridge, login };
  const lastButton = () => (sent[sent.length - 1]?.keyboard?.inline_keyboard || [])[0]?.[0];

  beforeEach(() => { calls.length = 0; asked.length = 0; awaiting = false; startFails = ""; });

  it("«/login» присылает ссылку кнопкой, а не текстом инструкции", async () => {
    await handleUpdate(msg(owner, { text: "/login" }), deps2);
    expect(calls[0]).toEqual({ start: true });
    expect(lastButton()?.url).toMatch(/oauth\/authorize/);
    expect(lastText()).toMatch(/код/i);
  });

  it("следующее сообщение считается кодом и доводит вход до конца", async () => {
    await handleUpdate(msg(owner, { text: "/login" }), deps2);
    await handleUpdate(msg(owner, { text: "aBc123-code" }), deps2);
    expect(calls).toContainEqual({ code: "aBc123-code" });
    expect(lastText()).toMatch(/подключён/i);
  });

  it("код не уезжает вопросом в Claude, даже когда включён режим моста", async () => {
    await handleUpdate(msg(owner, { text: "/claude" }), deps2);     // режим моста
    await handleUpdate(msg(owner, { text: "/login" }), deps2);
    await handleUpdate(msg(owner, { text: "secret-code" }), deps2);
    expect(asked).toEqual([]);                        // в мост не ушло ничего
    expect(calls).toContainEqual({ code: "secret-code" });
    resetBridgeMode();
  });

  it("«/stop» во время входа отменяет вход", async () => {
    await handleUpdate(msg(owner, { text: "/login" }), deps2);
    await handleUpdate(msg(owner, { text: "/stop" }), deps2);
    expect(calls).toContainEqual({ cancel: true });
    expect(lastText()).toMatch(/отмен/i);
  });

  it("сбой запуска объясняется словами, а не молчанием", async () => {
    startFails = "на сервере нет команды script или claude";
    await handleUpdate(msg(owner, { text: "/login" }), deps2);
    expect(lastText()).toMatch(/нет команды script/);
  });

  it("посторонний вход не начинает", async () => {
    await handleUpdate(msg(guest, { text: "/login" }), deps2);
    expect(calls).toEqual([]);
    expect(lastText()).toMatch(/только владельцу/);
  });

  it("без моста «/login» не предлагается вовсе — логинить некого", async () => {
    await handleUpdate(msg(owner, { text: "/login" }), { ...deps, bridge: null, login: null });
    expect(calls).toEqual([]);
    expect(lastText()).toMatch(/перешлите мне сообщение/i);
  });
});
