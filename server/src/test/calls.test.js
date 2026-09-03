import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createMeeting, deleteMeeting, getMeeting, listMeetings, parseMeeting, peersIn,
  putSignal, resetRooms, takeSignals,
} from "../lib/callStore.js";
import { handleUpdate, resetPending } from "../lib/bot.js";
import * as org from "../lib/orgStore.js";
import * as calls from "../lib/callStore.js";

/* Встречи, сигналинг созвона и приглашение из инлайн-режима. */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-calls-"));
  process.env.CALLS_DIR = path.join(tmp, "calls");
  process.env.ORG_DIR = path.join(tmp, "org");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  await fs.rm(process.env.CALLS_DIR, { recursive: true, force: true });
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  resetRooms(); resetPending();
});

describe("встречи", () => {
  it("id встречи неугадываемый — он же и приглашение", async () => {
    const a = await createMeeting({ title: "Разбор", by: "100" });
    const b = await createMeeting({ title: "Разбор", by: "100" });
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(12);
  });

  it("встреча без названия не заводится", async () => {
    await expect(createMeeting({ title: "  ", by: "100" })).rejects.toThrow(/required/);
  });

  it("читается по id и попадает в список создавшего", async () => {
    const m = await createMeeting({ title: "Разбор", at: "завтра 15:00", by: "100" });
    expect((await getMeeting(m.id)).at).toBe("завтра 15:00");
    expect((await listMeetings("100")).map((x) => x.id)).toContain(m.id);
    expect((await listMeetings("200")).map((x) => x.id)).not.toContain(m.id);
  });

  it("удаляет только тот, кто создал", async () => {
    const m = await createMeeting({ title: "Разбор", by: "100" });
    expect(await deleteMeeting(m.id, "200")).toBe(false);
    expect(await deleteMeeting(m.id, "100")).toBe(true);
    expect(await getMeeting(m.id)).toBeNull();
  });
});

describe("сигналинг", () => {
  it("сигнал доходит до собеседника, но не возвращается отправителю", () => {
    putSignal("r1", { from: "100", data: { type: "offer" } });
    expect(takeSignals("r1", "200", 0).signals).toHaveLength(1);
    expect(takeSignals("r1", "100", 0).signals).toHaveLength(0);
  });

  it("адресный сигнал не виден третьему", () => {
    putSignal("r1", { from: "100", to: "200", data: { type: "ice" } });
    expect(takeSignals("r1", "200", 0).signals).toHaveLength(1);
    expect(takeSignals("r1", "300", 0).signals).toHaveLength(0);
  });

  it("since не отдаёт то, что уже забрали", () => {
    putSignal("r1", { from: "100", data: 1 });
    const first = takeSignals("r1", "200", 0);
    expect(first.signals).toHaveLength(1);
    expect(takeSignals("r1", "200", first.seq).signals).toHaveLength(0);
    putSignal("r1", { from: "100", data: 2 });
    expect(takeSignals("r1", "200", first.seq).signals).toHaveLength(1);
  });

  it("комнаты не смешиваются", () => {
    putSignal("r1", { from: "100", data: 1 });
    expect(takeSignals("r2", "200", 0).signals).toHaveLength(0);
  });

  it("старые сигналы выбрасываются — в них адреса участников", () => {
    const t0 = Date.now();
    putSignal("r1", { from: "100", data: 1 }, t0);
    // Через полчаса созвон давно кончился.
    expect(takeSignals("r1", "200", 0, t0 + 30 * 60000).signals).toHaveLength(0);
  });

  it("в комнате видно, кто в ней недавно был", () => {
    const t0 = Date.now();
    putSignal("r1", { from: "100", data: 1 }, t0);
    putSignal("r1", { from: "200", data: 1 }, t0);
    expect(peersIn("r1", t0).sort()).toEqual(["100", "200"]);
    // Через пару минут молчания участник уже не считается в комнате.
    expect(peersIn("r1", t0 + 120000)).toEqual([]);
  });
});

describe("разбор времени встречи", () => {
  const now = new Date(2026, 8, 1);   // 1 сентября 2026

  it("«завтра 15:00 разбор прогноза» — время отдельно, тема отдельно", () => {
    const p = parseMeeting("завтра 15:00 разбор прогноза", now);
    expect(p.time).toBe("15:00");
    expect(p.day).toBe(1);
    expect(p.title).toBe("разбор прогноза");
    expect(p.atText).toBe("завтра 15:00");
    expect(p.ok).toBe(true);
  });

  it("«в 9» — тоже время", () => {
    expect(parseMeeting("сегодня в 9 созвон", now).time).toBe("09:00");
  });

  it("дата числом разбирается вместе с месяцем", () => {
    const p = parseMeeting("5.09 10:30 планёрка", now);
    expect(p.time).toBe("10:30");
    expect(p.atText).toMatch(/сен/);
  });

  it("без времени встреча всё равно получается — но это видно", () => {
    const p = parseMeeting("созвон когда освободишься", now);
    expect(p.ok).toBe(false);
    expect(p.title).toBe("созвон когда освободишься");
  });

  it("пустой запрос ничего не выдумывает", () => {
    expect(parseMeeting("", now).ok).toBe(false);
    expect(parseMeeting("", now).title).toBe("");
  });

  it("«15.30» — это время, а не тридцатый месяц", () => {
    // Дата разбирается раньше времени, поэтому без проверки месяца «15.30»
    // ушло бы в дату, и времени у встречи не осталось бы вовсе.
    // Без слова про день дата разбирается первой, и «15.30» без проверки
    // месяца ушло бы в неё — времени у встречи не осталось бы вовсе.
    const p = parseMeeting("15.30 созвон", now);
    expect(p.time).toBe("15:30");
    expect(p.day).toBeNull();
    expect(p.title).toBe("созвон");
  });

  it("невозможное время приводится к возможному", () => {
    expect(parseMeeting("завтра 99:99 созвон", now).time).toBe("23:59");
  });
});

