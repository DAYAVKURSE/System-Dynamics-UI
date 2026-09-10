import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFERRABLE, durationText, isTaskAction, missingGives, onTaskButton, onTaskMessage,
  reloadSteps, requiredGives, resetSteps, setupKeyboard, stepsFile, taskKeyboard,
} from "../lib/botTasks.js";
import { BACKLOG, taskFor, writeModel } from "../lib/workspaceStore.js";

/* Кнопки под уведомлением и вся сдача в чате — на заглушках: склад работы,
   файлы и Telegram подменены, и проверяется ровно то, что бот у них просит
   и что говорит человеку. */

const worker = { id: 200, first_name: "Иван" };
const stranger = { id: 777, first_name: "Чужой" };

const FUNC = {
  id: "f1", e: "e1", name: "Сделать макет",
  takes: [{ trait: "t0", lo: 1, hi: 1 }],
  // Макет обязателен (низ вилки 1), смета тоже; черновик — нет (низ 0).
  gives: [{ trait: "t1", lo: 1, hi: 1 }, { trait: "t2", lo: 1, hi: 2 }, { trait: "t3", lo: 0, hi: 1 }],
};
const TRAITS = [{ id: "t0", e: "e1", l: "бриф" }, { id: "t1", e: "e1", l: "макет" },
  { id: "t2", e: "e1", l: "смета" }, { id: "t3", e: "e1", l: "черновик" }];
const TASK = { id: "tk1", funcId: "f1", title: "Макет для Ромашки", assignee: "200",
  reviewer: "300", status: "backlog" };

let tmpSteps;
beforeAll(async () => {
  // Шаги сдачи пишутся на диск — во временный каталог, не в проект.
  tmpSteps = await fs.mkdtemp(path.join(os.tmpdir(), "sd-botsteps-"));
  process.env.BOT_STEPS_FILE = path.join(tmpSteps, "bot-steps.json");
});
afterAll(async () => { await fs.rm(tmpSteps, { recursive: true, force: true }); });

let sent, answered, edited, shown, calls, saved, work, deps, acked, deferred;
beforeEach(() => {
  resetSteps();
  sent = []; answered = []; edited = []; shown = []; calls = []; saved = [];
  acked = []; deferred = [];
  work = {
    take: async (u, id) => { calls.push(["take", String(u), id]); return { task: { ...TASK, id, status: "progress" } }; },
    defer: async (u, id, o) => { calls.push(["defer", String(u), id, o]); return { task: { ...TASK, id, status: "deferred" } }; },
    submit: async (u, id, s) => { calls.push(["submit", String(u), id, s]); return { task: { ...TASK, id, status: "review" } }; },
    taskFor: async (u, id) => (String(u) === TASK.assignee && id === TASK.id
      ? { task: TASK, func: FUNC, traits: TRAITS } : { error: id === TASK.id ? "not yours" : "not found" }),
    setupState: async () => ({ set: false, title: TASK.title, why: "Не хватает: исполнитель" }),
  };
  deps = {
    work,
    // На сколько откладывать — настройка человека; висящие напоминания —
    // отдельное хранилище, здесь заглушкой.
    deferMin: async () => 30,
    reminders: {
      ack: async (u, kind, id) => { acked.push([String(u), kind, id]); return true; },
      defer: async (u, kind, id, until) => { deferred.push([String(u), kind, id, until]); return true; },
    },
    files: { save: async (u, f) => { saved.push([String(u), f.name, f.type, f.bytes.length]);
      return { id: "r1", name: f.name, type: f.type, size: f.bytes.length, url: `/api/reports/s/${f.name}`, scope: "s" }; } },
    tg: { getFile: async (fileId) => ({ bytes: Buffer.from(`байты ${fileId}`), name: "file_1.pdf", type: "application/pdf" }) },
    // Показанное человеку — в одном списке в порядке появления: и новое
    // сообщение, и правка старого.
    send: async (chatId, text, keyboard) => { const m = { chatId, text, keyboard };
      sent.push(m); shown.push(m); return { message_id: 900 + sent.length }; },
    answer: async (id, text) => { answered.push({ id, text }); },
    edit: async (chatId, messageId, text, keyboard) => { const m = { chatId, messageId, text, keyboard };
      edited.push(m); shown.push(m); },
  };
});

