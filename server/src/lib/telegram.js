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
