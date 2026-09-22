import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PAGE_SIZE, botKey, contactsOf, deleteDialog, findContact, historyText, isBanned, listDialogs,
  pageOf, readDialog, recordDialog, setBanned, titleOf,
} from "../lib/dialogStore.js";

/* ═══════════════════════════════════════════════════════════════
   ДИАЛОГИ БОТА С ЛЮДЬМИ

   Бот помнит, с кем говорил, — это и есть его «кому можно писать».
   Главное: забаненный исчезает из контактов и его реплики не пишутся;
   «удалить» стирает всё; разные боты не видят диалогов друг друга.
   ═══════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-dialogs-"));
  process.env.DIALOGS_DIR = path.join(tmp, "dialogs");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => { await fs.rm(process.env.DIALOGS_DIR, { recursive: true, force: true }); });

const K = botKey("100", "ag1");

describe("запись и чтение", () => {
  it("ключ бота — владелец и агент; у ассистента агент «assistant»", () => {
    expect(botKey("100")).toBe("100_assistant");
    expect(botKey("100", "ag/1")).toBe("100_ag_1");
  });

  it("реплика человека ложится строкой, карточка запоминает имя и username", async () => {
    const line = await recordDialog(K, 555, { from: "user", name: "Иван", username: "ivan", text: "Привет" });
    expect(line).toMatchObject({ from: "user", text: "Привет" });
    await recordDialog(K, 555, { from: "bot", text: "Здравствуйте" });
    const d = await readDialog(K, 555);
    expect(d).toMatchObject({ chatId: "555", name: "Иван", username: "ivan", banned: false });
    expect(d.messages.map((m) => m.from)).toEqual(["user", "bot"]);
    expect(await readDialog(K, 777)).toBeNull();
  });

  it("пустой текст и чужой формат id не пишутся", async () => {
    expect(await recordDialog(K, 555, { text: "   " })).toBeNull();
    expect(await recordDialog(K, "../x", { text: "hi" })).toBeNull();
    expect(await listDialogs(K)).toEqual([]);
  });

  it("список — новые разговоры первыми, со счётчиком; боты не видят чужих диалогов", async () => {
    await recordDialog(K, 1, { name: "A", text: "a", at: "2026-01-01T00:00:00.000Z" });
    await recordDialog(K, 2, { name: "B", text: "b", at: "2026-01-02T00:00:00.000Z" });
    await recordDialog(K, 1, { name: "A", text: "a2", at: "2026-01-03T00:00:00.000Z" });
    const list = await listDialogs(K);
    expect(list.map((d) => [d.chatId, d.count])).toEqual([["1", 2], ["2", 1]]);
    expect(await listDialogs(botKey("100", "ag2"))).toEqual([]);
  });
});

describe("бан и удаление", () => {
  it("забаненный не в контактах, его реплики не записываются, разбан возвращает", async () => {
    await recordDialog(K, 5, { name: "Пётр", username: "petr", text: "1" });
    await setBanned(K, 5, true);
    expect(await isBanned(K, 5)).toBe(true);
    expect(await recordDialog(K, 5, { text: "2" })).toBeNull();
    expect(await contactsOf(K)).toEqual([]);
    expect((await listDialogs(K))[0]).toMatchObject({ banned: true, count: 1 });
    await setBanned(K, 5, false);
    expect(await isBanned(K, 5)).toBe(false);
    expect(await contactsOf(K)).toHaveLength(1);
  });

  it("удаление стирает переписку и карточку", async () => {
    await recordDialog(K, 5, { name: "Пётр", text: "1" });
    expect(await deleteDialog(K, 5)).toBe(true);
    expect(await readDialog(K, 5)).toBeNull();
    expect(await deleteDialog(K, 5)).toBe(false);
  });
});

describe("поиск собеседника", () => {
  it("по id, @username, имени — без регистра, и по части имени", async () => {
    await recordDialog(K, 5, { name: "Пётр Иванов", username: "Petr", text: "1" });
    expect((await findContact(K, "5"))?.chatId).toBe("5");
    expect((await findContact(K, "@petr"))?.chatId).toBe("5");
    expect((await findContact(K, "пётр иванов"))?.chatId).toBe("5");
    expect((await findContact(K, "иванов"))?.chatId).toBe("5");
    expect(await findContact(K, "никто")).toBeNull();
    expect(titleOf({ name: "", username: "petr", chatId: "5" })).toBe("@petr");
    expect(titleOf({ chatId: "5" })).toBe("id 5");
  });
});

describe("страницы и история", () => {
  it("страница режет по PAGE_SIZE, номер за границей — прижимается", () => {
    const msgs = Array.from({ length: 23 }, (_, i) => ({ from: "user", text: String(i) }));
    expect(pageOf(msgs, 0).items).toHaveLength(PAGE_SIZE);
    expect(pageOf(msgs, 2)).toMatchObject({ page: 2, pages: 3 });
    expect(pageOf(msgs, 2).items.map((m) => m.text)).toEqual(["20", "21", "22"]);
    expect(pageOf(msgs, 9).page).toBe(2);
    expect(pageOf([], 0)).toMatchObject({ items: [], page: 0, pages: 1 });
  });

  it("история — последние реплики словами, в пределах лимита", () => {
    const msgs = [{ from: "user", text: "старое" }, { from: "bot", text: "ответ" }, { from: "user", text: "новое" }];
    expect(historyText(msgs, { botName: "Агент" })).toBe("человек: старое\nАгент: ответ\nчеловек: новое");
    expect(historyText(msgs, { maxChars: 30 })).toBe("бот: ответ\nчеловек: новое");
  });
});
