import crypto from "node:crypto";
import { CANCELLED_ERROR } from "./assistantQueue.js";
import { applyPending, cancelPending, pendingById, undoApplied } from "./assistantActions.js";
import { undoById } from "./undoStore.js";

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

   Статус — ОДНО сообщение: «🕐 Думаю…» с часами, которые идут по кругу
   раз в секунду, пока ответа нет (владелец, 2026-09-21). Прежде там
   стояли стадии — «собираю ваши данные», «спрашиваю OpenAI /
   gpt-4o-mini», «отвечаю»; стадии рассказывали человеку про наше
   устройство и называли провайдера, о котором он не спрашивал. Идущие
   часы отвечают на единственный вопрос, который у него есть: жив ли бот
   и стоит ли ждать. Под статусом
   две кнопки. «✖ Отменить» прерывает запрос к модели (см.
   assistantQueue.cancel) — не прячет ответ, а останавливает счёт.
   «✎ Уточнить» — бот спрашивает, что добавить; следующий текст человека
   становится дополнением: текущий запрос отменяется и задаётся новый —
   «<вопрос>\n\nУточнение: <дополнение>». Ждать ответа, чтобы потом
   переспросить, — значит платить за ответ, который заведомо не тот.

   Кто что спросил и кто ждёт уточнения — в памяти процесса, как pending
   в bot.js: перезапуск посреди вопроса теряет только статус, и человек
   спрашивает заново; хранить это на диске ради трёх минут незачем.
   Ожидание уточнения истекает вместе с памятью о вопросе (KEEP_DONE_MS):
   иначе нажатое вчера «Уточнить» молча склеивало бы сегодняшний вопрос
   со вчерашним.

   Все ответы — в ЛИЧНЫЙ чат с написавшим (from.id), а не в чат сообщения:
   сообщение со статусом могли переслать в группу, и bot.js такие нажатия
   отсекает раньше, но и здесь группа адресом стать не должна.
   ════════════════════════════════════════════════════════════════ */

const REMEMBER = /^запомни\s*[:\-—]\s*/iu;
/* Ответ на «требуется вход»: «ключ <сервер>: <токен>» или
   «логин <сервер>: <логин> <пароль>». Имя сервера — как его зовут в
   настройках; регистр не важен. */
const MCP_KEY = /^ключ\s+(.+?)\s*[:\-—]\s*(\S[\s\S]*)$/iu;
const MCP_LOGIN = /^логин\s+(.+?)\s*[:\-—]\s*(\S+)\s+(\S[\s\S]*)$/iu;
const MAX_QUESTION = 4000;
export const BOT_TASK = "bot";

/* Кнопки под статусом. Префикс короткий: callback_data — 64 байта, а
   id вопроса (uuid) занимает 36. */
const P = "ai:";
export const AI_CANCEL = `${P}cancel:`;
export const AI_REFINE = `${P}refine:`;
/* Кнопки подтверждения изменения (владелец, 2026-09-21): «Подтвердить» и
   «Отменить» под отдельным сообщением о том, что будет сделано. */
export const AI_OK = `${P}ok:`;
export const AI_NO = `${P}no:`;
/* «Отменить изменения» — та же кнопка, что была «Подтвердить», после
   нажатия (владелец, 2026-09-21). Живёт столько же, сколько сам откат:
   без срока. */
export const AI_UNDO = `${P}undo:`;
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

/* ─── ИДУЩИЕ ЧАСЫ В СТАТУСЕ (владелец, 2026-09-21) ───

   Двенадцать циферблатов Telegram рисует сам, и они складываются в ход
   стрелки: сообщение правится раз в секунду, и человек видит, что бот
   не умер, — не узнавая при этом ни про стадии, ни про провайдера.

   Правка раз в секунду — предел, который Telegram держит для одного
   чата; не поправившаяся правка молчит (`setStatus`), и пропущенный
   такт ничего не ломает: следующий придёт через секунду. */
export const CLOCKS = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕",
  "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
export const TICK_MS = 1000;
export const tickText = (n = 0) =>
  `${CLOCKS[((n % CLOCKS.length) + CLOCKS.length) % CLOCKS.length]} ${THINKING}`;

