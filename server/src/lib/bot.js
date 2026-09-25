/* ════════════════════════════════════════════════════════════════
   БОТ · одна команда и помощник

   Прежде бот был «приглашалкой»: владелец пересылал ему сообщение от
   человека, бот показывал роли кнопками, а на всё остальное отвечал
   длинной подсказкой «Я умею одно: добавлять людей в модель». Вместе с
   ней в боте жили команды настройки звонка — «/callapp», «/callmain» — и
   запасной путь «id 123 Имя».

   Всё это убрано (владелец, 2026-09-21: «это сообщение удали, оно не
   должно отправляться, и все команды, которые с ним связаны, тоже.
   Должна работать только команда /id из них. Если пользователь пишет
   что-то словами, значит реагировать должен ассистент»). Людей зовут в
   приложении — ссылкой с договором; звонок настраивается переменными
   окружения.

   Осталось ровно три вещи:

   · «/id» — свой номер. Его и просят прислать, когда зовут человека;
   · кнопки под уведомлениями — сдача работы и ход вопроса к помощнику;
   · ЛЮБЫЕ СЛОВА — вопрос помощнику, и владельцу тоже: он знает модель,
     задачи и память, и отвечает тем же, чем ответил бы в приложении.

   Инлайн-режим («@бот завтра 15:00 разбор») остался: он не команда и не
   подсказка, а отдельный способ позвать на созвон прямо из чата. С
   2026-09-25 в той же выдаче — брейншторм-доски (см. onInline).

   Вся логика — чистая функция `handleUpdate`: она получает обновление и
   зависимости (хранилище, отправку) аргументами, поэтому проверяется
   тестами, а не перепиской с живым ботом.

   В группах бот только слушает: записывает (deps.chats) и молчит — см.
   начало handleUpdate.
   ════════════════════════════════════════════════════════════════ */

import { isTaskAction, onTaskButton, onTaskMessage } from "./botTasks.js";
import { isAssistantAction, onAssistantButton, onAssistantMessage } from "./botAssistant.js";
import { isDialogsAction } from "./dialogsUi.js";
import { MAIN, inStorage } from "./storages.js";

const nameOf = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ")
  || u?.username || String(u?.id || "");

// Группа и супергруппа — общий чат; канал и личный — нет.
const isGroupChat = (chat) => chat?.type === "group" || chat?.type === "supergroup";

/* Последняя встреча, заведённая инлайн-запросом, — на человека.

   Telegram присылает инлайн-запрос на КАЖДОЕ нажатие клавиши. Заводить на
   каждое по встрече — значит за один вечер вытеснить из хранилища все
   прежние вместе с их ссылками (там предел в 500 записей). Пока человек
   дописывает одну и ту же фразу, правится одна и та же встреча; новая
   фраза или пауза в несколько минут — новая встреча. */
const inlineDraft = new Map();   // id пользователя → { id, query, at }
const INLINE_REUSE_MS = 3 * 60 * 1000;

/** Та же ли это фраза, что набиралась только что: пачка ≤ 3 мин и одно начало. */
const sameBurst = (prev, typed, now) => Boolean(prev) && now - prev.at < INLINE_REUSE_MS
  && (typed.startsWith(prev.query) || prev.query.startsWith(typed));

/* Имя осталось прежним: его зовут тесты, а чистить теперь нечего,
   кроме черновика инлайн-встречи. */
export function resetPending() { inlineDraft.clear(); emptyBoard.clear(); emptyCall.clear(); }

/* ─────── инлайн-режим: позвать на созвон ───────
   Инлайн-запрос набирается в любом чате: «@бот завтра 15:00 разбор
   прогноза». Бот показывает разобранное время и текст подсказкой, а
   отправляет карточку со ссылкой, по которой открывается окно звонка в
   мини-приложении.

   Инлайн-режим сначала надо включить в @BotFather (/setinline) — без этого
   Telegram таких запросов просто не пришлёт. */

