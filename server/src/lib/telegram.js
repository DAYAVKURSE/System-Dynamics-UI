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
  if (!res.ok || !data.ok) {
    // description Telegram объясняет причину: чаще всего пользователь не
    // начинал диалог с ботом (403 bot was blocked / chat not found).
    throw new Error(data.description || `Telegram ответил ${res.status}`);
  }
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
export async function getMe(token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => ({}));
  return data.ok ? data.result : null;
}