// Нажатие на сообщении бота: у него есть chat и message_id — правится оно.
const NOTICE = "Начинается: Макет для Ромашки\nНачало: 2026-09-15 10:00\n\nДва варианта\n\n"
  + "«🔴 Отложить» — спрошу, на сколько. «🟢 Начать» — задача уйдёт в работу.";
const press = (data, from = worker) => onTaskButton({
  id: "cb", from, data, message: { message_id: 55, chat: { id: from.id }, text: NOTICE },
}, from, deps);
const say = (text, from = worker) => onTaskMessage({ text, chat: { id: from.id } }, from, deps);
const sendDoc = (doc, from = worker) => onTaskMessage({ document: doc, chat: { id: from.id } }, from, deps);

const last = () => shown[shown.length - 1];
const lastKeys = () => (last()?.keyboard?.inline_keyboard || []).map((row) => row.map((b) => b.text));
const lastData = () => (last()?.keyboard?.inline_keyboard || []).flat().map((b) => b.callback_data);
const lastAnswer = () => answered[answered.length - 1]?.text;

describe("клавиатура уведомления", () => {
  it("«🔴 Отложить» слева, «🟢 Начать» справа: отказ слева, действие справа", () => {
    const k = taskKeyboard("tk1").inline_keyboard;
    expect(k).toHaveLength(1);
    expect(k[0].map((b) => b.text)).toEqual(["🔴 Отложить", "🟢 Начать"]);
    expect(k[0].map((b) => b.callback_data)).toEqual(["task:defer:tk1", "task:start:tk1"]);
  });

  it("узнаёт свои кнопки и не трогает чужие", () => {
    expect(isTaskAction("task:start:tk1")).toBe(true);
    expect(isTaskAction("task:sdone:tk1")).toBe(true);
    expect(isTaskAction("r:executor")).toBe(false);
    expect(isTaskAction(undefined)).toBe(false);
  });
});

/* Правило «обязателен выход с низом вилки больше нуля» повторено на
   сервере, и эти случаи — те же, что у фронтенда: разойтись им нельзя. */
describe("обязательные выходы", () => {
  it("обязателен выход, у которого низ вилки больше нуля", () => {
    expect(requiredGives(FUNC).map((p) => p.trait)).toEqual(["t1", "t2"]);
    expect(requiredGives({ gives: [{ trait: "x", lo: "0", hi: 3 }] })).toEqual([]);
    expect(requiredGives(null)).toEqual([]);
  });

  it("чего не хватает — обязательное без файла", () => {
    expect(missingGives(FUNC, { t1: { name: "макет.pdf" } }).map((p) => p.trait)).toEqual(["t2"]);
    expect(missingGives(FUNC, { t1: {}, t2: {} })).toEqual([]);
  });
});

