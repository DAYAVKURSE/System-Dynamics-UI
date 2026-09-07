/* ════════════════════════════════════════════════════════════════
   БОТ · приглашение людей

   Владелец пересылает боту сообщение от человека — бот показывает роли
   кнопками, владелец выбирает или заводит новую. Всё остальное бот
   отклоняет: приглашать может только владелец, и это единственное, что
   он вообще умеет принимать.

   Про пересылку есть важная тонкость Telegram: `forward_from` приходит
   только если у человека не закрыт перенос в настройках приватности.
   Закрыт — приходит одно `forward_sender_name`, без id, и позвать по нему
   некого. Это не наша поломка, и молчать о ней нельзя: бот объясняет, что
   делать (попросить человека написать боту /id или прислать его номер).

   Вся логика — чистая функция `handleUpdate`: она получает обновление и
   зависимости (хранилище, отправку) аргументами, поэтому проверяется
   тестами, а не перепиской с живым ботом.
   ════════════════════════════════════════════════════════════════ */

import { CALL_APP_STEPS, CALL_MAIN_STEPS, callAppNameOk, isAppLink, isMainAppLink }
  from "./links.js";
import { isTaskAction, onTaskButton, onTaskMessage } from "./botTasks.js";
import { onAssistantMessage } from "./botAssistant.js";

// Роль, выбранная кнопкой: короткий префикс, чтобы влезть в 64 байта
// callback_data, которые разрешает Telegram.
const PICK = "r:";
const NEWROLE = "newrole";

const nameOf = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ")
  || u?.username || String(u?.id || "");

/** Ожидание ответа на «как назвать роль»: кого зовём, пока имя не пришло. */
const pending = new Map();

/* Последняя встреча, заведённая инлайн-запросом, — на человека.

   Telegram присылает инлайн-запрос на КАЖДОЕ нажатие клавиши. Заводить на
   каждое по встрече — значит за один вечер вытеснить из хранилища все
   прежние вместе с их ссылками (там предел в 500 записей). Пока человек
   дописывает одну и ту же фразу, правится одна и та же встреча; новая
   фраза или пауза в несколько минут — новая встреча. */
const inlineDraft = new Map();   // id пользователя → { id, query, at }
const INLINE_REUSE_MS = 3 * 60 * 1000;

export function resetPending() { pending.clear(); inlineDraft.clear(); }

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

const HELP = [
  "Я умею одно: добавлять людей в модель.",
  "",
  "Перешлите мне сообщение от человека, которого хотите добавить, —",
  "я предложу выбрать роль.",
  "",
  "Если пересылка не сработает (у человека закрыт перенос в настройках",
  "приватности), попросите его прислать мне /id и пришлите этот номер",
  "сообщением вида: id 123456789 Имя",
  "",
  "«/callapp» — отдельное мини-приложение для звонков: расскажу, как",
  "завести его в @BotFather, и запомню короткое имя.",
  "",
  "«/callmain» — если на ТЕЛЕФОНЕ звонок открывается на весь экран, а",
  "хочется на половину: расскажу, как сделать его главным приложением",
  "бота. На компьютере половины нет ни у какого мини-приложения.",
  "",
  "Любой другой текст — вопрос помощнику: он знает вашу модель и задачи.",
  "«запомни: …» или присланный документ — в память помощника.",
].join("\n");

const rolesKeyboard = (roles) => ({
  inline_keyboard: [
    ...roles.map((r) => [{ text: r.name, callback_data: PICK + r.id }]),
    [{ text: "+ новая роль", callback_data: NEWROLE }],
  ],
});

/**
 * @param update  объект обновления Telegram
 * @param deps    { org, send, answer } — хранилище и две отправки
 */
