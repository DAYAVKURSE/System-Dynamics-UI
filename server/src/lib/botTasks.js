/* ════════════════════════════════════════════════════════════════
   БОТ · кнопки задачи под уведомлением

   Уведомление о начале работы приходит тому, кому работа поручена, и
   решает он в этот момент ровно одно: начинает сейчас или нет. Отсюда две
   кнопки — «Отложить» и «Начать» — и два потока за ними:

   · «Отложить» спрашивает, НА СКОЛЬКО: один экран с готовыми сроками
     (`DEFER_CHOICES`) и «Назад». Срок выбирается в момент нажатия, а не
     берётся из анкеты: занят человек на десять минут или до завтра —
     видно только ему и только сейчас. Задача остаётся в бэклоге
     отложенной, срок не двигается (его ставит постановщик), а в названный
     момент планировщик присылает новое уведомление о начале.
     Спрашивается длительность, а не час на часах: «на два часа» одинаково
     понимается в любом часовом поясе, а «до 15:00» потребовало бы знать
     пояс человека, которого бот не знает.

   · «Начать» переводит задачу в работу, и то же сообщение превращается в
     «Сдать отчёт». Дальше вся сдача проходит в чате: по каждой вещи,
     которую функция обязана выдать, присылается файл; когда все на месте —
     часы, текст отчёта, оценка постановки и комментарий к ней, скрытый или
     публичный. Без обязательной вещи «Отправить отчёт» не появляется —
     правило то же, что на доске в приложении.

   Всё, что здесь есть, — чистые функции над `deps`: склад работы, файлы,
   Telegram и отправка передаются аргументами, поэтому поток проверяется
   тестами на заглушках, а не перепиской с живым ботом.

   Состояние шага (на каком вопросе человек, какие файлы уже приложены)
   — по одному на человека, в памяти И НА ДИСКЕ (`bot-steps.json`, см.
   `stepsFile`). Сдача в чате занимает минуты, а перезапуск случается при
   выкате; шаг, живший только в памяти, после него исчезал молча — и файл,
   присланный в ответ на «пришлите макет», уходил в память помощника, а
   число часов — вопросом модели. Теперь после перезапуска шаг читается с
   диска, и сдача продолжается с того же вопроса. «Не помню, с чего
   начали» остаётся только для кнопки, шага у которой и правда нет.
   ════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/* ─────── что задача ОБЯЗАНА выдать вещью ───────

   Повторено из `web/src/lib/funcs.js` (`requiredGives`, `missingGives`)
   НАРОЧНО, как расчёт цепочки в `reportView.js`: сервер отдаётся отдельным
   пакетом (деплой копирует только `server/src`), и тянуть в него код
   фронтенда нечем. Правило одно на оба места — обязателен выход, у которого
   нижняя граница вилки больше нуля: функция обещала выдать хотя бы столько,
   и работа без этого не сделана. Ноль внизу вилки — прямое разрешение не
   выдать ничего, и требовать файл там не за что. Разойтись двум местам не
   даёт `botTasks.test.js`: там те же случаи, что и в тестах фронтенда. */
const num = (v) => Number(v) || 0;
export const requiredGives = (f) => (f?.gives || [])
  .filter((p) => p && p.trait && num(p.lo) > 0);
export const missingGives = (f, files = {}) =>
  requiredGives(f).filter((p) => !(files || {})[p.trait]);

/* ─────── данные кнопок ───────

   Telegram даёт под callback_data 64 байта. Идентификатор задачи в них
   помещается, а вот задача вместе с ресурсом — не всегда, поэтому вещь
   называется НОМЕРОМ в списке обязательных выходов, а всё остальное
   (выбранные часы, приложенные файлы) лежит в шаге в памяти. */
const P = "task:";
export const TASK_START = `${P}start:`;
export const TASK_DEFER = `${P}defer:`;
/* Выбранный срок и «Назад» с экрана выбора. Минуты стоят ПЕРЕД
   идентификатором (`task:deferfor:60:tk1`): в идентификаторе двоеточия
   не бывает, и разбор — по первому. */
export const TASK_DEFER_FOR = `${P}deferfor:`;
export const TASK_DEFER_BACK = `${P}deferback:`;
/* Напоминание о постановке: «Готово» и «Отложить». Свои префиксы, а не
   общие с работой: у постановки другая проверка и другой склад — путать
   их значило бы отвечать «не ваша задача» тому, чья она и есть. */
export const SETUP_DONE = `${P}sdone:`;
export const SETUP_DEFER = `${P}sdefer:`;
export const SETUP_DEFER_FOR = `${P}sdeferfor:`;
export const SETUP_DEFER_BACK = `${P}sdeferback:`;
const REPORT = `${P}report:`;
const GIVE = `${P}give:`;
const SEND = `${P}send:`;
const MARK = `${P}mark:`;
const VIS = `${P}vis:`;
const BACK = `${P}back`;
const SKIP = `${P}skip`;

