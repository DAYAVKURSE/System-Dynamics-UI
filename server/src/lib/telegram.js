/* Отправка обычных текстовых сообщений через Bot API.
   Напоминания приходят как простое сообщение от бота — без разметки и
   кнопок, поэтому произвольный текст задачи ничего не может сломать. */

export async function sendMessage(chatId, text, token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
  });

  const data = await res.json().catch(() => ({}));
  // Чаще всего причина человеческая — не открыт чат с ботом. Тогда у ошибки
  // есть userMessage, и её можно показать словами (см. telegramError ниже).
  if (!res.ok || !data.ok) throw telegramError(data.description, res.status);
  return data.result;
}

/* Клавиатура нужна только приглашению из бота, поэтому отдельным
   аргументом: обычные напоминания как были простым текстом, так и
   остались — произвольный текст задачи ничего не может сломать. */
export async function sendWithKeyboard(chatId, text, keyboard,
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text,
      ...(keyboard ? { reply_markup: keyboard } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram ответил ${res.status}`);
  return data.result;
}

/**
 * Правит уже отправленное сообщение бота — текст и кнопки под ним.
 *
 * Шаги сдачи в чате идут один за другим, и каждый новым сообщением
 * растянул бы переписку на экран: нажатие правит то сообщение, на котором
 * была кнопка. Пустой `text` значит «текст тот же» — тогда меняются только
 * кнопки (editMessageReplyMarkup): Telegram отвечает ошибкой на правку, в
 * которой ничего не изменилось, и слать ему прежний текст незачем.
 * `keyboard` = null убирает кнопки. Ответ «message is not modified» — не
 * ошибка: показано ровно то, что и хотели.
 */
export async function editMessage(chatId, messageId, text, keyboard = null,
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const sameText = text == null || text === "";
  const method = sameText ? "editMessageReplyMarkup" : "editMessageText";
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, message_id: messageId,
      ...(sameText ? {} : { text }),
      reply_markup: keyboard || { inline_keyboard: [] },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    if (/not modified/i.test(String(data.description || ""))) return null;
    throw telegramError(data.description, res.status);
  }
  return data.result;
}

/**
 * Забирает присланный человеку файл: сначала getFile — путь на серверах
 * Telegram, потом сам файл по этому пути. Имя и тип — те, что известны
 * Telegram (имя из пути, тип из заголовка ответа); документ несёт свои
 * `file_name` и `mime_type`, и вызывающий код подставляет их сам.
 *
 * Предел Bot API на скачивание — 20 МБ: файл больше Telegram не отдаёт, и
 * ошибка про это приходит человеку словами (см. telegramError).
 */
export async function getFile(fileId, token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw telegramError(data.description, res.status);
  const filePath = String(data.result?.file_path || "");
  if (!filePath) throw new Error("Telegram не назвал путь к файлу");
  const dl = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!dl.ok) throw new Error(`Telegram не отдал файл (${dl.status})`);
  const bytes = Buffer.from(await dl.arrayBuffer());
  return {
    bytes,
    name: filePath.split("/").pop() || "файл",
    type: String(dl.headers.get("content-type") || "").split(";")[0].trim()
      || "application/octet-stream",
  };
}

/** Ответ на нажатие кнопки: без него Telegram крутит часики на кнопке. */
export async function answerCallback(id, text = "",
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) return null;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  }).catch(() => {});
  return null;
}

/**
 * Длинный опрос обновлений. Вебхук потребовал бы регистрации адреса и
 * ломался бы при каждой смене домена; опрос работает где угодно и ничего
 * о себе не сообщает наружу.
 */
export async function getUpdates(offset, timeout = 25,
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const url = `https://api.telegram.org/bot${token}/getUpdates`
    + `?timeout=${timeout}${offset ? `&offset=${offset}` : ""}`
    + "&allowed_updates="
    // edited_message — ради чатов групп: правка сообщения ложится в
    // хранилище новой строкой (lib/chatStore.js), иначе помощник цитировал
    // бы то, что человек уже исправил.
    + // pre_checkout_query — оплата звёздами: без ответа на него платёж не пройдёт.
    + encodeURIComponent(JSON.stringify(["message", "edited_message", "callback_query", "inline_query", "pre_checkout_query"]));
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram ответил ${res.status}`);
  return data.result || [];
}

/** Ответ на инлайн-запрос: список карточек, которые показывает Telegram. */
export async function answerInline(id, results, extra = {},
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/answerInlineQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inline_query_id: id, results, cache_time: 0, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  // Инлайн-ответ живёт секунды: если опоздали, Telegram отвечает ошибкой, и
  // ронять на этом опрос обновлений незачем.
  if (!res.ok || !data.ok) console.warn(`[bot] инлайн-ответ не принят: ${data.description || res.status}`);
  return data.result;
}

/** Имя бота — из него собирается ссылка на мини-приложение. */
/* ─────── файл в чат ───────

   Записи созвонов живут на диске сервера, а забирать их владелец хочет
   туда, где он и так сидит, — в чат с ботом. Bot API принимает файл только
   как multipart/form-data; в Node это FormData и Blob из стандартной
   библиотеки, никаких зависимостей.

   Предел у бота — 50 МБ на документ, а запись бывает и под сотню: в этом
   случае звать sendDocument бессмысленно, и вызывающий код шлёт ссылку.
   Предел назван здесь, чтобы решение принималось в одном месте. */

export const MAX_BOT_DOCUMENT_BYTES = 50 * 1024 * 1024;

/**
 * Ошибка Telegram, переведённая на человеческий.
 *
 * `userMessage` заполнено, только когда причина В ЧЕЛОВЕКЕ и он может её
 * устранить. Сломанная настройка сервера пользователю ничего не говорит и
 * не должна выглядеть его виной — такая ошибка идёт как есть, в журнал.
 */
function telegramError(description, status) {
  const d = String(description || "");
  const e = new Error(d || `Telegram ответил ${status}`);
  if (/chat not found|bot can't initiate|user is deactivated/i.test(d)) {
    e.userMessage = "Бот не может написать вам первым. Откройте чат с ботом,"
      + " нажмите «Запустить» и повторите.";
  } else if (/blocked by the user/i.test(d)) {
    e.userMessage = "Вы заблокировали бота — разблокируйте его, и запись придёт в чат.";
  } else if (/too large|entity too large|file is too big/i.test(d)) {
    // Одна и та же причина в обе стороны: бот не отправит больше 50 МБ и
    // не заберёт у Telegram больше 20 МБ.
    e.userMessage = "Файл слишком большой для бота.";
  }
  return e;
}

/**
 * Отправляет файл в чат.
 *
 * `blob` — предпочтительный способ: файл читается с диска потоком, а не
 * копируется в память целиком. `bytes` оставлен для короткого содержимого.
 */
export async function sendDocument(chatId, { blob, bytes, name, type, caption = "" },
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const body = blob || (bytes?.length
    ? new Blob([bytes], { type: type || "application/octet-stream" })
    : null);
  if (!body) throw new Error("файл пуст");
  if (body.size > MAX_BOT_DOCUMENT_BYTES) {
    throw Object.assign(new Error("файл больше 50 МБ — бот такой не отправит"), { tooBig: true });
  }
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (caption) form.set("caption", caption.slice(0, 1024));
  form.set("document", body, name);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST", body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw telegramError(data.description, res.status);
  return data.result;
}

/**
 * Отправляет картинку в чат — как фото, а не как файл: снимок экрана
 * должен быть виден в переписке сразу, без скачивания.
 */
export async function sendPhoto(chatId, { bytes, name = "screen.png", caption = "" },
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  if (!bytes?.length) throw new Error("картинка пуста");
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (caption) form.set("caption", caption.slice(0, 1024));
  form.set("photo", new Blob([bytes], { type: "image/png" }), name);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST", body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw telegramError(data.description, res.status);
  return data.result;
}

/**
 * Состоит ли человек в чате — прямо сейчас, по слову Telegram.
 *
 * Спрашивается перед тем, как сообщения группы попадут в контекст его
 * помощника (lib/chatStore.js). Ответ «да» — только для member,
 * administrator и creator; выгнанный, вышедший, ошибка сети, нет токена —
 * всё «нет»: лишний чужой чат в контексте хуже, чем недостающий свой.
 * Ошибкой не бросается нарочно: одна недоступная группа не должна
 * ронять весь контекст.
 */
/* Сколько ждать ответа про членство. Спрашивается на КАЖДЫЙ вопрос
   помощнику, по каждому чату, а очередь вопросов одна на всех: без предела
   молчащий Telegram (принял соединение и не отвечает — так ведёт себя
   перегруженный api.telegram.org или прокси) держал бы её до 5 минут,
   пока undici не сдастся сам, и все, кто спросил после, ждали бы тоже.
   Не ответил за 5 с — «не состоит»: лишний чат хуже недостающего. */
export const CHAT_MEMBER_TIMEOUT_MS = 5000;

export async function getChatMember(chatId, userId, token = process.env.TELEGRAM_BOT_TOKEN,
  timeoutMs = CHAT_MEMBER_TIMEOUT_MS) {
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: Number(userId) || userId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return false;
    return ["member", "administrator", "creator"].includes(String(data.result?.status || ""));
  } catch {
    return false;
  }
}

export async function getMe(token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => ({}));
  return data.ok ? data.result : null;
}

/* ─────── оплата звёздами (владелец, 2026-09-21) ───────
   Инвойс в Telegram Stars: валюта XTR, цена — в звёздах, `payload` —
   id платежа в сервисе кодов. Ссылку открывает мини-приложение
   (`openInvoice`); после оплаты Telegram присылает боту
   `pre_checkout_query` (надо ответить «ок») и `successful_payment`. */
export async function createInvoiceLink({ title, description, payload, amount },
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const res = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: String(title).slice(0, 32), description: String(description || title).slice(0, 255),
      payload: String(payload), currency: "XTR", prices: [{ label: String(title).slice(0, 32), amount: Math.max(1, Math.round(amount)) }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw telegramError(data.description, res.status);
  return data.result;
}
export async function answerPreCheckout(id, ok = true, error = "",
  token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const res = await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pre_checkout_query_id: id, ok, ...(ok ? {} : { error_message: error }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw telegramError(data.description, res.status);
  return data.result;
}
