import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { botKey, readDialog, recordDialog, setBanned } from "../lib/dialogStore.js";
import { resetWaiting, waitReply } from "../lib/peopleWait.js";
import { DONE_TEXT, createAgentBots, handleAgentUpdate } from "../lib/agentBots.js";
import { CLOCKS, THINKING } from "../lib/botAssistant.js";
import { runAgentPlanned, statusMessage, systemFor } from "../lib/agentRun.js";
import { PLAN_NOTE } from "../lib/planRunner.js";
import { addAgent, addProvider, updateAgent, updateProvider } from "../lib/assistantSettings.js";
import { identify } from "../lib/orgStore.js";

/* ═══════════════════════════════════════════════════════════════
   БОТЫ АГЕНТОВ

   Человек пишет боту агента — агент отвечает своей моделью, помня
   переписку; статус «🕐 Думаю…» с планом под ним правится по ходу.
   Забаненному — ничего. «/dialogs» — только владельцу настроек.
   ═══════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-agentbots-"));
  process.env.DIALOGS_DIR = path.join(tmp, "dialogs");
  process.env.ASSISTANT_DIR = path.join(tmp, "assistant");
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  await fs.rm(process.env.DIALOGS_DIR, { recursive: true, force: true });
  resetWaiting();
});

const BOT = { userId: "100", agentId: "a1", name: "Юрист", token: "1:x", username: "lawyer_bot" };
const K = botKey("100", "a1");
const petr = { id: 500, first_name: "Пётр", username: "petr" };
const owner = { id: 100, first_name: "Владелец" };
const message = (from, text, chat = { id: from.id, type: "private" }) => ({ update_id: 1, message: { from, chat, text } });

function deps(answer = "Здравствуйте, Пётр") {
  const sent = [];
  const edits = [];
  const runs = [];
  return {
    sent, edits, runs,
    send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); return { message_id: sent.length }; },
    edit: async (chatId, messageId, text, keyboard) => { edits.push({ chatId, messageId, text, keyboard }); },
    answer: async () => {},
    status: ({ chatId, first }) => statusMessage({ chatId, first,
      send: async (c, t) => { sent.push({ chatId: c, text: t }); return { message_id: sent.length }; },
      edit: async (c, m, t, k) => { edits.push({ chatId: c, messageId: m, text: t, keyboard: k }); } }),
    run: async ({ question, notes, onPlan }) => { runs.push({ question, notes }); if (onPlan) await onPlan("Что нужно сделать: ответить"); return answer; },
  };
}

describe("сообщение человека боту агента", () => {
  it("записывается, агент отвечает с переписки, статус — «Думаю…» → план → «Готово» с планом; ответ тоже в диалог", async () => {
    await recordDialog(K, 500, { name: "Пётр", text: "раньше спрашивал", at: "2026-01-01T00:00:00Z" });
    await recordDialog(K, 500, { from: "bot", text: "раньше отвечал", at: "2026-01-01T00:01:00Z" });
    const d = deps();
    const r = await handleAgentUpdate(BOT, message(petr, "Добрый день"), d);
    expect(r).toEqual({ answered: true });
    expect(d.runs[0].question).toBe("Добрый день");
    expect(d.runs[0].notes[0]).toMatch(/# С кем говоришь\nПётр \(@petr\), id 500\. Ты — агент «Юрист»/);
    expect(d.runs[0].notes[1]).toBe("# Переписка с ним до этого\nчеловек: раньше спрашивал\nЮрист: раньше отвечал");
    expect(d.sent[0].text).toBe(`${CLOCKS[0]} ${THINKING}`);
    expect(d.sent[1].text).toBe("Здравствуйте, Пётр");
    const last = d.edits[d.edits.length - 1];
    expect(last.text).toBe(`${DONE_TEXT}\n\nЧто нужно сделать: ответить`);
    expect(last.keyboard).toBeNull();
    const dialog = await readDialog(K, 500);
    expect(dialog.messages.slice(-2).map((m) => `${m.from}:${m.text}`)).toEqual(["user:Добрый день", "bot:Здравствуйте, Пётр"]);
  });

  it("ответ планировщика — объект `{answer}`: в чат уходят слова, а не «[object Object]»", async () => {
    const d = deps();
    d.run = async () => ({ planned: true, answer: "Три процесса: приём, звонок, сдача.", plan: null, unsolved: false });
    expect(await handleAgentUpdate(BOT, message(petr, "что знаешь о процессах?"), d)).toEqual({ answered: true });
    expect(d.sent[1].text).toBe("Три процесса: приём, звонок, сдача.");
    expect((await readDialog(K, 500)).messages.pop().text).toBe("Три процесса: приём, звонок, сдача.");
  });

  it("забаненному — ничего; команды и группы — мимо; «/start» — приветствие", async () => {
    await recordDialog(K, 500, { name: "Пётр", text: "x" });
    await setBanned(K, 500, true);
    const d = deps();
    expect(await handleAgentUpdate(BOT, message(petr, "ау"), d)).toEqual({ ignored: "banned" });
    expect(d.sent).toEqual([]);
    expect(await handleAgentUpdate(BOT, message(owner, "/help"), d)).toEqual({ ignored: "command" });
    expect(await handleAgentUpdate(BOT, message(petr, "в группе", { id: -1, type: "supergroup" }), d)).toEqual({ ignored: "not private" });
    expect(await handleAgentUpdate(BOT, message(owner, "/start"), d)).toEqual({ welcomed: true });
    expect(d.sent[0].text).toMatch(/Юрист/);
  });

  it("ответ, которого ждал агент (ask_person), уходит ждущему, а не в новый разговор", async () => {
    await recordDialog(K, 500, { name: "Пётр", text: "x" });
    const p = waitReply(K, 500, 5000);
    const d = deps();
    expect(await handleAgentUpdate(BOT, message(petr, "да, согласен"), d)).toEqual({ replied: true });
    expect(await p).toBe("да, согласен");
    expect(d.runs).toEqual([]);
    expect((await readDialog(K, 500)).messages.map((m) => m.text)).toEqual(["x", "да, согласен"]);
  });

  it("модель не ответила — слова человеку, статус «Не вышло»", async () => {
    const d = deps();
    d.run = async () => { throw new Error("модель не выбрана"); };
    expect(await handleAgentUpdate(BOT, message(petr, "?"), d)).toEqual({ error: "модель не выбрана" });
    expect(d.sent[1].text).toBe("модель не выбрана");
    expect(d.edits[d.edits.length - 1].text).toMatch(/^Не вышло/);
  });
});

describe("/dialogs у бота агента", () => {
  it("владельцу — список; другому — ничего; кнопки тоже только владельцу", async () => {
    await recordDialog(K, 500, { name: "Пётр", text: "x" });
    const d = deps();
    expect(await handleAgentUpdate(BOT, message(petr, "/dialogs"), d)).toEqual({ ignored: "not owner" });
    expect(d.sent).toEqual([]);
    expect(await handleAgentUpdate(BOT, message(owner, "/dialogs@lawyer_bot"), d)).toEqual({ dialogs: true });
    expect(d.sent[0].keyboard.inline_keyboard.flat().map((b) => b.text)).toEqual(["Пётр · 1", "закрыть"]);
    const cb = (from, data) => ({ update_id: 2, callback_query: { id: "c", from, data, message: { chat: { id: from.id }, message_id: 1 } } });
    expect(await handleAgentUpdate(BOT, cb(petr, "dl:o:500:0"), d)).toEqual({ ignored: "not owner" });
    expect(await handleAgentUpdate(BOT, cb(owner, "dl:o:500:0"), d)).toEqual({ opened: "500", page: 0 });
    expect(d.edits[0].text).toMatch(/^Пётр/);
  });
});

describe("опрос ботов", () => {
  it("по опросчику на токен; пропавший из настроек — останавливается, новый — заводится", async () => {
    let bots = [{ ...BOT }];
    const handled = [];
    let calls = 0;
    const reg = createAgentBots({
      list: () => bots,
      getUpdates: async (offset, timeout, token) => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return calls === 1 ? [{ update_id: 10, message: { from: petr, chat: { id: 500, type: "private" }, text: "/x" } }] : [];
      },
      handle: async (bot, u) => { handled.push([bot.name, u.update_id]); },
    });
    reg.refresh();
    expect(reg.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(handled).toEqual([["Юрист", 10]]);
    bots = [{ ...BOT, token: "2:y", name: "Другой" }];
    reg.refresh();
    expect(reg.bots().map((b) => b.name)).toEqual(["Другой"]);
    reg.stop();
    expect(reg.size()).toBe(0);
  });
});

describe("разговор агента с планом", () => {
  it("подсказка: правила, модели, действия, скилл, план, заметки, данные — в этом порядке", () => {
    const s = systemFor({ agent: { uses: {}, models: [], ask: false, skill: "Отвечай кратко" }, notes: ["# Заметка\nтекст"], context: "данные" });
    const order = ["# Чем ты можешь думать", "# Что ты умеешь делать", "# Инструкция\nОтвечай кратко", "# Планирование", "# Заметка", "# Данные\nданные"];
    let at = -1;
    order.forEach((m) => { const i = s.indexOf(m); expect(i).toBeGreaterThan(at); at = i; });
    expect(s).toContain(PLAN_NOTE);
  });

  it("свой агент: модель — его собственная; действует как участник-агент; без модели — ошибка словами", async () => {
    await identify("100", { name: "Владелец" });
    const p = addProvider("100", { name: "OpenAI", kind: "openai", key: "sk-test-0123456789" });
    updateProvider("100", p.id, { models: ["gpt-4.1"] });
    const a = addAgent("100", { name: "Юрист" });
    await expect(runAgentPlanned({ ownerId: "100", agentId: a.id, question: "?", complete: async () => "x",
      contextFor: async () => "" })).rejects.toThrow(/не выбрана модель/);
    updateAgent("100", a.id, { models: [{ providerId: p.id, model: "gpt-4.1" }] });
    const seen = [];
    const r = await runAgentPlanned({ ownerId: "100", agentId: a.id, asUserId: `ag_${a.id}`, question: "сколько задач?",
      complete: async (req) => { seen.push(req); return "три"; }, contextFor: async (u) => `данные ${u}` });
    expect(r).toMatchObject({ planned: false, answer: "три" });
    expect(seen[0].model).toBe("gpt-4.1");
    expect(seen[0].key).toBe("sk-test-0123456789");
    expect(seen[0].system).toContain(`# Данные\nданные ag_${a.id}`);
    expect(seen[0].messages).toEqual([{ role: "user", content: "сколько задач?" }]);
    // Инструменты «люди» — среди инструментов модели, когда даны.
    const r2 = await runAgentPlanned({ ownerId: "100", agentId: a.id, question: "?", complete: async (req) => { seen.push(req); return "ok"; },
      contextFor: async () => "", extra: [{ name: "people_list", description: "кому", run: async () => ({ ok: true, text: "" }) }] });
    expect(r2.answer).toBe("ok");
    expect(seen[seen.length - 1].tools.map((t) => t.name)).toContain("people_list");
  });
});
