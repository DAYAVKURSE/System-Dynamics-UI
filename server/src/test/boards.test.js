import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import * as org from "../lib/orgStore.js";
import * as boards from "../lib/boardStore.js";
import { BOARD_COLORS, MEMBER_COLORS, MIN_DELTA_E, deltaE, inkOn, luminance, pickColor }
  from "../lib/boardColors.js";
import { saveReport } from "../lib/reportStore.js";
import { boardLinkFor, boardPageLink } from "../lib/links.js";
import { PLAN_TABS } from "../lib/plans.js";
import { TABS as CODES_TABS, TAB_NAMES, LEVEL_TABS } from "../../../codes/src/plans.js";
import { ensureStorage, inStorage } from "../lib/storages.js";

/* ════════════════════════════════════════════════════════════════
   БРЕЙНШТОРМ-ДОСКИ (владелец, 2026-09-25): стор, цвета, ссылка и
   маршруты. Маршруты — через supertest по createApp, с настоящей
   подписью Telegram: блокировки и удаления держатся на ней.
   ════════════════════════════════════════════════════════════════ */

/* Токен плана из сервиса кодов — подменяется: сам сервис проверяется в
   codes.test.js, здесь важно одно — что вкладка плана доходит до досок. */
const mock = vi.hoisted(() => ({ tokens: {} }));
vi.mock("../lib/codes.js", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, verify: async (t) => mock.tokens[t] || null };
});

const TOKEN = "board-test-token";
let tmp, app, prev;

function initDataFor(id, name = "Кто-то", extra = {}) {
  const user = JSON.stringify({ id, first_name: name, ...extra });
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), user };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}
const as = (id, name, extra) => ({ "X-Telegram-Init-Data": initDataFor(id, name, extra) });
const inMain = (id, name) => ({ ...as(id, name), "X-Storage": "main" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error("не дождались");
    await sleep(10);
  }
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-boards-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN,
    stat: process.env.STATIC_DIR };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.BOARDS_DIR = path.join(tmp, "boards");
  process.env.REPORTS_DIR = path.join(tmp, "reports");
  process.env.STATIC_DIR = path.join(tmp, "static");
  await fs.mkdir(process.env.STATIC_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.STATIC_DIR, "index.html"), "<title>Схема</title>");
  await fs.writeFile(path.join(process.env.STATIC_DIR, "board.html"), "<title>Доска</title>");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  delete process.env.CODES_URL;
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  if (prev.stat === undefined) delete process.env.STATIC_DIR; else process.env.STATIC_DIR = prev.stat;
  delete process.env.REPORTS_DIR;
  boards.resetBoards();
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  delete process.env.CODES_URL;
  mock.tokens = {};
  boards.resetBoards();
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await fs.rm(process.env.BOARDS_DIR, { recursive: true, force: true });
  await fs.rm(process.env.WORKSPACE_DIR, { recursive: true, force: true });
});

/** Владелец MAIN — 100; «Штурм» — роль с вкладкой brainstorm. */
async function setupOrg() {
  await org.identify("100", { name: "Владелец" });
  const role = await org.addRole({ name: "Штурм", tabs: ["tasks", "brainstorm"] });
  await org.addUser({ id: "200", name: "Иван Штурмов", roleId: role.id, addedBy: "100" });
  await org.addUser({ id: "300", name: "Пётр Исполнитель", roleId: "executor", addedBy: "100" });
  return role;
}

async function newBoard(name = "Идеи", by = "100", opts = {}) {
  const res = await request(app).post("/api/boards").set(inMain(by, opts.byName || "Владелец"))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.board;
}
const open = (id, who, name, q = "") => request(app).get(`/api/boards/${id}${q}`).set(as(who, name));

/* ─────── цвета ─────── */