/* Сообщение о будущем изменении: что именно будет сделано и две кнопки.
   Спрашивает приложение, а не модель: разрешение — не предмет разговора,
   и человек должен видеть ровно одно ясное предложение с ответом в одно
   нажатие. */
export const CONFIRM_LEAD = "Подтвердите изменение:";
export const APPLIED_LEAD = "Изменение внесено:";
export const UNDONE_LEAD = "Изменение откачено:";
export const REFUSED_LEAD = "Изменение отменено:";
export const confirmKeyboard = (id) => ({
  inline_keyboard: [[
    { text: "✅ Подтвердить", callback_data: AI_OK + id },
    { text: "✖ Отменить", callback_data: AI_NO + id },
  ]],
});
/* Подтвердили — на месте тех же кнопок остаётся одна, обратная. Не второе
   сообщение: откатывают именно ТО изменение, и кнопка должна стоять под
   его описанием, а не под чем попало. */
export const undoKeyboard = (id) => ({
  inline_keyboard: [[{ text: "↩ Отменить изменения", callback_data: AI_UNDO + id }]],
});

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
const refining = new Map();   // userId → { id: вопрос, который уточняют, at: когда нажали }
export const KEEP_DONE_MS = 10 * 60 * 1000;

export function resetAssistantState() { inflight.clear(); refining.clear(); }

/* Забывается и отвеченное давнее, и давнее «жду уточнение»: срок один,
   чтобы «Уточнить» не пережило вопрос, который уточняет. */
