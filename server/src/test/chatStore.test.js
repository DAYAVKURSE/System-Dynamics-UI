import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CHAT_CONTEXT_CHARS, chatsFor, describeMessage, listChatIds, readChat, recordGroupMessage,
} from "../lib/chatStore.js";
import { CHAT_MEMBER_TIMEOUT_MS, getChatMember } from "../lib/telegram.js";

/* ═══════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ГРУПП

   Бот хранит всё, что видит в группах, а помощнику человека отдаёт
   только чаты, где тот состоит СЕЙЧАС. Главное здесь — граница: чужой
   чат не попадает в контекст, и решает это проверка при обращении, а не
   запись. Второе — правка сообщения не превращается во второе сообщение.
   ═══════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-chats-"));
  process.env.CHATS_DIR = path.join(tmp, "chats");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => { await fs.rm(process.env.CHATS_DIR, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });

const DATE = 1757340000;   // 2025-09-08T14:00:00Z
const group = (over = {}) => ({
  message_id: 1, date: DATE,
  chat: { id: -1001, type: "supergroup", title: "Продажи" },
  from: { id: 200, first_name: "Иван", last_name: "Петров" },
  text: "Решили: скидку не даём",
  ...over,
});
const lines = async (chatId) => (await fs.readFile(path.join(process.env.CHATS_DIR, `${chatId}.jsonl`), "utf8"))
  .split("\n").filter(Boolean);

describe("запись сообщений группы", () => {
  it("сообщение ложится строкой в файл чата: id, время, кто, текст; название чата — рядом", async () => {
    const line = await recordGroupMessage(group());
    expect(line).toMatchObject({ id: 1, from: { id: "200", name: "Иван Петров" }, text: "Решили: скидку не даём" });
    expect(line.at).toBe(new Date(DATE * 1000).toISOString());
    expect(await lines(-1001)).toHaveLength(1);
    const chat = await readChat(-1001);
    expect(chat.title).toBe("Продажи");
    expect(chat.messages).toHaveLength(1);
    expect(await listChatIds()).toEqual(["-1001"]);
  });

  it("личное сообщение боту не хранится: это не группа", async () => {
    expect(await recordGroupMessage(group({ chat: { id: 200, type: "private" } }))).toBeNull();
    expect(await listChatIds()).toEqual([]);
  });

  it("правка сообщения — новая строка с тем же id, а не второе сообщение", async () => {
    await recordGroupMessage(group());
    await recordGroupMessage(group({ text: "Решили: скидку даём", edit_date: DATE + 60 }));
    // На диске — обе строки: что было сказано, остаётся.
    expect(await lines(-1001)).toHaveLength(2);
    // При чтении — одно сообщение, с новым текстом, на прежнем месте и
    // с прежним временем.
    const { messages } = await readChat(-1001);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 1, text: "Решили: скидку даём", edited: true });
    expect(messages[0].at).toBe(new Date(DATE * 1000).toISOString());
  });

  it("фото, файл, стикер и вход в чат описываются словами; пустое не пишется", () => {
    expect(describeMessage({ photo: [{}], caption: "вот" })).toBe("[фото] вот");
    expect(describeMessage({ document: { file_name: "договор.pdf" } })).toBe("[файл «договор.pdf»]");
    expect(describeMessage({ sticker: { emoji: "👍" } })).toBe("[стикер 👍]");
    expect(describeMessage({ voice: {} })).toBe("[голосовое сообщение]");
    expect(describeMessage({ new_chat_members: [{ first_name: "Пётр" }] })).toBe("[в чат вошёл: Пётр]");
    expect(describeMessage({})).toBe("");
  });

  it("сообщение без единого слова (служебное) не пишется", async () => {
    expect(await recordGroupMessage(group({ text: undefined, delete_chat_photo: true }))).toBeNull();
    expect(await listChatIds()).toEqual([]);
  });

  it("id чата не из цифр в имя файла не попадает", async () => {
    expect(await recordGroupMessage(group({ chat: { id: "../etc", type: "group" } }))).toBeNull();
  });

  it("оборванная строка теряет одно сообщение, а не весь чат", async () => {
    await recordGroupMessage(group());
    await fs.appendFile(path.join(process.env.CHATS_DIR, "-1001.jsonl"), "{\"id\":2,\"tex", "utf8");
    expect((await readChat(-1001)).messages).toHaveLength(1);
  });

  it("отправитель без имени называется по @username или по номеру", async () => {
    const a = await recordGroupMessage(group({ from: { id: 5, username: "ivan" } }));
    expect(a.from.name).toBe("@ivan");
    const b = await recordGroupMessage(group({ message_id: 2, from: { id: 6 } }));
    expect(b.from.name).toBe("id 6");
  });
});

describe("chatsFor — только чаты, где человек состоит", () => {
  const two = async () => {
    await recordGroupMessage(group());
    await recordGroupMessage(group({ message_id: 7, date: DATE + 10,
      chat: { id: -1002, type: "group", title: "Юристы" }, text: "тайна юристов" }));
  };

  it("чужой чат (не член) не попадает, свой — попадает; членство спрашивается по каждому чату", async () => {
    await two();
    const isMember = vi.fn(async (chatId) => chatId === "-1001");
    const chats = await chatsFor("200", { isMember });
    expect(chats.map((c) => c.chatId)).toEqual(["-1001"]);
    expect(chats[0].title).toBe("Продажи");
    expect(chats[0].messages[0].text).toBe("Решили: скидку не даём");
    expect(JSON.stringify(chats)).not.toContain("тайна юристов");
    expect(isMember).toHaveBeenCalledWith("-1001", "200");
    expect(isMember).toHaveBeenCalledWith("-1002", "200");
  });

  it("ошибка проверки членства значит «не состоит»", async () => {
    await two();
    expect(await chatsFor("200", { isMember: async () => { throw new Error("сеть"); } })).toEqual([]);
    // «Да» — только настоящее true, а не что-то похожее на правду.
    expect(await chatsFor("200", { isMember: async () => "member" })).toEqual([]);
  });

  it("по умолчанию членство спрашивается у Telegram; без токена бота — никто нигде не состоит", async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await two();
      expect(await chatsFor("200")).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
    }
  });

  it("предел в знаках: берётся новое, старое считается, порядок внутри чата — по времени", async () => {
    for (let i = 1; i <= 30; i += 1) {
      await recordGroupMessage(group({ message_id: i, date: DATE + i, text: `сообщение ${i} ${"x".repeat(90)}` }));
    }
    const [chat] = await chatsFor("200", { isMember: async () => true, maxChars: 700 });
    expect(chat.total).toBe(30);
    expect(chat.messages.length).toBeLessThan(30);
    expect(chat.messages.length).toBeGreaterThan(0);
    expect(chat.dropped).toBe(30 - chat.messages.length);
    expect(chat.messages.at(-1).id).toBe(30);
    const ids = chat.messages.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("новое важнее и между чатами: старый чат уступает место новому", async () => {
    await recordGroupMessage(group({ date: DATE - 86400, text: "старое" }));
    await recordGroupMessage(group({ message_id: 2, date: DATE,
      chat: { id: -1002, type: "group", title: "Новый" }, text: "новое" }));
    const chats = await chatsFor("200", { isMember: async () => true, maxChars: 60 });
    expect(chats.map((c) => c.title)).toEqual(["Новый"]);
  });

  it("предел по умолчанию — 20 000 знаков", () => {
    expect(CHAT_CONTEXT_CHARS).toBe(20000);
  });
});

describe("telegram.getChatMember", () => {
  let prev;
  beforeEach(() => { prev = process.env.TELEGRAM_BOT_TOKEN; process.env.TELEGRAM_BOT_TOKEN = "test-token"; });
  afterEach(() => { if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prev; });

  const answer = (status, ok = true) => vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok, status: ok ? 200 : 400,
    json: async () => (ok ? { ok: true, result: { status } } : { ok: false, description: "chat not found" }),
  });

  it("member, administrator, creator — да; left, kicked — нет", async () => {
    for (const s of ["member", "administrator", "creator"]) {
      answer(s);
      expect(await getChatMember(-1001, "200")).toBe(true);
      vi.restoreAllMocks();
    }
    for (const s of ["left", "kicked", "restricted"]) {
      answer(s);
      expect(await getChatMember(-1001, "200")).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("спрашивает про этот чат и этого человека", async () => {
    const spy = answer("member");
    await getChatMember(-1001, "200");
    expect(spy.mock.calls[0][0]).toContain("/bottest-token/getChatMember");
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ chat_id: -1001, user_id: 200 });
  });

  /* Очередь вопросов одна на всех, и на каждом вопросе — этот запрос по
     каждому чату: молчащий Telegram без предела держал бы её минуты. */
  it("молчащий Telegram — «нет» через предел ожидания, а не вечное «собираю данные»", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(opts.signal.reason));
    }));
    const started = Date.now();
    expect(await getChatMember(-1001, "200", "test-token", 30)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    // По умолчанию — пять секунд: столько ждёт и человек под статусом «собираю данные».
    expect(CHAT_MEMBER_TIMEOUT_MS).toBe(5000);
  });

  it("ошибка Telegram или сети — «нет», а не исключение", async () => {
    answer("", false);
    expect(await getChatMember(-1001, "200")).toBe(false);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    expect(await getChatMember(-1001, "200")).toBe(false);
  });
});