export async function handleUpdate(update, deps) {
  const { org, send, answer } = deps;
  const msg = update?.message;
  const cb = update?.callback_query;
  const inline = update?.inline_query;
  const from = msg?.from || cb?.from || inline?.from;
  if (!from) return { ignored: "no sender" };

  // Позвать на созвон может любой, кого позвали в модель, — не только
  // владелец: иначе исполнитель не смог бы предложить встречу.
  if (inline) {
    if (!deps.calls) return { ignored: "no calls" };
    await onInline(inline, from, deps);
    return { inline: String(from.id) };
  }

  const me = await org.identify(String(from.id), { name: nameOf(from), username: from.username });

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

  /* Файл или текст в ответ на вопрос сдачи — у любого позванного. Раньше
     команд и помощника: человек отвечает на вопрос бота, а не задаёт свой.
     null — открытого шага нет, сообщение разбирается дальше как обычно. */
  if (msg && me.known && deps.work) {
    const r = await onTaskMessage(msg, from, deps);
    if (r) return r;
  }

  /* ─── помощник для позванных не-владельцев ───
     Бот перестал быть «только для владельца»: тому, кому поручена работа,
     на обычный текст и документ отвечает помощник — по его данным (см.
     lib/botAssistant.js). Команды и пересылки он возвращает как null, и
     они попадают в отказ ниже, как прежде. */
  if (msg && me.known && !me.isOwner && deps.assistant) {
    const handled = await onAssistantMessage(msg, from, deps);
    if (handled) return handled;
  }

  if (!me.isOwner) {
    // Чужим не отвечаем содержательно: бот не должен рассказывать
    // постороннему, что у него вообще есть роли и люди.
    if (msg) await send(from.id, "Этот бот отвечает только владельцу модели.");
    if (cb) await answer(cb.id, "Только владелец");
    return { ignored: "not owner" };
  }

  if (cb) return onCallback(cb, from, deps);
  return onMessage(msg, from, deps);
}

async function onMessage(msg, from, deps) {
  const { org, send } = deps;
  const text = String(msg.text || "").trim();

  // 1. Настройка приложения звонка.
  if (deps.settings) {
    const m = text.match(/^\/callapp\b\s*([\s\S]*)$/i);
    if (m) return onCallApp(m[1], from, deps);
    const main = text.match(/^\/callmain\b\s*([\s\S]*)$/i);
    if (main) return onCallMain(main[1], from, deps);
  }

  // 2. Пересланное сообщение — основной путь.
  const fwd = msg.forward_from;
  if (fwd) {
    const roles = (await org.listOrg()).roles;
    pending.set(String(from.id), { id: String(fwd.id), name: nameOf(fwd),
      username: fwd.username || "", awaiting: "role" });
    await send(from.id, `Кого добавляем: ${nameOf(fwd)} (id ${fwd.id}).\nВыберите роль:`,
      rolesKeyboard(roles));
    return { asked: String(fwd.id) };
  }
  if (msg.forward_sender_name || msg.forward_origin?.type === "hidden_user") {
    await send(from.id, [
      `У «${msg.forward_sender_name || msg.forward_origin?.sender_user_name}» закрыт`,
      "перенос сообщений, поэтому Telegram не сообщает его id — добавить по",
      "такой пересылке нельзя.",
      "",
      "Попросите человека открыть бота и отправить /id, а потом пришлите мне:",
      "id 123456789 Имя",
    ].join("\n"));
    return { blocked: "hidden" };
  }

  // 3. Ожидаем имя новой роли.
  const wait = pending.get(String(from.id));
  if (wait?.awaiting === "roleName" && text) {
    try {
      const role = await org.addRole({ name: text });
      await org.addUser({ id: wait.id, name: wait.name, username: wait.username,
        roleId: role.id, addedBy: from.id });
      pending.delete(String(from.id));
      await send(from.id, `Готово: ${wait.name} — «${role.name}».`);
      return { added: wait.id, role: role.id };
    } catch (e) {
      await send(from.id, `Не вышло: ${e.message}. Пришлите другое название.`);
      return { error: e.message };
    }
  }

  // 4. Запасной путь: «id 123 Имя» — когда пересылка не сработала.
  const byId = text.match(/^id\s+(\d{3,20})\s*(.*)$/i);
  if (byId) {
    const roles = (await org.listOrg()).roles;
    pending.set(String(from.id), { id: byId[1], name: byId[2].trim() || byId[1],
      username: "", awaiting: "role" });
    await send(from.id, `Кого добавляем: ${byId[2].trim() || byId[1]} (id ${byId[1]}).\nВыберите роль:`,
      rolesKeyboard(roles));
    return { asked: byId[1] };
  }

  // 5. Свой номер — чтобы было что переслать владельцу.
  if (/^\/id\b/.test(text)) {
    await send(from.id, `Ваш id: ${from.id}`);
    return { told: String(from.id) };
  }

  // 6. Всё остальное — вопрос помощнику («запомни: …» и документ — в память).
  //    Подсказка остаётся для команд и пустых сообщений: их помощник не
  //    берёт и возвращает null.
  if (deps.assistant) {
    const handled = await onAssistantMessage(msg, from, deps);
    if (handled) return handled;
  }

  await send(from.id, HELP);
  return { helped: true };
}

