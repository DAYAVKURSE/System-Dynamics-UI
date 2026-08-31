import "dotenv/config";
import { createApp } from "./app.js";
import { runTick } from "./lib/scheduler.js";
import { store } from "./lib/scheduleStore.js";
import { sendMessage } from "./lib/telegram.js";

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