/* Карточка приглашения.

   В ней ровно три вещи: название, время и кнопка «Подключиться». Так
   просил владелец, и просил по делу.

   Чего здесь БОЛЬШЕ НЕТ и почему:

   · ссылки текстом («Подключиться: https://t.me/…»). Кнопка ведёт туда
     же, а лишняя строка — ещё одна цель для пальца и лишний шум.

   · второй ссылки «Не открылось? Откройте страницей». Она вела на
     обычную страницу, а обычную страницу Telegram открывает встроенным
     браузером — всегда во весь экран и без надёжного доступа к камере.
     Лёжа рядом с нужной, она собирала промахи пальцем. Ценой этого ушёл
     и запасной выход: если в @BotFather у приложения окажется неверный
     адрес, приглашение перестанет открываться совсем, и понять это можно
     будет только по пустому окну. Владелец знает — он и просил убрать.

   · подписи про то, как окно откроется на телефоне. Обещать высоту окна
     мы всё равно не можем: её решает клиент Telegram (см. lib/links.js).

   · превью ссылки — оно было третьей крупной целью, ведущей на страницу.
*/
const meetingCard = (m) => [m.title, m.at].filter(Boolean).join("\n");

/** Кнопка под приглашением. Одна: другой цели у приглашения нет. */
const meetingButtons = (link) => [[{ text: "📹 Подключиться", url: link }]];

/* ─────── инлайн-режим: брейншторм-доски (владелец, 2026-09-25) ───────

   «при вводе в инлайн режиме в выпадающем списке должны показываться уже
   созданные доски, чтобы я мог нажать на какую-либо из них и выбрать. Если
   вводимого названия нету, то должна создаваться новая доска. у
   пользователя нет прав на создание досок, то при вводе, в выпадающем
   списке у него должен быть один пункт, в котором это будет написано. И
   даже если он отправит, в сообщении будет написано, что у него нет прав
   на создание таких досок.»

   Права — как у вкладки «Брейншторм» в хранилище MAIN: владелец или роль с
   `brainstorm`. Доски выдачи — тоже MAIN: инлайн набирают в чужом чате, и
   другого хранилища, кроме главного, у бота здесь нет. */
const BOARD_LIMIT = 20;
const BOARD_NAME_MAX = 120;

const NO_BOARDS = {
  type: "article", id: "no-boards", title: "Нет прав на создание досок",
  input_message_content: { message_text: "У вас нет прав на создание досок." },
};

/** Пункт выдачи «доска»: сообщение — её имя, кнопка — открыть. */
const boardItem = (id, title, name, link, description) => ({
  type: "article", id: `board_${id}`, title,
  ...(description ? { description } : {}),
  input_message_content: { message_text: name, disable_web_page_preview: true },
  reply_markup: { inline_keyboard: [[{ text: "🧠 Открыть доску", url: link }]] },
});

/* Пустой запрос — РОВНО ДВА пункта, и оба РАБОТАЮТ: «Новая доска» и
   «Новый звонок» (владелец, 2026-09-25: «после пробела он пытается
   запустить звонок, а должен и то и то выдавать»; «там должно быть две
   кнопки»; «кнопка „новая доска“ не работает — она требует написать имя
   доски, нахуй мне тогда эта кнопка»). Доска заводится сразу, с именем
   «Доска N» по счёту досок хранилища; звонок — с названием «Звонок».
   Готовые доски при пустом запросе не показываются — они появляются,
   когда человек начинает набирать название.

   Пустой запрос Telegram шлёт при каждом открытии инлайна и при стирании
   набранного — поэтому одна и та же пара «доска + звонок» держится на
   человека несколько минут (как черновик встречи при наборе), а не
   заводится заново на каждый запрос. */
const emptyBoard = new Map();   // id пользователя → { id, at }
const emptyCall = new Map();    // id пользователя → { id, at }
const DEFAULT_CALL_TITLE = "Звонок";

