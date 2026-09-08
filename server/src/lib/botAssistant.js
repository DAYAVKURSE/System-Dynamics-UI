import crypto from "node:crypto";
import { CANCELLED_ERROR } from "./assistantQueue.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК В ЧАТЕ БОТА

   Бот перестаёт быть «только для владельца»: любой позванный пишет ему
   словами и получает ответ по своим данным. Что человек видит в
   приложении, то помощник и знает, — граница та же (см.
   assistantContext.js), проверяется при каждом обращении. Отвечает
   модель, которую человек выбрал для задачи «помощник в чате бота» в
   своих настройках (строка 'bot' таблицы «задача → модель»).

   Здесь нет разбора команд и пересылок: их bot.js разбирает раньше. Сюда
   попадает то, что осталось, — обычный текст и документы, — и на всё
   прочее модуль отвечает null: «это не мне».

   «запомни: …» кладёт текст в память, документ без открытого шага сдачи —
   тоже в память (открытый шаг сдачи перехватывает botTasks.js раньше).
   Байты документа даёт `deps.tg.getFile`; если его нет — запоминается
   имя и подпись, и об этом говорится прямо.

   Ответа модели здесь НЕ ждут. Бот разбирает обновления по одному, и
   пока он ждал бы модель (секунды, а при зависшем провайдере минуты),
   кнопки и файлы всех остальных лежали бы у Telegram. Поэтому сразу
   уходит сообщение-статус, а ответ — потом, отдельным сообщением:
   отдельным, а не правкой статуса, потому что правку Telegram не
   показывает уведомлением, и человек, отложивший телефон, ответа бы не
   заметил.

   Статус — ОДНО сообщение, которое правится по стадиям («собираю ваши
   данные», «спрашиваю OpenAI / gpt-4o-mini», «отвечаю», «Готово»):
   человек видит, что происходит, а не гадает, жив ли бот. Под статусом
   две кнопки. «✖ Отменить» прерывает запрос к модели (см.
   assistantQueue.cancel) — не прячет ответ, а останавливает счёт.
   «✎ Уточнить» — бот спрашивает, что добавить; следующий текст человека
   становится дополнением: текущий запрос отменяется и задаётся новый —
   «<вопрос>\n\nУточнение: <дополнение>». Ждать ответа, чтобы потом
   переспросить, — значит платить за ответ, который заведомо не тот.

   Кто что спросил и кто ждёт уточнения — в памяти процесса, как pending
   в bot.js: перезапуск посреди вопроса теряет только статус, и человек
   спрашивает заново; хранить это на диске ради трёх минут незачем.
   ════════════════════════════════════════════════════════════════ */

const REMEMBER = /^запомни\s*[:\-—]\s*/iu;
const MAX_QUESTION = 4000;
export const BOT_TASK = "bot";

/* Кнопки под статусом. Префикс короткий: callback_data — 64 байта, а
   id вопроса (uuid) занимает 36. */
const P = "ai:";
export const AI_CANCEL = `${P}cancel:`;
export const AI_REFINE = `${P}refine:`;
export const isAssistantAction = (data) => String(data || "").startsWith(P);

export const THINKING = "Думаю…";
export const DONE_TEXT = "Готово";
export const FAILED_TEXT = "Не вышло";
export const CANCELLED_TEXT = "Отменено";
export const REFINE_PROMPT = "Что добавить к вопросу? Пришлите дополнение одним сообщением.";

const isCommand = (text) => /^\//.test(text);
const isForward = (msg) => Boolean(msg.forward_from || msg.forward_sender_name || msg.forward_origin
  || msg.forward_date);

const short = (s, n = 60) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/* Telegram принимает 4096 знаков на сообщение, а ответ модели этого не
   знает. Длинный ответ уходит несколькими сообщениями, по абзацам, —
   иначе Telegram отвечал бы «message is too long», и человек не видел бы
   ничего. */