export const isTaskAction = (data) => String(data || "").startsWith(P);

/* Откуда задачу можно «Начать» и «Отложить»: лежит в бэклоге, отложена
   или просрочена. Повторяет правило склада работы (`BACKLOG` + «deadline»
   в `takeTask`/`deferTask`, workspaceStore.js) и одно на бота и
   планировщик: расписание берёт список отсюда же, чтобы «отложенная
   напоминает, пока лежит» и «отложить можно, пока лежит» не разошлись. */
export const DEFERRABLE = ["backlog", "deferred", "deadline"];

/* ─────── клавиатура уведомления ───────

   «Отложить» слева, «Начать» справа: привычный порядок «отказ слева,
   действие справа». Инлайн-кнопки Telegram КРАСИТЬ НЕЛЬЗЯ — цвет у них
   берётся из темы клиента, а в Bot API поля цвета нет. Единственный
   способ передать «красная/зелёная» — эмодзи в подписи; поэтому 🔴 и 🟢
   стоят в самом тексте кнопки, а не в оформлении. */
export const taskKeyboard = (taskId) => ({
  inline_keyboard: [[
    { text: "🔴 Отложить", callback_data: TASK_DEFER + taskId },
    { text: "🟢 Начать", callback_data: TASK_START + taskId },
  ]],
});

/* Клавиатура напоминания о постановке. «Готово» — не отметка «я нажал», а
   ПРОВЕРКА: система смотрит, поставлена ли задача на самом деле, и говорит,
   чего не хватает, если нет. */
export const setupKeyboard = (taskId) => ({
  inline_keyboard: [[
    { text: "🔴 Отложить", callback_data: SETUP_DEFER + taskId },
    { text: "✅ Готово", callback_data: SETUP_DONE + taskId },
  ]],
});

const btn = (text, data) => ({ text, callback_data: data });
const backRow = () => [btn("Назад", BACK)];
const rows = (count, per, data) => {
  const out = [];
  for (let i = 0; i < count; i += per) {
    out.push(Array.from({ length: Math.min(per, count - i) },
      (_, k) => btn(String(i + k), data + (i + k))));
  }
  return out;
};
const reportButton = (taskId) => ({ inline_keyboard: [[btn("Сдать отчёт", REPORT + taskId)]] });

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
export const durationText = (h, m) => {
  const parts = [];
  if (h) parts.push(`${h} ${plural(h, "час", "часа", "часов")}`);
  if (m) parts.push(`${m} ${plural(m, "минуту", "минуты", "минут")}`);
  return parts.join(" ") || "ноль минут";
};

export const minutesText = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return durationText(h, m);
};

/* ─────── на сколько отложить ───────

   Готовые сроки: от «через четверть часа» до «завтра». Свободный ввод
   тут не нужен — человек откладывает на бегу, а число минут словами он
   пишет дольше, чем нажимает. Список один на работу и на постановку:
   откладывается в обоих случаях одно и то же — ближайшее напоминание. */
export const DEFER_CHOICES = [15, 30, 60, 120, 240, 1440];
// Сутки — «1 день», а не «24 часа»: так их и держат в голове.
const choiceText = (mins) => (mins === 1440 ? "1 день" : minutesText(mins));

/** Экран выбора: сроки по три в ряд (в один Telegram ужимает их до
    нечитаемых) и «Назад» — к уведомлению, с которого пришли. */
export const deferKeyboard = (forPrefix, taskId, backData) => {
  const keyboard = [];
  for (let i = 0; i < DEFER_CHOICES.length; i += 3) {
    keyboard.push(DEFER_CHOICES.slice(i, i + 3)
      .map((m) => btn(choiceText(m), `${forPrefix}${m}:${taskId}`)));
  }
  keyboard.push([btn("Назад", backData)]);
  return { inline_keyboard: keyboard };
};

/** Минуты и задача из данных кнопки. Срок не из списка — не срок. */
const choiceOf = (data, prefix) => {
  const rest = data.slice(prefix.length);
  const at = rest.indexOf(":");
  const mins = Number(rest.slice(0, at));
  return { mins: DEFER_CHOICES.includes(mins) ? mins : null, id: rest.slice(at + 1) };
};

/** Нажали — повтор гаснет. Нет хранилища напоминаний — и гасить нечего. */
const ackReminder = (deps, userId, kind, taskId) =>
  Promise.resolve(deps.reminders?.ack?.(userId, kind, taskId)).catch(() => {});

/* ─────── шаг человека ─────── */

/** userId → шаг. Один на человека: две сдачи разом в чате не ведут. */
const steps = new Map();