describe("инлайн-режим", () => {
  const sent = [];
  const inlineAnswers = [];
  const deps = {
    org, calls,
    send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); },
    answer: async () => {},
    answerInline: async (id, results, extra) => { inlineAnswers.push({ id, results, extra }); },
    appLink: (callId) => `https://t.me/bot/call?startapp=call_${callId}`,
    pageLink: (callId) => `https://x.test/call?call=${callId}`,
    botName: "bot",
  };
  const owner = { id: 100, first_name: "Владелец" };
  const guest = { id: 777, first_name: "Чужой" };
  const q = (from, query) => ({ update_id: 1, inline_query: { id: "iq1", from, query } });
  const last = () => inlineAnswers[inlineAnswers.length - 1];

  beforeEach(async () => {
    sent.length = 0; inlineAnswers.length = 0;
    await org.identify("100", { name: "Владелец" });
  });

  it("карточка несёт время, тему и ссылку на звонок", async () => {
    await handleUpdate(q(owner, "завтра 15:00 разбор прогноза"), deps);
    const [card] = last().results;
    expect(card.title).toMatch(/завтра 15:00/);
    expect(card.input_message_content.message_text).toMatch(/разбор прогноза/);
    expect(card.input_message_content.message_text).toMatch(/startapp=call_/);
    // И кнопкой тоже: ссылку в тексте на телефоне попасть пальцем трудно.
    expect(card.reply_markup.inline_keyboard[0][0].url).toMatch(/startapp=call_/);
  });

  it("в карточке две ссылки: мини-приложение и страница на случай осечки", async () => {
    // Мини-приложение зависит от того, что заведено в @BotFather. Если там
    // указан не тот адрес, Telegram покажет чёрный экран — и человеку на
    // встрече нужен запасной выход, а не разбирательство.
    await handleUpdate(q(owner, "завтра 15:00 разбор"), deps);
    const text = last().results[0].input_message_content.message_text;
    expect(text).toMatch(/Подключиться: https:\/\/t\.me\/bot\/call\?startapp=call_/);
    expect(text).toMatch(/Не открылось\? Откройте страницей: https:\/\/x\.test\/call\?call=/);
  });

  it("встреча заводится сразу — ссылка обязана работать в момент отправки", async () => {
    await handleUpdate(q(owner, "завтра 15:00 разбор"), deps);
    const id = last().results[0].id;
    expect(await getMeeting(id)).toBeTruthy();
  });

  it("пустой запрос показывает подсказку, а не пустоту", async () => {
    await handleUpdate(q(owner, ""), deps);
    expect(last().results[0].description).toMatch(/завтра 15:00/);
  });

  it("без разобранного времени так и сказано в подсказке", async () => {
    await handleUpdate(q(owner, "созвон когда-нибудь"), deps);
    expect(last().results[0].description).toMatch(/Время не разобрал/);
  });

  it("посторонний встреч не создаёт", async () => {
    await handleUpdate(q(guest, "завтра 15:00 разбор"), deps);
    expect(last().results).toEqual([]);
    expect(await listMeetings()).toHaveLength(0);
  });

  it("позвать на созвон может не только владелец", async () => {
    await org.addUser({ id: "200", name: "Иван", roleId: "executor", addedBy: "100" });
    await handleUpdate(q({ id: 200, first_name: "Иван" }, "завтра 12:00 созвон"), deps);
    expect(last().results).toHaveLength(1);
  });

  it("набор фразы по буквам правит одну встречу, а не плодит их", async () => {
    // Telegram присылает инлайн-запрос на каждое нажатие. По встрече на
    // нажатие — и хранилище (предел 500) за вечер вытеснит все прежние
    // вместе с их ссылками.
    for (const typed of ["зав", "завтра", "завтра 15:00", "завтра 15:00 разбор"]) {
      await handleUpdate(q(owner, typed), deps);
    }
    const all = await listMeetings();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("разбор");
    expect(all[0].at).toBe("завтра 15:00");
    // Ссылка всё это время одна и та же — её уже могли отправить.
    const ids = new Set(inlineAnswers.map((a) => a.results[0].id));
    expect(ids.size).toBe(1);
  });

  it("другая фраза — другая встреча: прежнее приглашение не переписывается", async () => {
    await handleUpdate(q(owner, "завтра 15:00 разбор"), deps);
    const first = last().results[0].id;
    await handleUpdate(q(owner, "в пятницу планёрка"), deps);
    const second = last().results[0].id;
    expect(second).not.toBe(first);
    expect((await getMeeting(first)).title).toBe("разбор");
  });

  it("инлайн-запрос не делает человека владельцем модели", async () => {
    // Владельца нет вовсе: набор запроса в чужом чате — не повод им стать.
    await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
    await handleUpdate(q(guest, "завтра 15:00 разбор"), deps);
    expect((await org.readOrg()).ownerId).toBeNull();
    expect(await listMeetings()).toHaveLength(0);
  });
});
