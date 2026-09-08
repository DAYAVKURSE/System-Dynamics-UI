import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as org from "../lib/orgStore.js";
import { writeModel } from "../lib/workspaceStore.js";
import { saveReport } from "../lib/reportStore.js";
import { createMeeting, putTranscript } from "../lib/callStore.js";
import { addMemory } from "../lib/memoryStore.js";
import { recordGroupMessage } from "../lib/chatStore.js";
import { INTERRUPTED, NO_MODEL, TRANSCRIBE_TIMEOUT_MS } from "../lib/transcribe.js";
import {
  MAX_CONTEXT_CHARS, TRUNCATED_NOTE, contextFor, describeModel, describeRecordings, fit,
} from "../lib/assistantContext.js";

/* Помощник знает ровно то, что человеку и так показывает приложение.
   Проверяем границу с обеих сторон: не-владелец не видит модель и чужие
   задачи, владелец видит модель; чужие файлы, встречи и память не
   попадают никому. */

let tmp;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-ctx-"));
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.REPORTS_DIR = path.join(tmp, "reports");
  process.env.CALLS_DIR = path.join(tmp, "calls");
  process.env.MEMORY_DIR = path.join(tmp, "memory");
  process.env.CHATS_DIR = path.join(tmp, "chats");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

const MODEL = {
  entities: [{ id: "e1", name: "Продажи" }, { id: "e2", name: "Юристы" }],
  kinds: [{ id: "k1", name: "документы" }],
  traits: [
    { id: "t1", e: "e1", l: "заявки", unit: "шт", have: 12 },
    { id: "t2", e: "e2", l: "договоры", k: "k1", unit: "шт", have: null },
    { id: "t9", e: "e2", l: "тайный бюджет", unit: "₽", have: 1000000 },
  ],
  funcs: [
    { id: "f1", e: "e1", name: "Обработать заявку", about: "позвонить и записать",
      takes: [{ id: "p1", trait: "t1", lo: 1, hi: 2 }],
      gives: [{ id: "p2", trait: "t2", lo: 0, hi: 1 }],
      dur: 1, durHi: 2, durUnit: "ч", every: 1, everyUnit: "дн" },
    { id: "f2", e: "e2", name: "Сезон", kind: "factor", takes: [], gives: [], dur: 1, durUnit: "мес" },
  ],
  goals: [{ id: "g1", trait: "t2", qty: 5, rate: "week", dueKind: "in", dueIn: 1, dueUnit: "мес",
    hours: 2, hoursUnit: "ч", hoursPer: "day", appliedAt: null }],
  reports: [{ id: "rp1", parent: null, name: "Проект А", trait: "t2", units: [] },
    { id: "rs1", parent: "rp1", name: "Раздел 1", trait: "t1", units: ["u1", "u2"] }],
  tasks: [
    { id: "tk1", funcId: "f1", title: "Задача Ивана", status: "progress", end: "2026-09-10T18:00",
      setter: "100", assignee: "200", reviewer: "300", submissions: [], reviews: [],
      comments: [
        { id: "c1", text: "публично: не спешите", at: "2026-09-07T10:00:00Z", by: "100", to: null, hidden: false },
        { id: "c2", text: "скрыто Ивану", at: "2026-09-07T10:01:00Z", by: "100", to: "200", hidden: true },
        { id: "c3", text: "скрыто Петру", at: "2026-09-07T10:02:00Z", by: "100", to: "300", hidden: true },
      ] },
    { id: "tk2", funcId: "f1", title: "Задача Петра", status: "backlog", end: null,
      setter: "100", assignee: "300", reviewer: "100", submissions: [],
      reviews: [{ id: "r1", at: "2026-09-06T10:00:00Z", by: "100", accept: true, mark: 5,
        comment: "отлично", hidden: false }], comments: [] },
    { id: "tk9", funcId: "f2", title: "Задача владельца", status: "done",
      setter: "100", assignee: "100", reviewer: "100", submissions: [], reviews: [], comments: [] },
  ],
};

