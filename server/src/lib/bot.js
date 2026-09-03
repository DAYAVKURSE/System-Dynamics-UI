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

import { CALL_APP_STEPS, callAppNameOk } from "./links.js";

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

   Ссылок в ней две, и вторая не для красоты. Первая открывает отдельное
   мини-приложение звонка — так и задумано, там надёжно работают камера и
   микрофон. Но она зависит от того, что владелец однажды завёл в @BotFather,
   и если там указан не тот адрес, Telegram показывает чёрный экран, по
   которому человеку нечего понять. Вторая ссылка ведёт на ту же страницу
   напрямую и не зависит ни от чего: по ней войдёт кто угодно, хоть вовсе
   без Telegram. Пусть лучше будет запасной выход, чем «у меня не
   открывается» посреди назначенной встречи. */
const meetingCard = (m, link, page) => [
  `📹 ${m.title}`,
  m.at ? `когда: ${m.at}` : "когда: договоримся в чате",
  "",
  `Подключиться: ${link}`,
  page && page !== link ? `Не открылось? Откройте страницей: ${page}` : "",
  link.startsWith("https://t.me/")
    ? "\nЗвонок откроется отдельным окном на пол-экрана — потяните вверх, чтобы развернуть."
    : "",
].filter(Boolean).join("\n");

async function onInline(q, from, { org, calls, answerInline, appLink, pageLink, botName }) {
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
  const page = pageLink ? pageLink(m.id) : "";
  return answerInline(q.id, [{
    type: "article",
    id: m.id,
    title: parsed.atText ? `${parsed.atText} — ${parsed.title}` : parsed.title,
    description: parsed.ok
      ? "Отправить приглашение со ссылкой на звонок"
      : "Время не разобрал — отправлю без него",
    input_message_content: { message_text: meetingCard(m, link, page),
      disable_web_page_preview: false },
    reply_markup: { inline_keyboard: [[{ text: "📹 Подключиться", url: link }]] },
  }], { cache_time: 0, is_personal: true });
}

/* ─────── мост к Claude Code ───────
   Только владельцу и только явной командой: «/claude вопрос» либо режим
   «/claude» без текста, когда каждое следующее сообщение уходит в мост.
   Явность здесь не формальность — иначе обычная переписка с ботом начала
   бы уезжать в чужой процесс. */

const bridgeMode = new Set();

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
  "Ещё умею передавать вопрос в ваш Claude Code: «/claude вопрос».",
  "«/claude» без текста включает режим, когда туда уходит каждое",
  "следующее сообщение; «/stop» его выключает.",
  "",
  "«/login» — вход в Claude Code прямо отсюда: пришлю ссылку, вы",
  "подтвердите и вставите код ответным сообщением — целиком, вместе",
  "с частью после «#». Ни SSH, ни компьютера для этого не нужно.",
  "",
  "«/callapp» — отдельное мини-приложение для звонков: расскажу, как",
  "завести его в @BotFather, и запомню короткое имя.",
].join("\n");

/**
 * Похоже ли сообщение на одноразовый код подтверждения Claude.
 *
 * Проверка нарочно узкая: длинная строка без пробелов из «код#состояние».
 * Обычная переписка так не выглядит, а перепутать значило бы не передать
 * человеку его же вопрос.
 */
export const looksLikeCode = (text) =>
  /^[A-Za-z0-9._~:+/=%-]{16,}#[A-Za-z0-9._~:+/=%-]{8,}$/.test(String(text || "").trim());