/* ─────── шаги на диске ───────

   Файл один на всех: шагов столько, сколько людей посреди сдачи, — единицы,
   и читать его нужно только при старте. Лежит под WORKSPACE_DIR, а не в
   каталоге кода: деплой стирает всё внутри app/ при каждом обновлении, а
   шаг должен пережить именно обновление. Свой путь — BOT_STEPS_FILE. */
export function stepsFile() {
  if (process.env.BOT_STEPS_FILE) return path.resolve(process.env.BOT_STEPS_FILE);
  const dir = process.env.WORKSPACE_DIR
    ? path.resolve(process.env.WORKSPACE_DIR)
    : path.resolve(process.cwd(), "data");
  return path.join(dir, "bot-steps.json");
}

const EMPTY = "{}";
let loaded = false;
let written = EMPTY;              // что лежит на диске — одно и то же не переписывается
let writing = Promise.resolve();  // записи по очереди: две сразу затирали бы друг друга

/* Читается один раз, при первом обращении, синхронно: первое сообщение
   после перезапуска должно застать шаг уже на месте, а не «в пути». */
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(stepsFile(), "utf8"));
    for (const [userId, step] of Object.entries(parsed && typeof parsed === "object" ? parsed : {})) {
      // Порченая запись — не шаг: лучше «не помню» на кнопку, чем падение.
      if (!step || typeof step !== "object" || typeof step.stage !== "string") continue;
      steps.set(userId, { ...step, files: step.files && typeof step.files === "object" ? step.files : {} });
    }
    written = JSON.stringify(Object.fromEntries(steps));
  } catch {
    // Файла нет или он не читается — шагов нет. Первая же запись заведёт файл.
  }
}

/* Через временный файл и переименование, как память помощника: после
   падения посреди записи на диске либо прежние шаги целиком, либо новые,
   но не половина. Сбой записи — в журнал, не в чат: шаг в памяти цел, и
   сдача продолжается; потеряется он только вместе с процессом. */
function persist(log) {
  const snapshot = JSON.stringify(Object.fromEntries(steps));
  writing = writing.then(async () => {
    if (snapshot === written) return;
    const file = stepsFile();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, snapshot, "utf8");
    await fsp.rename(tmp, file);
    written = snapshot;
  }).catch((e) => { log(`шаги сдачи не записаны на диск: ${e.message}`); });
  return writing;
}

const logOf = (deps) => deps?.log || ((m) => console.warn(`[bot] ${m}`));

/** Забыть все шаги — и в памяти, и на диске (тесты). */
export function resetSteps() {
  steps.clear();
  loaded = true;
  written = EMPTY;
  try { fs.rmSync(stepsFile(), { force: true }); } catch { /* нечего стирать */ }
}
/** Забыть память, оставив диск: так выглядит перезапуск (тесты). */
export function reloadSteps() { steps.clear(); loaded = false; written = EMPTY; }

const q = (s) => `«${s}»`;
const titleOf = (task) => String(task?.title || "Задача");
const traitName = (traits, id) => traits.find((t) => t.id === id)?.l || "ресурс без названия";

/* Отказ — словами. «Не ваша» и «уже не в бэклоге» — разные вещи: первое
   значит, что задачу передали, второе — что она уже двинулась, и человеку
   надо знать, что именно. */
const whyNot = (error) => (error === "not found" ? "Такой задачи уже нет"
  : error === "not yours" ? "Эта задача не ваша"
    : error === "not in backlog" ? "Задача уже в работе или сдана"
      : error === "missing files" ? "Не хватает обязательной вещи"
        : "Не вышло");

/* Показать шаг. Нажатие кнопки правит то сообщение, на котором она была,
   — так переписка не растёт на каждое нажатие. Когда править нечего (файл
   пришёл отдельным сообщением, у кнопки нет сообщения, редактирование не
   удалось — Telegram не даёт править очень старые), уходит новое. */
async function show(deps, target, text, keyboard = null) {
  const { send, edit } = deps;
  const { chatId, messageId } = target;
  if (edit && messageId != null) {
    try {
      await edit(chatId, messageId, text, keyboard);
      return;
    } catch { /* не удалось поправить — отправим заново */ }
  }
  const sent = await send(chatId, text, keyboard);
  if (sent?.message_id != null) {
    const step = steps.get(target.userId);
    if (step) step.messageId = sent.message_id;
  }
}

/* Куда отвечать. Всегда в личный чат с нажавшим (chat.id личного чата и
   есть from.id), а не в чат сообщения с кнопкой: сообщение могли
   переслать в группу, и bot.js такие нажатия отсекает раньше, — но и
   здесь, вторым рубежом, группа адресом стать не должна. Править
   можно только сообщение из этого же личного чата: чужое (пересланное)
   Telegram править не даст, и show() ушёл бы новым сообщением туда же. */