beforeEach(async () => {
  for (const d of ["ORG_DIR", "WORKSPACE_DIR", "REPORTS_DIR", "CALLS_DIR", "MEMORY_DIR", "CHATS_DIR"]) {
    await fs.rm(process.env[d], { recursive: true, force: true });
  }
  delete process.env.OWNER_TELEGRAM_ID;
  await org.identify("100", { name: "Владелец" });
  await org.addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
  await org.addUser({ id: "300", name: "Пётр", roleId: "reviewer", addedBy: "100" });
  await writeModel(MODEL);
  await saveReport("200", { name: "отчёт-ивана.png", type: "image/png", bytes: Buffer.from("png") });
  await saveReport("300", { name: "отчёт-петра.png", type: "image/png", bytes: Buffer.from("png") });
  await createMeeting({ title: "созвон Ивана", at: "завтра 15:00", text: "обсудить заявки", by: "200" });
  await createMeeting({ title: "созвон Петра", at: "завтра 16:00", text: "", by: "300" });
  await addMemory("200", { title: "памятка Ивана", text: "клиент любит звонки утром" });
  await addMemory("300", { title: "памятка Петра", text: "тайна Петра" });
});

describe("не-владелец", () => {
  it("видит свою задачу с именами постановщика и проверяющего — как на карточке", async () => {
    const ctx = await contextFor("200");
    expect(ctx).toContain("Задача Ивана");
    expect(ctx).toContain("вы исполняете");
    expect(ctx).toContain("поставил: Владелец");
    expect(ctx).toContain("проверяет: Пётр");
    expect(ctx).toContain("в работе");
  });

  it("не видит модель и чужие задачи", async () => {
    const ctx = await contextFor("200");
    expect(ctx).not.toContain("Задача Петра");
    expect(ctx).not.toContain("Задача владельца");
    expect(ctx).not.toContain("тайный бюджет");
    expect(ctx).not.toContain("## Модель");
    expect(ctx).not.toContain("## Цели");
  });

  it("не видит чужие файлы, встречи и память", async () => {
    const ctx = await contextFor("200");
    expect(ctx).toContain("отчёт-ивана.png");
    expect(ctx).not.toContain("отчёт-петра.png");
    expect(ctx).toContain("созвон Ивана");
    expect(ctx).not.toContain("созвон Петра");
    expect(ctx).toContain("клиент любит звонки утром");
    expect(ctx).not.toContain("тайна Петра");
  });

  it("скрытый комментарий — только адресату и автору", async () => {
    const ivan = await contextFor("200");
    expect(ivan).toContain("публично: не спешите");
    expect(ivan).toContain("скрыто Ивану");
    expect(ivan).not.toContain("скрыто Петру");
    const petr = await contextFor("300");
    expect(petr).toContain("скрыто Петру");
    expect(petr).not.toContain("скрыто Ивану");
  });

  it("свои оценки не видит: решение — да, отметку — нет", async () => {
    const petr = await contextFor("300");
    expect(petr).toContain("Задача Петра");
    expect(petr).toContain("принято");
    expect(petr).toContain("отлично");
    expect(petr).not.toMatch(/оценка\s*5|mark/i);
  });

  it("чего нет — названо словами, а не пропущено", async () => {
    await fs.rm(process.env.CALLS_DIR, { recursive: true, force: true });
    const ctx = await contextFor("200");
    expect(ctx).toContain("Встреч нет.");
    expect(ctx).toContain("срок 2026-09-10 18:00");
  });
});

