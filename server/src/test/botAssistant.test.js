import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEEP_DONE_MS, REFINE_PROMPT, onAssistantButton, onAssistantMessage, resetAssistantState, splitMessage,
  CLOCKS, TICK_MS, tickText,
} from "../lib/botAssistant.js";
import { NOT_CONFIGURED } from "../lib/assistantSettings.js";
import { CANCELLED_ERROR, createQueue } from "../lib/assistantQueue.js";

/* Помощник в чате: обычный текст → ответ, «запомни:» → память, документ →
   память. Команды и пересылки — не его: на них null, их разбирает bot.js.

   Ответа модели бот не ждёт: сразу «🕐 Думаю…» с идущими часами, ответ —
   потом, отдельным
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

beforeEach(() => { sent = []; asked = []; remembered = []; resetAssistantState(); });

describe("что помощник берёт, а что нет", () => {
  it("обычный текст — сразу «🕐 Думаю…», ответ от имени спросившего приходит потом", async () => {
    const r = await onAssistantMessage({ text: "что у меня сегодня?" }, from, deps());
    expect(r.answered).toBe("queued");
    // «🕐 Думаю…» ушло первым, ответ — отдельным сообщением следом.
    expect(sent[0].text).toBe(tickText(0));
    expect(await r.done).toEqual({ answered: true, parts: 1, id: r.id });
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
    d.send = async (chatId, text) => { if (text !== tickText(0)) throw new Error("Telegram лежит"); };
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

/* ─── статус, «Отменить», «Уточнить» ───

   Пока модель думает, человек видит, что бот жив, и может вмешаться: одно
   сообщение-статус с идущими часами, под ним две кнопки. Здесь
   помощник работает с НАСТОЯЩЕЙ очередью (createQueue на заглушках): отмена
   должна доходить до fetch, а не до слов. */