/**
 * Доски в выдаче: `fresh` — что завести (новая доска или отказ), `found` —
 * уже созданные, подходящие к набранному. Порядок в выдаче собирает
 * onInline: сперва «новая доска» и «новый звонок», потом найденные доски.
 */
async function boardResults(q, from, me, { boards, boardLink }) {
  if (!(me.isOwner || (me.tabs || []).includes("brainstorm"))) return { fresh: [NO_BOARDS], found: [] };
  const typed = String(q.query || "").trim();
  const name = typed.replace(/\s+/g, " ").slice(0, BOARD_NAME_MAX).trim();
  const needle = name.toLowerCase();
  const uid = String(from.id);
  const all = await boards.listBoards({ storage: MAIN });
  if (!needle) {
    const now = Date.now();
    const kept = emptyBoard.get(uid);
    let draft = kept && now - kept.at < INLINE_REUSE_MS ? await boards.getBoard(kept.id) : null;
    if (!draft || !draft.draft) {
      try {
        draft = await boards.createBoard({ name: `Доска ${all.length + 1}`, storage: MAIN, by: uid,
          byName: me.name || nameOf(from), draft: true });
      } catch (e) {
        if (!e?.status || e.status >= 500) throw e;
        return { fresh: [{ type: "article", id: "board-refused", title: e.message,
          input_message_content: { message_text: e.message } }], found: [] };
      }
      emptyBoard.set(uid, { id: draft.id, at: now });
    }
    return { fresh: [boardItem(draft.id, "🧠 Новая доска", draft.name, boardLink(draft.id), draft.name)],
      found: [] };
  }
  const found = all.filter((b) => b.name.toLowerCase().includes(needle)).slice(0, BOARD_LIMIT)
    .map((b) => boardItem(b.id, `🧠 ${b.name}`, b.name, boardLink(b.id), "Доска"));
  if (all.some((b) => b.name.trim().toLowerCase() === needle)) return { fresh: [], found };

  /* Такой доски нет — новая, и заводится СРАЗУ: ссылка в кнопке обязана
     работать в момент отправки, второго шага «подтвердите» в инлайне нет.
     Черновиком — пока её не открыли, её не видно ни в списке, ни в
     приложении: иначе каждый недописанный набор оставлял бы доску.

     Черновик НЕ переименовывается, пока человек дописывает фразу (в
     отличие от встречи): любой промежуточный пункт выдачи мог уже уйти в чат, и
     переименование подменило бы доску под отправленной ссылкой, а два
     сообщения повели бы на одну доску. Поэтому на каждое новое имя — свой
     черновик; то же имя ещё раз — тот же. Брошенные черновики стор
     убирает сам: срок и предел на создателя (lib/boardStore.js). */
  let draft;
  try {
    draft = await boards.findDraft({ storage: MAIN, by: uid, name })
      || await boards.createBoard({ name, storage: MAIN, by: uid, byName: me.name || nameOf(from),
        draft: true });
  } catch (e) {
    // Предел досок хранилища — отказ словами, пунктом выдачи.
    if (!e?.status || e.status >= 500) throw e;
    return { fresh: [{ type: "article", id: "board-refused", title: e.message,
      input_message_content: { message_text: e.message } }], found };
  }
  return { fresh: [boardItem(draft.id, `🧠 Новая доска «${draft.name}»`, draft.name, boardLink(draft.id))],
    found };
}

