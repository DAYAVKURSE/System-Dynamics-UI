import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleUpdate, resetPending } from "../lib/bot.js";
import * as org from "../lib/orgStore.js";
import * as calls from "../lib/callStore.js";
import * as boards from "../lib/boardStore.js";
import { ensureStorage } from "../lib/storages.js";

/* ════════════════════════════════════════════════════════════════
   ИНЛАЙН-РЕЖИМ: БРЕЙНШТОРМ-ДОСКИ (владелец, 2026-09-25)

   «при вводе в инлайн режиме в выпадающем списке должны показываться уже
   созданные доски… Если вводимого названия нету, то должна создаваться
   новая доска. у пользователя нет прав на создание досок, то при вводе, в
   выпадающем списке у него должен быть один пункт, в котором это будет
   написано. И даже если он отправит, в сообщении будет написано, что у
   него нет прав на создание таких досок.»
   ════════════════════════════════════════════════════════════════ */

let tmp;
const answers = [];
const deps = {
  org, calls, boards,
  send: async () => {},
  answer: async () => {},
  answerInline: async (id, results, extra) => { answers.push({ id, results, extra }); },
  appLink: (id) => `https://t.me/bot/call?startapp=call_${id}&mode=compact`,
  boardLink: (id) => `https://t.me/bot/call?startapp=board_${id}`,
  botName: "bot",
};
const owner = { id: 100, first_name: "Владелец" };
const ivan = { id: 200, first_name: "Иван" };
const petr = { id: 300, first_name: "Пётр" };
const stranger = { id: 777, first_name: "Чужой" };
const q = (from, query) => ({ update_id: 1, inline_query: { id: `iq-${from.id}`, from, query } });
const last = () => answers[answers.length - 1];
const ask = async (from, query) => { await handleUpdate(q(from, query), deps); return last(); };
const boardItems = (a) => a.results.filter((r) => r.id.startsWith("board_"));
// Пункт «новая доска» — первым в выдаче, до звонка (владелец, 2026-09-25).
const newBoard = (a) => a.results.find((r) => r.title.startsWith("🧠 Новая доска «"));

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-board-inline-"));
  process.env.CALLS_DIR = path.join(tmp, "calls");
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.BOARDS_DIR = path.join(tmp, "boards");
});
afterAll(async () => {
  boards.resetBoards();
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  boards.resetBoards();
  resetPending();
  answers.length = 0;
  for (const d of [process.env.CALLS_DIR, process.env.ORG_DIR, process.env.BOARDS_DIR]) {
    await fs.rm(d, { recursive: true, force: true });
  }
  await org.identify("100", { name: "Владелец" });
  const role = await org.addRole({ name: "Штурм", tabs: ["tasks", "brainstorm"] });
  await org.addUser({ id: "200", name: "Иван", roleId: role.id, addedBy: "100" });
  await org.addUser({ id: "300", name: "Пётр", roleId: "executor", addedBy: "100" });
});