describe("статус и кнопки под ним", () => {
  let edits, answered, queue, release, calls;
  const MODEL = { kind: "openai", key: "sk-test-0123456789", model: "gpt-4o-mini", providerName: "OpenAI" };
  // Модель, слушающая signal, как настоящий fetch: отвечает, когда отпустят, или падает по отмене.
  const complete = (p) => new Promise((resolve, reject) => {
    calls.push(p);
    release = resolve;
    p.signal.addEventListener("abort", () => reject(new Error("Запрос отменён")));
  });
  const live = () => ({
    assistant: { ask: queue.askNow, cancel: queue.cancel, memory },
    send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); return { message_id: sent.length }; },
    edit: async (chatId, messageId, text, keyboard) => { edits.push({ chatId, messageId, text, keyboard }); },
    answer: async (id, text) => { answered.push({ id, text }); },
  });
  const press = (data, who = from) => onAssistantButton(
    { id: "cb1", data, from: who, message: { message_id: 1, chat: { id: who.id } } }, who, live());
  const keys = (k) => (k?.inline_keyboard || []).flat().map((b) => [b.text, b.callback_data]);
  const settle = () => new Promise((r) => setTimeout(r, 5));

  beforeEach(() => {
    edits = []; answered = []; calls = []; release = null;
    queue = createQueue({ complete, modelFor: () => MODEL, contextFor: async () => "ctx", log: () => {} });
  });

  /* ЧАСЫ ВМЕСТО СТАДИЙ (владелец, 2026-09-21: «должно быть просто
     „думаю…" и значок часов, который обновляется каждую секунду, меняя
     сообщение, пока не придёт ответ»). Провайдера в статусе больше нет:
     человек про него не спрашивал. */
  it("статус — «🕐 Думаю…» с идущими часами, и заканчивается «Готово» без кнопок", async () => {
    const r = await onAssistantMessage({ text: "что у меня?" }, from, live());
    await settle();
    // Кнопки — под статусом, с id вопроса.
    expect(sent[0].text).toBe(tickText(0));
    expect(keys(sent[0].keyboard)).toEqual([["✖ Отменить", `ai:cancel:${r.id}`], ["✎ Уточнить", `ai:refine:${r.id}`]]);
    // Ни провайдера, ни стадий — только часы.
    edits.forEach((e) => expect(e.text === "Готово" || /^🕐|🕑|🕒|🕓|🕔|🕕|🕖|🕗|🕘|🕙|🕚|🕛/.test(e.text)).toBe(true));
    expect(edits.some((e) => /Спрашиваю|Собираю|Отвечаю/.test(e.text))).toBe(false);
    edits.forEach((e) => expect(e.messageId).toBe(1));
    release("Задач нет.");
    expect(await r.done).toEqual({ answered: true, parts: 1, id: r.id });
    expect(sent[1].text).toBe("Задач нет.");
    expect(edits[edits.length - 1]).toMatchObject({ text: "Готово", keyboard: null });
    // Модель спрашивали по строке «помощник в чате бота».
    expect(calls[0].model).toBe("gpt-4o-mini");
  });

  it("«✖ Отменить» прерывает запрос к модели: статус «Отменено», ответа нет", async () => {
    const r = await onAssistantMessage({ text: "?" }, from, live());
    await settle();
    expect(calls[0].signal.aborted).toBe(false);
    const pressed = await press(`ai:cancel:${r.id}`);
    expect(pressed).toEqual({ cancelled: true, id: r.id });
    expect(calls[0].signal.aborted).toBe(true);
    expect(answered[0].text).toBe("Отменил");
    expect(await r.done).toEqual({ cancelled: true, id: r.id });
    expect(edits[edits.length - 1]).toMatchObject({ text: "Отменено", keyboard: null });
    // Второго сообщения про отмену нет: человек сам нажал, ему и так ясно.
    expect(sent.map((m) => m.text)).toEqual([tickText(0)]);
  });

  it("«Отменить» под уже отвеченным — «отменять нечего»; чужой вопрос — не ваш; забытый — честно", async () => {
    const r = await onAssistantMessage({ text: "?" }, from, live());
    await settle();
    release("ок");
    await r.done;
    expect(await press(`ai:cancel:${r.id}`)).toEqual({ ignored: "done" });
    expect(answered[0].text).toMatch(/отменять нечего/);
    expect(await press(`ai:cancel:${r.id}`, { id: 300 })).toEqual({ stale: true });
    expect(answered[1].text).toMatch(/не ваш/);
    expect(await press("ai:cancel:нет-такого")).toEqual({ stale: true });
    expect(answered[2].text).toMatch(/не помню/);
  });

  it("«✎ Уточнить»: бот ждёт дополнение, потом отменяет текущий и спрашивает заново с «Уточнение: …»", async () => {
    const r = await onAssistantMessage({ text: "что по заявкам?" }, from, live());
    await settle();
    const pressed = await press(`ai:refine:${r.id}`);
    expect(pressed).toEqual({ asking: "refine", id: r.id });
    expect(sent[sent.length - 1].text).toBe("Что добавить к вопросу? Пришлите дополнение одним сообщением.");
    // Дополнение — обычным текстом: он не уходит вопросом сам по себе.
    const r2 = await onAssistantMessage({ text: "за сентябрь" }, from, live());
    expect(r2.refined).toBe(r.id);
    expect(r2.answered).toBe("queued");
    expect(await r.done).toEqual({ cancelled: true, id: r.id });
    expect(calls[0].signal.aborted).toBe(true);
    // Старый статус — «отменено, вопрос уточнён», новый — своё «🕐 Думаю…» со своими кнопками.
    expect(edits.find((e) => e.text === "Отменено — вопрос уточнён")).toBeTruthy();
    const status2 = sent[sent.length - 1];
    expect(status2.text).toBe(tickText(0));
    expect(keys(status2.keyboard)[0][1]).toBe(`ai:cancel:${r2.id}`);
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toBe("что по заявкам?\n\nУточнение: за сентябрь");
    release("вот");
    expect(await r2.done).toMatchObject({ answered: true });
  });

  it("уточнить можно и отвеченный вопрос — отменять нечего, просто спрашивается заново", async () => {
    const r = await onAssistantMessage({ text: "что по заявкам?" }, from, live());
    await settle();
    release("ок");
    await r.done;
    await press(`ai:refine:${r.id}`);
    const r2 = await onAssistantMessage({ text: "подробнее" }, from, live());
    await settle();
    expect(calls[1].messages[0].content).toBe("что по заявкам?\n\nУточнение: подробнее");
    release("подробно");
    expect(await r2.done).toMatchObject({ answered: true });
  });

  it("ошибка модели — статус «Не вышло» без кнопок, слова ошибки отдельным сообщением", async () => {
    const d = live();
    d.assistant.ask = async () => { throw new Error("OpenAI ответил 429: rate limit"); };
    const r = await onAssistantMessage({ text: "?" }, from, d);
    await r.done;
    expect(sent[1].text).toMatch(/429/);
    expect(edits[edits.length - 1]).toMatchObject({ text: "Не вышло", keyboard: null });
  });

  it("без edit статус не правится, но ответ приходит; ошибка правки не ломает ответ", async () => {
    const d = live();
    delete d.edit;
    const r = await onAssistantMessage({ text: "?" }, from, d);
    await settle();
    release("ок");
    expect(await r.done).toMatchObject({ answered: true });
    const bad = live();
    bad.edit = async () => { throw new Error("message is too old"); };
    const r2 = await onAssistantMessage({ text: "?" }, from, bad);
    await settle();
    release("тоже ок");
    expect(await r2.done).toMatchObject({ answered: true });
    expect(sent[sent.length - 1].text).toBe("тоже ок");
  });

  /* Статус «Думаю…» не ушёл (429, сеть моргнула) — вопрос уже в очереди,
     и ответ обязан дойти отдельным сообщением, а запись о вопросе — закрыться. */
  it("статус не отправился — ответ всё равно приходит, запись о вопросе закрывается", async () => {
    const d = live();
    const logged = [];
    d.log = (m) => logged.push(m);
    let first = true;
    d.send = async (chatId, text, keyboard) => {
      if (first) { first = false; throw new Error("Too Many Requests: retry after 5"); }
      sent.push({ chatId, text, keyboard });
      return { message_id: sent.length };
    };
    const r = await onAssistantMessage({ text: "что у меня?" }, from, d);
    expect(r.answered).toBe("queued");
    expect(logged[0]).toMatch(/статус «Думаю…» не отправлен: Too Many Requests/);
    await settle();
    release("Задач нет.");
    expect(await r.done).toEqual({ answered: true, parts: 1, id: r.id });
    expect(sent.map((m) => m.text)).toEqual(["Задач нет."]);
    // Статус без номера сообщения не правится — и не падает.
    expect(edits).toEqual([]);
    // Вопрос завершён: «Отменить» под ним — «отменять нечего», а не «Отменил».
    expect(await press(`ai:cancel:${r.id}`)).toEqual({ ignored: "done" });
  });

  it("ответы — в личный чат нажавшего, а не в чат сообщения с кнопкой", async () => {
    const r = await onAssistantMessage({ text: "?", chat: { id: -100123, type: "supergroup" } }, from, live());
    expect(sent[0].chatId).toBe(from.id);
    await onAssistantButton({ id: "cb1", data: `ai:refine:${r.id}`, from,
      message: { message_id: 1, chat: { id: -100123, type: "supergroup" } } }, from, live());
    expect(sent[sent.length - 1]).toMatchObject({ chatId: from.id, text: REFINE_PROMPT });
  });

  /* Часы ИДУТ: сообщение правится раз в секунду, пока ответа нет
     (владелец, 2026-09-21). Время двигаем сами — ждать его по-настоящему
     значило бы держать тест на секундах. */
  it("часы правят сообщение каждую секунду и останавливаются с ответом", async () => {
    vi.useFakeTimers();
    try {
      const r = await onAssistantMessage({ text: "что у меня?" }, from, live());
      // Время фальшивое — «дать всему улечься» тоже приходится вручную.
      await vi.advanceTimersByTimeAsync(5);
      edits.length = 0;
      await vi.advanceTimersByTimeAsync(3000);
      // Три секунды — три правки, и каждая своим циферблатом.
      expect(edits.map((e) => e.text)).toEqual([tickText(1), tickText(2), tickText(3)]);
      edits.forEach((e) => expect(keys(e.keyboard)).toHaveLength(2));
      release("Задач нет.");
      await r.done;
      expect(edits[edits.length - 1]).toMatchObject({ text: "Готово", keyboard: null });
      // Ответ пришёл — часы встали: дальше правок нет.
      const after = edits.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect(edits).toHaveLength(after);
    } finally { vi.useRealTimers(); }
  });

  it("часы идут по кругу, и слова у них одни — «Думаю…»", () => {
    expect(tickText(0)).toBe("🕐 Думаю…");
    expect(tickText(1)).toBe("🕑 Думаю…");
    // Двенадцать циферблатов — и снова первый: круг замыкается.
    expect(tickText(12)).toBe(tickText(0));
    expect(CLOCKS).toHaveLength(12);
    expect(TICK_MS).toBe(1000);
  });

  it("слово отмены у очереди и у бота одно", () => {
    expect(CANCELLED_ERROR).toBe("Отменено");
  });
});