/* ─────── инлайн-режим: встреча ─────── */
async function meetingResults(q, from, { calls, appLink }) {
  const parsed = calls.parseMeeting(q.query || "");
  if (!q.query || !q.query.trim()) {
    /* Пустой запрос — звонок заводится сразу, «Звонок» без времени: кнопка
       должна работать, а не просить набрать что-то (владелец, 2026-09-25).
       Несколько минут подряд — один и тот же, см. emptyBoard выше. */
    const uid = String(from.id);
    const now = Date.now();
    const kept = emptyCall.get(uid);
    let m = kept && now - kept.at < INLINE_REUSE_MS ? await calls.getMeeting(kept.id) : null;
    if (!m) {
      m = await calls.createMeeting({ title: DEFAULT_CALL_TITLE, at: "", text: "", by: from.id });
      emptyCall.set(uid, { id: m.id, at: now });
    }
    return [{
      type: "article", id: m.id, title: "📹 Новый звонок",
      description: "Отправить приглашение со ссылкой на звонок",
      input_message_content: { message_text: meetingCard(m), disable_web_page_preview: true },
      reply_markup: { inline_keyboard: meetingButtons(appLink(m.id)) },
    }];
  }

  // Встреча заводится сразу: ссылка должна работать в тот момент, когда
  // сообщение уже отправлено, а второго шага «подтвердите» в инлайне нет.
  // Но пока человек дописывает ту же фразу — правится одна запись, а не
  // заводится по встрече на нажатие клавиши.
  const typed = String(q.query || "").trim();
  const prev = inlineDraft.get(String(from.id));
  const now = Date.now();
  const fields = { title: parsed.title, at: parsed.atText, text: parsed.text };
  const m = (sameBurst(prev, typed, now) && await calls.updateMeeting(prev.id, fields))
    || await calls.createMeeting({ ...fields, by: from.id });
  inlineDraft.set(String(from.id), { id: m.id, query: typed, at: now });
  const link = appLink(m.id);
  return [{
    type: "article",
    id: m.id,
    // «Новый звонок» — словами в заголовке: рядом стоит «Новая доска», и
    // голое «а» не говорило, что это звонок (владелец, 2026-09-25).
    title: parsed.atText ? `📹 Новый звонок: ${parsed.atText} — ${parsed.title}`
      : `📹 Новый звонок «${parsed.title}»`,
    description: parsed.ok
      ? "Отправить приглашение со ссылкой на звонок"
      : "Время не разобрал — отправлю без него",
    input_message_content: { message_text: meetingCard(m),
      // Превью — ещё одна крупная цель, ведущая на страницу, а не в
      // мини-приложение. Ради него терять окно звонка незачем.
      disable_web_page_preview: true },
    reply_markup: { inline_keyboard: meetingButtons(link) },
  }];
}

/**
 * Инлайн-запрос: сначала доски, потом встреча — одной выдачей.
 *
 * Кто в модели не состоит, встреч не заводит, а досок — тем более: у него
 * в выдаче ровно один пункт «Нет прав на создание досок». Без досок
 * (зависимости `boards` нет) — как было: пустая выдача с кнопкой.
 */
async function onInline(q, from, deps) {
  const { org, calls, boards, answerInline } = deps;
  // claim: false — набранный в чужом чате инлайн-запрос не должен делать
  // человека владельцем модели, даже если владелец ещё не назначен.
  // Хранилище — главное: бот живёт вне запросов приложения. Кто работает
  // под страницей виртуального сотрудника (привязал к ней Telegram), тот
  // и здесь — она, как в приложении (middleware/telegramUser.js): иначе
  // вкладка у него открыта, а инлайн говорит «нет прав».
  const me = await inStorage(MAIN, async () => {
    const rid = org.recordIdFor ? await org.recordIdFor(String(from.id)) : String(from.id);
    return org.identify(rid, { name: nameOf(from), username: from.username }, { claim: false });
  });
  const b = boards ? await boardResults(q, from, me, deps) : { fresh: [], found: [] };
  const meeting = calls && me.known ? await meetingResults(q, from, deps) : [];
  // Сперва что завести — новая доска и новый звонок, — потом готовые доски.
  const results = [...b.fresh, ...meeting, ...b.found];
  if (!results.length && !me.known) {
    return answerInline(q.id, [], {
      button: { text: "Вас ещё не позвали в модель", start_parameter: "start" },
    });
  }
  return answerInline(q.id, results.slice(0, 50), { cache_time: 0, is_personal: true });
}

/* Что сказать на то, чего бот не разобрал: стикер, фото вне шага сдачи,
   пересылка, незнакомая команда. Одна строка, а не список умений: слова
   уходят помощнику и до этого места не доходят. */