/** Пускает долгую работу дальше, не роняя бота на её ошибке. */
const detach = (p) => { p.catch(() => {}); return p; };

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
  const { org, send, bridge, login } = deps;
  const text = String(msg.text || "").trim();

  // 0. Настройка приложения звонка — раньше моста, иначе команда уехала бы
  //    в Claude Code обычным вопросом.
  if (deps.settings) {
    const m = text.match(/^\/callapp\b\s*([\s\S]*)$/i);
    if (m) return onCallApp(m[1], from, deps);
  }

  /* 1. Вход в Claude Code — тоже раньше моста: и «/login», и код
        подтверждения иначе уехали бы в мост обычным вопросом.

        Разговор с claude идёт долго (ссылка — секунды, проверка кода —
        тоже), а обновления Telegram обрабатываются по очереди. Поэтому
        сам разговор не ждём: бот остаётся живым и может, в частности,
        принять «/stop». Обещание отдаётся вызывающему в `done` — тестам
        есть чего дождаться. */
  if (login) {
    if (/^\/login\b/i.test(text)) return { login: "started", done: detach(onLogin(from, deps)) };
    // «/stop» отменяет вход на любой его стадии, не только пока ждём код:
    // проверка кода — как раз тот момент, когда отменить хочется сильнее.
    if (login.loginState().stage !== "idle" && /^\/(stop|cancel)\b/i.test(text)) {
      login.cancelLogin();
      await send(from.id, "Вход отменён.");
      return { login: "cancelled" };
    }
    if (login.awaitingCode() && text && !text.startsWith("/")) {
      return { login: "code", done: detach(onLoginCode(text, from, deps)) };
    }
    // Код, присланный без начатого входа (окно закрылось, вход отменили),
    // не должен уехать в Claude Code обычным вопросом: он одноразовый, но
    // до сих пор попадал и в чужой процесс, и в журнал воркера.
    if (looksLikeCode(text)) {
      await send(from.id, "Похоже на код подтверждения, но вход сейчас не начат"
        + " — он живёт несколько минут. Отправьте /login и повторите.");
      return { login: "stale-code" };
    }
  }

  // 2. Мост к Claude Code: в режиме моста сообщение уходит туда целиком,
  //    включая то, что похоже на команду.
  if (bridge) {
    const cmd = text.match(/^\/claude\b\s*([\s\S]*)$/i);
    if (cmd) {
      const rest = cmd[1].trim();
      if (!rest) {
        bridgeMode.add(String(from.id));
        await send(from.id, "Режим Claude Code включён: пишите вопрос обычным сообщением. «/stop» — выйти.");
        return { bridgeMode: "on" };
      }
      return askBridge(rest, from, deps);
    }
    if (/^\/stop\b/i.test(text) && bridgeMode.has(String(from.id))) {
      bridgeMode.delete(String(from.id));
      await send(from.id, "Режим Claude Code выключен.");
      return { bridgeMode: "off" };
    }
    if (bridgeMode.has(String(from.id)) && text && !msg.forward_from) {
      return askBridge(text, from, deps);
    }
  }

  // 3. Пересланное сообщение — основной путь.
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

  // 4. Ожидаем имя новой роли.
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

  // 5. Запасной путь: «id 123 Имя» — когда пересылка не сработала.
  const byId = text.match(/^id\s+(\d{3,20})\s*(.*)$/i);
  if (byId) {
    const roles = (await org.listOrg()).roles;
    pending.set(String(from.id), { id: byId[1], name: byId[2].trim() || byId[1],
      username: "", awaiting: "role" });
    await send(from.id, `Кого добавляем: ${byId[2].trim() || byId[1]} (id ${byId[1]}).\nВыберите роль:`,
      rolesKeyboard(roles));
    return { asked: byId[1] };
  }

  // 6. Свой номер — чтобы было что переслать владельцу.
  if (/^\/id\b/.test(text)) {
    await send(from.id, `Ваш id: ${from.id}`);
    return { told: String(from.id) };
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
  const { send, settings, botName = "", publicUrl = "" } = deps;
  const name = String(arg || "").trim().replace(/^@/, "");
  const steps = CALL_APP_STEPS.replace("{url}", `${publicUrl}/call`);

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
        "", steps].join("\n")
      : ["Отдельного приложения звонка пока нет, и ссылка ведёт на обычную",
        "страницу — в Telegram она откроется браузером, а камеру и микрофон",
        "он даёт не везде. Заведём мини-приложение — минута:",
        "", steps].join("\n"));
    return { callApp: now || "" };
  }

  if (!callAppNameOk(name)) {
    await send(from.id, "Короткое имя — латиница, цифры и «_», от 3 до 32 знаков."
      + " Например: call");
    return { error: "bad name" };
  }

  settings.setCallApp(name);
  await send(from.id, [
    `Запомнил: звонки открывает t.me/${botName}/${name}`,
    "",
    "Проверьте: позовите себя на встречу через инлайн-режим («@" + (botName || "бот")
      + " сегодня 18:00 проверка») и нажмите «Подключиться». Должно открыться",
    "окно звонка на пол-экрана, а не модель.",
    "",
    "Если Telegram скажет, что приложение не найдено, — короткое имя другое:"
      + " посмотрите его в @BotFather, /myapps.",
  ].join("\n"));
  return { callApp: name };
}