const sweep = (now = Date.now()) => {
  for (const [id, e] of inflight) {
    if (e.done && now - e.at > KEEP_DONE_MS) inflight.delete(id);
  }
  for (const [userId, r] of refining) {
    if (now - r.at > KEEP_DONE_MS) refining.delete(userId);
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
async function askQuestion(deps, { userId, chatId, question, context = "", image = null }) {
  const a = deps.assistant || deps;
  const send = deps.send || a.send;
  sweep();
  /* `context` — что человек видел в приложении, когда спросил (кнопка с
     волшебной палочкой, владелец 2026-09-21). Хранится при вопросе, чтобы
     «Уточнить» продолжало разговор с тем же экраном перед глазами. */
  const e = { id: "", queueId: null, userId, chatId, question, context: String(context || ""),
    /* Снимок экрана (вопрос из приложения) — модели, картинкой: иначе на
       «что ты видишь на скриншоте?» она отвечала бы про что угодно. */
    image: image || null,
    messageId: null, done: false, at: Date.now(), tick: 0, timer: null, chain: Promise.resolve() };
  /* Такт может прийти раньше, чем Telegram вернёт номер сообщения-статуса:
     часы заводятся вместе с вопросом. Поэтому правки идут цепочкой по
     порядку — иначе поздний такт перезаписал бы «Готово». */
  const show = () => {
    e.chain = e.chain.then(async () => {
      if (e.done || e.messageId == null) return;
      const text = tickText(e.tick);
      // Telegram на «ничего не изменилось» отвечает ошибкой — не шлём то же.
      if (text === e.shown) return;
      e.shown = text;
      await setStatus(deps, e, text, statusKeyboard(e.id));
    });
    return e.chain;
  };

  /* Подтверждение изменения — ОТДЕЛЬНЫМ сообщением с кнопками, а не
     правкой статуса: правку Telegram не показывает уведомлением, и
     человек, отложивший телефон, не узнал бы, что его ждут. Ответ
     говорит помощнику, дошло ли: не дошло — откладывать нечего. */
  const onConfirm = async ({ id, words }) => {
    try {
      await send(chatId, `${CONFIRM_LEAD}\n${words}`, confirmKeyboard(id));
      return true;
    } catch (err) {
      logOf(deps)(`подтверждение не отправлено: ${err.message}`);
      return false;
    }
  };

  /* ВХОД НА ЧУЖОЙ СЕРВЕР ПОСРЕДИ РАБОТЫ (владелец, 2026-09-21): «агент
     должен сам запрашивать логин и пароль в чате, или отправлять в чат
     страницу для логина». Спрашиваем сообщением — модель об этом только
     узнаёт. Что прислать, человек решает сам: ключ или пару логин/пароль;
     адрес страницы входа шлём, если сервер его назвал. */
  const onAuthNeeded = async ({ server, where, scheme = "", realm = "" }) => {
    try {
      /* Что просить — по тому, что запросил сервер (владелец, 2026-09-21):
         логин с паролем — только если он сказал Basic; иначе ключ. */
      const what = realm ? ` (${realm})` : "";
      const lines = [`«${server}»${what} требует входа — без него инструмент не отвечает.`];
      if (where) lines.push(`Войти: ${where}`);
      lines.push("", "Пришлите сюда одним сообщением:");
      if (scheme === "basic") lines.push(`логин ${server}: <логин> <пароль>`);
      else lines.push(`ключ ${server}: <ваш токен>`);
      await send(chatId, lines.join("\n"));
      return true;
    } catch (err) {
      logOf(deps)(`не спросил вход: ${err.message}`);
      return false;
    }
  };

  let raw;
  try {
    raw = a.ask(userId, question.slice(0, MAX_QUESTION), e.context,
      { task: BOT_TASK, onConfirm, onAuthNeeded, ...(e.image ? { image: e.image } : {}) });
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

  /* Статус не ушёл (Telegram ответил 429, сеть моргнула) — вопрос уже в
     очереди и деньги за ответ уйдут; терять ответ из-за слова «Думаю…»
     нельзя. Без номера сообщения стадии молчат (setStatus), а ответ всё
     равно уйдёт отдельным сообщением ниже. */
  let sent = null;
  try {
    sent = await send(chatId, tickText(0), statusKeyboard(e.id));
    e.shown = tickText(0);
  } catch (err) {
    logOf(deps)(`статус «${THINKING}» не отправлен: ${err.message}`);
  }
  e.messageId = sent?.message_id ?? null;
  /* Часы идут, пока ответа нет. `unref` — чтобы тик не держал процесс
     живым: приложение не должно ждать завершения чужого таймера. */
  if (e.messageId != null) {
    e.timer = setInterval(() => { e.tick += 1; show(); }, TICK_MS);
    e.timer.unref?.();
  }

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
    if (e.timer) { clearInterval(e.timer); e.timer = null; }
    e.done = true; e.at = Date.now();
    return { error: err.message, id: e.id };
  });
  return { answered: "queued", id: e.id, done };
}

/* Завершение статуса: кнопки снимаются, чтобы «Отменить» не висела под
   уже отвеченным. Дожидаемся цепочки правок стадий: иначе «Готово»
   перезаписала бы запоздавшая «Отвечаю…». */
async function finishStatus(deps, e, text) {
  // Часы останавливаются ПЕРВЫМИ: иначе такт, запущенный за миг до
  // ответа, перезаписал бы «Готово» обратно на «Думаю…».
  if (e.timer) { clearInterval(e.timer); e.timer = null; }
  e.done = true;
  await e.chain.catch(() => {});
  e.at = Date.now();
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
  const chatId = from.id;

  /* ─── ПОДТВЕРЖДЕНИЕ ИЗМЕНЕНИЯ (владелец, 2026-09-21) ───

     Эти две кнопки живут отдельно от вопроса: отложенное изменение
     переживает и ответ помощника, и десять минут памяти о вопросе. Кто
     нажал — тот и подтверждает: id человека хранится вместе с самим
     изменением, и чужую кнопку нажать нельзя. */
  /* Правка ТОГО ЖЕ сообщения: кнопки меняются под своим описанием, а не
     уезжают вниз новым сообщением. Не вышло поправить — не беда: о самом
     деле человек узнаёт из ответа на кнопку и из сообщения ниже. */
  const restyle = async (text, keyboard) => {
    const edit = deps.edit;
    const mid = cb?.message?.message_id;
    if (!edit || mid == null) return;
    try { await edit(cb.message.chat?.id ?? chatId, mid, text, keyboard); }
    catch { /* сообщение не поправилось */ }
  };

  if (data.startsWith(AI_OK) || data.startsWith(AI_NO)) {
    const yes = data.startsWith(AI_OK);
    const pid = data.slice((yes ? AI_OK : AI_NO).length);
    const p = pendingById(pid);
    if (!p || p.userId !== userId) {
      await answer(cb.id, p ? "Это не ваше изменение" : "Это подтверждение уже не действует");
      return { stale: true };
    }
    if (!yes) {
      cancelPending(pid);
      await answer(cb.id, "Отменено");
      await restyle(`${REFUSED_LEAD}\n${p.words}`, null);
      return { cancelled: pid };
    }
    let who = { isOwner: false };
    try { who = await (deps.org?.identify?.(userId, {}, { claim: false })) || who; }
    catch { /* гость: права решит само хранилище */ }
    const r = await applyPending(pid, { isOwner: !!who.isOwner });
    await answer(cb.id, r?.ok ? "Готово" : "Не вышло");
    /* Получилось — на месте «Подтвердить» встаёт «Отменить изменения», и
       стоит она без срока: откат лежит файлом и переживает перезапуск. */
    if (r?.ok && r.undoId) await restyle(`${APPLIED_LEAD}\n${p.words}`, undoKeyboard(r.undoId));
    else await restyle(`${p.words}`, null);
    await send(chatId, r?.text || "Изменение уже не действует.");
    return { applied: pid, ok: !!r?.ok };
  }

  if (data.startsWith(AI_UNDO)) {
    const uid = data.slice(AI_UNDO.length);
    const r = await undoApplied(uid, { userId });
    if (!r) {
      await answer(cb.id, "Откатывать уже нечего");
      await restyle(`${APPLIED_LEAD}\n${(await undoById(uid))?.words || ""}`.trim(), null);
      return { stale: true };
    }
    if (r.foreign) {
      await answer(cb.id, "Это не ваше изменение");
      return { stale: true };
    }
    await answer(cb.id, "Откатил");
    await restyle(`${UNDONE_LEAD}\n${r.words}`, null);
    await send(chatId, r.text);
    return { undone: uid };
  }

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
    refining.set(userId, { id, at: Date.now() });
    await answer(cb.id, "");
    await send(chatId, REFINE_PROMPT);
    return { asking: "refine", id };
  }

  await answer(cb.id, "");
  return { ignored: "unknown callback" };
}

