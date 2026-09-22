import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { botKey, listDialogs, readDialog, recordDialog } from "../lib/dialogStore.js";
import {
  CLOSED_TEXT, DL, EMPTY_TEXT, LIST_TEXT, dialogView, isDialogsAction, listView, onDialogsButton, openDialogs,
} from "../lib/dialogsUi.js";
import { isWaiting, resetWaiting, takeReply, waitReply } from "../lib/peopleWait.js";
import { peopleToolsFor } from "../lib/peopleTools.js";
import { runAgentDuty, taskQuestion } from "../lib/agentDuty.js";

/* ═══════════════════════════════════════════════════════════════
   «/dialogs», ОЖИДАНИЕ ОТВЕТА, ИНСТРУМЕНТЫ «ЛЮДИ», АГЕНТЫ ПО РАСПИСАНИЮ
   ═══════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-dlui-"));
  process.env.DIALOGS_DIR = path.join(tmp, "dialogs");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => { await fs.rm(process.env.DIALOGS_DIR, { recursive: true, force: true }); resetWaiting(); });

const K = botKey("100", "a1");
const flat = (kb) => (kb?.inline_keyboard || []).flat().map((b) => `${b.text}=${b.callback_data}`);

describe("/dialogs — список и переписка в одном сообщении", () => {
  it("пустой список — «диалогов нет» и «закрыть»; со списком — кнопка на каждого и «закрыть»", async () => {
    const sent = [];
    await openDialogs({ key: K, chatId: 100, send: async (c, t, k) => { sent.push({ c, t, k }); return { message_id: 7 }; } });
    expect(sent[0].t).toBe(EMPTY_TEXT);
    expect(flat(sent[0].k)).toEqual([`закрыть=${DL}x`]);
    await recordDialog(K, 5, { name: "Пётр", text: "привет", at: "2026-01-01T00:00:00Z" });
    await recordDialog(K, 6, { username: "anna", text: "hi", at: "2026-01-02T00:00:00Z" });
    const v = listView(await listDialogs(K));
    expect(v.text).toBe(LIST_TEXT);
    expect(flat(v.keyboard)).toEqual([`@anna · 1=${DL}o:6:0`, `Пётр · 1=${DL}o:5:0`, `закрыть=${DL}x`]);
    expect(isDialogsAction(`${DL}o:5:0`)).toBe(true);
    expect(isDialogsAction("ai:cancel:1")).toBe(false);
  });

  it("переписка — страницами по 10, с кнопками «забанить», «удалить», «назад», «закрыть»", async () => {
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await recordDialog(K, 5, { name: "Пётр", from: i % 2 ? "bot" : "user", text: `м${i}`, at: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z` });
    }
    const d = await readDialog(K, 5);
    const p0 = dialogView(d, 0, { botName: "Юрист" });
    expect(p0.text).toMatch(/^Пётр\n\n01\.01 00:00 человек: м0\n01\.01 00:01 Юрист: м1/);
    expect(p0.text).toMatch(/страница 1 из 2$/);
    expect(flat(p0.keyboard)).toEqual([`›=${DL}o:5:1`, `забанить=${DL}b:5:0`, `удалить=${DL}d:5`, `назад=${DL}l`, `закрыть=${DL}x`]);
    const p1 = dialogView(d, 1);
    expect(p1.text).toContain("бот: м11");
    expect(flat(p1.keyboard)[0]).toBe(`‹=${DL}o:5:0`);
  });

  it("кнопки правят то же сообщение: открыть → забанить → разбанить → удалить → список; «закрыть» снимает кнопки", async () => {
    await recordDialog(K, 5, { name: "Пётр", text: "привет" });
    const edits = [];
    const answers = [];
    const deps = { key: K, edit: async (c, m, t, k) => { edits.push({ c, m, t, k }); }, answer: async (id, t) => { answers.push(t); } };
    const cb = (data) => ({ id: "cb1", data, message: { chat: { id: 100 }, message_id: 7 } });
    expect(await onDialogsButton(cb(`${DL}o:5:0`), deps)).toEqual({ opened: "5", page: 0 });
    expect(edits[0]).toMatchObject({ c: 100, m: 7 });
    expect(edits[0].t).toMatch(/^Пётр/);
    expect(await onDialogsButton(cb(`${DL}b:5:0`), deps)).toEqual({ banned: true, chatId: "5" });
    expect((await readDialog(K, 5)).banned).toBe(true);
    expect(edits[1].t).toMatch(/^⛔ Пётр/);
    expect(flat(edits[1].k)).toContain(`разбанить=${DL}b:5:0`);
    expect(answers[1]).toMatch(/Забанен/);
    expect(await onDialogsButton(cb(`${DL}b:5:0`), deps)).toEqual({ banned: false, chatId: "5" });
    expect(await onDialogsButton(cb(`${DL}d:5`), deps)).toEqual({ deleted: "5" });
    expect(await readDialog(K, 5)).toBeNull();
    expect(edits[3].t).toBe(EMPTY_TEXT);
    expect(await onDialogsButton(cb(`${DL}l`), deps)).toEqual({ listed: true });
    expect(await onDialogsButton(cb(`${DL}x`), deps)).toEqual({ closed: true });
    expect(edits[5]).toMatchObject({ t: CLOSED_TEXT, k: null });
    // Открыть удалённого — снова список, с пояснением.
    expect(await onDialogsButton(cb(`${DL}o:5:0`), deps)).toEqual({ listed: true });
    expect(answers[answers.length - 1]).toBe("Диалога уже нет");
  });
});

describe("ожидание ответа человека", () => {
  it("сообщение того, кого ждали, уходит ждущему; чужое — нет; срок — null", async () => {
    const p = waitReply(K, 5, 5000);
    expect(isWaiting(K, 5)).toBe(true);
    expect(takeReply(K, 6, "не мне")).toBe(false);
    expect(takeReply(K, 5, "да, согласен")).toBe(true);
    expect(await p).toBe("да, согласен");
    expect(takeReply(K, 5, "ещё")).toBe(false);
    expect(await waitReply(K, 5, 1)).toBeNull();
  });
});

describe("инструменты «люди»", () => {
  const members = [{ id: "200", name: "Иван Петров", username: "ivan" }, { id: "ag_a1", name: "Юрист" }];
  const make = () => {
    const out = [];
    const tools = peopleToolsFor({ key: K, members, mainKey: botKey("100", "assistant"), sendVia: {
      agent: async (chatId, text) => out.push({ via: "agent", chatId, text }),
      main: async (chatId, text) => out.push({ via: "main", chatId, text }),
    } });
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { out, by };
  };

  it("список: собеседники бота и участники-люди через основного бота; агенты — нет", async () => {
    await recordDialog(K, 5, { name: "Пётр", username: "petr", text: "привет" });
    const { by } = make();
    const r = await by.people_list.run({});
    expect(r.text).toContain("· Пётр — id 5");
    expect(r.text).toContain("· Иван Петров (@ivan) — id 200 (через основного бота)");
    expect(r.text).not.toContain("Юрист");
  });

  it("написать: собеседнику — своим ботом, участнику — основным; и то и другое ложится в диалог; неизвестному — отказ", async () => {
    await recordDialog(K, 5, { name: "Пётр", text: "привет" });
    const { out, by } = make();
    expect((await by.people_send.run({ who: "пётр", text: "Здравствуйте" })).ok).toBe(true);
    expect((await by.people_send.run({ who: "@ivan", text: "Иван, срок?" })).ok).toBe(true);
    expect(out).toEqual([{ via: "agent", chatId: "5", text: "Здравствуйте" }, { via: "main", chatId: "200", text: "Иван, срок?" }]);
    expect((await readDialog(K, 5)).messages.map((m) => m.from)).toEqual(["user", "bot"]);
    expect((await readDialog(botKey("100", "assistant"), 200)).messages[0]).toMatchObject({ from: "bot", text: "Иван, срок?" });
    expect(await by.people_send.run({ who: "никто", text: "x" })).toMatchObject({ ok: false });
  });

  it("спросить: ждёт ответа того человека; пришёл — отдаёт словами; не пришёл — говорит, сколько ждал", async () => {
    await recordDialog(K, 5, { name: "Пётр", text: "привет" });
    const { by } = make();
    const p = by.ask_person.run({ who: "Пётр", question: "Согласны?" });
    await new Promise((r) => setTimeout(r, 5));
    expect(isWaiting(K, 5)).toBe(true);
    expect(takeReply(K, 5, "да")).toBe(true);
    expect(await p).toEqual({ ok: true, text: "Пётр ответил: да" });
    const q = by.ask_person.run({ who: "ivan", question: "Срок?", minutes: 0.0001 });
    await new Promise((r) => setTimeout(r, 5));
    expect(isWaiting(botKey("100", "assistant"), 200)).toBe(true);
    // Срок не больше минуты в округлении: минимальный — секунда.
    resetWaiting();
    // Снятое ожидание — тот же «не ответил».
  });
});

describe("агенты по расписанию", () => {
  const T0 = Date.parse("2026-09-22T09:00:00Z");
  const store = () => {
    const files = {};
    return { files,
      read: async (u) => files[u] || null,
      markSent: async (u, key, now) => { files[u] = files[u] || { sent: {} }; files[u].sent[key] = now; } };
  };
  it("в час начала задачи агент начинает её — один раз; «через N минут» и постановка молчат", async () => {
    const st = store();
    const started = [];
    const tasksFor = async (userId, saved) => ({ chatId: null, tzOffset: 0, sent: saved?.sent || {},
      tasks: [{ id: "t1", title: "Договор", body: "проверить", status: "backlog", start: "2026-09-22T09:00", repeat: "once", days: [], time: "", warnMin: 10, end: "2026-09-23" },
        { id: "t2", kind: "setup", title: "Постановка", status: "wait" }] });
    const args = { agents: [{ id: "ag_a1", agentId: "a1", name: "Юрист" }], store: st, tasksFor,
      start: async (x) => { started.push(x); } };
    const n1 = await runAgentDuty({ ...args, now: T0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(n1).toBe(1);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ agentUserId: "ag_a1", agentId: "a1", name: "Юрист" });
    expect(started[0].task).toMatchObject({ kind: "start", title: "Договор", taskId: "t1" });
    expect(Object.keys(st.files.ag_a1.sent).length).toBeGreaterThanOrEqual(1);
    // Второй тик — та же задача не начинается снова.
    expect(await runAgentDuty({ ...args, now: T0 + 60000 })).toBe(0);
    expect(started).toHaveLength(1);
    expect(taskQuestion(started[0].task)).toMatch(/^Начни задачу «Договор» и доведи её до результата\.\nОписание: проверить\nСрок: 2026-09-23/);
  });
});