/* ─────── отдельное мини-приложение звонка ───────
   Ссылка на звонок открывает мини-приложение, только если оно заведено в
   @BotFather: создать его через Bot API нельзя вовсе — такого метода нет.
   Зато можно не гонять владельца в GitHub за секретом: короткое имя он
   присылает сюда, а сервер кладёт его в .env, откуда и читает ссылку.
   Деплой это значение сохраняет. */

async function onCallApp(arg, from, deps) {
  const { send, settings, botName = "", publicUrl = "", appLink } = deps;
  const name = String(arg || "").trim().replace(/^@/, "");
  const steps = CALL_APP_STEPS.replace("{url}", `${publicUrl}/call`);
  // Что уходит в приглашение НА САМОМ ДЕЛЕ. Собирать ответ руками — значит
  // рассказывать про отдельное приложение и тогда, когда включено главное
  // («/callmain on») или когда ссылка вообще свалилась на страницу.
  const live = appLink ? appLink("abc") : "";
  const branch = !live ? ""
    : isMainAppLink(live)
      ? "Сейчас приглашения открывают ГЛАВНОЕ приложение бота — так решает «/callmain»."
      : isAppLink(live)
        ? ""
        : "Но приглашения сейчас ведут на обычную страницу, а не в приложение:"
          + " проверьте, что бот знает своё имя и задан PUBLIC_URL.";

  if (!name) {
    const now = settings.getCallApp();
    await send(from.id, now
      ? [`Звонок открывает приложение «${now}»:`,
        `t.me/${botName}/${now}?startapp=call_…`,
        "",
        `Если оно показывает пустое окно — проверьте его адрес в @BotFather`,
        `(/myapps → ${now} → Edit Web App URL). Должен быть ровно:`,
        `${publicUrl}/call`,
        "Доменом, а не IP: по IP сертификат не подходит, и Telegram молча",
        "показывает пустое окно.",
        "",
        "Сменить имя — пришлите «/callapp другое-имя». Завести заново:",
        "", steps, ...(branch ? ["", branch] : [])].join("\n")
      : ["Отдельного приложения звонка пока нет, и ссылка ведёт на обычную",
        "страницу — в Telegram она откроется браузером, а камеру и микрофон",
        "он даёт не везде. Заведём мини-приложение — минута:",
        "", steps].join("\n"));
    return { callApp: now || "" };
  }

  // Приложение можно и удалить в @BotFather — тогда имя надо забыть, иначе
  // приглашение поведёт на несуществующее, и Telegram скажет только
  // «приложение не найдено».
  if (/^(-|нет|off|удали|забудь)$/i.test(name)) {
    settings.setCallApp("");
    await send(from.id, ["Забыл имя приложения звонка.",
      "",
      settings.getCallMain?.()
        ? "Приглашения открывают главное приложение бота — их это не задевает."
        : "Теперь приглашения ведут на обычную страницу: она откроется"
          + " браузером, во весь экран, и камеру он даёт не везде."
          + " Завести приложение заново — «/callapp», сделать звонок главным"
          + " приложением — «/callmain»."].join("\n"));
    return { callApp: "" };
  }

  if (!callAppNameOk(name)) {
    await send(from.id, "Короткое имя — латиница, цифры и «_», от 3 до 32 знаков."
      + " Например: call. Удалили приложение в @BotFather — пришлите «/callapp -»,"
      + " и я забуду имя.");
    return { error: "bad name" };
  }

  settings.setCallApp(name);
  await send(from.id, [
    `Запомнил: звонки открывает t.me/${botName}/${name}`,
    "",
    "Проверьте: позовите себя на встречу через инлайн-режим («@" + (botName || "бот")
      + " сегодня 18:00 проверка») и нажмите «Подключиться». Должно открыться",
    "окно звонка, а не модель.",
    "",
    "Оно откроется во весь экран: половину Telegram отдельным приложениям не",
    "делает. Нужна половина — «/callmain», но и там она только на телефоне.",
    "",
    "Если Telegram скажет, что приложение не найдено, — короткое имя другое:"
      + " посмотрите его в @BotFather, /myapps.",
  ].join("\n"));
  return { callApp: name };
}