const targetOf = (from, cb) => {
  const chatId = from.id;
  const own = cb?.message?.chat?.id != null && String(cb.message.chat.id) === String(chatId);
  return {
    userId: String(from.id),
    chatId,
    messageId: own ? (cb.message.message_id ?? null) : null,
  };
};

/* ─────── экраны ─────── */

const WORK_HINT = "Когда сделаете, нажмите «Сдать отчёт».";
const takenText = (title) => `Взял в работу: ${q(title)}. Она в колонке «В работе». ${WORK_HINT}`;
const inWorkText = (title) => `${q(title)} в работе — колонка «В работе». ${WORK_HINT}`;

/* Само уведомление — название, время, описание — остаётся в сообщении и
   после нажатия: по нему человек видит, что делать. Уходит только то, что
   дописал сам бот: абзац про кнопки и вопрос «на сколько отложить». Иначе
   «Отложить → Назад → Отложить» приписывало бы вопрос к вопросу. */
const ADDED = ["\n\n«🔴 Отложить»", "\n\nНа сколько отложить"];
const withoutHint = (text) =>
  ADDED.reduce((s, mark) => s.split(mark)[0], String(text || "")).trim();
const above = (text, next) => (withoutHint(text) ? `${withoutHint(text)}\n\n${next}` : next);

/** Экран сдачи: обязательные вещи и что из них уже на месте. */
function reportScreen(step, { func, traits }) {
  const required = requiredGives(func);
  const lines = [`Сдача: ${q(step.title)}.`];
  if (!required.length) {
    lines.push("Обязательных вещей у этой функции нет — можно отправлять отчёт.");
  } else {
    lines.push("Что функция обязана выдать:");
    required.forEach((p) => {
      const got = step.files[p.trait];
      lines.push(got ? `✅ ${traitName(traits, p.trait)} — ${got.name}`
        : `⬜ ${traitName(traits, p.trait)} — файла нет`);
    });
    lines.push("", "Нажмите вещь, чтобы прислать файл.");
  }
  const keyboard = required.map((p, i) => [btn(
    `${step.files[p.trait] ? "✅ " : ""}${traitName(traits, p.trait)}`, `${GIVE}${step.taskId}:${i}`)]);
  // «Отправить отчёт» появляется только когда приложено всё обязательное:
  // кнопка, которая ответит отказом, хуже отсутствующей.
  if (!missingGives(func, step.files).length) {
    keyboard.push([btn("Отправить отчёт", SEND + step.taskId)]);
  }
  keyboard.push(backRow());
  return { text: lines.join("\n"), keyboard: { inline_keyboard: keyboard } };
}

const hoursScreen = (step) => ({
  text: `Сколько часов ушло на ${q(step.title)}? Пришлите число — например 2 или 1.5.`,
  keyboard: { inline_keyboard: [backRow()] },
});
const textScreen = () => ({
  text: "Текст отчёта: что сделано? Пришлите сообщением.",
  keyboard: { inline_keyboard: [[btn("Назад", BACK), btn("Пропустить", SKIP)]] },
});
const markScreen = () => ({
  text: "Оцените постановку задачи — насколько ясно было, что сделать?"
    + " 1 — непонятно, 10 — всё ясно.",
  keyboard: { inline_keyboard: [
    /* Десятибалльная шкала — двумя рядами: в один ряд Telegram ужимает
       кнопки до нечитаемых. */
    [1, 2, 3, 4, 5].map((n) => btn(String(n), MARK + n)),
    [6, 7, 8, 9, 10].map((n) => btn(String(n), MARK + n)),
    [btn("Назад", BACK), btn("Пропустить", SKIP)],
  ] },
});
const commentScreen = () => ({
  text: "Комментарий к постановке — что бы вы сказали тому, кто ставил задачу?"
    + " Пришлите текст.",
  keyboard: { inline_keyboard: [[btn("Назад", BACK), btn("Пропустить", SKIP)]] },
});
const visScreen = () => ({
  text: "Ваш отзыв о постановке — скрыто или публично? Скрытость одна на отметку и слова.",
  keyboard: { inline_keyboard: [
    [btn("Публично — после публикации видят все", `${VIS}public`)],
    [btn("Скрыто — отметку видите только вы, слова — вы и постановщик", `${VIS}hidden`)],
    backRow(),
  ] },
});

/* ─────── переходы ─────── */

/** @param note — что сказать над списком: почему человек снова здесь. */
async function toReport(deps, target, step, note = "") {
  const got = await deps.work.taskFor(target.userId, step.taskId);
  if (got?.error) {
    steps.delete(target.userId);
    await show(deps, target, `${whyNot(got.error)}: сдавать нечего.`);
    return { error: got.error };
  }
  step.stage = "report";
  step.title = titleOf(got.task);
  const s = reportScreen(step, got);
  await show(deps, target, note ? `${note}\n\n${s.text}` : s.text, s.keyboard);
  return { task: step.taskId, stage: "report" };
}