/* ─────── вход в Claude Code ───────
   Владелец жмёт ссылку, подтверждает и присылает код обратно сообщением.
   Токен в чат не уходит: сервер кладёт его в .env сам (см. lib/loginFlow.js).

   Код одноразовый и живёт минуты: если он не подошёл, старая ссылка уже
   бесполезна — второй код по ней не выдадут. Поэтому на любую осечку бот
   сразу присылает НОВУЮ ссылку, а не просит вспоминать про «/login». */

const CODE_STEPS = [
  "1. Откройте ссылку и подтвердите вход в свой аккаунт Claude.",
  "2. Скопируйте код целиком — вместе с длинной частью после «#».",
  "3. Пришлите его мне ответным сообщением, одной строкой.",
  "",
  "Код живёт несколько минут. «/stop» — отменить.",
].join("\n");

async function sendAuthLink(from, { send, login }, lead) {
  if (lead) await send(from.id, lead);
  try {
    const { url } = await login.startLogin();
    await send(from.id, CODE_STEPS, { inline_keyboard: [[{ text: "Войти в Claude", url }]] });
    return { login: "url" };
  } catch (e) {
    await send(from.id, `Вход не запустился: ${e.message}`);
    return { login: "error", error: e.message };
  }
}

async function onLogin(from, deps) {
  const { login } = deps;
  // Одно сообщение, а не два: «уже подключён, отправьте /login ещё раз» в
  // ответ на только что отправленный /login читалось как отказ.
  return sendAuthLink(from, deps, await login.loggedIn()
    ? "Claude Code уже подключён — обновляю вход, это несколько секунд…"
    : "Запускаю вход, это занимает несколько секунд…");
}

async function onLoginCode(code, from, deps) {
  const { send, login } = deps;
  await send(from.id, "Проверяю код…");
  try {
    const r = await login.finishLogin(code);
    await send(from.id, r.restarted
      ? "Готово: Claude Code подключён, черновики задач заработают сразу."
      : "Готово: Claude Code подключён. Черновики заработают в течение минуты.");
    return { login: "done", mode: r.mode };
  } catch (e) {
    // Осечка на коде — не тупик: старый код уже сгорел, поэтому выдаём
    // новую ссылку тем же сообщением, а не отсылаем к «/login».
    if (e.retry) return sendAuthLink(from, deps, `${e.message}. Вот новая ссылка:`);
    await send(from.id, `${e.message}\n\nПопробуйте ещё раз: /login`);
    return { login: "error", error: e.message };
  }
}

async function askBridge(text, from, { send, bridge }) {
  try {
    const item = bridge.ask({ text, from: from.id, chatId: from.id });
    await send(from.id, "Передал в Claude Code, жду ответ…");
    return { asked: item.id };
  } catch (e) {
    await send(from.id, `Не вышло: ${e.message}`);
    return { error: e.message };
  }
}

export function resetBridgeMode() { bridgeMode.clear(); }

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
