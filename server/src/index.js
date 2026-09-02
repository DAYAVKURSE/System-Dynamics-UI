import "dotenv/config";
import { callLinkEnv, callLinkFor } from "./lib/links.js";
import { createApp } from "./app.js";
import { runTick } from "./lib/scheduler.js";
import { store } from "./lib/scheduleStore.js";
import { answerCallback, answerInline, getMe, getUpdates, sendMessage, sendWithKeyboard }
  from "./lib/telegram.js";
import { handleUpdate } from "./lib/bot.js";
import * as org from "./lib/orgStore.js";
import * as calls from "./lib/callStore.js";
import * as bridge from "./lib/bridgeStore.js";
import * as login from "./lib/loginFlow.js";
import { setSetting } from "./lib/envStore.js";

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
  /* Имя бота нужно, чтобы собрать ссылку на звонок в мини-приложение.
     Само оно не меняется, но первый запрос может не дойти — сеть на
     старте сервера поднимается не всегда раньше него. Без имени ссылка
     тихо деградирует до обычной страницы, поэтому спрашиваем, пока не
     ответят: раз в полминуты, не роняя ничего. */
  let botName = "";
  const askName = async () => {
    for (let i = 0; !botName && i < 20; i += 1) {
      try {
        const u = await getMe();
        botName = u?.username || "";
        // Маршруты звонков собирают ту же ссылку-приглашение и берут имя
        // отсюда: заводить ради одной строки общий модуль состояния незачем.
        if (botName) process.env.BOT_NAME = botName;
      } catch (e) {
        console.error(`[bot] имя бота не узнать: ${e.message}`);
      }
      if (!botName) await new Promise((r) => setTimeout(r, 30000));
    }
    if (!botName) console.error("[bot] имя бота узнать не удалось — ссылка на звонок"
      + " будет вести на страницу /call, а не в мини-приложение");
  };
  askName();
  // Как собирается ссылка на звонок — см. lib/links.js: отдельное
  // мини-приложение звонка (TELEGRAM_CALL_APP), а без него — страница
  // /call. На главное приложение модели ссылка не ведёт никогда.
  const appLink = (callId) => callLinkFor(callLinkEnv(process.env, botName), callId);

  /* Отдельное мини-приложение звонка. Завести его можно только руками в
     @BotFather (метода Bot API для этого нет вовсе), а вот запомнить его
     короткое имя владелец может из чата: «/callapp call». Значение живёт
     в .env, поэтому переживает перезапуск, а деплой его переносит. */
  const settings = {
    getCallApp: () => (process.env.TELEGRAM_CALL_APP || "").trim(),
    setCallApp: (name) => setSetting("TELEGRAM_CALL_APP", name),
  };
  if (!settings.getCallApp()) {
    console.warn("[calls] TELEGRAM_CALL_APP не задан: ссылка на звонок ведёт на"
      + " страницу /call, а не в мини-приложение. Как завести — команда /callapp в чате"
      + " с ботом или docs/DEPLOYMENT.md, раздел 6.6.");
  }
  if (!process.env.PUBLIC_URL) {
    console.warn("[calls] PUBLIC_URL не задан: в приглашении окажется относительная"
      + " ссылка на звонок, по которой из чата не откроется ничего.");
  }

  const loop = async () => {
    for (;;) {
      try {
        const updates = await getUpdates(offset);
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handleUpdate(u, {
              org, calls,
              bridge: process.env.BRIDGE_TOKEN ? bridge : null,
              // Вход в Claude Code из чата — только когда мост вообще включён:
              // логинить некого, если воркеру нечем подключиться.
              login: process.env.BRIDGE_TOKEN ? login : null,
              send: (chatId, text, keyboard) => sendWithKeyboard(chatId, text, keyboard),
              answer: answerCallback,
              answerInline,
              appLink,
              botName,
              settings,
              publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
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

/* Ответы моста разносит по чатам сам сервер: воркер знает только id
   вопроса, а в какой чат его отправить — знает очередь. */
if (process.env.TELEGRAM_BOT_TOKEN && process.env.BRIDGE_TOKEN) {
  setInterval(async () => {
    for (const item of bridge.takeAnswered()) {
      if (!item.chatId) continue;
      const body = item.error
        ? `Claude Code ответил ошибкой:\n${item.error}`
        : (item.answer || "(пустой ответ)");
      try {
        // Ответ Claude Code бывает длиннее одного сообщения Telegram —
        // режем по абзацам, иначе API просто откажет.
        for (const part of bridge.chunk(body)) await sendMessage(item.chatId, part);
      } catch (e) {
        console.error(`[bridge] ответ не отправлен: ${e.message}`);
      }
    }
  }, 1000);
  if (!bridge.asciiSecret(process.env.BRIDGE_TOKEN)) {
    console.warn("[bridge] BRIDGE_TOKEN должен быть из латиницы и цифр, не короче"
      + " 8 символов: заголовки HTTP не несут кириллицу, и воркер не сможет"
      + " подключиться.");
  }
  console.log("Мост к Claude Code включён");
} else if (process.env.TELEGRAM_BOT_TOKEN) {
  console.log("BRIDGE_TOKEN не задан — мост к Claude Code выключен");
}