async function toStage(deps, target, step, stage) {
  step.stage = stage;
  const s = stage === "hours" ? hoursScreen(step)
    : stage === "text" ? textScreen()
      : stage === "mark" ? markScreen()
        : stage === "comment" ? commentScreen()
          : visScreen();
  await show(deps, target, s.text, s.keyboard);
  return { task: step.taskId, stage };
}

/** Комментарий дан или оценка поставлена — есть что показывать или прятать.
    Ни того ни другого — спрашивать «скрытый или публичный» не о чем. */
async function afterComment(deps, target, step) {
  if (step.mark == null && !step.comment) return submit(deps, target, step, null);
  return toStage(deps, target, step, "vis");
}

async function submit(deps, target, step, hidden) {
  const setterRating = step.mark == null && !step.comment ? null
    : { mark: step.mark, comment: step.comment, hidden: Boolean(hidden) };
  const r = await deps.work.submit(target.userId, step.taskId, {
    hours: step.hours, files: step.files, text: step.text, setterRating,
  });
  if (r?.error) {
    /* Обязательной вещи нет, хотя «Отправить отчёт» её проверял: за минуты
       сдачи функцию поправили или задачу переназначили. Не тупик без
       кнопок, а назад к списку — там ⬜ по новой вещи и кнопка под неё. */
    if (r.error === "missing files") {
      return toReport(deps, target, step, `${whyNot(r.error)}: отчёт не отправлен.`);
    }
    // Задачи нет или она не ваша — сдавать нечего, шаг закрыт.
    steps.delete(target.userId);
    await show(deps, target, `${whyNot(r.error)}: отчёт не отправлен.`);
    return { error: r.error };
  }
  steps.delete(target.userId);
  const n = Object.keys(step.files).length;
  const things = n ? `${n} ${plural(n, "вещь", "вещи", "вещей")}` : "без вещей";
  // Проверяющий и исполнитель — один человек: принимать не у кого, задача
  // сразу в готовых. Так решает склад работы, здесь это только сказано.
  const where = r?.task?.status === "done"
    ? "Проверяющий — вы сами, задача сразу в готовых."
    : "Задача ушла на проверку.";
  await show(deps, target,
    `Отчёт по ${q(step.title)} отправлен: ${step.hours} ч, ${things}. ${where}`);
  return { task: step.taskId, submitted: true };
}

/* ─────── нажатия ─────── */

/**
 * @param cb    callback_query от Telegram
 * @param from  кто нажал (bot.js уже проверил, что его звали в модель)
 * @param deps  { work, files, tg, send, answer, edit, log? } — см. CONTRACTS.md, C6
 */
export async function onTaskButton(cb, from, deps) {
  ensureLoaded();
  // Что бы ни случилось с нажатием, шаг на диске должен совпасть с шагом в
  // памяти: иначе перезапуск вернул бы человека на вопрос назад.
  try {
    return await handleButton(cb, from, deps);
  } finally {
    await persist(logOf(deps));
  }
}