async function onCallback(cb, from, { org, send, answer }) {
  const data = String(cb.data || "");
  const wait = pending.get(String(from.id));
  if (!wait) {
    await answer(cb.id, "Не помню, кого добавляем — перешлите сообщение заново");
    return { stale: true };
  }

  if (data === NEWROLE) {
    pending.set(String(from.id), { ...wait, awaiting: "roleName" });
    await answer(cb.id, "");
    await send(from.id, "Как назвать роль? Пришлите название одним сообщением.");
    return { asking: "roleName" };
  }

  if (data.startsWith(PICK)) {
    const roleId = data.slice(PICK.length);
    try {
      await org.addUser({ id: wait.id, name: wait.name, username: wait.username,
        roleId, addedBy: from.id });
      const role = (await org.listOrg()).roles.find((r) => r.id === roleId);
      pending.delete(String(from.id));
      await answer(cb.id, "Добавлен");
      await send(from.id, `Готово: ${wait.name} — «${role?.name || roleId}».`);
      return { added: wait.id, role: roleId };
    } catch (e) {
      await answer(cb.id, "Не вышло");
      await send(from.id, `Не вышло: ${e.message}`);
      return { error: e.message };
    }
  }

  await answer(cb.id, "");
  return { ignored: "unknown callback" };
}

/* ─────── звонок как главное приложение бота ───────

   Единственная причина этой команды — высота окна. Отдельное приложение
   звонка (/newapp) открывается только на весь экран: Telegram Desktop для
   таких ссылок compact не реализует вовсе, а телефон берёт высоту из
   ответа сервера, а не из ссылки (подробно и со ссылками на исходники —
   в lib/links.js). У главного приложения обе дороги открыты.

   Включать вслепую нельзя: если главное приложение в @BotFather не
   заведено, ссылка t.me/<бот>?startapp=… молча превращается в ссылку на
   чат с ботом, и по приглашению не открывается НИЧЕГО. Поэтому перед тем
   как запомнить настройку, бот спрашивает у Telegram (getMe →
   has_main_web_app), заведено ли оно на самом деле. */