describe("инлайн: доски", () => {
  it("пустой запрос — ровно две записи: «новая доска» и «новый звонок», без готовых досок", async () => {
    await boards.createBoard({ name: "Идеи к релизу", by: "100" });
    await boards.createBoard({ name: "черновик", by: "100", draft: true });
    await boards.createBoard({ name: "Названия продукта", by: "200" });
    const res = await ask(owner, "");
    expect(res.extra).toEqual({ cache_time: 0, is_personal: true });
    expect(res.results.map((r) => r.id)).toEqual(["board-hint", "hint"]);
    expect(res.results[0].title).toBe("🧠 Новая доска");
    expect(res.results[1].title).toBe("📹 Новый звонок");
    // Пустой запрос ничего не заводит.
    expect(await boards.listBoards({ drafts: true })).toHaveLength(3);
  });

  it("готовые доски — при наборе: подходящие по имени, новые сверху, без черновиков и чужих хранилищ", async () => {
    const a = await boards.createBoard({ name: "Идеи к релизу", by: "100" });
    await boards.createBoard({ name: "Идеи черновые", by: "100", draft: true });
    const b = await boards.createBoard({ name: "Идеи названий", by: "200" });
    await boards.createBoard({ name: "Идеи чужие", by: "300", storage: "300" });
    const res = await ask(owner, "идеи");
    // Точного совпадения нет — первой «Новая доска «идеи»», за ней звонок, потом найденные.
    const ids = res.results.map((r) => r.id);
    expect(ids[0]).toMatch(/^board_/);
    expect((await boards.getBoard(ids[0].slice(6)))).toMatchObject({ name: "идеи", draft: true });
    expect(ids.slice(1)).toEqual([res.results[1].id, `board_${b.id}`, `board_${a.id}`]);
    expect(res.results[1].title).toBe("📹 Новый звонок «идеи»");
    const item = res.results[2];
    expect(item).toEqual({
      type: "article", id: `board_${b.id}`, title: "🧠 Идеи названий", description: "Доска",
      input_message_content: { message_text: "Идеи названий", disable_web_page_preview: true },
      reply_markup: { inline_keyboard: [[{ text: "🧠 Открыть доску",
        url: `https://t.me/bot/call?startapp=board_${b.id}` }]] },
    });
  });

  it("набранное фильтрует доски без учёта регистра; точное совпадение — без новой", async () => {
    const a = await boards.createBoard({ name: "Идеи к релизу", by: "100" });
    await boards.createBoard({ name: "Названия", by: "100" });
    const res = await ask(owner, "идеи");
    // «идеи» ≠ «Идеи к релизу» — новая доска первой, звонок, потом найденная.
    expect(res.results[0].title).toBe("🧠 Новая доска «идеи»");
    expect(res.results[1].title).toBe("📹 Новый звонок «идеи»");
    expect(res.results[2].id).toBe(`board_${a.id}`);
    answers.length = 0;
    const exact = await ask(owner, "  ИДЕИ К РЕЛИЗУ ");
    expect(boardItems(exact).map((r) => r.id)).toEqual([`board_${a.id}`]);
  });

  it("нет такой — новая доска заводится сразу, черновиком, по ссылке в кнопке", async () => {
    const res = await ask(owner, "Куда расти в 2027");
    const item = newBoard(res);
    expect(item.title).toBe("🧠 Новая доска «Куда расти в 2027»");
    expect(item.input_message_content).toEqual({ message_text: "Куда расти в 2027",
      disable_web_page_preview: true });
    const id = item.id.replace(/^board_/, "");
    expect(item.reply_markup.inline_keyboard).toEqual([[{ text: "🧠 Открыть доску",
      url: `https://t.me/bot/call?startapp=board_${id}` }]]);
    const d = await boards.getBoard(id);
    expect(d).toMatchObject({ name: "Куда расти в 2027", storage: "main", by: "100", draft: true });
    // Черновик нигде не виден, пока его не открыли.
    expect(await boards.listBoards({ storage: "main" })).toEqual([]);
    // Открыли — доска.
    await boards.enterBoard(id, { id: "555", name: "Из чата" });
    expect((await boards.listBoards({ storage: "main" })).map((x) => x.id)).toEqual([id]);
    // И после встречи — прежний пункт встречи.
    expect(res.results[res.results.length - 1].reply_markup.inline_keyboard[0][0].text)
      .toMatch(/Подключиться/);
  });

  it("набор по буквам: каждое новое имя — свой черновик, отправленный не переименовывается", async () => {
    // «Идеи для Q4» ушла в чат (пункт выбран), и человек сразу набирает другое.
    const sent = newBoard(await ask(owner, "Идеи для Q4")).id;
    const ids = [];
    for (const typed of ["И", "Ит", "Итоги"]) ids.push(newBoard(await ask(owner, typed)).id);
    const first = await boards.getBoard(sent.replace(/^board_/, ""));
    expect(first.name).toBe("Идеи для Q4");
    expect(ids).not.toContain(sent);
    expect(new Set(ids).size).toBe(3);
    expect((await boards.getBoard(ids[2].replace(/^board_/, ""))).name).toBe("Итоги");
    // Та же фраза ещё раз — тот же черновик, а не второй с тем же именем.
    answers.length = 0;
    const again = await ask(owner, "Идеи для Q4");
    expect(newBoard(again)).toMatchObject({ id: sent, title: "🧠 Новая доска «Идеи для Q4»" });
    expect((await boards.listBoards({ drafts: true })).filter((b) => b.name === "Идеи для Q4"))
      .toHaveLength(1);
  });

  it("выбранный пункт (отзыв инлайна) помечает черновик отправленным", async () => {
    const id = newBoard(await ask(owner, "В чат")).id;
    const out = await handleUpdate({ update_id: 2, chosen_inline_result: { result_id: id, from: owner,
      query: "В чат" } }, deps);
    expect(out).toEqual({ chosen: id });
    const d = await boards.getBoard(id.replace(/^board_/, ""));
    expect(d).toMatchObject({ draft: true, sent: true });
    // Встреча или «нет прав» — ничего не делают.
    expect(await handleUpdate({ update_id: 3, chosen_inline_result: { result_id: "no-boards",
      from: owner, query: "" } }, deps)).toEqual({ chosen: "no-boards" });
  });

  it("хранилище полно — пункт с отказом словами вместо новой доски", async () => {
    const full = { ...boards, createBoard: async () => {
      throw new boards.BoardError(400, "В хранилище уже 200 досок.");
    } };
    await handleUpdate(q(owner, "Ещё одна"), { ...deps, boards: full });
    const refused = last().results.find((r) => r.id === "board-refused");
    expect(refused).toEqual({ type: "article", id: "board-refused", title: "В хранилище уже 200 досок.",
      input_message_content: { message_text: "В хранилище уже 200 досок." } });
  });

  it("другая фраза — другой черновик; открытую доску продолжение набора не переименовывает", async () => {
    const first = newBoard(await ask(owner, "Идеи")).id.replace(/^board_/, "");
    const second = newBoard(await ask(owner, "Совсем другое")).id.replace(/^board_/, "");
    expect(second).not.toBe(first);
    expect((await boards.getBoard(first)).name).toBe("Идеи");

    // Черновик открыли, а человек дописывает ту же фразу — новая доска, старая цела.
    await boards.enterBoard(second, { id: "555", name: "Из чата" });
    const third = newBoard(await ask(owner, "Совсем другое дело")).id.replace(/^board_/, "");
    expect(third).not.toBe(second);
    expect((await boards.getBoard(second)).name).toBe("Совсем другое");
  });

  it("не больше 20 досок в выдаче", async () => {
    for (let i = 0; i < 25; i += 1) await boards.createBoard({ name: `Доска ${i}`, by: "100" });
    const res = await ask(owner, "доска");
    // 20 найденных плюс «Новая доска «доска»» (точного совпадения нет).
    expect(boardItems(res)).toHaveLength(21);
    expect(res.results.length).toBeLessThanOrEqual(50);
    expect(boardItems(res)[1].title).toBe("🧠 Доска 24");
  });

  it("право — у роли с вкладкой brainstorm, не только у владельца", async () => {
    const res = await ask(ivan, "Мозговой штурм");
    const item = newBoard(res);
    expect(item.title).toBe("🧠 Новая доска «Мозговой штурм»");
    expect((await boards.getBoard(item.id.replace(/^board_/, ""))).by).toBe("200");
  });

  it("работающий под страницей виртуального (Telegram привязан к ней) — права этой страницы", async () => {
    const role = (await org.listOrg()).roles.find((r) => r.name === "Штурм");
    const v = await org.addVirtualUser({ roleId: role.id, addedBy: "100" });
    const token = (await org.readOrg()).users.find((u) => u.id === v.id).token;
    await org.claimVirtual(token, "600", { name: "Вера" });
    const vera = { id: 600, first_name: "Вера" };
    const res = await ask(vera, "Вера предлагает");
    expect(res.results.some((r) => r.id === "no-boards")).toBe(false);
    const item = newBoard(res);
    expect(item.title).toBe("🧠 Новая доска «Вера предлагает»");
    // Доска узнаёт людей по Telegram-id — создатель тоже он.
    expect((await boards.getBoard(item.id.replace(/^board_/, ""))).by).toBe("600");
    // И встреча — как у позванного.
    expect(res.results.at(-1).reply_markup.inline_keyboard[0][0].text).toMatch(/Подключиться/);
  });
});