export const TG_MESSAGE_LIMIT = 4000;
export function splitMessage(text, limit = TG_MESSAGE_LIMIT) {
  const out = [];
  let rest = String(text || "");
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/* ─── что показывает статус на каждой стадии ─── */
export function stageText(stage, info = {}) {
  if (stage === "context") return "Собираю ваши данные…";
  if (stage === "model") {
    const who = [info.providerName, info.model].filter(Boolean).join(" / ");
    return who ? `Спрашиваю ${who}…` : "Спрашиваю модель…";
  }
  if (stage === "answer") return "Отвечаю…";
  return THINKING;
}

export const statusKeyboard = (id) => ({
  inline_keyboard: [[
    { text: "✖ Отменить", callback_data: AI_CANCEL + id },
    { text: "✎ Уточнить", callback_data: AI_REFINE + id },
  ]],
});

/* Вопросы в работе и завершённые недавно — по id; кто ждёт уточнения —
   по человеку. Завершённые не стираются сразу: «Уточнить» под уже
   отвеченным вопросом — законный ход (переспросить точнее), и для него
   нужен текст исходного вопроса. */
const inflight = new Map();   // id → { id, queueId, userId, chatId, question, messageId, done, at }
const refining = new Map();   // userId → id вопроса, который уточняют
const KEEP_DONE_MS = 10 * 60 * 1000;

export function resetAssistantState() { inflight.clear(); refining.clear(); }

const sweep = (now = Date.now()) => {
  for (const [id, e] of inflight) {
    if (e.done && now - e.at > KEEP_DONE_MS) inflight.delete(id);
  }
};

const logOf = (deps) => deps.log || ((m) => console.warn(`[bot] ${m}`));

/* Правка статуса — молча, если не вышло: Telegram не даёт править очень
   старые сообщения, а бывает, что сеть моргнула. Ответ всё равно придёт
   отдельным сообщением, и это важнее, чем слово в статусе. */
async function setStatus(deps, e, text, keyboard) {
  const edit = deps.edit;
  if (!edit || e.messageId == null) return;
  try { await edit(e.chatId, e.messageId, text, keyboard); } catch { /* статус не поправился */ }
}

/**
 * Задать вопрос: статус с кнопками — сразу, ответ — потом.
 * Возвращает { answered: "queued", id, done }: done — обещание, что ответ
 * или ошибка уже ушли в чат; бот его не ждёт, тесты — ждут.
 */
async function askQuestion(deps, { userId, chatId, question }) {
  const a = deps.assistant || deps;
  const send = deps.send || a.send;
  sweep();
  const e = { id: "", queueId: null, userId, chatId, question, messageId: null, done: false,
    at: Date.now(), stage: null, chain: Promise.resolve() };
  /* Стадии могут прийти раньше, чем Telegram вернёт номер сообщения-статуса:
     очередь начинает сразу. Поэтому стадия запоминается, а правки идут
     цепочкой по порядку — иначе «отвечаю» могло бы обогнать «собираю». */
  const show = () => {
    e.chain = e.chain.then(async () => {
      if (e.done || e.stage == null || e.messageId == null) return;
      const text = stageText(e.stage.stage, e.stage.info);
      // Одна стадия — одна правка: Telegram на «ничего не изменилось» отвечает ошибкой.
      if (text === e.shown) return;
      e.shown = text;
      await setStatus(deps, e, text, statusKeyboard(e.id));
    });
    return e.chain;
  };
  const onProgress = (stage, info) => { e.stage = { stage, info }; show(); };

  let raw;
  try {
    raw = a.ask(userId, question.slice(0, MAX_QUESTION), "", { task: BOT_TASK, onProgress });
  } catch (err) {
    raw = Promise.reject(err);
  }
  // id даёт очередь (по нему она отменяет); подмена в тестах может не дать —
  // тогда свой, лишь бы кнопки было к чему привязать.
  e.queueId = raw?.id || null;
  e.id = e.queueId || crypto.randomUUID();
  inflight.set(e.id, e);
  const p = Promise.resolve(raw);
  // Отказ до того, как статус ушёл, не должен стать необработанным: его
  // дождутся ниже, когда сообщение-статус уже на месте.
  p.catch(() => {});

  const sent = await send(chatId, THINKING, statusKeyboard(e.id));
  e.messageId = sent?.message_id ?? null;
  show();

  const done = (async () => {
    try {
      const answer = await p;
      const parts = splitMessage(String(answer || "").trim() || "Ответ пуст.");
      for (const part of parts) {
        // eslint-disable-next-line no-await-in-loop
        await send(chatId, part);
      }
      await finishStatus(deps, e, DONE_TEXT);
      return { answered: true, parts: parts.length, id: e.id };
    } catch (err) {
      const message = err?.message || "Помощник не ответил.";
      if (message === CANCELLED_ERROR) {
        // Отменил сам человек: статус говорит «Отменено», второе сообщение
        // об этом было бы шумом. Уточнение ставит своё слово само.
        await finishStatus(deps, e, e.refined ? `${CANCELLED_TEXT} — вопрос уточнён` : CANCELLED_TEXT);
        return { cancelled: true, id: e.id };
      }
      // Ошибка — словами: «не настроен», «OpenAI ответил 401», «не ответил
      // за 90 секунд». Молчание было бы хуже любой из них.
      await send(chatId, message);
      await finishStatus(deps, e, FAILED_TEXT);
      return { error: message, id: e.id };
    }
  })().catch((err) => {
    // Не ушло даже слово об ошибке (Telegram не отвечает) — остаётся
    // журнал; необработанным отказом это стать не должно.
    logOf(deps)(`ответ помощника не отправлен: ${err.message}`);
    e.done = true; e.at = Date.now();
    return { error: err.message, id: e.id };
  });
  return { answered: "queued", id: e.id, done };
}

/* Завершение статуса: кнопки снимаются, чтобы «Отменить» не висела под
   уже отвеченным. Дожидаемся цепочки правок стадий: иначе «Готово»
   перезаписала бы запоздавшая «Отвечаю…». */
async function finishStatus(deps, e, text) {
  await e.chain.catch(() => {});
  e.done = true; e.at = Date.now();
  await setStatus(deps, e, text, null);
}

/* ─── кнопки под статусом ─── */

/**
 * @returns { cancelled | asked | ignored | stale }
 */
export async function onAssistantButton(cb, from, deps = {}) {
  const a = deps.assistant || deps;
  const answer = deps.answer || (async () => {});
  const send = deps.send || a.send;
  const data = String(cb?.data || "");
  const userId = String(from.id);
  const chatId = cb?.message?.chat?.id ?? from.id;
  const id = data.startsWith(AI_CANCEL) ? data.slice(AI_CANCEL.length)
    : data.startsWith(AI_REFINE) ? data.slice(AI_REFINE.length) : "";
  sweep();
  const e = inflight.get(id);
  if (!e || e.userId !== userId) {
    // Чужой или забытый (перезапуск, десять минут прошло): честно «не помню».
    await answer(cb.id, e ? "Это не ваш вопрос" : "Этот вопрос я уже не помню — спросите заново");
    return { stale: true };
  }

  if (data.startsWith(AI_CANCEL)) {
    if (e.done) {
      await answer(cb.id, "Уже ответил — отменять нечего");
      return { ignored: "done" };
    }
    // Очередь ответила false — ответ уже уходит, и статус закроет он сам.
    const ok = a.cancel ? await a.cancel(e.queueId ?? e.id, userId) : false;
    await answer(cb.id, ok ? "Отменил" : "Уже завершён — отменять нечего");
    return { cancelled: ok, id };
  }

  if (data.startsWith(AI_REFINE)) {
    refining.set(userId, id);
    await answer(cb.id, "");
    await send(chatId, REFINE_PROMPT);
    return { asking: "refine", id };
  }

  await answer(cb.id, "");
  return { ignored: "unknown callback" };
}

/**
 * @param msg   сообщение Telegram
 * @param from  кто пишет
 * @param deps  { assistant: { ask(userId, question, context, {task, onProgress}) → Promise<string> & {id},
 *                             cancel(id, userId), memory }, send, edit?, answer?, tg? }
 *              либо те же поля на верхнем уровне
 * @returns null, если сообщение не для помощника. На вопрос —
 *          { answered: "queued", id, done }: done — обещание, что ответ или
 *          ошибка уже ушли в чат; бот его не ждёт, тесты — ждут.
 */
export async function onAssistantMessage(msg, from, deps = {}) {
  if (!msg || !from) return null;
  const a = deps.assistant || deps;
  const { ask, memory } = a;
  const send = deps.send || a.send;
  if (!send) return null;
  const userId = String(from.id);
  const chatId = msg.chat?.id ?? from.id;
  const text = String(msg.text || "").trim();
  const doc = msg.document || null;

  if (isForward(msg)) return null;
  if (text && isCommand(text)) return null;
  if (!text && !doc) return null;

  /* ─── дополнение к вопросу, которого ждали после «Уточнить» ───
     Раньше «запомни» и документа: человек отвечает на вопрос бота, а не
     задаёт свой. Документ дополнением быть не может — ждём ещё. */
  const refineId = refining.get(userId);
  if (refineId && text) {
    refining.delete(userId);
    const prev = inflight.get(refineId);
    if (!prev) {
      await send(chatId, "Тот вопрос я уже не помню — задайте его заново целиком.");
      return { stale: true };
    }
    if (!ask) {
      await send(chatId, "Помощник здесь не подключён.");
      return { error: "no ask" };
    }
    if (!prev.done && a.cancel) {
      prev.refined = true;
      await a.cancel(prev.queueId ?? prev.id, userId);
    }
    const question = `${prev.question}\n\nУточнение: ${text}`;
    const r = await askQuestion(deps, { userId, chatId, question });
    return { ...r, refined: refineId };
  }

  /* ─── «запомни: …» ─── */
  if (text && REMEMBER.test(text)) {
    const body = text.replace(REMEMBER, "").trim();
    if (!body) {
      await send(from.id, "Что запомнить? Напишите: запомни: <текст>");
      return { remembered: null };
    }
    if (!memory?.addMemory) {
      await send(from.id, "Память помощника здесь не подключена.");
      return { error: "no memory" };
    }
    try {
      const item = await memory.addMemory(userId, { text: body });
      await send(from.id, `Запомнил: «${short(item.title)}». Посмотреть и удалить можно в Инструментах → Помощник.`);
      return { remembered: item.id };
    } catch (e) {
      await send(from.id, `Не запомнил: ${e.message}`);
      return { error: e.message };
    }
  }

  /* ─── документ → в память ─── */
  if (doc) {
    if (!memory?.addMemory) {
      await send(from.id, "Память помощника здесь не подключена.");
      return { error: "no memory" };
    }
    const caption = String(msg.caption || "").trim();
    const name = doc.file_name || "файл";
    try {
      let item;
      const getFile = deps.tg?.getFile;
      if (getFile) {
        const got = await getFile(doc.file_id);
        item = await memory.addMemory(userId, {
          title: caption ? short(caption, 200) : "",
          text: caption,
          file: { name: got?.name || name, type: got?.type || doc.mime_type, bytes: got?.bytes },
        });
        await send(from.id, `Положил в память файл «${item.file?.name || name}»${caption ? " с подписью" : ""}.`);
      } else {
        // Скачать файл нечем: запоминаем то, что есть, и говорим об этом.
        item = await memory.addMemory(userId, {
          title: caption ? short(caption, 200) : name,
          text: caption ? `${caption}\n(файл «${name}» прислан в чат, но его содержимое бот сохранить не может)`
            : `Файл «${name}» прислан в чат, но его содержимое бот сохранить не может.`,
        });
        await send(from.id, `Запомнил название файла «${name}»${caption ? " и подпись" : ""}. Сам файл сохранить не могу — положите его в память через Инструменты → Помощник.`);
      }
      return { remembered: item.id };
    } catch (e) {
      await send(from.id, `Не запомнил: ${e.message}`);
      return { error: e.message };
    }
  }

  /* ─── обычный текст → вопрос ─── */
  if (!ask) {
    await send(from.id, "Помощник здесь не подключён.");
    return { error: "no ask" };
  }
  return askQuestion(deps, { userId, chatId, question: text });
}