async function handleButton(cb, from, deps) {
  const { work, answer } = deps;
  const data = String(cb.data || "");
  const userId = String(from.id);
  const step = steps.get(userId);
  const target = targetOf(from, cb);

  // ── с уведомления ──
  if (data.startsWith(TASK_START)) {
    const id = data.slice(TASK_START.length);
    const r = await work.take(userId, id);
    if (r?.error) {
      await answer(cb.id, whyNot(r.error));
      await deps.send(from.id, `${whyNot(r.error)}: ничего не поменял.`);
      return { error: r.error };
    }
    steps.delete(userId);
    await answer(cb.id, "Взял в работу");
    await show(deps, target, above(cb.message?.text, takenText(titleOf(r.task))), reportButton(id));
    return { task: id, action: "take" };
  }

  /* «Отложить» — вопрос «на сколько», а не откладывание: срок человек
     выбирает каждый раз сам. Проверки (задача своя, ещё лежит) — до
     вопроса: спрашивать про срок у того, кому откладывать нечего, значит
     отказывать после выбора.

     ВАЖЕН ПОРЯДОК: выбранный срок и «Назад» разбираются раньше самой
     кнопки. Префиксы и так различаются двоеточием (`task:defer:` против
     `task:deferfor:`), но порядок не даст им сойтись при правках. */
  if (data.startsWith(TASK_DEFER_FOR)) {
    const { mins, id } = choiceOf(data, TASK_DEFER_FOR);
    if (!mins) {
      await answer(cb.id, "Нет такого срока");
      return { error: "bad defer" };
    }
    const got = await work.taskFor(userId, id);
    const error = got?.error || (DEFERRABLE.includes(got.task?.status) ? null : "not in backlog");
    if (error) {
      await answer(cb.id, whyNot(error));
      await deps.send(from.id, `${whyNot(error)}: ничего не поменял.`);
      return { error };
    }
    const until = new Date(Date.now() + mins * 60000).toISOString();
    const r = await work.defer(userId, id, { until });
    if (r?.error) {
      await answer(cb.id, whyNot(r.error));
      await show(deps, target, `${whyNot(r.error)}: ничего не поменял.`);
      return { error: r.error };
    }
    steps.delete(userId);
    await ackReminder(deps, userId, "task", id);
    await answer(cb.id, "Отложил");
    await show(deps, target, `Отложил: ${q(titleOf(got.task))} на ${choiceText(mins)}.`
      + " Осталась в бэклоге как отложенная — срок при этом не сдвинулся."
      + " Когда время выйдет, напомню снова.");
    return { task: id, action: "defer", until };
  }

  /* «Назад» — то же уведомление и те же две кнопки. Абзац про них
     возвращается вместе с ними: кнопка без слов о том, что она делает,
     заставляла бы гадать. */
  if (data.startsWith(TASK_DEFER_BACK)) {
    const id = data.slice(TASK_DEFER_BACK.length);
    await show(deps, target, `${withoutHint(cb.message?.text)}\n\n`
      + "«🔴 Отложить» — спрошу, на сколько. «🟢 Начать» — задача уйдёт в работу.",
    taskKeyboard(id));
    await answer(cb.id, "");
    return { task: id, action: "defer-back" };
  }

  if (data.startsWith(TASK_DEFER)) {
    const id = data.slice(TASK_DEFER.length);
    const got = await work.taskFor(userId, id);
    const error = got?.error || (DEFERRABLE.includes(got.task?.status) ? null : "not in backlog");
    if (error) {
      await answer(cb.id, whyNot(error));
      await deps.send(from.id, `${whyNot(error)}: ничего не поменял.`);
      return { error };
    }
    await answer(cb.id, "");
    await show(deps, target, above(cb.message?.text, `На сколько отложить ${q(titleOf(got.task))}?`),
      deferKeyboard(TASK_DEFER_FOR, id, TASK_DEFER_BACK + id));
    return { task: id, action: "defer-ask" };
  }

  /* ─── напоминание о постановке ───

     «Готово» — не отметка, а проверка: система смотрит, поставлена ли
     задача. Не поставлена — говорит, чего не хватает, и напоминание
     остаётся (повторится через минуту). */
  if (data.startsWith(SETUP_DONE)) {
    const id = data.slice(SETUP_DONE.length);
    const r = await work.setupState(userId, id);
    if (r?.error) {
      await answer(cb.id, whyNot(r.error));
      await deps.send(from.id, `${whyNot(r.error)}: ничего не поменял.`);
      return { error: r.error };
    }
    if (!r.set) {
      await answer(cb.id, "Ещё не поставлена");
      await deps.send(from.id, `Ещё не поставлена: ${q(r.title)}. ${r.why}`
        + " Поставьте её во вкладке «Проверка» — и нажмите «Готово» снова.");
      return { task: id, action: "setup-not-yet", why: r.why };
    }
    await ackReminder(deps, userId, "setup", id);
    await answer(cb.id, "Поставлена");
    await show(deps, target, `Поставлена: ${q(r.title)}. Больше не напоминаю.`);
    return { task: id, action: "setup-done" };
  }

  /* Постановку откладывают тем же экраном выбора — порядок проверок тот
     же: сперва выбранный срок и «Назад», потом сама кнопка. */
  if (data.startsWith(SETUP_DEFER_FOR)) {
    const { mins, id } = choiceOf(data, SETUP_DEFER_FOR);
    if (!mins) {
      await answer(cb.id, "Нет такого срока");
      return { error: "bad defer" };
    }
    const until = new Date(Date.now() + mins * 60000).toISOString();
    /* Откладывается НАПОМИНАНИЕ, а не задача: задача так и ждёт постановки,
       и двигать её состояние тем, что человек занят, было бы неправдой. */
    const ok = await deps.reminders?.defer?.(userId, "setup", id, until);
    await answer(cb.id, ok === false ? "Нечего откладывать" : "Отложил");
    await show(deps, target, `Напомню про постановку через ${choiceText(mins)}.`
      + " Задача так и ждёт постановки — её состояние не изменилось.");
    return { task: id, action: "setup-defer", until };
  }

  if (data.startsWith(SETUP_DEFER_BACK)) {
    const id = data.slice(SETUP_DEFER_BACK.length);
    await show(deps, target, `${withoutHint(cb.message?.text)}\n\n`
      + "«🔴 Отложить» — спрошу, на сколько. «✅ Готово» — проверю, поставлена ли.",
    setupKeyboard(id));
    await answer(cb.id, "");
    return { task: id, action: "setup-defer-back" };
  }

  if (data.startsWith(SETUP_DEFER)) {
    const id = data.slice(SETUP_DEFER.length);
    await answer(cb.id, "");
    await show(deps, target, above(cb.message?.text, "На сколько отложить напоминание о постановке?"),
      deferKeyboard(SETUP_DEFER_FOR, id, SETUP_DEFER_BACK + id));
    return { task: id, action: "setup-defer-ask" };
  }

  if (data.startsWith(REPORT)) {
    const id = data.slice(REPORT.length);
    // Приложенное к этой же задаче не теряется, если человек уходил «Назад».
    const files = step?.taskId === id ? step.files : {};
    const next = { taskId: id, title: "", stage: "report", chatId: target.chatId, files,
      hours: 0, text: "", mark: null, comment: "" };
    steps.set(userId, next);
    await answer(cb.id, "");
    return toReport(deps, target, next);
  }

  // ── всё дальше — внутри начатого шага ──
  if (!step) {
    await answer(cb.id, "Не помню, с чего начали — нажмите кнопку под уведомлением заново");
    return { stale: true };
  }

  if (data.startsWith(GIVE) && step.stage === "report") {
    const [id, idx] = data.slice(GIVE.length).split(":");
    const got = await work.taskFor(userId, id);
    const port = got?.error ? null : requiredGives(got.func)[Number(idx)];
    if (!port) {
      await answer(cb.id, got?.error ? whyNot(got.error) : "Такой вещи у функции уже нет");
      return got?.error ? { error: got.error } : toReport(deps, target, step);
    }
    step.stage = "file";
    step.trait = port.trait;
    step.traitTitle = traitName(got.traits, port.trait);
    await answer(cb.id, "");
    await show(deps, target,
      `Пришлите файл для ${q(step.traitTitle)} — документом или фото.`,
      { inline_keyboard: [backRow()] });
    return { task: id, stage: "file", trait: port.trait };
  }

  if (data.startsWith(SEND) && step.stage === "report") {
    const got = await work.taskFor(userId, step.taskId);
    if (got?.error) {
      await answer(cb.id, whyNot(got.error));
      return { error: got.error };
    }
    // Правило проверяется и здесь, а не только при показе кнопки: кнопка
    // могла остаться от прежнего экрана, а функцию за это время поправили.
    const missing = missingGives(got.func, step.files);
    if (missing.length) {
      await answer(cb.id, `Не хватает: ${missing.map((p) => traitName(got.traits, p.trait)).join(", ")}`);
      return toReport(deps, target, step);
    }
    await answer(cb.id, "");
    return toStage(deps, target, step, "hours");
  }

  if (data === SKIP) {
    await answer(cb.id, "");
    if (step.stage === "text") { step.text = ""; return toStage(deps, target, step, "mark"); }
    if (step.stage === "mark") { step.mark = null; return toStage(deps, target, step, "comment"); }
    if (step.stage === "comment") { step.comment = ""; return afterComment(deps, target, step); }
    return { ignored: "nothing to skip" };
  }

  if (data.startsWith(MARK) && step.stage === "mark") {
    const mark = Number(data.slice(MARK.length));
    if (!(mark >= 1 && mark <= 10)) {
      await answer(cb.id, "Оценка — от 1 до 10");
      return { error: "bad mark" };
    }
    step.mark = mark;
    await answer(cb.id, "");
    return toStage(deps, target, step, "comment");
  }

  if (data.startsWith(VIS) && step.stage === "vis") {
    await answer(cb.id, "");
    return submit(deps, target, step, data.slice(VIS.length) === "hidden");
  }

  if (data === BACK) {
    await answer(cb.id, "");
    return goBack(deps, target, step);
  }

  await answer(cb.id, "Эта кнопка уже не про этот шаг");
  return { ignored: "wrong stage", stage: step.stage };
}