async function onCallMain(arg, from, deps) {
  const { send, settings, botName = "", publicUrl = "" } = deps;
  const want = String(arg || "").trim().toLowerCase();
  const steps = CALL_MAIN_STEPS.replace("{url}", `${publicUrl}/call`);
  const on = Boolean(settings.getCallMain?.());
  const app = settings.getCallApp?.() || "";

  if (want === "off") {
    settings.setCallMain?.(false);
    await send(from.id, [
      "Выключил: приглашения снова открывают отдельное приложение звонка"
        + (app ? ` (t.me/${botName}/${app})` : " — а его нет, так что ссылка ведёт на страницу"),
      "",
      "Оно откроется на весь экран — половину умеет только главное"
        + " приложение. Вернуть: «/callmain on».",
    ].join("\n"));
    return { callMain: false };
  }

  if (want !== "on") {
    await send(from.id, on
      ? [`Звонок открывает главное приложение бота: t.me/${botName}?startapp=call_…`,
        "",
        "На телефоне окно должно открываться на пол-экрана. Если оно всё",
        "равно во весь — проверьте в @BotFather (Bot Settings → Configure",
        "Mini App), что там выбрана половина: телефон берёт высоту из ответа",
        "Telegram, а им управляет именно эта настройка, а не ссылка.",
        "",
        "На компьютере окно останется во весь экран в любом случае —",
        "половины там нет ни у какого мини-приложения. Его можно потянуть",
        "мышью за край, и это всё, что Telegram Desktop умеет.",
        "",
        "Вернуть отдельное приложение — «/callmain off»."].join("\n")
      : ["Сейчас звонок открывается во весь экран, и отдельное приложение",
        "по-другому не умеет: на компьютере половины нет вообще ни у какого",
        "мини-приложения, а на телефоне высоту диктует не ссылка, а ответ",
        "Telegram (mode=compact там до сих пор не работает — открытая ошибка",
        "bugs.telegram.org/c/45743).",
        "",
        "На ТЕЛЕФОНЕ половина получится, если то же окно звонка сделать",
        "главным приложением бота: тогда высотой начинает управлять его",
        "настройка в @BotFather. Это минута:",
        "", steps, "", checkStep(botName)].join("\n"));
    return { callMain: on };
  }

  // Проверяем у самого Telegram. Не ответил — не включаем: включить вслепую
  // значит разменять «окно на весь экран» на «не открывается ничего».
  let ready = null;
  try { ready = await settings.mainAppReady?.(); } catch { ready = null; }
  if (ready === null || ready === undefined) {
    await send(from.id, "Не смог спросить у Telegram, заведено ли главное"
      + " приложение. Ничего не менял — повторите «/callmain on» через минуту.");
    return { error: "no answer" };
  }
  if (!ready) {
    await send(from.id, ["Telegram говорит, что главного приложения у бота нет.",
      "Ссылка на него открывала бы просто чат с ботом, поэтому не включаю.",
      "", "Заводится оно так:", "", steps].join("\n"));
    return { error: "no main app" };
  }

  settings.setCallMain?.(true);
  await send(from.id, [
    `Готово: приглашения открывают t.me/${botName}?startapp=call_…`,
    "",
    checkStep(botName),
    "",
    "Потом позовите себя на встречу («@" + (botName || "бот")
      + " сегодня 18:00 проверка») и нажмите «Подключиться»:",
    "на телефоне окно должно открыться на пол-экрана.",
    "",
    "Проверять — именно на телефоне: на компьютере окно останется во весь",
    "экран, половины там нет ни у какого мини-приложения.",
    "",
    "Если и на телефоне во весь — высоту решает не ссылка, а настройка",
    "приложения: @BotFather → Bot Settings → Configure Mini App, выберите",
    "половину экрана. И закройте окно звонка полностью перед проверкой:",
    "свёрнутое Telegram открывает в той же высоте, что и было.",
    "",
    "Передумаете — «/callmain off».",
  ].join("\n"));
  return { callMain: true };
}

/**
 * Проверка своими глазами: точно ли главное приложение — это окно звонка.
 *
 * Спросить у Telegram нечего: getMe отвечает только «есть/нет», а какой у
 * приложения адрес — не говорит ни один метод Bot API. А промахнуться
 * легко: у главного приложения бота вполне может быть записана модель, и
 * тогда приглашение на звонок открывало бы её — ровно то, чего быть не
 * должно. Зато отличить их глазами просто: без номера встречи окно звонка
 * само говорит, что ссылка неполная, а модель показывает модель.
 */
const checkStep = (botName) => [
  `Убедитесь, что это и правда окно звонка: откройте t.me/${botName || "бот"}?startapp=check`,
  "Должна открыться тёмная страница со словами «Ссылка на звонок неполная»",
  "— это и есть окно звонка. Если открылась модель, значит в @BotFather у",
  "главного приложения записан её адрес: поменяйте на адрес звонка.",
].join("\n");