const NOT_PARSED = "Не разобрал.";
/* Приветствие и кнопка — по-английски для всех (владелец, 2026-09-22):
   «/start» нажимают до того, как выбран язык. */
export const WELCOME = "Welcome! Open the panel to get to work, or send me a message";

/**
 * @param update  объект обновления Telegram
 * @param deps    { org, send, answer } — хранилище и две отправки
 */
export async function handleUpdate(update, deps) {
  const { org, send, answer } = deps;
  /* ─── оплата звёздами (владелец, 2026-09-21) ───
     Telegram спрашивает перед списанием — отвечаем «да»: сумму и план
     проверил сервис кодов, когда выписывал инвойс. */
  const pre = update?.pre_checkout_query;
  if (pre) {
    if (deps.billing?.preCheckout) await deps.billing.preCheckout(pre.id, true);
    return { preCheckout: pre.id };
  }
  /* ─── выбранный пункт инлайна (владелец, 2026-09-25) ───
     Приходит, только если в @BotFather включён отзыв инлайна
     (/setinlinefeedback). Черновик доски, ушедший в чат, помечается
     отправленным: срок и предел черновиков его больше не вытеснят — его
     ссылка у людей. Отвечать на это обновление нечем и некому. */
  const chosen = update?.chosen_inline_result;
  if (chosen) {
    const picked = /^board_(.+)$/.exec(String(chosen.result_id || ""));
    if (picked && deps.boards?.markDraftSent) await deps.boards.markDraftSent(picked[1]);
    return { chosen: String(chosen.result_id || "") };
  }
  const msg = update?.message;
  const edited = update?.edited_message;
  const cb = update?.callback_query;
  const inline = update?.inline_query;
  const from = msg?.from || edited?.from || cb?.from || inline?.from;
  if (!from) return { ignored: "no sender" };

  /* ─── группы: слушать и молчать ───
     Всё, что бот видит в группе, ложится на диск (lib/chatStore.js, E):
     помощник потом отвечает по этим чатам тем, кто в них состоит. Отвечать
     в группу бот не должен ничем — ни помощником, ни подсказкой, ни
     «только владельцу»: чат общий, а бот отвечает каждому про своё.
     Правка сообщения — тоже запись: та же строка с тем же id. Раньше
     identify: в группе никого не зовём и владельцем не делаем. */
  const inGroup = msg || edited;
  if (inGroup && isGroupChat(inGroup.chat)) {
    if (!deps.chats?.record) return { ignored: "group" };
    await deps.chats.record(inGroup);
    return { recorded: true };
  }
  // Правка личного сообщения — не новое сообщение: отвечать второй раз нечего.
  if (!msg && edited) return { ignored: "edited" };

  /* Кнопка под сообщением, ПЕРЕСЛАННЫМ в группу: Telegram сохраняет
     инлайн-клавиатуру при пересылке и доставляет нажатие исходному боту.
     Отвечать в группу нельзя ничем (см. выше), а ход сдачи и оценка
     постановки — личное дело того, кому поручена работа. Поэтому — ответ
     на само нажатие (его видит только нажавший) и ничего в чат. */
  if (cb && isGroupChat(cb.message?.chat)) {
    await answer(cb.id, "Кнопки работают только в личном чате с ботом");
    return { ignored: "group callback" };
  }

  // Позвать на созвон может любой, кого позвали в модель, — не только
  // владелец: иначе исполнитель не смог бы предложить встречу. Доски —
  // тот, кому открыт «Брейншторм» (см. onInline).
  if (inline) {
    if (!deps.calls && !deps.boards) return { ignored: "no calls" };
    await onInline(inline, from, deps);
    return { inline: String(from.id) };
  }

  const me = await org.identify(String(from.id), { name: nameOf(from), username: from.username });

  /* ─── ДИАЛОГИ (владелец, 2026-09-22, lib/dialogsUi.js) ───
     Забаненному бот не отвечает ничем — ни словом, ни кнопкой. «/dialogs»
     и кнопки под ним — только владельцу сценария; остальным — ничего.
     Ответ, которого ждал агент (ask_person), уходит ему, а не помощнику. */
  const dl = deps.dialogs;
  if (dl?.banned && await dl.banned(from.id)) {
    if (cb && answer) await answer(cb.id, "");
    return { ignored: "banned" };
  }
  if (cb && dl?.button && isDialogsAction(cb.data)) {
    if (!me.isOwner) return { ignored: "not owner" };
    return dl.button(cb, from);
  }
  if (msg && dl?.open && /^\/dialogs(?:@\w+)?\s*$/.test(String(msg.text || "").trim())) {
    if (!me.isOwner) return { ignored: "not owner" };
    await dl.open(from.id);
    return { dialogs: true };
  }
  if (msg && dl?.reply && me.known && String(msg.text || "").trim() && !/^\//.test(String(msg.text || "").trim())
    && await dl.reply(from, String(msg.text || "").trim())) {
    return { replied: true };
  }

  /* «/id» — всем, и незваным в первую очередь: именно незваного просят
     прислать боту /id, чтобы владелец мог позвать его по номеру. Раньше
     всего остального: внутри шага сдачи и у не-владельца команда обязана
     работать так же. Ничего чужого она не выдаёт — свой номер человек и
     так видит в любом клиенте. */
  if (msg && /^\/id\b/.test(String(msg.text || "").trim())) {
    await send(from.id, `Ваш id: ${from.id}`);
    return { told: String(from.id) };
  }

  /* Звёзды списаны: платёж — сервису кодов, он включает подписку. Ответ
     человеку — словами, что открылось. */
  if (msg?.successful_payment && deps.billing?.paid) {
    const sp = msg.successful_payment;
    const r = await deps.billing.paid(sp.invoice_payload, sp.telegram_payment_charge_id);
    if (r?.ok) {
      await send(from.id, `Оплата получена: план ${r.planName || r.plan} на ${r.days} дн. Откройте приложение — вкладки уже открыты.`);
      return { paid: sp.invoice_payload };
    }
    await send(from.id, `Оплата получена, но подписку включить не удалось: ${r?.error || "сервис кодов не ответил"}. Напишите владельцу.`);
    return { paid: sp.invoice_payload, error: r?.error || "codes" };
  }

  /* «/adminbot <токен>» — владелец присылает токен админ-бота подписок
     (владелец, 2026-09-21: «скажи мне, куда отправить токен бота, но
     чтобы не было сильно сложно»). Сервер кладёт его в .env, сервис
     кодов подхватывает в течение минуты. Только владельцу и только в
     личном чате — токен даёт власть над панелью. */
  const adminTok = msg && String(msg.text || "").trim().match(/^\/adminbot(?:\s+(\S+))?$/);
  if (adminTok) {
    if (!me.isOwner) { await send(from.id, "Эта команда — только владельцу."); return { ignored: "not owner" }; }
    const token = adminTok[1] || "";
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      await send(from.id, "Пришлите так: /adminbot 123456:токен_из_BotFather");
      return { ignored: "bad token" };
    }
    if (deps.settings?.setAdminBot) await deps.settings.setAdminBot(token);
    await send(from.id, "Токен админ-бота сохранён. Через минуту откройте того бота и нажмите /start — он пришлёт кнопку панели.");
    return { adminBot: true };
  }

  /* ─── кнопки под уведомлением о задаче ───

     Отвечают ВСЕМ позванным, а не одному владельцу: уведомление приходит
     тому, кому работа поручена, и кнопка под ним обязана работать у него.
     Проверку «своя ли задача» делает сам склад работы (`deferTask`,
     `takeTask` в `workspaceStore.js`) — там же, где она делается для
     нажатия на доске, чтобы два места не разошлись в правилах. */
  if (cb && deps.work && isTaskAction(cb.data)) {
    if (!me.known) {
      await answer(cb.id, "Вас ещё не звали в модель");
      return { ignored: "not invited" };
    }
    return onTaskButton(cb, from, deps);
  }

  /* Кнопки под статусом помощника — «✖ Отменить», «✎ Уточнить» — у любого
     позванного: вопрос задавал он, и ход вопроса его. Чей вопрос — сверяет
     сам помощник (lib/botAssistant.js). */
  if (cb && deps.assistant && isAssistantAction(cb.data)) {
    if (!me.known) {
      await answer(cb.id, "Вас ещё не звали в модель");
      return { ignored: "not invited" };
    }
    return onAssistantButton(cb, from, deps);
  }

  /* Файл или текст в ответ на вопрос сдачи — у любого позванного. Раньше
     команд и помощника: человек отвечает на вопрос бота, а не задаёт свой.
     null — открытого шага нет, сообщение разбирается дальше как обычно. */
  if (msg && me.known && deps.work) {
    const r = await onTaskMessage(msg, from, deps);
    if (r) return r;
  }

  /* ─── ПОМОЩНИК ВСЕМ ПОЗВАННЫМ, И ВЛАДЕЛЬЦУ ТОЖЕ (владелец, 2026-09-21:
     «если пользователь пишет что-то словами, значит реагировать должен
     ассистент») ───

     Прежде владелец до помощника доходил последним: сперва бот проверял
     пересылку, «id 123 Имя» и команды звонка, и только потом отдавал
     текст помощнику. Теперь проверять нечего — слова идут прямо к нему.
     Команды, пересылки и стикеры помощник возвращает как null, и они
     попадают в короткий ответ ниже. Незваному помощник не отвечает: у
     него нет ни модели, ни задач, и отвечать ему не из чего. */
  if (msg && me.known && deps.assistant) {
    const handled = await onAssistantMessage(msg, from, deps);
    if (handled) return handled;
  }

  /* Ссылка приглашения с договором: «/start agr_<токен>» — человек открыл
     бота по ссылке владельца. Соглашение становится его, роль —
     приготовленной; подписывать — в приложении. Раньше проверки «владелец
     ли»: приходит незваный. */
  const inv = msg && String(msg.text || "").trim().match(/^\/start\s+agr_([A-Za-z0-9_-]{6,80})$/);
  if (inv && deps.contracts?.claim) {
    try {
      await deps.contracts.claim(inv[1], { id: String(from.id), name: nameOf(from), username: from.username || "" });
      await send(from.id, [
        "Вам отправили договор.",
        "Откройте приложение: там нужно заполнить оставшиеся поля, поставить подпись и отправить —",
        "после этого откроется ваша роль.",
      ].join("\n"));
      return { claimed: inv[1] };
    } catch (e) {
      await send(from.id, `Не вышло: ${e.message}`);
      return { error: e.message };
    }
  }

  /* «/start» без хвоста — приветствие с кнопкой панели (владелец,
     2026-09-22: бот отвечал «Не разобрал»). Отвечаем и незваному: это
     первое, что нажимает любой, и ничего о модели здесь нет. */
  if (msg && /^\/start(?:@\w+)?\s*$/.test(String(msg.text || "").trim())) {
    const url = String(deps.publicUrl || "").replace(/\/+$/, "");
    const keyboard = url ? { inline_keyboard: [[{ text: "Open the panel", web_app: { url } }]] } : null;
    await send(from.id, WELCOME, keyboard);
    return { welcomed: true };
  }

  /* Незваному бот не отвечает содержательно: он не должен рассказывать
     постороннему, что у него вообще есть модель, роли и люди. */
  if (!me.known) {
    if (cb) await answer(cb.id, "Вас ещё не звали в модель");
    if (msg) await send(from.id, "Этот бот отвечает только участникам модели.");
    return { ignored: "not invited" };
  }

  if (cb) { await answer(cb.id, ""); return { ignored: "unknown callback" }; }
  await send(from.id, NOT_PARSED);
  return { helped: true };
}
