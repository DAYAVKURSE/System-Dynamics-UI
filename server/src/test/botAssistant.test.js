import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  APP_LEAD, KEEP_DONE_MS, REFINE_PROMPT, askFromApp, onAssistantButton, onAssistantMessage,
  resetAssistantState, splitMessage, CLOCKS, TICK_MS, tickText,
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

/* ПЛАН ПОД «ДУМАЮ…» (владелец, 2026-09-22): очередь отдаёт план через
   onPlan, бот показывает его в том же сообщении-статусе под часами, а
   «Готово» оставляет план под собой. Диалог — на диске: вопрос и ответ. */
describe("снимок из приложения не отправился", () => {
  it("вопрос уходит текстом, и отдельной строкой — почему нет картинки", async () => {
    const d = deps();
    d.tg = { sendPhoto: async () => { throw new Error("PHOTO_INVALID_DIMENSIONS"); } };
    const r = await askFromApp(d, { userId: "200", chatId: 200, question: "что это?", shot: Buffer.from("png") });
    await r.done;
    expect(sent[0].text).toBe(`${APP_LEAD}\nчто это?`);
    expect(sent[1].text).toBe("Снимок экрана не отправился: PHOTO_INVALID_DIMENSIONS");
  });
});

describe("план продолжается после кнопки", () => {
  /* Действие откладывается настоящим путём (runAction с ask: true) — так
     подтверждение и продолжение проверяются вместе. */
  let dir;
  let actions;
  let ws;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sd-resume-"));
    process.env.WORKSPACE_DIR = path.join(dir, "ws");
    process.env.UNDO_DIR = path.join(dir, "undo");
    vi.resetModules();
    actions = await import("../lib/assistantActions.js");
    ws = await import("../lib/workspaceStore.js");
    actions.resetPendingActions();
    await ws.writeModel({ tasks: [{ id: "tk1", title: "Задача", status: "backlog", assignee: "200", setter: "100" }] });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("«Да» под подтверждением — тот же вопрос задаётся заново с места остановки, и план доходит до конца", async () => {
    const mod = await import("../lib/botAssistant.js");
    mod.resetAssistantState();
    const d = deps();
    const asks = [];
    let pendingId = null;
    d.assistant.ask = async (userId, q, ctx, opts) => {
      asks.push({ q, resume: opts.resume || null });
      if (!opts.resume) {
        const r = await actions.runAction("task_take", { taskId: "tk1" },
          { userId: "200", agentId: "assistant", ask: true, onConfirm: opts.onConfirm });
        pendingId = r.id;
        opts.onStopped({ plan: { request: "сдать", result: "сдано", steps: [
          { action: "взять", expect: "взято", state: "pending", result: "" },
          { action: "сдать", expect: "сдано", state: "pending", result: "" }] }, at: 0 });
        return `Жду вашего подтверждения — оно отправлено отдельным сообщением с кнопками:\n${r.words}`;
      }
      return "Сдано.";
    };
    d.answer = async () => {};
    d.edit = async () => {};
    d.org = { identify: async () => ({ isOwner: false }) };
    const r = await mod.onAssistantMessage({ text: "сдай задачу" }, from, d);
    await r.done;
    expect(asks).toHaveLength(1);
    expect(sent.some((m) => m.text.startsWith("Подтвердите изменение:"))).toBe(true);
    const pressed = await mod.onAssistantButton({ id: "cb", data: `ai:ok:${pendingId}`, from,
      message: { chat: { id: 200 }, message_id: 1 } }, from, d);
    expect(pressed).toMatchObject({ applied: pendingId, ok: true });
    expect(pressed.resumed).toBeTruthy();
    expect((await ws.readModel()).tasks[0].status).toBe("progress");
    await pressed.resumedDone;
    expect(asks).toHaveLength(2);
    expect(asks[1]).toMatchObject({ q: "сдай задачу", resume: { at: 0, outcome: "applied", plan: { request: "сдать" } } });
    expect(sent[sent.length - 1].text).toBe("Сдано.");
  });
});

