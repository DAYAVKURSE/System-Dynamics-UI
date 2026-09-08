import { beforeEach, describe, expect, it } from "vitest";
import { onAssistantMessage, splitMessage } from "../lib/botAssistant.js";
import { NOT_CONFIGURED } from "../lib/assistantSettings.js";

/* Помощник в чате: обычный текст → ответ, «запомни:» → память, документ →
   память. Команды и пересылки — не его: на них null, их разбирает bot.js.

   Ответа модели бот не ждёт: сразу «Думаю…», ответ — потом, отдельным
   сообщением. Возвращаемое `done` — обещание, что ответ или ошибка уже
   ушли в чат; тесты ждут его, бот — нет. */

const from = { id: 200, first_name: "Иван" };
let sent, asked, remembered;

const memory = {
  addMemory: async (userId, item) => {
    const saved = { id: `m${remembered.length + 1}`, userId, title: item.title
      || (item.text || "").split("\n")[0] || item.file?.name, text: item.text || "",
    file: item.file ? { name: item.file.name, size: item.file.bytes?.length } : null };
    remembered.push(saved);
    return saved;
  },
};
const deps = () => ({
  assistant: { ask: async (userId, q) => { asked.push({ userId, q }); return `ответ на «${q}»`; }, memory },
  send: async (chatId, text) => { sent.push({ chatId, text }); },
});

beforeEach(() => { sent = []; asked = []; remembered = []; });

describe("что помощник берёт, а что нет", () => {
  it("обычный текст — сразу «Думаю…», ответ от имени спросившего приходит потом", async () => {
    const r = await onAssistantMessage({ text: "что у меня сегодня?" }, from, deps());
    expect(r.answered).toBe("queued");
    // «Думаю…» ушло первым, ответ — отдельным сообщением следом.
    expect(sent[0].text).toBe("Думаю…");
    expect(await r.done).toEqual({ answered: true, parts: 1 });
    expect(asked).toEqual([{ userId: "200", q: "что у меня сегодня?" }]);
    expect(sent[1].text).toBe("ответ на «что у меня сегодня?»");
  });

  it("пока модель думает, бот не занят: ответ уходит, когда придёт", async () => {
    let release;
    const d = deps();
    d.assistant.ask = () => new Promise((r) => { release = r; });
    const r = await onAssistantMessage({ text: "?" }, from, d);
    expect(r.answered).toBe("queued");
    expect(sent).toHaveLength(1);
    release("вот ответ");
    await r.done;
    expect(sent[1].text).toBe("вот ответ");
  });

  it("команды, пересылки и пустые сообщения — не его", async () => {
    expect(await onAssistantMessage({ text: "/start" }, from, deps())).toBeNull();
    expect(await onAssistantMessage({ text: "привет", forward_from: { id: 5 } }, from, deps())).toBeNull();
    expect(await onAssistantMessage({ text: "привет", forward_sender_name: "X" }, from, deps())).toBeNull();
    expect(await onAssistantMessage({ sticker: {} }, from, deps())).toBeNull();
    expect(sent).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("не настроен — тот самый текст, а не тишина и не stack trace", async () => {
    const d = deps();
    d.assistant.ask = async () => { throw new Error(NOT_CONFIGURED); };
    const r = await onAssistantMessage({ text: "?" }, from, d);
    await r.done;
    expect(sent[1].text).toBe(NOT_CONFIGURED);
  });

  it("ошибка провайдера — словами", async () => {
    const d = deps();
    d.assistant.ask = async () => { throw new Error("OpenAI ответил 429: rate limit"); };
    const r = await onAssistantMessage({ text: "?" }, from, d);
    expect((await r.done).error).toMatch(/429/);
    expect(sent[1].text).toMatch(/OpenAI ответил 429/);
  });

  it("не ушла даже ошибка — журнал, а не необработанный отказ", async () => {
    const d = deps();
    const logged = [];
    d.log = (m) => logged.push(m);
    d.assistant.ask = async () => { throw new Error("модель молчит"); };
    d.send = async (chatId, text) => { if (text !== "Думаю…") throw new Error("Telegram лежит"); };
    const r = await onAssistantMessage({ text: "?" }, from, d);
    expect((await r.done).error).toBe("Telegram лежит");
    expect(logged[0]).toMatch(/Telegram лежит/);
  });

  it("длинный ответ уходит несколькими сообщениями, целыми абзацами", async () => {
    const d = deps();
    const para = "абзац ".repeat(300).trim();
    d.assistant.ask = async () => [para, para, para].join("\n\n");
    const r = await (await onAssistantMessage({ text: "?" }, from, d)).done;
    expect(r.parts).toBeGreaterThan(1);
    sent.forEach((m) => expect(m.text.length).toBeLessThanOrEqual(4000));
    expect(sent.slice(1).map((m) => m.text).join("\n\n").replace(/\s+/g, " "))
      .toBe([para, para, para].join(" "));
  });
});

describe("память из чата", () => {
  it("«запомни: …» кладёт текст в память спросившего", async () => {
    const r = await onAssistantMessage({ text: "Запомни: клиент просил счёт до пятницы" }, from, deps());
    expect(r.remembered).toBe("m1");
    expect(remembered[0]).toMatchObject({ userId: "200", text: "клиент просил счёт до пятницы" });
    expect(sent[0].text).toMatch(/Запомнил: «клиент просил счёт до пятницы»/);
    expect(asked).toEqual([]);
  });

  it("«запомни:» без текста — подсказка, а не пустая запись", async () => {
    await onAssistantMessage({ text: "запомни:" }, from, deps());
    expect(remembered).toEqual([]);
    expect(sent[0].text).toMatch(/Что запомнить/);
  });

  it("документ с getFile — файл целиком в память, с подписью как названием", async () => {
    const d = deps();
    d.tg = { getFile: async (id) => ({ bytes: Buffer.from("pdf-bytes"), name: `f-${id}.pdf`, type: "application/pdf" }) };
    const r = await onAssistantMessage({ document: { file_id: "F1", file_name: "договор.pdf", mime_type: "application/pdf" },
      caption: "договор с Ромашкой" }, from, d);
    expect(r.remembered).toBe("m1");
    expect(remembered[0].file).toEqual({ name: "f-F1.pdf", size: 9 });
    expect(remembered[0].title).toBe("договор с Ромашкой");
    expect(sent[0].text).toMatch(/Положил в память файл/);
  });

  it("документ без getFile — запоминается имя и подпись, и об этом сказано прямо", async () => {
    const r = await onAssistantMessage({ document: { file_id: "F1", file_name: "договор.pdf" } }, from, deps());
    expect(r.remembered).toBe("m1");
    expect(remembered[0].file).toBeNull();
    expect(remembered[0].title).toBe("договор.pdf");
    expect(remembered[0].text).toMatch(/содержимое бот сохранить не может/);
    expect(sent[0].text).toMatch(/Сам файл сохранить не могу/);
  });

  it("память не подключена — так и говорится", async () => {
    const d = deps();
    d.assistant.memory = null;
    const r = await onAssistantMessage({ text: "запомни: х" }, from, d);
    expect(r.error).toBe("no memory");
    expect(sent[0].text).toMatch(/не подключена/);
  });
});

describe("разбиение под лимит Telegram", () => {
  it("короткое — одним куском, длинное — по границам строк", () => {
    expect(splitMessage("привет")).toEqual(["привет"]);
    const parts = splitMessage(`${"a".repeat(3000)}\n${"b".repeat(3000)}`, 4000);
    expect(parts).toEqual(["a".repeat(3000), "b".repeat(3000)]);
    expect(splitMessage("")).toEqual([]);
  });
});
