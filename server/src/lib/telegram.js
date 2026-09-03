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
    + encodeURIComponent(JSON.stringify(["message", "callback_query", "inline_query"]));
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
    e.userMessage = "Файл слишком большой для отправки ботом.";
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

export async function getMe(token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => ({}));
  return data.ok ? data.result : null;
}