describe("владелец", () => {
  it("видит модель: активы, ресурсы с остатками, функции, цели, отчёты", async () => {
    const ctx = await contextFor("100");
    expect(ctx).toContain("## Модель");
    expect(ctx).toContain("Актив «Продажи»");
    expect(ctx).toContain("заявки — есть 12 шт");
    expect(ctx).toContain("договоры (документы) — количество не названо");
    expect(ctx).toContain("«Обработать заявку»: берёт заявки 1–2 шт; даёт договоры 0–1 шт → в актив «Юристы»");
    expect(ctx).toContain("время одного выполнения 1–2 ч; повтор раз в 1 дн");
    expect(ctx).toContain("«Сезон» (фактор");
    expect(ctx).toContain("договоры: 5 в неделю, через 1 мес; готовы тратить 2 ч в день; ещё не применена");
    expect(ctx).toContain("Проект А › Раздел 1: ресурс «заявки», единицы: u1, u2");
    expect(ctx).toContain("Прогноз и план по целям здесь не посчитаны");
  });

  it("видит все задачи — как на своей доске", async () => {
    const ctx = await contextFor("100");
    expect(ctx).toContain("Задача Ивана");
    expect(ctx).toContain("Задача Петра");
    expect(ctx).toContain("Задача владельца");
  });

  it("но не чужие файлы, встречи и память", async () => {
    const ctx = await contextFor("100");
    expect(ctx).not.toContain("отчёт-ивана.png");
    expect(ctx).not.toContain("созвон Петра");
    expect(ctx).not.toContain("тайна Петра");
    expect(ctx).toContain("Память пуста.");
  });
});

describe("чаты групп", () => {
  const msg = (chatId, title, text, id = 1) => ({
    message_id: id, date: 1757340000 + id,
    chat: { id: chatId, type: "supergroup", title },
    from: { id: 100, first_name: "Владелец" }, text,
  });

  it("чужой чат (не член) в контекст не попадает, свой — попадает; членство спрашивается при обращении", async () => {
    await recordGroupMessage(msg(-1001, "Продажи", "скидку не даём"));
    await recordGroupMessage(msg(-1002, "Юристы", "тайна юристов"));
    const asked = [];
    const isMember = async (chatId, userId) => { asked.push([chatId, userId]); return chatId === "-1001"; };
    const ctx = await contextFor("200", { isMember });
    expect(ctx).toContain("## Чаты");
    expect(ctx).toContain("«Продажи»");
    expect(ctx).toContain("Владелец: скидку не даём");
    expect(ctx).not.toContain("тайна юристов");
    expect(asked).toEqual(expect.arrayContaining([["-1001", "200"], ["-1002", "200"]]));
  });

  it("выгнали из чата — следующий вопрос его уже не видит", async () => {
    await recordGroupMessage(msg(-1001, "Продажи", "скидку не даём"));
    let inside = true;
    const isMember = async () => inside;
    expect(await contextFor("200", { isMember })).toContain("скидку не даём");
    inside = false;
    expect(await contextFor("200", { isMember })).not.toContain("скидку не даём");
  });

  it("правка сообщения не даёт второй строки", async () => {
    await recordGroupMessage(msg(-1001, "Продажи", "скидку не даём"));
    await recordGroupMessage({ ...msg(-1001, "Продажи", "скидку даём"), edit_date: 1757340100 });
    const ctx = await contextFor("200", { isMember: async () => true });
    expect(ctx).toContain("(исправлено): скидку даём");
    expect(ctx).not.toContain("скидку не даём");
    expect(ctx).toContain("(1 сообщений)");
  });

  it("чатов нет — сказано словами", async () => {
    expect(await contextFor("200", { isMember: async () => true })).toContain("Чатов нет");
  });
});