describe("«Отложить» — сразу, на срок из анкеты", () => {
  /* Владелец: «если нажал отложить, новое напоминание должно прийти через
     то время, которое указал пользователь в этом разделе». Три экрана
     (часы → минуты → подтверждение) ради числа, которое у человека уже
     записано, — лишний путь; их больше нет. */
  it("одно нажатие: откладывает на deferMin и говорит, на сколько", async () => {
    const before = Date.now();
    deps.deferMin = async () => 45;
    const r = await press("task:defer:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "defer" });
    expect(calls).toHaveLength(1);
    const [, who, id, opts] = calls[0];
    expect([who, id]).toEqual(["200", "tk1"]);
    const until = Date.parse(opts.until);
    expect(until - before).toBeGreaterThanOrEqual(45 * 60000 - 50);
    expect(until - Date.now()).toBeLessThanOrEqual(45 * 60000);
    expect(last().text).toMatch(/Отложил: «Макет для Ромашки» на 45 минут/);
    expect(last().text).toMatch(/срок при этом не сдвинулся/);
    expect(last().keyboard).toBeNull();
    // Повтор гаснет: человек ответил.
    expect(acked).toEqual([["200", "task", "tk1"]]);
  });

  it("настройки нет — полчаса: молчать вечно хуже, чем напомнить", async () => {
    deps.deferMin = async () => null;
    await press("task:defer:tk1");
    expect(last().text).toMatch(/на 30 минут/);
  });

  it("чужому — отказ словами", async () => {
    const r = await press("task:defer:tk1", stranger);
    expect(r).toEqual({ error: "not yours" });
    expect(lastAnswer()).toBe("Эта задача не ваша");
    expect(sent[sent.length - 1].text).toMatch(/Эта задача не ваша: ничего не поменял/);
    expect(calls).toEqual([]);
  });

  it("уже взятую или сданную не откладывают — отказ сразу", async () => {
    for (const status of ["progress", "review", "done"]) {
      work.taskFor = async () => ({ task: { ...TASK, status }, func: FUNC, traits: TRAITS });
      const r = await press("task:defer:tk1");
      expect(r).toEqual({ error: "not in backlog" });
      expect(lastAnswer()).toBe("Задача уже в работе или сдана");
      expect(calls).toEqual([]);
    }
    // Просроченная и уже отложенная — лежат, их откладывать можно.
    for (const status of ["deadline", "deferred"]) {
      work.taskFor = async () => ({ task: { ...TASK, status }, func: FUNC, traits: TRAITS });
      expect(await press("task:defer:tk1")).toMatchObject({ action: "defer" });
    }
  });
});

describe("напоминание о постановке: «Готово» проверяет, а не верит", () => {
  /* Владелец: «когда пользователь нажимает „Готово“, система должна
     проверять, действительно ли он поставил эту задачу». */
  it("не поставлена — сказано, чего не хватает, и напоминание остаётся", async () => {
    work.setupState = async () => ({ set: false, title: "Макет для Ромашки",
      why: "Не хватает: исполнитель, срок" });
    const r = await press("task:sdone:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "setup-not-yet" });
    expect(lastAnswer()).toBe("Ещё не поставлена");
    expect(sent[sent.length - 1].text).toMatch(/Ещё не поставлена: «Макет для Ромашки»/);
    expect(sent[sent.length - 1].text).toMatch(/Не хватает: исполнитель, срок/);
    // Повтор не гаснет: задача так и ждёт постановки.
    expect(acked).toEqual([]);
  });

  it("поставлена — повтор гаснет, и это сказано словами", async () => {
    work.setupState = async () => ({ set: true, title: "Макет для Ромашки", why: "" });
    const r = await press("task:sdone:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "setup-done" });
    expect(lastAnswer()).toBe("Поставлена");
    expect(last().text).toMatch(/Поставлена: «Макет для Ромашки». Больше не напоминаю/);
    expect(acked).toEqual([["200", "setup", "tk1"]]);
  });

  it("не постановщику — отказ словами", async () => {
    work.setupState = async () => ({ error: "not yours" });
    expect(await press("task:sdone:tk1")).toEqual({ error: "not yours" });
    expect(lastAnswer()).toBe("Эта задача не ваша");
  });

  it("«Отложить» переносит напоминание, а не задачу", async () => {
    deps.deferMin = async () => 20;
    const before = Date.now();
    const r = await press("task:sdefer:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "setup-defer" });
    expect(deferred).toHaveLength(1);
    const [who, kind, id, until] = deferred[0];
    expect([who, kind, id]).toEqual(["200", "setup", "tk1"]);
    expect(Date.parse(until) - before).toBeGreaterThanOrEqual(20 * 60000 - 50);
    // Складу работы никто не звонил: задача так и ждёт постановки.
    expect(calls).toEqual([]);
    expect(last().text).toMatch(/Напомню про постановку через 20 минут/);
    expect(last().text).toMatch(/состояние не изменилось/);
  });

  it("клавиатура постановки: «Отложить» слева, «Готово» справа", () => {
    const k = setupKeyboard("tk1").inline_keyboard;
    expect(k[0].map((b) => b.text)).toEqual(["🔴 Отложить", "✅ Готово"]);
    expect(k[0].map((b) => b.callback_data)).toEqual(["task:sdefer:tk1", "task:sdone:tk1"]);
  });
});

describe("«Начать» и сдача в чате", () => {
  const doc = { file_id: "F1", file_name: "макет.pdf", mime_type: "application/pdf" };

  it("«Начать» берёт задачу, и то же сообщение получает кнопку «Сдать отчёт»", async () => {
    const r = await press("task:start:tk1");
    expect(r).toMatchObject({ task: "tk1", action: "take" });
    expect(calls).toEqual([["take", "200", "tk1"]]);
    expect(edited).toHaveLength(1);
    expect(last().text).toMatch(/Взял в работу: «Макет для Ромашки»/);
    expect(last().text).toMatch(/колонке «В работе»/);
    // Само уведомление остаётся: по нему видно, что делать. Уходит только
    // абзац про кнопки, которых больше нет.
    expect(last().text).toMatch(/^Начинается: Макет для Ромашки\nНачало: 2026-09-15 10:00\n\nДва варианта\n\n/);
    expect(last().text).not.toMatch(/🔴 Отложить/);
    expect(lastKeys()).toEqual([["Сдать отчёт"]]);
    expect(lastData()).toEqual(["task:report:tk1"]);
  });

  it("«Сдать отчёт» показывает обязательные вещи, и без файлов «Отправить отчёт» нет", async () => {
    await press("task:start:tk1");
    const r = await press("task:report:tk1");
    expect(r).toMatchObject({ task: "tk1", stage: "report" });
    expect(last().text).toMatch(/⬜ макет — файла нет/);
    expect(last().text).toMatch(/⬜ смета — файла нет/);
    // Необязательный черновик не спрашивается: низ вилки 0.
    expect(last().text).not.toMatch(/черновик/);
    expect(lastKeys()).toEqual([["макет"], ["смета"], ["Назад"]]);
    expect(lastData()).toEqual(["task:give:tk1:0", "task:give:tk1:1", "task:back"]);
  });

  it("вещь → «пришлите файл» → документ → tg.getFile → files.save → ✅", async () => {
    await press("task:report:tk1");
    const ask = await press("task:give:tk1:0");
    expect(ask).toMatchObject({ stage: "file", trait: "t1" });
    expect(last().text).toMatch(/Пришлите файл для «макет»/);

    const r = await sendDoc(doc);
    expect(r).toMatchObject({ stage: "report" });
    // Имя и тип — из документа, байты — от Telegram.
    expect(saved).toEqual([["200", "макет.pdf", "application/pdf", Buffer.byteLength("байты F1")]]);
    // Файл пришёл отдельным сообщением — экран сдачи уходит новым сообщением.
    const shown = sent[sent.length - 1];
    expect(shown.text).toMatch(/✅ макет — макет.pdf/);
    expect(shown.text).toMatch(/⬜ смета — файла нет/);
    expect(shown.keyboard.inline_keyboard.map((row) => row.map((b) => b.text)))
      .toEqual([["✅ макет"], ["смета"], ["Назад"]]);
  });

  it("не файл, когда ждётся файл, — просьба словами; текст вне шага — не наше (null)", async () => {
    expect(await say("привет")).toBeNull();
    await press("task:report:tk1");
    // Экран со списком ждёт нажатия, а не текста: сообщение — не наше.
    expect(await say("привет")).toBeNull();
    await press("task:give:tk1:1");
    const r = await say("вот смета");
    expect(r).toMatchObject({ stage: "file", error: "no file" });
    expect(sent[sent.length - 1].text).toMatch(/Жду файл для «смета»/);
    // Команды не перехватываются даже внутри шага.
    expect(await say("/id")).toBeNull();
  });

  it("если Telegram файл не отдал — сказано, почему, и шаг не потерян", async () => {
    deps.tg.getFile = async () => { throw Object.assign(new Error("Bad Request: file is too big"),
      { userMessage: "Файл слишком большой для бота." }); };
    await press("task:report:tk1");
    await press("task:give:tk1:0");
    const r = await sendDoc(doc);
    expect(r).toMatchObject({ stage: "file", error: "file failed" });
    expect(sent[sent.length - 1].text).toMatch(/Файл слишком большой для бота/);
    expect(sent[sent.length - 1].text).toMatch(/20 МБ/);
    expect(saved).toEqual([]);
  });

  it("весь путь: файлы → «Отправить отчёт» → часы → текст → оценка → комментарий → скрытый → submit",
    async () => {
      await press("task:start:tk1");
      await press("task:report:tk1");
      await press("task:give:tk1:0");
      await sendDoc(doc);
      await press("task:give:tk1:1");
      await onTaskMessage({ photo: [{ file_id: "small" }, { file_id: "P9" }], chat: { id: 200 } },
        worker, deps);
      // Оба обязательных на месте — появился «Отправить отчёт».
      expect(sent[sent.length - 1].keyboard.inline_keyboard.map((row) => row.map((b) => b.text)))
        .toEqual([["✅ макет"], ["✅ смета"], ["Отправить отчёт"], ["Назад"]]);
      // Фото — самое крупное, и названо фотографией.
      expect(saved[1]).toEqual(["200", "фото.jpg", "image/jpeg", Buffer.byteLength("байты P9")]);

      expect((await press("task:send:tk1")).stage).toBe("hours");
      expect(last().text).toMatch(/Сколько часов ушло/);
      expect((await say("abc")).error).toBe("bad hours");
      expect((await say("2,5")).stage).toBe("text");
      expect((await say("Сделал два варианта")).stage).toBe("mark");
      expect(lastKeys()).toEqual([["1", "2", "3", "4", "5"], ["Назад", "Пропустить"]]);
      expect((await press("task:mark:4")).stage).toBe("comment");
      expect((await say("Не хватало брифа")).stage).toBe("vis");
      expect(lastKeys()).toEqual([["Публично — после публикации видят все"],
        ["Скрыто — отметку видите только вы, слова — вы и постановщик"], ["Назад"]]);

      const r = await press("task:vis:hidden");
      expect(r).toMatchObject({ task: "tk1", submitted: true });
      const submit = calls.find((c) => c[0] === "submit");
      expect(submit.slice(1, 3)).toEqual(["200", "tk1"]);
      expect(submit[3]).toEqual({
        hours: 2.5,
        files: {
          t1: { name: "макет.pdf", type: "application/pdf", size: Buffer.byteLength("байты F1"),
            url: "/api/reports/s/макет.pdf" },
          t2: { name: "фото.jpg", type: "image/jpeg", size: Buffer.byteLength("байты P9"),
            url: "/api/reports/s/фото.jpg" },
        },
        text: "Сделал два варианта",
        setterRating: { mark: 4, comment: "Не хватало брифа", hidden: true },
      });
      expect(last().text).toMatch(/Отчёт по «Макет для Ромашки» отправлен: 2.5 ч, 2 вещи/);
      expect(last().text).toMatch(/ушла на проверку/);
      // Шаг закрыт: дальше сообщения не наши.
      expect(await say("ещё")).toBeNull();
    });

  it("оценка и комментарий пропущены — «скрытый/публичный» не спрашивается, setterRating = null",
    async () => {
      // Функция без обязательных вещей: «Отправить отчёт» есть сразу.
      work.taskFor = async () => ({ task: TASK, func: { ...FUNC, gives: [{ trait: "t3", lo: 0, hi: 1 }] },
        traits: TRAITS });
      await press("task:report:tk1");
      expect(last().text).toMatch(/Обязательных вещей у этой функции нет/);
      expect(lastKeys()).toEqual([["Отправить отчёт"], ["Назад"]]);
      await press("task:send:tk1");
      await say("1");
      expect((await press("task:skip")).stage).toBe("mark");
      expect((await press("task:skip")).stage).toBe("comment");
      const r = await press("task:skip");
      expect(r).toMatchObject({ submitted: true });
      const submit = calls.find((c) => c[0] === "submit");
      expect(submit[3]).toEqual({ hours: 1, files: {}, text: "", setterRating: null });
      expect(last().text).toMatch(/1 ч, без вещей/);
    });

  /* Голос, стикер или фото без подписи — не текст. Записать вместо них
     пустоту значило бы выбросить сказанное молча. */
  it("голос или стикер вместо текста отчёта — просьба словами, шаг на месте", async () => {
    work.taskFor = async () => ({ task: TASK, func: { ...FUNC, gives: [] }, traits: TRAITS });
    await press("task:report:tk1");
    await press("task:send:tk1");
    await say("2");
    expect(last().text).toMatch(/Текст отчёта/);
    const r = await onTaskMessage({ sticker: { file_id: "s" }, chat: { id: 200 } }, worker, deps);
    expect(r).toEqual({ task: "tk1", stage: "text", error: "no text" });
    expect(sent[sent.length - 1].text).toMatch(/Жду текст сообщением/);
    expect(sent[sent.length - 1].keyboard.inline_keyboard.flat().map((b) => b.text))
      .toEqual(["Назад", "Пропустить"]);
    // Подпись к фото — слова, она годится.
    const withCaption = await onTaskMessage({ photo: [{ file_id: "p" }], caption: "Сделал макет",
      chat: { id: 200 } }, worker, deps);
    expect(withCaption.stage).toBe("mark");
    await press("task:mark:5");
    const voice = await onTaskMessage({ voice: { file_id: "v" }, chat: { id: 200 } }, worker, deps);
    expect(voice).toEqual({ task: "tk1", stage: "comment", error: "no text" });
    expect(await say("Всё ясно")).toMatchObject({ stage: "vis" });
    await press("task:vis:public");
    const submit = calls.find((c) => c[0] === "submit");
    expect(submit[3]).toMatchObject({ text: "Сделал макет",
      setterRating: { mark: 5, comment: "Всё ясно", hidden: false } });
  });

  /* «Отправить отчёт» проверял обязательные вещи, но за минуты сдачи
     функцию могли поправить: отказ склада не должен быть тупиком без
     кнопок. */
  it("отказ склада «не хватает вещи» возвращает к списку с кнопками, а не в тупик", async () => {
    work.taskFor = async () => ({ task: TASK, func: { ...FUNC, gives: [] }, traits: TRAITS });
    await press("task:report:tk1");
    await press("task:send:tk1");
    await say("1");
    await press("task:skip");
    await press("task:mark:3");
    await press("task:skip");
    // Пока шли вопросы, у функции появилась обязательная вещь.
    work.taskFor = async () => ({ task: TASK, func: FUNC, traits: TRAITS });
    work.submit = async () => ({ error: "missing files", missing: ["t1", "t2"] });
    const r = await press("task:vis:hidden");
    expect(r).toMatchObject({ task: "tk1", stage: "report" });
    expect(last().text).toMatch(/^Не хватает обязательной вещи: отчёт не отправлен\./);
    expect(last().text).toMatch(/⬜ макет — файла нет/);
    expect(lastKeys()).toEqual([["макет"], ["смета"], ["Назад"]]);
    // Шаг жив: можно приложить вещь и продолжить.
    await press("task:give:tk1:0");
    expect((await sendDoc(doc)).stage).toBe("report");
    expect(last().text).toMatch(/✅ макет/);
  });

  it("отказ «задача не ваша» при отправке закрывает шаг словами", async () => {
    work.taskFor = async () => ({ task: TASK, func: { ...FUNC, gives: [] }, traits: TRAITS });
    await press("task:report:tk1");
    await press("task:send:tk1");
    await say("1");
    work.submit = async () => ({ error: "not yours" });
    await press("task:skip");   // текст
    await press("task:skip");   // оценка
    expect(await press("task:skip")).toEqual({ error: "not yours" });   // комментарий → отправка
    expect(last().text).toBe("Эта задача не ваша: отчёт не отправлен.");
    expect(await say("ещё")).toBeNull();
  });

  it("«Отправить отчёт» без обязательного файла не проходит, даже если кнопка осталась", async () => {
    await press("task:report:tk1");
    const r = await press("task:send:tk1");
    expect(r).toMatchObject({ stage: "report" });
    expect(lastAnswer()).toBe("Не хватает: макет, смета");
    expect(calls.filter((c) => c[0] === "submit")).toEqual([]);
  });

  it("«Назад» из сдачи возвращает к «Сдать отчёт», а приложенное не теряется", async () => {
    await press("task:report:tk1");
    await press("task:give:tk1:0");
    await sendDoc(doc);
    expect((await press("task:back")).stage).toBe("idle");
    expect(lastKeys()).toEqual([["Сдать отчёт"]]);
    expect(await say("текст")).toBeNull();
    await press("task:report:tk1");
    expect(last().text).toMatch(/✅ макет — макет.pdf/);
    // И по шагам назад: часы → список, текст → часы.
    await press("task:give:tk1:1");
    await sendDoc({ file_id: "F2", file_name: "смета.xlsx" });
    await press("task:send:tk1");
    expect((await press("task:back")).stage).toBe("report");
    await press("task:send:tk1");
    await say("3");
    expect((await press("task:back")).stage).toBe("hours");
  });

  it("чужому — отказ словами и на «Начать», и на «Сдать отчёт»", async () => {
    work.take = async () => ({ error: "not yours" });
    expect(await press("task:start:tk1", stranger)).toEqual({ error: "not yours" });
    expect(lastAnswer()).toBe("Эта задача не ваша");
    expect(sent[sent.length - 1].text).toMatch(/ничего не поменял/);

    expect(await press("task:report:tk1", stranger)).toEqual({ error: "not yours" });
    expect(last().text).toMatch(/Эта задача не ваша: сдавать нечего/);
    // Файл от чужого никуда не сохраняется: шага у него нет.
    expect(await sendDoc(doc, stranger)).toBeNull();
    expect(saved).toEqual([]);
  });

  it("без edit и без сообщения у кнопки бот пишет новым сообщением", async () => {
    delete deps.edit;
    const r = await onTaskButton({ id: "cb", from: worker, data: "task:start:tk1" }, worker, deps);
    expect(r).toMatchObject({ action: "take" });
    expect(sent[sent.length - 1].text).toMatch(/Взял в работу/);
    expect(sent[sent.length - 1].chatId).toBe(200);
  });
});

/* ─────── шаг переживает перезапуск ───────

   Сдача занимает минуты, выкат случается посреди неё. Шаг, живший в
   памяти, после перезапуска исчезал молча: файл в ответ на «пришлите
   макет» уходил в память помощника, число часов — вопросом модели. */
/* Второй рубеж после bot.js: даже если нажатие с пересланного в группу
   сообщения дошло сюда, ответ уходит в личный чат нажавшего, а чужое
   сообщение не правится. */
describe("адресат ответа — личный чат нажавшего", () => {
  const group = { id: -100123, type: "supergroup", title: "Команда" };

  it("кнопка на сообщении в группе: экран уходит в личку новым сообщением, группа не получает ничего", async () => {
    const r = await onTaskButton({ id: "cb", from: worker, data: "task:report:tk1",
      message: { message_id: 55, chat: group, text: NOTICE } }, worker, deps);
    expect(r).toMatchObject({ task: "tk1", stage: "report" });
    expect(edited).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(worker.id);
    // И дальнейшие шаги — туда же.
    await press("task:give:tk1:0");
    shown.forEach((m) => expect(m.chatId).toBe(worker.id));
  });

  it("кнопка на своём сообщении в личке правится на месте, как прежде", async () => {
    await press("task:report:tk1");
    expect(sent).toEqual([]);
    expect(edited[0]).toMatchObject({ chatId: worker.id, messageId: 55 });
  });
});

describe("шаг сдачи на диске", () => {
  const doc = { file_id: "F1", file_name: "макет.pdf", mime_type: "application/pdf" };
  const onDisk = async () => JSON.parse(await fs.readFile(stepsFile(), "utf8"));

  it("файл лежит там, куда указано: BOT_STEPS_FILE, иначе рядом с моделью", () => {
    expect(stepsFile()).toBe(path.join(tmpSteps, "bot-steps.json"));
    const prev = process.env.BOT_STEPS_FILE;
    delete process.env.BOT_STEPS_FILE;
    process.env.WORKSPACE_DIR = "/srv/data/workspace";
    expect(stepsFile()).toBe(path.join("/srv/data/workspace", "bot-steps.json"));
    delete process.env.WORKSPACE_DIR;
    expect(stepsFile()).toBe(path.resolve(process.cwd(), "data", "bot-steps.json"));
    process.env.BOT_STEPS_FILE = prev;
  });

  it("после перезапуска сдача продолжается с того же вопроса, приложенное на месте", async () => {
    await press("task:report:tk1");
    await press("task:give:tk1:0");
    await sendDoc(doc);
    await press("task:give:tk1:1");
    expect((await onDisk())["200"]).toMatchObject({ taskId: "tk1", stage: "file", trait: "t2",
      files: { t1: { name: "макет.pdf" } } });

    reloadSteps();   // так выглядит перезапуск: память пуста, диск — нет
    const r = await sendDoc({ file_id: "F2", file_name: "смета.xlsx" });
    expect(r).toMatchObject({ stage: "report" });
    expect(sent[sent.length - 1].text).toMatch(/✅ макет — макет.pdf/);
    expect(sent[sent.length - 1].text).toMatch(/✅ смета — смета.xlsx/);
    // И кнопка внутри шага после перезапуска — не «не помню».
    expect((await press("task:send:tk1")).stage).toBe("hours");
  });

  it("закрытый шаг уходит и с диска: перезапуск не воскрешает сданное", async () => {
    await press("task:report:tk1");
    await press("task:give:tk1:0");
    await sendDoc(doc);
    expect((await onDisk())["200"]).toBeTruthy();
    await press("task:start:tk1");          // «Начать» закрывает шаг сдачи
    expect(await onDisk()).toEqual({});
    reloadSteps();
    expect((await press("task:send:tk1")).stale).toBe(true);
  });

  it("порченый файл — шагов нет, и это не падение", async () => {
    await fs.writeFile(stepsFile(), "{ это не json", "utf8");
    reloadSteps();
    expect(await say("привет")).toBeNull();
    await fs.writeFile(stepsFile(), JSON.stringify({ 200: "не шаг", 300: { stage: 5 } }), "utf8");
    reloadSteps();
    expect((await press("task:send:tk1")).stale).toBe(true);
  });

  it("временного файла после записи не остаётся", async () => {
    await press("task:report:tk1");
    const names = await fs.readdir(tmpSteps);
    expect(names).toEqual(["bot-steps.json"]);
  });
});

/* taskFor — на настоящем складе работы: своя задача с функцией и ресурсами,
   чужая — отказ словом. */
describe("taskFor на складе работы", () => {
  let tmp;
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-bottasks-"));
    process.env.WORKSPACE_DIR = path.join(tmp, "ws");
    await writeModel({
      entities: [{ id: "e1", name: "Студия" }],
      traits: [...TRAITS, { id: "t9", e: "e1", l: "тайна" }],
      funcs: [FUNC],
      tasks: [TASK, { id: "tk2", funcId: "нет-такой", title: "Без функции", assignee: "200" }],
    });
  });
  afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("исполнителю — задача, функция и ровно её ресурсы", async () => {
    const r = await taskFor("200", "tk1");
    expect(r.task.title).toBe("Макет для Ромашки");
    expect(r.func.id).toBe("f1");
    expect(r.traits.map((t) => t.id).sort()).toEqual(["t0", "t1", "t2", "t3"]);
    expect(JSON.stringify(r)).not.toContain("тайна");
  });

  it("задача без функции — func пустой, ресурсов нет, и это не ошибка", async () => {
    const r = await taskFor("200", "tk2");
    expect(r.func).toBeNull();
    expect(r.traits).toEqual([]);
    expect(requiredGives(r.func)).toEqual([]);
  });

  it("чужому и по несуществующей — отказ словом", async () => {
    expect(await taskFor("300", "tk1")).toEqual({ error: "not yours" });
    expect(await taskFor("200", "нет")).toEqual({ error: "not found" });
  });
});
