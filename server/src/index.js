import "dotenv/config";
import { createApp } from "./app.js";
import { runTick } from "./lib/scheduler.js";
import { store } from "./lib/scheduleStore.js";
import { answerCallback, getUpdates, sendMessage, sendWithKeyboard } from "./lib/telegram.js";
import { handleUpdate } from "./lib/bot.js";
import * as org from "./lib/orgStore.js";

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`System Dynamics UI server listening on port ${PORT}`);
});

/* Планировщик напоминаний: раз в минуту смотрит расписания всех
   пользователей и отправляет то, чему пришло время. Без токена бота слать
   некуда, поэтому не запускается вовсе. */
const TICK_MS = 60 * 1000;
if (process.env.TELEGRAM_BOT_TOKEN) {
  const tick = async () => {
    try {
      const sent = await runTick({
        store, send: sendMessage, log: (m) => console.warn(`[scheduler] ${m}`),
      });
      if (sent) console.log(`[scheduler] отправлено напоминаний: ${sent}`);
    } catch (e) {
      // Планировщик не должен ронять процесс: приложение важнее напоминаний.
      console.error(`[scheduler] тик не выполнен: ${e.message}`);
    }
  };
  setInterval(tick, TICK_MS);
  tick();
  console.log("Планировщик напоминаний запущен (тик раз в минуту)");
} else {
  console.log("TELEGRAM_BOT_TOKEN не задан — планировщик напоминаний выключен");
}

/* Бот принимает одно: приглашение людей владельцем. Длинный опрос — цикл
   без таймера: следующий запрос уходит сразу после предыдущего ответа,
   поэтому нажатие кнопки не ждёт до минуты. */
if (process.env.TELEGRAM_BOT_TOKEN) {
  let offset = 0;
  const loop = async () => {
    for (;;) {
      try {
        const updates = await getUpdates(offset);
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handleUpdate(u, {
              org,
              send: (chatId, text, keyboard) => sendWithKeyboard(chatId, text, keyboard),
              answer: answerCallback,
            });
          } catch (e) {
            console.error(`[bot] обновление не обработано: ${e.message}`);
          }
        }
      } catch (e) {
        // Сеть моргнула или Telegram ответил ошибкой — ждём и продолжаем:
        // упасть здесь значило бы тихо перестать принимать приглашения.
        console.error(`[bot] опрос не удался: ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  loop();
  console.log("Бот приглашений запущен (длинный опрос)");
} else {
  console.log("TELEGRAM_BOT_TOKEN не задан — бот приглашений выключен");
}