describe("инлайн: нет прав на доски", () => {
  const NO = {
    type: "article", id: "no-boards", title: "Нет прав на создание досок",
    input_message_content: { message_text: "У вас нет прав на создание досок." },
  };

  it("участник без вкладки: один пункт вместо досок — и встреча, как прежде", async () => {
    await boards.createBoard({ name: "Идеи", by: "100" });
    const res = await ask(petr, "Идеи");
    expect(res.results[0]).toEqual(NO);
    expect(res.results[0].reply_markup).toBeUndefined();
    expect(res.results.filter((r) => r.id === "no-boards")).toHaveLength(1);
    expect(boardItems(res)).toEqual([]);
    expect(res.results).toHaveLength(2);
    expect(res.results[1].reply_markup.inline_keyboard[0][0].text).toMatch(/Подключиться/);
    // Ничего не заведено.
    expect(await boards.listBoards({ drafts: true })).toHaveLength(1);
  });

  it("посторонний: этот пункт — единственный; ни доски, ни встречи", async () => {
    const res = await ask(stranger, "завтра 15:00 разбор");
    expect(res.results).toEqual([NO]);
    expect(res.extra).toEqual({ cache_time: 0, is_personal: true });
    expect(await boards.listBoards({ drafts: true })).toEqual([]);
    expect(await calls.listMeetings()).toEqual([]);
    answers.length = 0;
    expect((await ask(stranger, "")).results).toEqual([NO]);
  });

  it("права — из хранилища MAIN: своё хранилище, где он владелец, их не даёт", async () => {
    await ensureStorage("777", { name: "Чужой" });
    await boards.createBoard({ name: "Его", by: "777", storage: "777" });
    expect((await ask(stranger, "Его")).results).toEqual([NO]);
  });

  it("инлайн не делает человека владельцем модели", async () => {
    await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
    const res = await ask(stranger, "Идеи");
    expect(res.results).toEqual([NO]);
    expect((await org.readOrg()).ownerId).toBeNull();
    expect(await boards.listBoards({ drafts: true })).toEqual([]);
  });
});

describe("инлайн без досок — как прежде", () => {
  it("зависимости boards нет — постороннему пустая выдача с кнопкой", async () => {
    const { boards: _drop, ...noBoards } = deps;
    await handleUpdate(q(stranger, "Идеи"), noBoards);
    expect(last().results).toEqual([]);
    expect(last().extra.button.start_parameter).toBe("start");
  });
});