/* «Назад» — на предыдущий вопрос, а из первого — к тому, с чего начали:
   отложить — к уведомлению с двумя кнопками, сдать — к «Сдать отчёт». */
async function goBack(deps, target, step) {
  switch (step.stage) {
    case "report":
      // Приложенное остаётся в шаге: вернуться и продолжить можно.
      step.stage = "idle";
      await show(deps, target, inWorkText(step.title), reportButton(step.taskId));
      return { task: step.taskId, stage: "idle" };
    case "file":
    case "hours":
      return toReport(deps, target, step);
    case "text":
      return toStage(deps, target, step, "hours");
    case "mark":
      return toStage(deps, target, step, "text");
    case "comment":
      return toStage(deps, target, step, "mark");
    case "vis":
      return toStage(deps, target, step, "comment");
    default:
      return { ignored: "nowhere to go back" };
  }
}

/* ─────── сообщения ───────

   Файл или текст в ответ на вопрос. Что именно ждётся, решает шаг: вне
   шага сообщение не наше, и bot.js разбирает его сам (команды, пересылки,
   помощник). Команды не перехватываются и внутри шага: «/id» должен
   работать всегда. */
const AWAITING = new Set(["file", "hours", "text", "comment"]);

/** Что прислали файлом: документ, фото (самое крупное), видео, голос. */
function attachmentOf(msg) {
  if (msg.document) {
    return { fileId: msg.document.file_id, name: msg.document.file_name || "",
      type: msg.document.mime_type || "" };
  }
  if (Array.isArray(msg.photo) && msg.photo.length) {
    return { fileId: msg.photo[msg.photo.length - 1].file_id, name: "фото.jpg", type: "image/jpeg" };
  }
  if (msg.video) return { fileId: msg.video.file_id, name: msg.video.file_name || "видео.mp4",
    type: msg.video.mime_type || "video/mp4" };
  if (msg.audio) return { fileId: msg.audio.file_id, name: msg.audio.file_name || "запись.mp3",
    type: msg.audio.mime_type || "audio/mpeg" };
  if (msg.voice) return { fileId: msg.voice.file_id, name: "голос.ogg",
    type: msg.voice.mime_type || "audio/ogg" };
  return null;
}