/* ─────── ВОПРОС ИЗ ПРИЛОЖЕНИЯ (владелец, 2026-09-21) ───────

   Кнопка с волшебной палочкой в шапке: человек пишет вопрос в окне, а
   ответ приходит в чат бота — там же он и продолжает разговор кнопкой
   «Уточнить». Вместе с вопросом приходит то, что он видел на экране:
   текстом — в подсказку модели, картинкой — в чат, чтобы было видно, о
   чём спрашивали. Сам вопрос тоже кладётся в чат (подписью к картинке,
   если она есть): ответ без вопроса читался бы как реплика ниоткуда. */
export const APP_LEAD = "Вопрос из приложения:";
export async function askFromApp(deps, { userId, chatId, question, context = "", shot = null }) {
  const a = deps.assistant || deps;
  const send = deps.send || a.send;
  const q = String(question || "").trim();
  if (!q) throw new Error("question is required");
  if (!send || !a.ask) throw new Error("Помощник здесь не подключён");
  /* Снимок и вопрос — одним сообщением: вопрос подписью к картинке
     (владелец, 2026-09-22). Подпись у Telegram не длиннее 1024 знаков:
     длинный вопрос — отдельно текстом, картинка следом без подписи. Не
     отправилась картинка — вопрос всё равно уходит текстом. */
  const lead = `${APP_LEAD}\n${q}`;
  let told = false;
  if (shot?.length && deps.tg?.sendPhoto) {
    const fits = lead.length <= 1024;
    if (!fits) { await send(chatId, lead); told = true; }
    try {
      await deps.tg.sendPhoto(chatId, { bytes: shot, name: "screen.png", caption: fits ? lead : "" });
      told = true;
    } catch (err) { logOf(deps)(`снимок экрана не отправлен: ${err.message}`); }
  }
  if (!told) await send(chatId, lead);
  const image = shot?.length ? { mime: "image/png", data: Buffer.from(shot).toString("base64") } : null;
  return askQuestion(deps, { userId, chatId, question: q, context, image });
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
  const chatId = from.id;
  let text = String(msg.text || "").trim();
  const doc = msg.document || null;

  if (isForward(msg)) return null;
  if (text && isCommand(text)) return null;
  /* ─── голосовое (владелец, 2026-09-21) ───
     Аудио расшифровывается моделью строки «расшифровка» у ассистента
     (`hear` — index.js: getFile → transcribeFile) и дальше идёт как
     обычный вопрос словами. Модели нет — сказано одной строкой. */
  const voice = msg.voice || msg.audio || null;
  if (!text && !doc && voice && voice.file_id) {
    const hear = a.hear || deps.hear;
    if (!hear) return null;
    let heard;
    try {
      heard = await hear(userId, voice.file_id, { name: voice.file_name || "голосовое.ogg",
        type: voice.mime_type || "audio/ogg" });
    } catch (e) {
      await send(chatId, `Не расшифровал: ${e.message}`);
      return { error: e.message };
    }
    if (heard == null) {
      await send(chatId, "Модель для расшифровки голоса не выбрана.");
      return { error: "no transcribe model" };
    }
    text = String(heard).trim();
    if (!text) { await send(chatId, "В голосовом не нашлось слов."); return { error: "empty voice" }; }
  }
  if (!text && !doc) return null;

  /* ─── дополнение к вопросу, которого ждали после «Уточнить» ───
     Раньше «запомни» и документа: человек отвечает на вопрос бота, а не
     задаёт свой. Документ дополнением быть не может — ждём ещё. Давнее
     «Уточнить» уже забыто (sweep): текст — обычный новый вопрос. */
  sweep();
  const refineId = refining.get(userId)?.id;
  if (refineId && text) {
    refining.delete(userId);
    const prev = inflight.get(refineId);
    if (!prev) {
      // Вопрос забыт, а текст человека — нет: он задаётся как новый, а не
      // выбрасывается вместе с просьбой «задайте заново».
      if (!ask) {
        await send(chatId, "Помощник здесь не подключён.");
        return { error: "no ask" };
      }
      await send(chatId, "Тот вопрос уже не помню — задаю ваш текст как новый вопрос.");
      const r = await askQuestion(deps, { userId, chatId, question: text });
      return { ...r, stale: true };
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
    const r = await askQuestion(deps, { userId, chatId, question, context: prev.context || "" });
    return { ...r, refined: refineId };
  }

  /* ─── ВХОД НА MCP-СЕРВЕР, ПРИСЛАННЫЙ В ЧАТ (владелец, 2026-09-21) ───

     Раньше «запомни» и помощника: это ответ на вопрос бота, а не новый
     вопрос. Сообщение с ключом удаляем сразу же, если бот вправе: ключ
     не должен лежать в переписке. */
  const mcpAuth = a.mcpAuth || deps.mcpAuth;
  const key = text && text.match(MCP_KEY);
  const pair = text && text.match(MCP_LOGIN);
  if ((key || pair) && mcpAuth) {
    const name = String((key || pair)[1]).trim();
    const auth = key
      ? { kind: "bearer", token: String(key[2]).trim() }
      : { kind: "basic", login: String(pair[2]).trim(), password: String(pair[3]).trim() };
    let saved = null;
    try { saved = await mcpAuth(userId, name, auth); }
    catch (e) { await send(chatId, `Не вышло: ${e.message}`); return { error: e.message }; }
    if (deps.tg?.deleteMessage && msg.message_id != null) {
      try { await deps.tg.deleteMessage(chatId, msg.message_id); } catch { /* не вышло — не беда */ }
    }
    if (!saved) {
      await send(chatId, `Не нашёл сервер «${name}» среди ваших. Проверьте название.`);
      return { error: "no server" };
    }
    await send(chatId, `Запомнил вход в «${saved.name}». Спросите снова — теперь получится.`);
    return { mcpAuth: saved.id };
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
      await send(from.id, `Запомнил: «${short(item.title)}». Посмотреть и удалить можно в Инструментах → Агенты.`);
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