describe("план под статусом и запись диалога", () => {
  it("план приходит в сообщение-статус под часами; «Готово» — с планом; вопрос и ответ записаны в диалог", async () => {
    const edits = [];
    const recorded = [];
    const d = deps();
    d.send = async (chatId, text) => { sent.push({ chatId, text }); return { message_id: 7 }; };
    d.edit = async (chatId, messageId, text, keyboard) => { edits.push({ text, keyboard }); };
    d.dialogs = { record: async (chatId, line) => { recorded.push({ chatId, ...line }); } };
    d.assistant.ask = async (userId, q, ctx, opts) => {
      await opts.onPlan("Что нужно сделать: посчитать\n🔵 1. посмотреть → список\nОжидаемый результат: число");
      return "три";
    };
    const r = await onAssistantMessage({ text: "сколько задач?" }, { ...from, last_name: "Иванов", username: "ivan" }, d);
    await r.done;
    expect(edits.some((e) => e.text.endsWith("Что нужно сделать: посчитать\n🔵 1. посмотреть → список\nОжидаемый результат: число")
      && e.text.startsWith(CLOCKS[0]))).toBe(true);
    expect(edits[edits.length - 1]).toEqual({ text: "Готово\n\nЧто нужно сделать: посчитать\n🔵 1. посмотреть → список\nОжидаемый результат: число", keyboard: null });
    expect(recorded).toEqual([
      { chatId: 200, from: "user", name: "Иван Иванов", username: "ivan", text: "сколько задач?" },
      { chatId: 200, from: "bot", text: "три" },
    ]);
  });
});

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

  /* ГОЛОСОВОЕ (владелец, 2026-09-21): расшифровывается моделью строки
     «расшифровка» (`hear`) и идёт как обычный вопрос; модели нет — одна
     строка; `hear` не подключён — сообщение не помощника. */
  it("голосовое расшифровывается и задаётся как вопрос; без модели — одна строка", async () => {
    const d = deps();
    const heard = [];
    d.assistant.hear = async (userId, fileId, meta) => { heard.push({ userId, fileId, meta }); return "сколько задач?"; };
    const r = await onAssistantMessage({ voice: { file_id: "v1", mime_type: "audio/ogg" } }, from, d);
    expect(r.answered).toBe("queued");
    await r.done;
    expect(heard).toEqual([{ userId: "200", fileId: "v1", meta: { name: "голосовое.ogg", type: "audio/ogg" } }]);
    expect(asked).toEqual([{ userId: "200", q: "сколько задач?" }]);
    expect(sent.map((s) => s.text)).not.toContain("Не разобрал.");

    sent = [];
    d.assistant.hear = async () => null;
    expect(await onAssistantMessage({ voice: { file_id: "v2" } }, from, d)).toEqual({ error: "no transcribe model" });
    expect(sent.map((s) => s.text)).toEqual(["Модель для расшифровки голоса не выбрана."]);

    sent = [];
    d.assistant.hear = async () => { throw new Error("провайдер ответил 400"); };
    expect(await onAssistantMessage({ audio: { file_id: "a1", file_name: "з.mp3", mime_type: "audio/mpeg" } }, from, d))
      .toEqual({ error: "провайдер ответил 400" });
    expect(sent[0].text).toBe("Не расшифровал: провайдер ответил 400");

    expect(await onAssistantMessage({ voice: { file_id: "v3" } }, from, deps())).toBeNull();
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
  let edits, answered, queue, calls, pending;
  const MODEL = { kind: "openai", key: "sk-test-0123456789", model: "gpt-4o-mini", providerName: "OpenAI" };
  /* Модель, слушающая signal, как настоящий fetch: отвечает, когда
     отпустят, или падает по отмене. Отпускаются ВСЕ ждущие вызовы, а не
     последний: под нагрузкой второй вызов модели успевает встать до
     «отпустить», и первый иначе висел бы вечно. */
  const complete = (p) => new Promise((resolve, reject) => {
    calls.push(p);
    pending.push(resolve);
    p.signal.addEventListener("abort", () => reject(new Error("Запрос отменён")));
  });
  const release = (text) => { pending.splice(0).forEach((r) => r(text)); };
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
    edits = []; answered = []; calls = []; pending = [];
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
    // Отпускать есть кого только после вызова модели: под нагрузкой он позже.
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
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
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].messages[0].content).toBe("что по заявкам?\n\nУточнение: за сентябрь");
    release("вот");
    expect(await r2.done).toMatchObject({ answered: true });
  });

  it("уточнить можно и отвеченный вопрос — отменять нечего, просто спрашивается заново", async () => {
    const r = await onAssistantMessage({ text: "что по заявкам?" }, from, live());
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    release("ок");
    await r.done;
    await press(`ai:refine:${r.id}`);
    const r2 = await onAssistantMessage({ text: "подробнее" }, from, live());
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
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
      /* Пока модель не спросили, отпускать нечего: на загруженной машине
         очередь доходит до неё позже пяти фальшивых миллисекунд. */
      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
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
  }, 20000);

  /* ПОДТВЕРЖДЕНИЕ — ОТДЕЛЬНЫМ СООБЩЕНИЕМ С КНОПКАМИ (владелец,
     2026-09-21): «мне должно прийти сообщение с тем, что будет сделано, и
     кнопками „Подтвердить" и „Отменить"». */
  it("изменение приходит отдельным сообщением с двумя кнопками", async () => {
    const asked = [];
    const d = live();
    d.assistant = {
      ask: (userId, q, ctx, opts) => {
        // Помощник просит показать изменение — как это делает runAction.
        const p = opts.onConfirm({ id: "p1", words: "взять задачу tk1 в работу" });
        return Object.assign(p.then(() => "Жду вашего подтверждения."), { id: "q1" });
      },
      memory,
    };
    const r = await onAssistantMessage({ text: "возьми tk1" }, from, d);
    await r.done;
    const ask2 = sent.find((m) => (m.text || "").startsWith("Подтвердите изменение:"));
    expect(ask2).toBeTruthy();
    expect(ask2.text).toMatch(/взять задачу tk1 в работу/);
    expect(keys(ask2.keyboard)).toEqual([["✅ Подтвердить", "ai:ok:p1"], ["✖ Отменить", "ai:no:p1"]]);
    asked.push(ask2);
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
    // Ждём именно вызова модели: пяти миллисекунд под нагрузкой не хватает.
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    release("ок");
    await r.done;
    await refine(r.id);
    tick(KEEP_DONE_MS + 1000);
    const r2 = await onAssistantMessage({ text: "какие у меня задачи на завтра?" }, from, live());
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    expect(r2.refined).toBeUndefined();
    expect(r2.answered).toBe("queued");
    expect(calls[1].messages[0].content).toBe("какие у меня задачи на завтра?");
    expect(sent.map((m) => m.text)).not.toContain("Тот вопрос уже не помню — задаю ваш текст как новый вопрос.");
  }, 20000);

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