/* ─── «Уточнить» истекает ───
   Раньше «жду уточнение» жило до следующего текста без срока: нажатое
   утром «Уточнить» молча склеивало вечерний вопрос с утренним, а если
   утренний уже был забыт — вечерний текст выбрасывался с «задайте заново». */
describe("«Уточнить» — срок ожидания", () => {
  let queue, calls, release;
  const MODEL = { kind: "openai", key: "sk-test-0123456789", model: "gpt-4o-mini", providerName: "OpenAI" };
  const complete = (p) => new Promise((resolve) => { calls.push(p); release = resolve; });
  const live = () => ({
    assistant: { ask: queue.askNow, cancel: queue.cancel, memory },
    send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); return { message_id: sent.length }; },
    edit: async () => {},
    answer: async () => {},
  });
  const refine = (id) => onAssistantButton(
    { id: "cb1", data: `ai:refine:${id}`, from, message: { message_id: 1, chat: { id: from.id } } }, from, live());
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const tick = (ms) => vi.setSystemTime(Date.now() + ms);

  beforeEach(() => {
    calls = [];
    queue = createQueue({ complete, modelFor: () => MODEL, contextFor: async () => "ctx", log: () => {} });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("дополнение через минуту — уточнение; через десять с лишним — обычный новый вопрос", async () => {
    const r = await onAssistantMessage({ text: "что по заявкам?" }, from, live());
    await settle();
    release("ок");
    await r.done;
    await refine(r.id);
    tick(KEEP_DONE_MS + 1000);
    const r2 = await onAssistantMessage({ text: "какие у меня задачи на завтра?" }, from, live());
    await settle();
    expect(r2.refined).toBeUndefined();
    expect(r2.answered).toBe("queued");
    expect(calls[1].messages[0].content).toBe("какие у меня задачи на завтра?");
    expect(sent.map((m) => m.text)).not.toContain("Тот вопрос уже не помню — задаю ваш текст как новый вопрос.");
  });

  it("вопрос уже забыт, а «Уточнить» ещё нет — текст задаётся новым вопросом, а не выбрасывается", async () => {
    const r = await onAssistantMessage({ text: "что по заявкам?" }, from, live());
    await settle();
    release("ок");
    await r.done;
    // Нажали «Уточнить» за минуту до того, как вопрос забылся, а дополнение прислали после.
    tick(KEEP_DONE_MS - 60000);
    await refine(r.id);
    tick(120000);
    const r2 = await onAssistantMessage({ text: "за сентябрь" }, from, live());
    await settle();
    expect(r2).toMatchObject({ answered: "queued", stale: true });
    expect(sent.map((m) => m.text)).toContain("Тот вопрос уже не помню — задаю ваш текст как новый вопрос.");
    expect(calls[1].messages[0].content).toBe("за сентябрь");
    release("вот");
    expect(await r2.done).toMatchObject({ answered: true });
  });
});