/**
 * @returns null, если у человека нет открытого шага, ждущего сообщения
 */
export async function onTaskMessage(msg, from, deps) {
  ensureLoaded();
  const userId = String(from.id);
  const step = steps.get(userId);
  if (!step || !AWAITING.has(step.stage)) return null;
  const text = String(msg?.text || "").trim();
  if (text.startsWith("/")) return null;
  try {
    return await handleMessage(msg, from, step, deps);
  } finally {
    await persist(logOf(deps));
  }
}

async function handleMessage(msg, from, step, deps) {
  const userId = String(from.id);
  const text = String(msg?.text || "").trim();
  // В личный чат с написавшим, как и у кнопок (targetOf): шаг сдачи —
  // личное дело исполнителя, и группа адресом быть не должна.
  const target = { userId, chatId: from.id, messageId: null };

  if (step.stage === "file") {
    const att = attachmentOf(msg);
    if (!att) {
      await deps.send(target.chatId,
        `Жду файл для ${q(step.traitTitle)} — документом или фото. «Назад» вернёт к списку.`,
        { inline_keyboard: [backRow()] });
      return { task: step.taskId, stage: "file", error: "no file" };
    }
    let saved;
    try {
      const got = await deps.tg.getFile(att.fileId);
      saved = await deps.files.save(userId, {
        name: att.name || got.name || "файл",
        type: att.type || got.type || "application/octet-stream",
        bytes: got.bytes,
      });
    } catch (e) {
      // Самая частая причина — файл больше 20 МБ: столько бот у Telegram
      // забрать не может. Человеку об этом надо сказать, а не молчать.
      await deps.send(target.chatId,
        `Не удалось приложить файл: ${e.userMessage || e.message}.`
        + " Файл больше 20 МБ бот забрать не может — приложите его в приложении.",
        { inline_keyboard: [backRow()] });
      return { task: step.taskId, stage: "file", error: "file failed" };
    }
    // Ровно ссылка на вещь: имя, тип, размер и адрес. Байты остались в
    // хранилище отчётов, в сдачу едет то же, что кладёт доска.
    step.files[step.trait] = { name: saved.name, type: saved.type, size: saved.size, url: saved.url };
    return toReport(deps, target, step);
  }

  if (step.stage === "hours") {
    const hours = Number(text.replace(",", "."));
    if (!text || !Number.isFinite(hours) || hours <= 0) {
      await deps.send(target.chatId, "Не понял число часов. Пришлите число больше нуля —"
        + " например 2 или 1.5.", { inline_keyboard: [backRow()] });
      return { task: step.taskId, stage: "hours", error: "bad hours" };
    }
    step.hours = hours;
    return toStage(deps, target, step, "text");
  }

  /* Текст отчёта и комментарий — словами. Голос, стикер или фото без
     подписи текстом не являются, и записать вместо них пустоту значило бы
     выбросить сказанное молча: человек увидел бы следующий вопрос и не
     узнал, что его слова не дошли. Подпись к фото — слова, она годится. */
  const body = text || String(msg?.caption || "").trim();
  if (!body) {
    await deps.send(target.chatId, "Жду текст сообщением — или нажмите «Пропустить».",
      { inline_keyboard: [[btn("Назад", BACK), btn("Пропустить", SKIP)]] });
    return { task: step.taskId, stage: step.stage, error: "no text" };
  }

  if (step.stage === "text") {
    step.text = body;
    return toStage(deps, target, step, "mark");
  }

  // comment
  step.comment = body;
  return afterComment(deps, target, step);
}