describe("записи звонков", () => {
  const call = (who, name) => saveReport(who, { name, type: "video/webm", kind: "call", bytes: Buffer.from("webm") });

  it("записей нет — сказано словами", async () => {
    expect(await contextFor("200")).toContain("Записей звонков нет.");
  });

  it("расшифровка без модели — фраза словами, а не тишина", async () => {
    await call("200", "звонок-ивана.webm");
    const ctx = await contextFor("200");
    expect(ctx).toContain("## Записи звонков");
    expect(ctx).toContain("«звонок-ивана.webm»");
    expect(ctx).toContain(NO_MODEL);
  });

  it("с расшифровкой — текст; чужая расшифровка не видна", async () => {
    const mine = await call("200", "звонок-ивана.webm");
    const other = await call("300", "звонок-петра.webm");
    await putTranscript({ fileId: mine.id, by: "200", name: mine.name, status: "done",
      text: "Договорились о скидке", model: "Groq / whisper" });
    await putTranscript({ fileId: other.id, by: "300", name: other.name, status: "done", text: "тайна звонка Петра" });
    const ctx = await contextFor("200");
    expect(ctx).toContain("Договорились о скидке");
    expect(ctx).toContain("(Groq / whisper)");
    expect(ctx).not.toContain("тайна звонка Петра");
    expect(ctx).not.toContain("звонок-петра.webm");
  });

  it("«идёт» и «не удалось» — словами с причиной", async () => {
    const a = await call("200", "звонок-а.webm");
    const b = await call("200", "звонок-б.webm");
    await putTranscript({ fileId: a.id, by: "200", name: a.name, status: "pending", model: "Groq / whisper" });
    await putTranscript({ fileId: b.id, by: "200", name: b.name, status: "error", error: "провайдер ответил 500: boom" });
    const ctx = await contextFor("200");
    expect(ctx).toContain("расшифровка ещё идёт (модель Groq / whisper");
    expect(ctx).toContain("расшифровка не удалась — провайдер ответил 500: boom");
  });

  it("«идёт» дольше предела ожидания — «прервана перезапуском», а не «идёт» навечно", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    const old = new Date(now - TRANSCRIBE_TIMEOUT_MS - 60000).toISOString();
    const fresh = new Date(now - 60000).toISOString();
    const text = describeRecordings(
      [{ id: "f1", name: "а.webm", savedAt: old }, { id: "f2", name: "б.webm", savedAt: fresh }],
      [{ fileId: "f1", status: "pending", at: old, model: "Groq" }, { fileId: "f2", status: "pending", at: fresh, model: "Groq" }],
      undefined, now,
    );
    expect(text).toContain(`«а.webm», сохранена ${old.replace("T", " ").slice(0, 16)}: ${INTERRUPTED}`);
    expect(text).toContain("выберите модель расшифровки заново");
    expect(text).toContain("«б.webm»");
    expect(text).toContain("расшифровка ещё идёт (модель Groq");
  });

  it("длинная расшифровка обрезается с пометкой, а не молча", () => {
    const text = describeRecordings(
      [{ id: "f1", name: "а.webm", savedAt: "2026-09-08T10:00:00Z" }, { id: "f2", name: "б.webm", savedAt: "2026-09-08T09:00:00Z" }],
      [{ fileId: "f1", status: "done", text: "x".repeat(50) }, { fileId: "f2", status: "done", text: "y".repeat(50) }],
      60,
    );
    expect(text).toContain("x".repeat(50));
    expect(text).toContain("расшифровка обрезана");
    expect(text).not.toContain("y".repeat(50));
  });
});

describe("границы", () => {
  it("непозванному контекст не собирается", async () => {
    await expect(contextFor("777")).rejects.toThrow(/не звали/);
  });

  it("роль проверяется заново при каждом обращении", async () => {
    expect(await contextFor("200")).toContain("Задача Ивана");
    await org.removeUser("200");
    await expect(contextFor("200")).rejects.toThrow(/не звали/);
  });

  it("слишком длинный контекст обрезается с честной пометкой", () => {
    const long = "x".repeat(MAX_CONTEXT_CHARS * 2);
    const cut = fit(long);
    expect(cut.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(cut.endsWith(TRUNCATED_NOTE)).toBe(true);
    expect(fit("короткий")).toBe("короткий");
  });

  it("пустая модель описывается словами", () => {
    const text = describeModel({});
    expect(text).toContain("Активов в модели нет.");
    expect(text).toContain("Целей не поставлено.");
    expect(text).toContain("Проектов и разделов нет.");
  });
});
