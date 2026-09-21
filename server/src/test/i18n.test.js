import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LANGS, langOf, resetDicts, setUserLang, tr, trKeyboard, userLang } from "../lib/i18n.js";

/* ═══════════════════════════════════════════════════════════════
   ЯЗЫК СООБЩЕНИЙ БОТА (владелец, 2026-09-21)

   Словари — locales/ в корне; бот пишет по-русски, переводится
   исходящее в telegram.js: текст построчно (точно или по шаблону «{n}»)
   и подписи кнопок. Язык человека — из анкеты, хранится в langs.json.
   ═══════════════════════════════════════════════════════════════ */

let tmp, prevOrg, prevLoc;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-i18n-"));
  prevOrg = process.env.ORG_DIR; prevLoc = process.env.LOCALES_DIR;
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.LOCALES_DIR = path.join(tmp, "locales");
  await fs.mkdir(process.env.LOCALES_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.LOCALES_DIR, "en.json"), JSON.stringify({
    "Задача принята.": "Task accepted.",
    "Осталось {0} дн. до «{1}»": "{0} days left until “{1}”",
    "Взять": "Take",
    "Осталось ": "Left ",
    " дн. до сдачи": " d. until submission",
  }));
});
afterAll(async () => {
  if (prevOrg === undefined) delete process.env.ORG_DIR; else process.env.ORG_DIR = prevOrg;
  if (prevLoc === undefined) delete process.env.LOCALES_DIR; else process.env.LOCALES_DIR = prevLoc;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(() => resetDicts());

describe("перевод исходящего", () => {
  it("русский — как есть; английский — по словарю, построчно и по шаблону; чего нет — по-русски", () => {
    expect(LANGS).toEqual(["ru", "en", "zh"]);
    expect(langOf("xx")).toBe("ru");
    expect(tr("ru", "Задача принята.")).toBe("Задача принята.");
    expect(tr("en", "Задача принята.")).toBe("Task accepted.");
    expect(tr("en", "Осталось 3 дн. до «Сайт»")).toBe("3 days left until “Сайт”");
    expect(tr("en", "Задача принята.\nТакого нет\nВзять")).toBe("Task accepted.\nТакого нет\nTake");
    expect(tr("en", "no cyrillic")).toBe("no cyrillic");
    // Собранное из кусков — по кускам.
    expect(tr("en", "Осталось 7 дн. до сдачи")).toBe("Left 7 d. until submission");
  });
  it("клавиатура: подписи переводятся, данные кнопок — нет", () => {
    const kb = { inline_keyboard: [[{ text: "Взять", callback_data: "take:1" }, { text: "Открыть", url: "https://x" }]] };
    expect(trKeyboard("en", kb)).toEqual({ inline_keyboard: [[{ text: "Take", callback_data: "take:1" }, { text: "Открыть", url: "https://x" }]] });
    expect(trKeyboard("ru", kb)).toBe(kb);
    expect(trKeyboard("en", null)).toBeNull();
  });
  it("язык человека хранится в langs.json; русский — значит, записи нет", async () => {
    expect(userLang("100")).toBe("ru");
    await setUserLang("100", "en");
    expect(userLang("100")).toBe("en");
    expect(JSON.parse(await fs.readFile(path.join(process.env.ORG_DIR, "langs.json"), "utf8"))).toEqual({ 100: "en" });
    await setUserLang("100", "ru");
    expect(userLang("100")).toBe("ru");
  });
  it("sendMessage и sendWithKeyboard шлют текст на языке получателя", async () => {
    const { sendMessage, sendWithKeyboard } = await import("../lib/telegram.js");
    await setUserLang("777", "en");
    const bodies = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    });
    await sendMessage("777", "Задача принята.", "tok");
    await sendWithKeyboard("777", "Осталось 2 дн. до «Отчёт»", { inline_keyboard: [[{ text: "Взять", callback_data: "t" }]] }, "tok");
    await sendMessage("778", "Задача принята.", "tok");
    expect(bodies[0].text).toBe("Task accepted.");
    expect(bodies[1].text).toBe("2 days left until “Отчёт”");
    expect(bodies[1].reply_markup.inline_keyboard[0][0].text).toBe("Take");
    expect(bodies[2].text).toBe("Задача принята.");
    vi.restoreAllMocks();
    await setUserLang("777", "ru");
  });
  it("язык кладётся в анкету и оттуда — в langs.json", async () => {
    const org = await import("../lib/orgStore.js");
    await org.identify("100", { name: "Хозяин" });
    const saved = await org.setProfile("100", { lang: "zh" });
    expect(saved.lang).toBe("zh");
    expect(userLang("100")).toBe("zh");
    // Незнакомый язык — русский.
    expect((await org.setProfile("100", { lang: "nope" })).lang).toBe("ru");
    expect(userLang("100")).toBe("ru");
  });
});