/* ─────── КНОПКИ ПОДТВЕРЖДЕНИЯ И ОТКАТА (владелец, 2026-09-21) ───────

   «При нажатии „Подтвердить" эта кнопка должна меняться на „Отменить
   изменения". Даже если я нажму на неё в дальнейшем, неважно, через какое
   время, ассистент должен откатить ровно те изменения, которые внёс».

   Отложенное живёт отдельно от вопроса и принадлежит тому, кому его
   показали; откат живёт файлом и срока не имеет вовсе. */
describe("подтверждение изменения", () => {
  let actions;
  let ws;
  let undo;
  let dir;
  let sent2, answered2, edits2;
  const from2 = { id: 200, first_name: "Иван" };
  const deps2 = () => ({
    assistant: { ask: async () => "ответ", memory },
    send: async (chatId, text) => { sent2.push({ chatId, text }); },
    edit: async (chatId, messageId, text, keyboard) => {
      edits2.push({ chatId, messageId, text, keyboard });
    },
    answer: async (id, text) => { answered2.push({ id, text }); },
    org: { identify: async () => ({ isOwner: false }) },
  });

  const TASK = { id: "tk1", title: "Сверстать", status: "backlog", assignee: "200",
    setter: "100", reviewer: "100", submissions: [], reviews: [], chat: [] };

  beforeEach(async () => {
    sent2 = []; answered2 = []; edits2 = [];
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sd-undo-"));
    process.env.WORKSPACE_DIR = path.join(dir, "ws");
    process.env.UNDO_DIR = path.join(dir, "undo");
    vi.resetModules();
    actions = await import("../lib/assistantActions.js");
    ws = await import("../lib/workspaceStore.js");
    undo = await import("../lib/undoStore.js");
    await undo.resetUndo();
    actions.resetPendingActions();
    await ws.writeModel({ tasks: [{ ...TASK }] });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  /* Откладываем настоящим путём — через runAction: так проверяется то, что
     и работает, а не отдельная выдумка теста. */
  const hold = async (userId = "200") => {
    let held = null;
    await actions.runAction("task_take", { taskId: "tk1" },
      { userId, agentId: "assistant", ask: true,
        onConfirm: async (p) => { held = p; return true; } });
    return held;
  };

  const press = async (data, who = from2) => {
    const mod = await import("../lib/botAssistant.js");
    return mod.onAssistantButton(
      { id: "cb1", data, from: who,
        message: { message_id: 7, chat: { id: who.id } } }, who, deps2());
  };

  it("«Отменить» снимает изменение и переписывает то же сообщение", async () => {
    const p = await hold();
    const r = await press(`ai:no:${p.id}`);
    expect(r).toEqual({ cancelled: p.id });
    expect(answered2[0].text).toBe("Отменено");
    // Кнопки сняты с ТОГО ЖЕ сообщения, а не уехали новым.
    expect(edits2[0]).toMatchObject({ messageId: 7, keyboard: null });
    expect(edits2[0].text).toMatch(/Изменение отменено:[\s\S]*взять задачу tk1 в работу/);
    expect(actions.pendingById(p.id)).toBeNull();
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");
  });

  it("«Подтвердить» делает дело, и кнопка становится «Отменить изменения»", async () => {
    const p = await hold();
    const r = await press(`ai:ok:${p.id}`);
    expect(r).toMatchObject({ applied: p.id, ok: true });
    expect((await ws.readModel()).tasks[0].status).toBe("progress");
    // На месте двух кнопок — одна, обратная, под тем же описанием.
    const keys2 = (k) => (k?.inline_keyboard || []).flat().map((b) => [b.text, b.callback_data]);
    expect(edits2[0].messageId).toBe(7);
    expect(edits2[0].text).toMatch(/Изменение внесено:/);
    expect(keys2(edits2[0].keyboard)).toEqual([["↩ Отменить изменения", `ai:undo:${p.id}`]]);
  });

  it("«Отменить изменения» возвращает ровно то, что было", async () => {
    const before = (await ws.readModel()).tasks[0];
    const p = await hold();
    await press(`ai:ok:${p.id}`);
    expect((await ws.readModel()).tasks[0].status).toBe("progress");

    const r = await press(`ai:undo:${p.id}`);
    expect(r).toEqual({ undone: p.id });
    expect(answered2[answered2.length - 1].text).toBe("Откатил");
    // Задача вернулась ровно в прежний вид, до последнего поля.
    expect((await ws.readModel()).tasks[0]).toEqual(before);
    expect(edits2[edits2.length - 1]).toMatchObject({ keyboard: null });
    expect(edits2[edits2.length - 1].text).toMatch(/Изменение откачено:/);
  });

  it("откат переживает перезапуск: он лежит файлом, а не в памяти", async () => {
    const before = (await ws.readModel()).tasks[0];
    const p = await hold();
    await press(`ai:ok:${p.id}`);
    // Перезапуск: модули заново, память процесса пуста.
    vi.resetModules();
    actions = await import("../lib/assistantActions.js");
    ws = await import("../lib/workspaceStore.js");
    expect(actions.pendingById(p.id)).toBeNull();
    await press(`ai:undo:${p.id}`);
    expect((await ws.readModel()).tasks[0]).toEqual(before);
  });

  it("откатывают один раз; чужой откат не нажать", async () => {
    const p = await hold();
    await press(`ai:ok:${p.id}`);
    await press(`ai:undo:${p.id}`);
    // Второй раз откатывать нечего — и это ответ, а не поломка.
    expect(await press(`ai:undo:${p.id}`)).toEqual({ stale: true });

    const p2 = await hold();
    await press(`ai:ok:${p2.id}`);
    const foreign = await press(`ai:undo:${p2.id}`, { id: 999, first_name: "Чужой" });
    expect(foreign).toEqual({ stale: true });
    expect((await ws.readModel()).tasks[0].status).toBe("progress");
  });

  it("правки человека после подтверждения откат не трогает", async () => {
    const p = await hold();
    await press(`ai:ok:${p.id}`);
    // Человек завёл вторую задачу руками — она к изменению отношения не имеет.
    const m = await ws.readModel();
    await ws.writeModel({ ...m, tasks: [...m.tasks, { ...TASK, id: "tk2", title: "Другое" }] });
    await press(`ai:undo:${p.id}`);
    const after = await ws.readModel();
    expect(after.tasks.map((t) => t.id).sort()).toEqual(["tk1", "tk2"]);
    expect(after.tasks.find((t) => t.id === "tk1").status).toBe("backlog");
    expect(after.tasks.find((t) => t.id === "tk2").title).toBe("Другое");
  });

  it("чужую кнопку подтверждения нажать нельзя, а забытую — «уже не действует»", async () => {
    const p = await hold("999");
    expect(await press(`ai:ok:${p.id}`)).toEqual({ stale: true });
    expect(answered2[0].text).toMatch(/не ваше/);
    expect(actions.pendingById(p.id)).toBeTruthy();

    actions.resetPendingActions();
    expect(await press("ai:ok:нет-такого")).toEqual({ stale: true });
    expect(answered2[1].text).toMatch(/уже не действует/);
  });
});

/* ВХОД НА MCP-СЕРВЕР ИЗ ЧАТА (владелец, 2026-09-21): «Ассистент или агент
   должен сам запрашивать логин и пароль в чате… если это требуется
   непосредственно при выполнении задачи». Ответ человека — обычное
   сообщение, и разбирается оно РАНЬШЕ «запомни:» и самого помощника:
   это ответ на вопрос бота, а не новый вопрос. */
describe("вход на MCP-сервер, присланный в чат", () => {
  const withAuth = (saved = { id: "mcp1", name: "Погода" }) => {
    const d = deps();
    const got = [];
    d.assistant.mcpAuth = async (userId, name, auth) => { got.push({ userId, name, auth }); return saved; };
    return { d, got };
  };

  it("«ключ <сервер>: <токен>» запоминается, а сообщение с ключом удаляется", async () => {
    const { d, got } = withAuth();
    const killed = [];
    d.tg = { deleteMessage: async (chatId, id) => { killed.push({ chatId, id }); } };
    const r = await onAssistantMessage({ text: "ключ Погода: sk-1", message_id: 77 }, from, d);
    expect(r).toEqual({ mcpAuth: "mcp1" });
    expect(got).toEqual([{ userId: "200", name: "Погода", auth: { kind: "bearer", token: "sk-1" } }]);
    // Ключ в переписке не остаётся.
    expect(killed).toEqual([{ chatId: 200, id: 77 }]);
    expect(sent[0].text).toMatch(/Запомнил вход в «Погода»/);
    // Помощника не звали: это ответ боту, а не вопрос.
    expect(asked).toEqual([]);
  });

  it("«логин <сервер>: <логин> <пароль>» — то же самое", async () => {
    const { d, got } = withAuth();
    await onAssistantMessage({ text: "логин Погода: ivan s3cret" }, from, d);
    expect(got[0].auth).toEqual({ kind: "basic", login: "ivan", password: "s3cret" });
    expect(asked).toEqual([]);
  });

  it("сервера с таким названием нет — говорит об этом, а не молчит", async () => {
    const { d } = withAuth(null);
    const r = await onAssistantMessage({ text: "ключ Погодка: sk-1" }, from, d);
    expect(r.error).toBe("no server");
    expect(sent[0].text).toMatch(/Не нашёл сервер «Погодка»/);
  });

  it("что просить — по схеме сервера: Basic — логин и пароль, иначе ключ", async () => {
    const seen = [];
    const d = deps();
    d.assistant.ask = (userId, q, ctx, opts) => { seen.push(opts); return Promise.resolve("ок"); };
    const r = await onAssistantMessage({ text: "погода?" }, from, d);
    await r.done;
    expect(typeof seen[0].onAuthNeeded).toBe("function");
    sent.length = 0;
    await seen[0].onAuthNeeded({ server: "Погода", where: "", scheme: "basic", realm: "weather" });
    expect(sent[0].text).toMatch(/«Погода» \(weather\) требует входа/);
    expect(sent[0].text).toMatch(/логин Погода: <логин> <пароль>/);
    expect(sent[0].text).not.toMatch(/ключ Погода/);
    sent.length = 0;
    await seen[0].onAuthNeeded({ server: "Погода", where: "https://x/login", scheme: "oauth" });
    expect(sent[0].text).toMatch(/Войти: https:\/\/x\/login/);
    expect(sent[0].text).toMatch(/ключ Погода: <ваш токен>/);
    expect(sent[0].text).not.toMatch(/логин Погода/);
  });

  it("без входа в зависимостях это обычный вопрос помощнику", async () => {
    const r = await onAssistantMessage({ text: "ключ от квартиры: где деньги лежат" }, from, deps());
    expect(r.answered).toBe("queued");
    await r.done;
    expect(asked[0].q).toBe("ключ от квартиры: где деньги лежат");
  });
});

/* ВОПРОС ИЗ ПРИЛОЖЕНИЯ (владелец, 2026-09-21): волшебная палочка. Сам
   вопрос и снимок — в чат, экран словами — модели, ответ — в чат, и
   «Уточнить» продолжает разговор с тем же экраном перед глазами. */
describe("вопрос из приложения", () => {
  it("вопрос и снимок уходят в чат, экран — в подсказку модели, ответ — в чат", async () => {
    const d = deps();
    const seen = [];
    d.assistant.ask = (userId, q, ctx) => { seen.push({ q, ctx }); return Promise.resolve("вот ответ"); };
    const photos = [];
    d.tg = { sendPhoto: async (chatId, p) => { photos.push({ chatId, name: p.name, size: p.bytes.length, caption: p.caption }); } };
    const r = await askFromApp(d, { userId: "200", chatId: 200, question: "Почему тут пусто?",
      context: "## Экран\nВкладки: [Задачи]", shot: Buffer.from("png") });
    await r.done;
    // Вопрос — подписью к снимку, одним сообщением (владелец, 2026-09-22).
    expect(photos).toEqual([{ chatId: 200, name: "screen.png", size: 3, caption: `${APP_LEAD}\nПочему тут пусто?` }]);
    expect(sent.map((m) => m.text)).not.toContain(`${APP_LEAD}\nПочему тут пусто?`);
    expect(seen).toEqual([{ q: "Почему тут пусто?", ctx: "## Экран\nВкладки: [Задачи]" }]);
    expect(sent.map((m) => m.text)).toContain("вот ответ");
    // Длинный вопрос в подпись не влезает — текстом, картинка следом.
    const long = "х".repeat(1100);
    const r2 = await askFromApp(d, { userId: "200", chatId: 200, question: long, shot: Buffer.from("png") });
    await r2.done;
    expect(photos[1].caption).toBe("");
    expect(sent.map((m) => m.text)).toContain(`${APP_LEAD}\n${long}`);
    // Картинка не ушла — вопрос всё равно в чате текстом.
    d.tg.sendPhoto = async () => { throw new Error("нет сети"); };
    const r3 = await askFromApp(d, { userId: "200", chatId: 200, question: "Ещё?", shot: Buffer.from("png") });
    await r3.done;
    expect(sent.map((m) => m.text)).toContain(`${APP_LEAD}\nЕщё?`);
  });

  it("без снимка обходится, а пустой вопрос — отказ", async () => {
    const d = deps();
    const r = await askFromApp(d, { userId: "200", chatId: 200, question: "Что это?", context: "" });
    await r.done;
    expect(sent[0].text).toBe(`${APP_LEAD}\nЧто это?`);
    await expect(askFromApp(d, { userId: "200", chatId: 200, question: "  " })).rejects.toThrow(/required/);
  });

  it("«Уточнить» продолжает разговор с тем же экраном", async () => {
    const d = deps();
    const seen = [];
    d.assistant.ask = (userId, q, ctx) => { seen.push({ q, ctx }); return Promise.resolve("ответ"); };
    d.answer = async () => {};
    d.edit = async () => {};
    const r = await askFromApp(d, { userId: "200", chatId: 200, question: "Что это?", context: "ЭКРАН" });
    await r.done;
    // Нажали «Уточнить» под ответом и прислали дополнение.
    await onAssistantButton({ id: "cb1", data: `ai:refine:${r.id}`, from,
      message: { message_id: 1, chat: { id: 200 } } }, from, d);
    const r2 = await onAssistantMessage({ text: "а подробнее" }, from, d);
    await r2.done;
    expect(seen[1].q).toMatch(/Что это\?\n\nУточнение: а подробнее/);
    expect(seen[1].ctx).toBe("ЭКРАН");
  });
});
