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
   подсказка, а отдельный способ позвать на созвон прямо из чата.

   Вся логика — чистая функция `handleUpdate`: она получает обновление и
   зависимости (хранилище, отправку) аргументами, поэтому проверяется
   тестами, а не перепиской с живым ботом.

   В группах бот только слушает: записывает (deps.chats) и молчит — см.
   начало handleUpdate.
   ════════════════════════════════════════════════════════════════ */

import { isTaskAction, onTaskButton, onTaskMessage } from "./botTasks.js";
import { isAssistantAction, onAssistantButton, onAssistantMessage } from "./botAssistant.js";

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

/* Имя осталось прежним: его зовут тесты, а чистить теперь нечего,
   кроме черновика инлайн-встречи. */
export function resetPending() { inlineDraft.clear(); }

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

async function onInline(q, from, { org, calls, answerInline, appLink, botName }) {
  const parsed = calls.parseMeeting(q.query || "");
  // claim: false — набранный в чужом чате инлайн-запрос не должен делать
  // человека владельцем модели, даже если владелец ещё не назначен.
  const me = await org.identify(String(from.id), { name: nameOf(from), username: from.username },
    { claim: false });
  if (!me.known) {
    return answerInline(q.id, [], {
      button: { text: "Вас ещё не позвали в модель", start_parameter: "start" },
    });
  }
  if (!q.query || !q.query.trim()) {
    return answerInline(q.id, [{
      type: "article", id: "hint", title: "Напишите время и тему",
      description: "например: завтра 15:00 разбор прогноза",
      input_message_content: { message_text:
        "Наберите после имени бота время и тему: «завтра 15:00 разбор прогноза»." },
    }]);
  }

  // Встреча заводится сразу: ссылка должна работать в тот момент, когда
  // сообщение уже отправлено, а второго шага «подтвердите» в инлайне нет.
  // Но пока человек дописывает ту же фразу — правится одна запись, а не
  // заводится по встрече на нажатие клавиши.
  const typed = String(q.query || "").trim();
  const prev = inlineDraft.get(String(from.id));
  const now = Date.now();
  const sameBurst = prev && now - prev.at < INLINE_REUSE_MS
    && (typed.startsWith(prev.query) || prev.query.startsWith(typed));
  const fields = { title: parsed.title, at: parsed.atText, text: parsed.text };
  const m = (sameBurst && await calls.updateMeeting(prev.id, fields))
    || await calls.createMeeting({ ...fields, by: from.id });
  inlineDraft.set(String(from.id), { id: m.id, query: typed, at: now });
  const link = appLink(m.id);
  return answerInline(q.id, [{
    type: "article",
    id: m.id,
    title: parsed.atText ? `${parsed.atText} — ${parsed.title}` : parsed.title,
    description: parsed.ok
      ? "Отправить приглашение со ссылкой на звонок"
      : "Время не разобрал — отправлю без него",
    input_message_content: { message_text: meetingCard(m),
      // Превью — ещё одна крупная цель, ведущая на страницу, а не в
      // мини-приложение. Ради него терять окно звонка незачем.
      disable_web_page_preview: true },
    reply_markup: { inline_keyboard: meetingButtons(link) },
  }], { cache_time: 0, is_personal: true });
}

/* Что сказать на то, чего бот не разобрал: стикер, фото вне шага сдачи,
   пересылка, незнакомая команда. Одна строка, а не список умений: слова
   уходят помощнику и до этого места не доходят. */
const NOT_PARSED = "Не разобрал.";

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
  // владелец: иначе исполнитель не смог бы предложить встречу.
  if (inline) {
    if (!deps.calls) return { ignored: "no calls" };
    await onInline(inline, from, deps);
    return { inline: String(from.id) };
  }

  const me = await org.identify(String(from.id), { name: nameOf(from), username: from.username });

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