const ratio = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("цвета досок и участников", () => {
  it("буквы — чёрные или белые, что контрастнее; у каждого цвета палитры контраст не ниже 4.5", () => {
    expect(inkOn("#FFFFFF")).toBe("#111111");
    expect(inkOn("#000000")).toBe("#FFFFFF");
    expect(inkOn("#9BCB5A")).toBe("#111111");   // салатный — светлый
    expect(inkOn("#1F6E78")).toBe("#FFFFFF");   // петроль — тёмный
    expect(inkOn("#4B4FC4")).toBe("#FFFFFF");   // индиго
    for (const c of [...MEMBER_COLORS, ...BOARD_COLORS]) {
      expect(["#111111", "#FFFFFF"]).toContain(inkOn(c));
      expect(ratio(c, inkOn(c))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("палитры без базовых цветов, без повторов; фоны досок темнее любого стикера", () => {
    const basic = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#00FFFF", "#FF00FF", "#000000", "#FFFFFF"];
    for (const c of [...MEMBER_COLORS, ...BOARD_COLORS]) expect(basic).not.toContain(c.toUpperCase());
    expect(new Set(MEMBER_COLORS).size).toBe(MEMBER_COLORS.length);
    expect(new Set(BOARD_COLORS).size).toBe(BOARD_COLORS.length);
    const darkestSticker = Math.min(...MEMBER_COLORS.map(luminance));
    for (const b of BOARD_COLORS) expect(luminance(b)).toBeLessThan(darkestSticker);
    /* Стикер отделяется от доски не только тенью: «баклажан» #5E3A6E
       давал 1,6:1 и на тёмной сливе пропадал, петроль и индиго — 2,2–2,5.
       Любой цвет участника к любому фону доски — не меньше 3:1. */
    for (const m of MEMBER_COLORS) {
      for (const b of BOARD_COLORS) expect(ratio(m, b)).toBeGreaterThanOrEqual(3);
    }
  });

  it("«разных цветов» — на глаз: любые два цвета палитры отстоят не меньше чем на ΔE 8", () => {
    for (const list of [BOARD_COLORS, MEMBER_COLORS]) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          expect(deltaE(list[i], list[j]), `${list[i]} и ${list[j]}`).toBeGreaterThanOrEqual(MIN_DELTA_E);
        }
      }
    }
  });

  it("первый свободный по порядку; палитра кончилась — достроенный свой, а не повтор", () => {
    expect(pickColor(MEMBER_COLORS, [], "a")).toBe(MEMBER_COLORS[0]);
    expect(pickColor(MEMBER_COLORS, [MEMBER_COLORS[0].toLowerCase()], "a")).toBe(MEMBER_COLORS[1]);
    const all = [...MEMBER_COLORS];
    const extra = pickColor(MEMBER_COLORS, all, "777");
    expect(all).not.toContain(extra);
    for (const c of all) expect(deltaE(c, extra)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    // Достроенный держит те же правила: буквы — 4.5, к любой доске — 3.
    expect(ratio(extra, inkOn(extra))).toBeGreaterThanOrEqual(4.5);
    for (const b of BOARD_COLORS) expect(ratio(extra, b)).toBeGreaterThanOrEqual(3);
    // Тот же id при тех же занятых — тот же цвет.
    expect(pickColor(MEMBER_COLORS, all, "777")).toBe(extra);
    // Участников много — у каждого свой.
    const many = [...MEMBER_COLORS];
    for (let i = 0; i < 30; i += 1) many.push(pickColor(MEMBER_COLORS, many, `u${i}`));
    expect(new Set(many).size).toBe(many.length);
    for (const c of many.slice(MEMBER_COLORS.length)) {
      expect(ratio(c, inkOn(c))).toBeGreaterThanOrEqual(4.5);
      for (const b of BOARD_COLORS) expect(ratio(c, b)).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ─────── ссылка ─────── */

describe("ссылка на доску", () => {
  it("то же мини-приложение, что у звонка, но board_<id> и без mode=compact", () => {
    expect(boardLinkFor({ botName: "sdbot", callMain: true }, "b1"))
      .toBe("https://t.me/sdbot?startapp=board_b1");
    expect(boardLinkFor({ botName: "sdbot", callApp: "call" }, "b1"))
      .toBe("https://t.me/sdbot/call?startapp=board_b1");
    for (const l of [boardLinkFor({ botName: "sdbot", callMain: true }, "b1"),
      boardLinkFor({ botName: "sdbot", callApp: "call" }, "b1")]) expect(l).not.toContain("compact");
  });

  it("без приложения или с негодным id — страница /board", () => {
    expect(boardLinkFor({ botName: "sdbot", publicUrl: "https://x.test" }, "b1"))
      .toBe("https://x.test/board?board=b1");
    expect(boardLinkFor({ publicUrl: "https://x.test", callMain: true }, "b1"))
      .toBe("https://x.test/board?board=b1");
    expect(boardLinkFor({ botName: "b", callApp: "call", publicUrl: "https://x.test" }, "a b"))
      .toBe("https://x.test/board?board=a%20b");
    expect(boardPageLink({}, "b1")).toBe("/board?board=b1");
  });
});

/* ─────── вкладка ─────── */

describe("вкладка «Брейншторм»", () => {
  it("стоит сразу после «Отчётов» — и на сервере, и в сервисе кодов", () => {
    expect(org.TABS.indexOf("brainstorm")).toBe(org.TABS.indexOf("reports") + 1);
    expect(CODES_TABS).toEqual(org.TABS);
    expect(TAB_NAMES.brainstorm).toBe("Брейншторм");
  });

  it("max открывает её сам; free и pro — без изменений", () => {
    expect(PLAN_TABS.max).toContain("brainstorm");
    expect(LEVEL_TABS.max).toContain("brainstorm");
    expect(PLAN_TABS.free).toEqual(["market", "me", "tasks"]);
    expect(PLAN_TABS.pro).not.toContain("brainstorm");
    expect(LEVEL_TABS.pro).not.toContain("brainstorm");
  });

  it("роль с brainstorm открывает вкладку — с правом r тоже", async () => {
    await setupOrg();
    const role = await org.addRole({ name: "Смотрящий" });
    await org.setRoleTabs(role.id, { brainstorm: "r" });
    await org.addUser({ id: "400", name: "Сима", roleId: role.id, addedBy: "100" });
    expect((await org.identify("400", {})).tabs).toContain("brainstorm");
    const res = await request(app).post("/api/boards").set(inMain(400, "Сима")).send({ name: "Её" });
    expect(res.status).toBe(201);
  });
});

/* ─────── стор ─────── */

describe("стор досок", () => {
  it("id — 12 знаков base64url; создатель — сразу участник со своим цветом", async () => {
    const b = await boards.createBoard({ name: "  Идеи   к  релизу ", by: "100", byName: "Владелец" });
    expect(b.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(b.name).toBe("Идеи к релизу");
    expect(b.rev).toBe(1);
    expect(b.members).toEqual([{ id: "100", name: "Владелец", color: MEMBER_COLORS[0], joinedAt: null,
      blocked: false }]);
    const again = await boards.createBoard({ name: "Идеи", by: "100" });
    expect(again.id).not.toBe(b.id);
  });

  it("пустое имя — отказ словами; длинное — до 120", async () => {
    await expect(boards.createBoard({ name: "   ", by: "100" }))
      .rejects.toMatchObject({ status: 400, message: "Название доски не может быть пустым." });
    const b = await boards.createBoard({ name: "я".repeat(300), by: "100" });
    expect(b.name).toHaveLength(120);
  });

  it("доски хранилища — разных цветов; другое хранилище и черновики не в счёт", async () => {
    const a = await boards.createBoard({ name: "A", by: "1", storage: "main" });
    const d = await boards.createBoard({ name: "черновик", by: "1", storage: "main", draft: true });
    const b = await boards.createBoard({ name: "B", by: "1", storage: "main" });
    const other = await boards.createBoard({ name: "C", by: "2", storage: "2" });
    expect(a.color).toBe(BOARD_COLORS[0]);
    expect(d.color).toBe(BOARD_COLORS[1]);
    expect(b.color).toBe(BOARD_COLORS[1]);   // черновик цвет не держит
    expect(other.color).toBe(BOARD_COLORS[0]);
    // Черновик, ставший доской, получает свой, незанятый.
    const { published } = await boards.enterBoard(d.id, { id: "5", name: "Гость" });
    expect(published).toBe(true);
    expect(d.color).toBe(BOARD_COLORS[2]);
    /* Палитра кончилась — цвет достраивается: и тринадцатая доска, и
       дальше — у каждой свой, и первая сверх палитры на глаз отличима от
       всех. Фон — не светлее палитры: стикерам на нём те же 3:1. */
    const made = [];
    for (let i = 0; i < BOARD_COLORS.length + 6; i += 1) {
      made.push(await boards.createBoard({ name: `x${i}`, by: "1", storage: "s" }));
    }
    const colors = made.map((x) => x.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.slice(0, BOARD_COLORS.length)).toEqual(BOARD_COLORS);
    const thirteenth = colors[BOARD_COLORS.length];
    for (const c of BOARD_COLORS) expect(deltaE(c, thirteenth)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    const lightest = Math.max(...BOARD_COLORS.map(luminance));
    for (const c of colors) {
      expect(luminance(c)).toBeLessThanOrEqual(lightest);
      for (const m of MEMBER_COLORS) expect(ratio(m, c)).toBeGreaterThanOrEqual(3);
    }
  });

  it("цвет участника — первый свободный на ЭТОЙ доске", async () => {
    const b = await boards.createBoard({ name: "A", by: "1" });
    await boards.enterBoard(b.id, { id: "2", name: "Два" });
    await boards.enrollMembers(b.id, [{ id: "3", name: "Три" }]);
    expect(b.members.map((m) => m.color)).toEqual(MEMBER_COLORS.slice(0, 3));
    const other = await boards.createBoard({ name: "B", by: "3" });
    expect(other.members[0].color).toBe(MEMBER_COLORS[0]);
  });

  it("список — без черновиков, новые сверху, по хранилищу", async () => {
    const a = await boards.createBoard({ name: "A", by: "1" });
    await boards.createBoard({ name: "черн", by: "1", draft: true });
    const b = await boards.createBoard({ name: "B", by: "1" });
    await boards.createBoard({ name: "чужая", by: "2", storage: "2" });
    expect((await boards.listBoards({ storage: "main" })).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(await boards.listBoards({ storage: "main" })).toEqual([
      { id: b.id, name: "B", color: b.color, by: "1", byName: "", stickers: 0, createdAt: b.createdAt },
      { id: a.id, name: "A", color: a.color, by: "1", byName: "", stickers: 0, createdAt: a.createdAt },
    ]);
    expect(await boards.listBoards({ storage: "main", drafts: true })).toHaveLength(3);
  });

  it("каждое изменение двигает rev; то, что ничего не меняет, — нет", async () => {
    const b = await boards.createBoard({ name: "A", by: "1" });
    let rev = b.rev;
    const step = () => { expect(b.rev).toBe(rev + 1); rev = b.rev; };
    await boards.enterBoard(b.id, { id: "1", name: "Один" }); step();          // пришёл
    await boards.enterBoard(b.id, { id: "1", name: "Один" });
    expect(b.rev).toBe(rev);                                                   // уже здесь
    // Сменил имя — запомнено, но rev не двигается (см. тест ниже).
    await boards.enterBoard(b.id, { id: "1", name: "Один Новый" });
    expect(b.rev).toBe(rev);
    expect(b.members.find((m) => m.id === "1").name).toBe("Один Новый");
    const { sticker } = await boards.addSticker(b.id, "1"); step();
    await boards.setStickerText(b.id, sticker.id, "1", "текст"); step();
    await boards.setStickerText(b.id, sticker.id, "1", "текст");
    expect(b.rev).toBe(rev);
    await boards.enterBoard(b.id, { id: "2", name: "Два" }); step();
    await boards.setBlocked(b.id, "1", "2", true); step();
    await boards.setBlocked(b.id, "1", "2", false); step();
    await boards.enrollMembers(b.id, [{ id: "3" }]); step();
    await boards.enrollMembers(b.id, [{ id: "3" }]);
    expect(b.rev).toBe(rev);
    await boards.removeMember(b.id, "1", "3"); step();
    await boards.deleteSticker(b.id, sticker.id, "1"); step();
  });

  it("стикеров — не больше 500; текст — до 2000", async () => {
    const b = await boards.createBoard({ name: "A", by: "1" });
    for (let i = 0; i < boards.MAX_STICKERS; i += 1) await boards.addSticker(b.id, "1");
    await expect(boards.addSticker(b.id, "1"))
      .rejects.toMatchObject({ status: 400, message: "На доске уже 500 стикеров." });
    const sid = b.stickers[0].id;
    await boards.setStickerText(b.id, sid, "1", "ы".repeat(5000));
    expect(b.stickers[0].text).toHaveLength(2000);
  });

  it("два окна одного человека с разными подписями не будят друг друга: имя — без нового rev", async () => {
    const b = await boards.createBoard({ name: "A", by: "1" });
    await boards.enterBoard(b.id, { id: "200", name: "Anna" });
    const rev = b.rev;
    // Ждущий на этой доске не должен просыпаться от смены имени.
    const woke = vi.fn();
    const waiting = boards.waitBoard(b.id, rev, 150).then(woke);
    for (let i = 0; i < 20; i += 1) {
      await boards.enterBoard(b.id, { id: "200", name: i % 2 ? "Anna" : "Anna P." });
    }
    expect(b.rev).toBe(rev);
    expect(boards.waitingOn(b.id)).toBe(1);
    await waiting;
    expect(woke).toHaveBeenCalledTimes(1);
    // Имя доезжает со следующим настоящим изменением.
    await boards.enterBoard(b.id, { id: "200", name: "Anna Petrova" });
    await boards.addSticker(b.id, "200");
    expect(b.rev).toBe(rev + 1);
    expect(b.members.find((m) => m.id === "200").name).toBe("Anna Petrova");
  });

  it("досок в хранилище — не больше 200: новая не заводится, чужие хранилища не трогаются", async () => {
    const mainBoard = await boards.createBoard({ name: "Главная", by: "100" });
    const mainDraft = await boards.createBoard({ name: "Отправленный черновик", by: "100", draft: true });
    for (let i = 0; i < boards.MAX_BOARDS_PER_STORAGE; i += 1) {
      await boards.createBoard({ name: `д${i}`, by: "555", storage: "555" });
    }
    await expect(boards.createBoard({ name: "лишняя", by: "555", storage: "555" }))
      .rejects.toMatchObject({ status: 400, message: `В хранилище уже ${boards.MAX_BOARDS_PER_STORAGE} досок.` });
    await expect(boards.createBoard({ name: "и черновик", by: "555", storage: "555", draft: true }))
      .rejects.toMatchObject({ status: 400 });
    expect((await boards.listBoards({ storage: "555" }))).toHaveLength(boards.MAX_BOARDS_PER_STORAGE);
    // Доска и черновик MAIN целы, и в MAIN новые по-прежнему заводятся.
    expect((await boards.listBoards({ storage: "main" })).map((x) => x.id)).toEqual([mainBoard.id]);
    expect(await boards.getBoard(mainDraft.id)).toBeTruthy();
    await boards.createBoard({ name: "Ещё главная", by: "100" });
  }, 30000);

  it("черновики: срока нет; на пределе вытесняются свои неотправленные — сперва промежуточные, потом старые", async () => {
    const other = await boards.createBoard({ name: "чужой", by: "2", draft: true });
    const sent = await boards.createBoard({ name: "ушёл в чат", by: "1", draft: true });
    expect(await boards.markDraftSent(sent.id)).toBe(true);
    const first = await boards.createBoard({ name: "первый", by: "1", draft: true });
    const typing = await boards.createBoard({ name: "Ито", by: "1", draft: true });
    for (let i = 2; i < boards.MAX_DRAFTS_PER_CREATOR; i += 1) {
      await boards.createBoard({ name: `ч${i}.`, by: "1", draft: true });
    }
    // Год без открытия — ссылка всё ещё работает: срока нет.
    const old = new Date(Date.now() - 365 * 86400000).toISOString();
    for (const x of [other, first]) (await boards.getBoard(x.id)).createdAt = old;
    await boards.createBoard({ name: "Итоги", by: "1", draft: true });
    expect(await boards.getBoard(first.id)).toBeTruthy();
    // Предел: первым уходит промежуточный «Ито» (начало «Итоги»), а не самый старый.
    expect(await boards.getBoard(typing.id)).toBeNull();
    await boards.createBoard({ name: "сверх", by: "1", draft: true });
    expect(await boards.getBoard(first.id)).toBeNull();          // потом — свой самый старый
    expect(await boards.getBoard(sent.id)).toBeTruthy();         // отправленный — никогда
    expect(await boards.getBoard(other.id)).toBeTruthy();        // чужой — никогда
  }, 60000);

  it("черновик ищется по точному имени и создателю; не переименовывается; открытый — уже не черновик", async () => {
    const d = await boards.createBoard({ name: "Идеи", by: "1", draft: true });
    expect((await boards.findDraft({ by: "1", name: "  Идеи " }))?.id).toBe(d.id);
    expect(await boards.findDraft({ by: "1", name: "Иде" })).toBeNull();
    expect(await boards.findDraft({ by: "2", name: "Идеи" })).toBeNull();
    expect(await boards.findDraft({ by: "1", name: "Идеи", storage: "s" })).toBeNull();
    await boards.enterBoard(d.id, { id: "1", name: "Один" });
    expect(await boards.findDraft({ by: "1", name: "Идеи" })).toBeNull();
    expect(await boards.markDraftSent(d.id)).toBe(false);
    expect(d.sent).toBeUndefined();
  });

  it("на диск — с задержкой и атомарно; перечитывается как было", async () => {
    const f = path.join(process.env.BOARDS_DIR, "boards.json");
    const b = await boards.createBoard({ name: "На диск", by: "1" });
    // Сразу — ещё нет: запись отложена.
    await expect(fs.access(f)).rejects.toThrow();
    await until(async () => fs.access(f).then(() => true, () => false));
    const saved = JSON.parse(await fs.readFile(f, "utf8"));
    expect(saved.map((x) => x.id)).toEqual([b.id]);
    expect((await fs.readdir(process.env.BOARDS_DIR)).filter((n) => n.includes(".tmp"))).toEqual([]);
    // Правка + немедленная запись.
    await boards.addSticker(b.id, "1");
    await boards.flushBoards();
    boards.resetBoards();
    const back = await boards.getBoard(b.id);
    expect(back.stickers).toHaveLength(1);
    expect(back.rev).toBe(b.rev);
  });

  it("испорченный файл не затирается пустым — откладывается рядом", async () => {
    await fs.mkdir(process.env.BOARDS_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.BOARDS_DIR, "boards.json"), "{ не json");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await boards.listBoards()).toEqual([]);
    err.mockRestore();
    const names = await fs.readdir(process.env.BOARDS_DIR);
    expect(names.some((n) => n.startsWith("boards.json.broken-"))).toBe(true);
  });

  it("ожидание: будит изменение, отпускает по сроку, снимается отменой", async () => {
    const b = await boards.createBoard({ name: "A", by: "1" });
    // Изменение будит сразу.
    const t0 = Date.now();
    const woke = boards.waitBoard(b.id, b.rev, 5000);
    await until(() => boards.waitingOn(b.id) === 1);
    await boards.addSticker(b.id, "1");
    await woke;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(boards.waitingOn(b.id)).toBe(0);
    // Срок.
    const t1 = Date.now();
    await boards.waitBoard(b.id, b.rev, 60);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(50);
    // Уже отставший rev — сразу.
    await boards.waitBoard(b.id, b.rev - 1, 5000);
    // Отмена.
    const ac = new AbortController();
    const cancelled = boards.waitBoard(b.id, b.rev, 5000, ac.signal);
    await until(() => boards.waitingOn(b.id) === 1);
    ac.abort();
    await cancelled;
    expect(boards.waitingOn(b.id)).toBe(0);
  });
});

/* ─────── основное приложение: список и создание ─────── */

describe("список и создание досок", () => {
  it("без права на вкладку — 403 словами; с правом — список хранилища", async () => {
    await setupOrg();
    const no = await request(app).get("/api/boards").set(inMain(300, "Пётр"));
    expect(no.status).toBe(403);
    expect(no.body.error).toBe("Нет доступа к брейншторму.");
    const cant = await request(app).post("/api/boards").set(inMain(300, "Пётр")).send({ name: "Моя" });
    expect(cant.status).toBe(403);
    expect(cant.body.error).toBe("У вас нет прав на создание досок.");
    expect(await boards.listBoards({ drafts: true })).toEqual([]);

    const a = await newBoard("Первая");
    const b = await newBoard("Вторая", "200", { byName: "Иван" });
    const list = await request(app).get("/api/boards").set(inMain(200, "Иван"));
    expect(list.status).toBe(200);
    expect(list.body.canCreate).toBe(true);
    expect(list.body.boards.map((x) => x.id)).toEqual([b.id, a.id]);
    // Имя создателя — из организации (identify только что обновил его из подписи).
    expect(list.body.boards[0]).toEqual({ id: b.id, name: "Вторая", color: b.color, by: "200",
      byName: "Иван", stickers: 0, createdAt: b.createdAt });
    expect(a.color).not.toBe(b.color);
  });

  it("пустое название — 400 словами", async () => {
    await setupOrg();
    const res = await request(app).post("/api/boards").set(inMain(100, "Владелец")).send({ name: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Название доски не может быть пустым.");
  });

  it("доски — по хранилищам: своя доска в своём хранилище, в MAIN её нет", async () => {
    await setupOrg();
    const main = await newBoard("Главная");
    // У 300 своё хранилище, где он владелец: там вкладка открыта.
    const own = await request(app).post("/api/boards").set(as(300, "Пётр")).send({ name: "Своя" });
    expect(own.status).toBe(201);
    const ownList = await request(app).get("/api/boards").set(as(300, "Пётр"));
    expect(ownList.body.boards.map((x) => x.id)).toEqual([own.body.board.id]);
    const mainList = await request(app).get("/api/boards").set(inMain(100, "Владелец"));
    expect(mainList.body.boards.map((x) => x.id)).toEqual([main.id]);
    expect((await boards.getBoard(own.body.board.id)).storage).toBe("300");
  });

  it("люди с доступом вписываются в участники при создании и при каждом списке", async () => {
    const role = await setupOrg();
    // Виртуальный без Telegram и агент — войти на доску им нечем.
    await org.addVirtualUser({ roleId: role.id, addedBy: "100" });
    const agent = await org.addAgentUser({ id: "a1", name: "Агент", addedBy: "100" });
    await org.setUserRoles(agent.id, [role.id]);
    const b = await newBoard("Идеи");
    const ids = () => boards.getBoard(b.id).then((x) => x.members.map((m) => [m.id, m.joinedAt]));
    expect(await ids()).toEqual([["100", null], ["200", null]]);

    // Роль появилась позже доски — участник появится при следующем списке.
    const v = await org.addVirtualUser({ roleId: role.id, addedBy: "100" });
    const { user } = await org.claimVirtual((await org.readOrg()).users.find((u) => u.id === v.id).token,
      "600", { name: "Вера" });
    expect(user.tg).toBe("600");
    await org.setUserRoles("300", ["executor", role.id]);
    await request(app).get("/api/boards").set(inMain(100, "Владелец")).expect(200);
    expect(await ids()).toEqual([["100", null], ["200", null], ["300", null], ["600", null]]);
  });

  it("план без вкладки закрывает и список, и создание — даже владельцу", async () => {
    await setupOrg();
    process.env.CODES_URL = "http://codes.test";
    mock.tokens = {
      pro: { uid: "u1", plan: "pro", tabs: null },
      picked: { uid: "u2", plan: "pro", tabs: ["me", "brainstorm"] },
      max: { uid: "u3", plan: "max" },
    };
    const h = (tok) => ({ ...inMain(100, "Владелец"), "X-User-Token": tok });
    const r1 = await request(app).get("/api/boards").set(h("pro"));
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe("Нет доступа к брейншторму.");
    const r2 = await request(app).post("/api/boards").set(h("pro")).send({ name: "x" });
    expect(r2.status).toBe(403);
    expect(r2.body.error).toBe("У вас нет прав на создание досок.");
    await request(app).get("/api/boards").set(h("picked")).expect(200);
    await request(app).post("/api/boards").set(h("max")).send({ name: "x" }).expect(201);
  });

  it("список без подписи в production — 401", async () => {
    await request(app).get("/api/boards").expect(401);
  });
});

/* ─────── доска ─────── */

describe("доска: вход и вид", () => {
  it("любой со ссылкой входит и вписывается; вид — ровно по контракту", async () => {
    await setupOrg();
    const b = await newBoard("Идеи");
    const res = await open(b.id, 777, "Гость Чатов");
    expect(res.status).toBe(200);
    const v = res.body.board;
    expect(Object.keys(v).sort()).toEqual(["by", "byName", "color", "createdAt", "id", "isCreator", "me",
      "members", "name", "rev", "stickers"]);
    expect(v).toMatchObject({ id: b.id, name: "Идеи", color: b.color, by: "100", byName: "Владелец",
      me: "777", isCreator: false, stickers: [] });
    const guest = v.members.find((m) => m.id === "777");
    expect(guest).toEqual({ id: "777", name: "Гость Чатов", color: MEMBER_COLORS[2], avatar: null,
      registered: false, blocked: false, stickers: 0 });
    // Вписанные заранее видны тоже — зарегистрированные, с именем из организации.
    expect(v.members.find((m) => m.id === "200")).toMatchObject({ name: "Иван Штурмов", registered: true });
    const stored = (await boards.getBoard(b.id)).members.find((m) => m.id === "777");
    expect(Date.parse(stored.joinedAt)).toBeGreaterThan(0);
    // Создатель видит себя создателем.
    expect((await open(b.id, 100, "Владелец")).body.board.isCreator).toBe(true);
  });

  it("имя незарегистрированного — из Telegram, и обновляется на входе", async () => {
    await setupOrg();
    const b = await newBoard();
    await open(b.id, 777, "Гость");
    const v = (await open(b.id, 777, "Гость Переименованный")).body.board;
    expect(v.members.find((m) => m.id === "777").name).toBe("Гость Переименованный");
    const nick = await request(app).get(`/api/boards/${b.id}`)
      .set({ "X-Telegram-Init-Data": initDataFor(778, "", { first_name: undefined, username: "nick" }) });
    expect(nick.body.board.members.find((m) => m.id === "778").name).toBe("nick");
  });

  it("нет доски — 404 словами; без подписи — 401 словами", async () => {
    const res = await open("нет-такой", 100, "Владелец");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Доски нет.");
    const b = await boards.createBoard({ name: "A", by: "100" });
    const anon = await request(app).get(`/api/boards/${b.id}`);
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("Откройте доску в Telegram.");
    const forged = new URLSearchParams(initDataFor(100, "Я"));
    forged.set("user", JSON.stringify({ id: 100, first_name: "Я" }).replace("100", "101"));
    const bad = await request(app).get(`/api/boards/${b.id}`)
      .set("X-Telegram-Init-Data", forged.toString());
    expect(bad.status).toBe(401);
    // Гостевого номера, как у звонка, здесь нет.
    const guest = await request(app).get(`/api/boards/${b.id}`).set("X-Call-Guest", "abcdefgh12345");
    expect(guest.status).toBe(401);
  });

  it("вход на доску не делает человека владельцем модели", async () => {
    // Владельца нет вовсе: посторонний открыл доску из общего чата.
    const b = await boards.createBoard({ name: "A", by: "900" });
    await open(b.id, 777, "Гость").expect(200);
    await request(app).post(`/api/boards/${b.id}/stickers`).set(as(777, "Гость")).expect(201);
    expect((await org.readOrg()).ownerId).toBeNull();
  });

  it("черновик из инлайна становится доской при первом открытии — и в нём появляются люди с доступом", async () => {
    await setupOrg();
    const d = await boards.createBoard({ name: "Из чата", by: "200", byName: "Иван", draft: true });
    const before = await request(app).get("/api/boards").set(inMain(100, "Владелец"));
    expect(before.body.boards).toEqual([]);
    const res = await open(d.id, 555, "Кто-то из чата");
    expect(res.status).toBe(200);
    expect((await boards.getBoard(d.id)).draft).toBe(false);
    expect(res.body.board.members.map((m) => m.id).sort()).toEqual(["100", "200", "555"]);
    const after = await request(app).get("/api/boards").set(inMain(100, "Владелец"));
    expect(after.body.boards.map((x) => x.id)).toEqual([d.id]);
  });
});

describe("доска: длинный опрос", () => {
  it("без rev и с отставшим rev — сразу; с текущим — ждёт и отвечает на первое же изменение", async () => {
    await setupOrg();
    const b = await newBoard();
    const first = (await open(b.id, 200, "Иван")).body.board;
    const t0 = Date.now();
    const old = await open(b.id, 200, "Иван", `?rev=${first.rev - 1}&wait=5000`);
    expect(old.body.board.rev).toBe(first.rev);
    const ahead = await open(b.id, 200, "Иван", `?rev=${first.rev + 5}&wait=5000`);
    expect(ahead.body.board.rev).toBe(first.rev);
    expect(Date.now() - t0).toBeLessThan(1000);

    const waiting = open(b.id, 200, "Иван", `?rev=${first.rev}&wait=5000`).then((r) => r);
    await until(() => boards.waitingOn(b.id) === 1);
    const t1 = Date.now();
    const add = await request(app).post(`/api/boards/${b.id}/stickers`).set(as(100, "Владелец"));
    expect(add.status).toBe(201);
    const got = await waiting;
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(got.status).toBe(200);
    expect(got.body.board.rev).toBeGreaterThan(first.rev);
    expect(got.body.board.stickers).toHaveLength(1);
    expect(boards.waitingOn(b.id)).toBe(0);
  });

  it("ничего не изменилось — ответ по сроку тем же состоянием; срок не больше 25 с", async () => {
    await setupOrg();
    const b = await newBoard();
    const { rev } = (await open(b.id, 100, "Владелец")).body.board;
    const t0 = Date.now();
    const res = await open(b.id, 100, "Владелец", `?rev=${rev}&wait=80`);
    expect(res.status).toBe(200);
    expect(res.body.board.rev).toBe(rev);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });

  it("заблокированный во время ожидания получает 403 с blocked", async () => {
    await setupOrg();
    const b = await newBoard();
    const { rev } = (await open(b.id, 777, "Гость")).body.board;
    const waiting = open(b.id, 777, "Гость", `?rev=${rev}&wait=5000`).then((r) => r);
    await until(() => boards.waitingOn(b.id) === 1);
    await request(app).post(`/api/boards/${b.id}/members/777/block`).set(as(100, "Владелец")).expect(200);
    const got = await waiting;
    expect(got.status).toBe(403);
    expect(got.body).toEqual({ error: "Вы были заблокированы.", blocked: true });
  });

  it("клиент ушёл — ожидание снимается", async () => {
    await setupOrg();
    const b = await newBoard();
    const { rev } = (await open(b.id, 100, "Владелец")).body.board;
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address();
      const req = http.get({ host: "127.0.0.1", port, path: `/api/boards/${b.id}?rev=${rev}&wait=20000`,
        headers: as(100, "Владелец") });
      req.on("error", () => {});
      await until(() => boards.waitingOn(b.id) === 1);
      req.destroy();
      await until(() => boards.waitingOn(b.id) === 0);
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});

describe("доска: стикеры", () => {
  it("новый стикер — пустой, моего авторства, в конец; правит и удаляет только автор", async () => {
    await setupOrg();
    const b = await newBoard();
    const s1 = await request(app).post(`/api/boards/${b.id}/stickers`).set(as(200, "Иван"));
    expect(s1.status).toBe(201);
    const s2 = await request(app).post(`/api/boards/${b.id}/stickers`).set(as(777, "Гость"));
    const list = s2.body.board.stickers;
    expect(list.map((s) => s.by)).toEqual(["200", "777"]);
    expect(list[1]).toMatchObject({ by: "777", text: "" });
    expect(Object.keys(list[0]).sort()).toEqual(["by", "createdAt", "id", "text", "updatedAt"]);
    // Первый стикер гостя вписал его в участники.
    expect(s2.body.board.members.find((m) => m.id === "777")).toMatchObject({ stickers: 1 });

    const sid = list[0].id;
    const foreign = await request(app).patch(`/api/boards/${b.id}/stickers/${sid}`).set(as(777, "Гость"))
      .send({ text: "чужое" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Править стикер может только его автор.");
    // И создатель доски чужой стикер не правит.
    await request(app).patch(`/api/boards/${b.id}/stickers/${sid}`).set(as(100, "Владелец"))
      .send({ text: "чужое" }).expect(403);

    const mine = await request(app).patch(`/api/boards/${b.id}/stickers/${sid}`).set(as(200, "Иван"))
      .send({ text: "моя идея" });
    expect(mine.status).toBe(200);
    expect(Object.keys(mine.body)).toEqual(["rev"]);
    expect(mine.body.rev).toBe((await boards.getBoard(b.id)).rev);
    const seen = (await open(b.id, 777, "Гость")).body.board;
    expect(seen.stickers[0].text).toBe("моя идея");

    const long = await request(app).patch(`/api/boards/${b.id}/stickers/${sid}`).set(as(200, "Иван"))
      .send({ text: "д".repeat(3000) });
    expect(long.status).toBe(200);
    expect((await boards.getBoard(b.id)).stickers[0].text).toHaveLength(2000);

    // Без текста — отказ, а не стёртый стикер; пустая строка — очистить.
    const empty = await request(app).patch(`/api/boards/${b.id}/stickers/${sid}`).set(as(200, "Иван"))
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Нет текста стикера.");
    expect((await boards.getBoard(b.id)).stickers[0].text).toHaveLength(2000);

    const none = await request(app).patch(`/api/boards/${b.id}/stickers/nope`).set(as(200, "Иван"))
      .send({ text: "x" });
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("Стикера нет.");

    const delForeign = await request(app).delete(`/api/boards/${b.id}/stickers/${sid}`).set(as(777, "Гость"));
    expect(delForeign.status).toBe(403);
    expect(delForeign.body.error).toBe("Править стикер может только его автор.");
    const del = await request(app).delete(`/api/boards/${b.id}/stickers/${sid}`).set(as(200, "Иван"));
    expect(del.status).toBe(200);
    expect(typeof del.body.rev).toBe("number");
    expect((await boards.getBoard(b.id)).stickers.map((s) => s.by)).toEqual(["777"]);
  });

  it("стикеры идут по времени создания; число стикеров — у каждого участника", async () => {
    await setupOrg();
    const b = await newBoard();
    for (const who of [100, 200, 100]) {
      await request(app).post(`/api/boards/${b.id}/stickers`).set(as(who, "x")).expect(201);
    }
    const v = (await open(b.id, 100, "Владелец")).body.board;
    const times = v.stickers.map((s) => s.createdAt);
    expect([...times].sort()).toEqual(times);
    expect(v.stickers.map((s) => s.by)).toEqual(["100", "200", "100"]);
    expect(v.members.find((m) => m.id === "100").stickers).toBe(2);
    expect(v.members.find((m) => m.id === "200").stickers).toBe(1);
  });

  it("предел 500 — 400 словами", async () => {
    await setupOrg();
    const b = await newBoard();
    for (let i = 0; i < 500; i += 1) await boards.addSticker(b.id, "100");
    const res = await request(app).post(`/api/boards/${b.id}/stickers`).set(as(100, "Владелец"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("На доске уже 500 стикеров.");
  });
});

describe("доска: участниками управляет только создатель", () => {
  it("не создатель — 403 словами; себя — 400; нет такого — 404", async () => {
    await setupOrg();
    const b = await newBoard();
    await open(b.id, 777, "Гость");
    for (const [method, url] of [["post", "/members/777/block"], ["post", "/members/777/unblock"],
      ["delete", "/members/777"]]) {
      const res = await request(app)[method](`/api/boards/${b.id}${url}`).set(as(200, "Иван"));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Управлять участниками может только создатель доски.");
    }
    const self = await request(app).post(`/api/boards/${b.id}/members/100/block`).set(as(100, "Владелец"));
    expect(self.status).toBe(400);
    expect(self.body.error).toBe("Себя заблокировать нельзя.");
    const selfDel = await request(app).delete(`/api/boards/${b.id}/members/100`).set(as(100, "Владелец"));
    expect(selfDel.status).toBe(400);
    expect(selfDel.body.error).toBe("Себя удалить нельзя.");
    await request(app).post(`/api/boards/${b.id}/members/999/block`).set(as(100, "Владелец")).expect(404);
  });

  it("блок: войти нельзя ни на одном маршруте, стикеры остаются; снять блок — можно снова", async () => {
    await setupOrg();
    const b = await newBoard();
    const s = await request(app).post(`/api/boards/${b.id}/stickers`).set(as(777, "Гость"));
    const sid = s.body.board.stickers[0].id;
    const blocked = await request(app).post(`/api/boards/${b.id}/members/777/block`).set(as(100, "Владелец"));
    expect(blocked.status).toBe(200);
    const m = blocked.body.board.members.find((x) => x.id === "777");
    expect(m).toMatchObject({ blocked: true, stickers: 1 });
    expect(blocked.body.board.stickers.map((x) => x.id)).toEqual([sid]);

    const tries = [
      open(b.id, 777, "Гость"),
      request(app).post(`/api/boards/${b.id}/stickers`).set(as(777, "Гость")),
      request(app).patch(`/api/boards/${b.id}/stickers/${sid}`).set(as(777, "Гость")).send({ text: "x" }),
      request(app).delete(`/api/boards/${b.id}/stickers/${sid}`).set(as(777, "Гость")),
    ];
    for (const res of await Promise.all(tries)) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Вы были заблокированы.", blocked: true });
    }
    // И при следующих заходах — то же.
    expect((await open(b.id, 777, "Гость")).body.blocked).toBe(true);
    // Список в приложении не вписывает его заново и блок не снимает.
    await request(app).get("/api/boards").set(inMain(100, "Владелец")).expect(200);
    expect((await boards.getBoard(b.id)).members.find((x) => x.id === "777").blocked).toBe(true);

    const un = await request(app).post(`/api/boards/${b.id}/members/777/unblock`).set(as(100, "Владелец"));
    expect(un.status).toBe(200);
    expect(un.body.board.members.find((x) => x.id === "777").blocked).toBe(false);
    await open(b.id, 777, "Гость").expect(200);
  });

  it("удаление: из участников — вон, все стикеры — с доски, войти больше нельзя", async () => {
    await setupOrg();
    const b = await newBoard();
    await request(app).post(`/api/boards/${b.id}/stickers`).set(as(200, "Иван")).expect(201);
    await request(app).post(`/api/boards/${b.id}/stickers`).set(as(200, "Иван")).expect(201);
    await request(app).post(`/api/boards/${b.id}/stickers`).set(as(100, "Владелец")).expect(201);
    const res = await request(app).delete(`/api/boards/${b.id}/members/200`).set(as(100, "Владелец"));
    expect(res.status).toBe(200);
    expect(res.body.board.members.map((m) => m.id)).not.toContain("200");
    expect(res.body.board.stickers.map((s) => s.by)).toEqual(["100"]);
    expect((await boards.getBoard(b.id)).removed).toEqual(["200"]);

    const back = await open(b.id, 200, "Иван");
    expect(back.status).toBe(403);
    expect(back.body).toEqual({ error: "Вас удалили с доски.", removed: true });
    await request(app).post(`/api/boards/${b.id}/stickers`).set(as(200, "Иван")).expect(403);
    // Роль у него осталась, но решение создателя сильнее: заново не вписывается.
    await request(app).get("/api/boards").set(inMain(100, "Владелец")).expect(200);
    expect((await boards.getBoard(b.id)).members.map((m) => m.id)).not.toContain("200");
  });

  it("управлять может и создатель, у которого нет роли — он создатель этой доски", async () => {
    await setupOrg();
    const b = await newBoard("Ивана", "200", { byName: "Иван" });
    await open(b.id, 777, "Гость");
    await request(app).post(`/api/boards/${b.id}/members/777/block`).set(as(200, "Иван")).expect(200);
    // А владелец модели чужой доской не управляет.
    await request(app).post(`/api/boards/${b.id}/members/777/unblock`).set(as(100, "Владелец")).expect(403);
  });
});

describe("доска: картинки участников", () => {
  it("зарегистрированный с картинкой — ссылка на неё; незарегистрированный — null", async () => {
    await setupOrg();
    const pic = `data:image/png;base64,${PNG.toString("base64")}`;
    await org.setProfile("200", { avatar: pic });
    const b = await newBoard();
    await open(b.id, 777, "Гость");
    const v = (await open(b.id, 200, "Иван")).body.board;
    const ivan = v.members.find((m) => m.id === "200");
    expect(ivan.registered).toBe(true);
    expect(ivan.avatar).toMatch(new RegExp(`^/api/boards/${b.id}/avatar/200\\?v=[0-9a-f]{8}$`));
    expect(v.members.find((m) => m.id === "777").avatar).toBeNull();
    // Владелец без картинки — зарегистрирован, но без ссылки.
    expect(v.members.find((m) => m.id === "100")).toMatchObject({ registered: true, avatar: null });

    // Байты — без подписи (картинке в <img> заголовок не передать).
    const img = await request(app).get(ivan.avatar);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toMatch(/^image\/png/);
    expect(img.headers["cache-control"]).toBe("private, max-age=300");
    expect(Buffer.compare(img.body, PNG)).toBe(0);
    // Сменил картинку — сменилась и версия в ссылке.
    await org.setProfile("200", { avatar: `data:image/png;base64,${Buffer.concat([PNG, Buffer.from([0])]).toString("base64")}` });
    const again = (await open(b.id, 200, "Иван")).body.board.members.find((m) => m.id === "200");
    expect(again.avatar).not.toBe(ivan.avatar);
  });

  it("картинка из Telegram — переадресацией; чужому, постороннему и не-картинке — 404", async () => {
    await setupOrg();
    await org.identify("200", { name: "Иван Штурмов", photo: "https://t.me/i/userpic/320/ivan.jpg" });
    const b = await newBoard();
    await open(b.id, 777, "Гость");
    const r = await request(app).get(`/api/boards/${b.id}/avatar/200`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("https://t.me/i/userpic/320/ivan.jpg");
    expect(r.headers["cache-control"]).toBe("private, max-age=300");
    await request(app).get(`/api/boards/${b.id}/avatar/777`).expect(404);   // не зарегистрирован
    await request(app).get(`/api/boards/${b.id}/avatar/999`).expect(404);   // не участник
    await request(app).get(`/api/boards/nope/avatar/200`).expect(404);
    // Своя «картинка» с HTML внутри с нашего адреса не отдаётся.
    await org.setProfile("200", { avatar: "data:text/html;base64,PHNjcmlwdD4=" });
    await request(app).get(`/api/boards/${b.id}/avatar/200`).expect(404);
    await org.setProfile("200", { avatar: "data:image/svg+xml;base64,PHN2Zz4=" });
    await request(app).get(`/api/boards/${b.id}/avatar/200`).expect(404);
  });

  it("картинка, загруженная на сервер (/api/reports/…), отдаётся байтами — только растровая", async () => {
    await setupOrg();
    const saved = await saveReport("200", { name: "лицо.png", type: "image/png", bytes: PNG, kind: "avatar" });
    await org.setProfile("200", { avatar: `/api/reports/${saved.scope}/${saved.id}` });
    const b = await newBoard();
    const ivan = (await open(b.id, 200, "Иван")).body.board.members.find((m) => m.id === "200");
    expect(ivan.avatar).toMatch(new RegExp(`^/api/boards/${b.id}/avatar/200\\?v=[0-9a-f]{8}$`));
    const img = await request(app).get(ivan.avatar);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toMatch(/^image\/png/);
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(img.headers["cache-control"]).toBe("private, max-age=300");
    expect(Buffer.compare(img.body, PNG)).toBe(0);
    // Не картинка и нет такого файла — 404.
    const text = await saveReport("200", { name: "a.txt", type: "text/plain", bytes: Buffer.from("<b>x</b>") });
    await org.setProfile("200", { avatar: `/api/reports/${text.scope}/${text.id}` });
    await request(app).get(`/api/boards/${b.id}/avatar/200`).expect(404);
    await org.setProfile("200", { avatar: `/api/reports/${saved.scope}/нет` });
    await request(app).get(`/api/boards/${b.id}/avatar/200`).expect(404);
  });

  it("произвольная https-ссылка в анкете — не переадресация с нашего адреса: 404 и буквы", async () => {
    await setupOrg();
    await org.setProfile("200", { avatar: "https://evil.example/face.png" });
    const b = await newBoard();
    const v = (await open(b.id, 200, "Иван")).body.board;
    expect(v.members.find((m) => m.id === "200").avatar).toBeNull();
    const r = await request(app).get(`/api/boards/${b.id}/avatar/200`);
    expect(r.status).toBe(404);
    expect(r.headers.location).toBeUndefined();
    // И адрес Telegram, вписанный в анкету руками, а не пришедший подписью, — тоже.
    await org.setProfile("200", { avatar: "https://t.me/i/userpic/320/other.jpg" });
    await request(app).get(`/api/boards/${b.id}/avatar/200`).expect(404);
    // Картинка из подписи, но не с адреса Telegram — тоже нет.
    await org.setProfile("300", {});
    await org.identify("300", { name: "Пётр", photo: "https://evil.example/p.jpg" });
    await open(b.id, 300, "Пётр");
    expect((await open(b.id, 300, "Пётр")).body.board.members.find((m) => m.id === "300").avatar).toBeNull();
    await request(app).get(`/api/boards/${b.id}/avatar/300`).expect(404);
  });

  it("регистрация — по организации хранилища ДОСКИ, в том числе через привязанный Telegram", async () => {
    await setupOrg();
    const role = (await org.listOrg()).roles.find((x) => x.name === "Штурм");
    const v = await org.addVirtualUser({ roleId: role.id, addedBy: "100" });
    await org.claimVirtual((await org.readOrg()).users.find((u) => u.id === v.id).token, "600", { name: "Вера" });
    // Доска в хранилище 300: там 300 — владелец, а 200 и 600 никто.
    await ensureStorage("300", { name: "Пётр" });
    const own = await boards.createBoard({ name: "У Петра", by: "300", storage: "300" });
    const main = await newBoard();
    await open(own.id, 200, "Иван"); await open(main.id, 200, "Иван");
    await open(main.id, 600, "Вера Телеграм");
    const inOwn = (await open(own.id, 300, "Пётр")).body.board.members;
    expect(inOwn.find((m) => m.id === "300").registered).toBe(true);
    expect(inOwn.find((m) => m.id === "200")).toMatchObject({ registered: false, name: "Иван" });
    const inMainBoard = (await open(main.id, 100, "Владелец")).body.board.members;
    expect(inMainBoard.find((m) => m.id === "200").registered).toBe(true);
    expect(inMainBoard.find((m) => m.id === "600")).toMatchObject({ registered: true, name: "Вера" });
    // Организацию хранилища 300 доска не трогала.
    const org300 = await inStorage("300", () => org.readOrg());
    expect(org300.users.map((u) => u.id)).toEqual(["300"]);
  });
});

describe("страница доски", () => {
  it("/board и /board/... отдают board.html без кеша", async () => {
    for (const p of ["/board", "/board/", "/board/x?board=abc"]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Доска");
      expect(res.headers["cache-control"]).toMatch(/no-store/);
    }
    expect((await request(app).get("/boards")).text).toContain("Схема");
  });
});
