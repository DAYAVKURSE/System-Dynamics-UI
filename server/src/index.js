import "dotenv/config";
import { callLinkEnv, callLinkFor } from "./lib/links.js";
import { createApp } from "./app.js";
import { runTick } from "./lib/scheduler.js";
import { scheduleFor } from "./lib/scheduleTasks.js";
import { store } from "./lib/scheduleStore.js";
import { answerCallback, answerInline, answerPreCheckout, editMessage, getFile, getMe, getUpdates,
  sendWithKeyboard } from "./lib/telegram.js";
import * as codes from "./lib/codes.js";
import { handleUpdate } from "./lib/bot.js";
import * as org from "./lib/orgStore.js";
import * as calls from "./lib/callStore.js";
import { setSetting } from "./lib/envStore.js";
import { deferTask, setupStateFor, submitTask, takeTask, taskFor, withModel, writeModel }
  from "./lib/workspaceStore.js";
import { saveReport } from "./lib/reportStore.js";
import { publishStep } from "./lib/ratings.js";
import { askNow, cancel as cancelAsk } from "./lib/assistantQueue.js";
import * as memory from "./lib/memoryStore.js";
import { recordGroupMessage } from "./lib/chatStore.js";
import { bindLatestAgreement, claimAgreement } from "./lib/contractStore.js";
import { resumeTranscripts } from "./lib/transcribe.js";
import * as assistantSettings from "./lib/assistantSettings.js";
import { findStorage, inStorage, inTaskStorage, listStorages } from "./lib/storages.js";
import { readModel } from "./lib/workspaceStore.js";

/* В каком хранилище задача — там и работаем (lib/storages.js). */
const hasTask = async (id) => ((await readModel()).tasks || []).some((t) => t && t.id === id);
const atTask = (userId, taskId, fn) => inTaskStorage(userId, taskId, hasTask, fn);

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`System Dynamics UI server listening on port ${PORT}`);
});

/* Расшифровки, оборванные перезапуском: запись «идёт» пережить перезапуск
   не может — ждал её этот процесс, и его больше нет. Байты на месте —
   расшифровка заново, нет — «прервана» словами (lib/transcribe.js). В
   фоне и по одной: записи большие, а сервер уже принимает запросы. */
resumeTranscripts()
  .then((done) => {
    if (done.length) console.log(`[transcribe] после перезапуска: ${done.map((d) => `${d.fileId} ${d.status}`).join(", ")}`);
  })
  .catch((e) => console.error(`[transcribe] восстановление после перезапуска не удалось: ${e.message}`));

/* ─── ПОДПИСКА ЗАКАНЧИВАЕТСЯ (владелец, 2026-09-21) ───
   За 5, 3 и 1 день — сообщение в основном боте, по одному разу на
   каждый срок. Кого спросить — знает сервис кодов; кому слать — его
   Telegram (с какого регистрировались). Раз в десять минут: чаще
   незачем, дни — не минуты. */
let remindedAt = 0;
async function remindSubscriptions() {
  if (!codes.enabled() || Date.now() - remindedAt < 10 * 60 * 1000) return;
  remindedAt = Date.now();
  const r = await codes.expiring();
  if (r.status >= 400) return;
  const url = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  const keyboard = url ? { inline_keyboard: [[{ text: "Продлить в приложении", web_app: { url } }]] } : null;
  for (const x of r.body?.expiring || []) {
    const chat = x.tg?.id;
    if (!chat) { await codes.reminded(x.uid, x.mark); continue; }
    const days = x.daysLeft === 1 ? "1 день" : x.daysLeft < 5 ? `${x.daysLeft} дня` : `${x.daysLeft} дней`;
    try {
      await sendWithKeyboard(chat, `Подписка «${x.planName}» заканчивается через ${days}. Продлите её, чтобы вкладки не погасли.`, keyboard);
      await codes.reminded(x.uid, x.mark);
    } catch (e) {
      console.error(`[billing] напоминание ${x.uid}: ${e.message}`);
    }
  }
}

/* Планировщик напоминаний: раз в минуту смотрит расписания всех
   пользователей и отправляет то, чему пришло время. Без токена бота слать
   некуда, поэтому не запускается вовсе. */
const TICK_MS = 60 * 1000;
if (process.env.TELEGRAM_BOT_TOKEN) {
  const tick = async () => {
    try {
      const sent = await runTick({
        /* Уведомление о начале работы приходит с кнопками «Начать» и
           «Отложить», поэтому отправка та же, что и у бота. */
        store, send: sendWithKeyboard, log: (m) => console.warn(`[scheduler] ${m}`),
        // Задачи — из модели: список не должен зависеть от того, открывали
        // ли приложение (владелец, 2026-09-20).
        tasksFor: scheduleFor,
      });
      if (sent) console.log(`[scheduler] отправлено напоминаний: ${sent}`);
      /* Попытка публикации оценок — на каждом тике: то, что стало
         анонимным (два разных автора), публикуется, не дожидаясь чтения
         рейтинга. Не больше одной за тик — две сразу назвали бы обоих. */
      for (const st of await listStorages()) {
        await inStorage(st.id, () => withModel(async (model) => {
          if (publishStep(model).changed) await writeModel(model);
        }));
      }
      await remindSubscriptions();
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

/* Бот: приглашения, кнопки под уведомлениями, помощник — и сообщения
   групп (их он записывает и молчит; зависимость `chats` — lib/chatStore.js).
   Длинный опрос — цикл без таймера: следующий запрос уходит сразу после
   предыдущего ответа, поэтому нажатие кнопки не ждёт до минуты. */
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
  // Как собирается ссылка на звонок — см. lib/links.js: главное
  // приложение бота, если владелец включил его «/callmain on», иначе
  // отдельное приложение звонка (TELEGRAM_CALL_APP), иначе страница
  // /call. На модель ссылка не ведёт ни в одном из случаев.
  const appLink = (callId) => callLinkFor(callLinkEnv(process.env, botName), callId);
  /* Отдельное мини-приложение звонка. Завести его можно только руками в
     @BotFather (метода Bot API для этого нет вовсе), а вот запомнить его
     короткое имя владелец может из чата: «/callapp call». Значение живёт
     в .env, поэтому переживает перезапуск, а деплой его переносит. */
  const settings = {
    getCallApp: () => (process.env.TELEGRAM_CALL_APP || "").trim(),
    setCallApp: (name) => setSetting("TELEGRAM_CALL_APP", name),
    // Открывать ли звонок ГЛАВНЫМ приложением бота. Ради одного —
    // пол-экрана: отдельное приложение открывается только на весь
    // (почему — в lib/links.js). Команда «/callmain on».
    getCallMain: () => (process.env.TELEGRAM_CALL_MAIN || "").trim() === "1",
    setCallMain: (on) => setSetting("TELEGRAM_CALL_MAIN", on ? "1" : ""),
    // Токен админ-бота подписок — командой «/adminbot» (lib/bot.js).
    setAdminBot: (token) => setSetting("ADMIN_BOT_TOKEN", token),
    // Заведено ли главное приложение на самом деле. null — Telegram не
    // ответил; включать на таком ответе нельзя, иначе приглашение
    // перестанет открывать вообще что-либо.
    mainAppReady: async () => {
      const u = await getMe();
      return u ? Boolean(u.has_main_web_app) : null;
    },
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
              /* Кнопки под уведомлением двигают задачу на общем складе
                 работы — там же, где её двигает нажатие на доске. «Отложено
                 до» ставится в расписание сразу: бот отложил — бот и напомнит,
                 не дожидаясь, пока владелец выгрузит модель заново. */
              /* Задача лежит в одном из хранилищ человека (lib/storages.js):
                 каждое действие бота идёт в том, где она есть. */
              work: {
                take: (u, id, o) => atTask(u, id, async () => {
                  const r = await takeTask(u, id, o);
                  if (!r.error) await store.setDeferredUntil(u, id, null).catch(() => {});
                  return r;
                }),
                defer: (u, id, o) => atTask(u, id, async () => {
                  const r = await deferTask(u, id, o);
                  if (!r.error) await store.setDeferredUntil(u, id, r.task.deferredUntil).catch(() => {});
                  return r;
                }),
                submit: (u, id, sub) => atTask(u, id, () => submitTask(u, id, sub)),
                taskFor: (u, id) => atTask(u, id, () => taskFor(u, id)),
                // «Готово» под напоминанием о постановке: спрашиваем склад,
                // а не верим нажатию.
                setupState: (u, id) => atTask(u, id, () => setupStateFor(u, id)),
              },
              /* Висящие напоминания: нажатие гасит повтор, «Отложить»
                 переносит его на срок, выбранный тут же, под кнопкой. */
              reminders: {
                ack: (u, kind, id) => store.ackReminder(u, `${kind}:${id}`).catch(() => false),
                defer: (u, kind, id, until) =>
                  store.deferReminder(u, `${kind}:${id}`, until).catch(() => false),
              },
              /* Сданная в чате вещь ложится туда же, куда файлы из приложения:
                 хранилище одно, и в отчёте она найдётся по тому же адресу. */
              files: { save: (userId, f) => saveReport(userId, f) },
              tg: { getFile },
              edit: (chatId, messageId, text, keyboard) => editMessage(chatId, messageId, text, keyboard),
              /* Помощник: любой позванный пишет боту словами и получает ответ по
                 своим данным (lib/botAssistant.js). askNow отдаёт обещание
                 ответа; бот его не ждёт — иначе на время вопроса он не
                 отвечал бы никому. cancel — кнопка «✖ Отменить» под статусом:
                 прерывает запрос к модели, а не прячет ответ. Статус —
                 «🕐 Думаю…» с идущими часами, и правит его `edit` выше.
                 Память — та же, что в приложении. */
              assistant: { ask: askNow, cancel: cancelAsk, memory,
                /* Вход на MCP-сервер, присланный в чат: ищем сервер по
                   названию среди СВОИХ — чужих у человека и нет. */
                mcpAuth: async (userId, name, auth) => {
                  const mine = assistantSettings.settingsView(userId).mcp || [];
                  const want = String(name).trim().toLowerCase();
                  const m = mine.find((x) => String(x.name).toLowerCase() === want)
                    || mine.find((x) => String(x.name).toLowerCase().includes(want));
                  return m ? assistantSettings.setMcpAuth(userId, m.id, auth) : null;
                } },
              /* Группы бот только слушает: сообщение ложится в хранилище чатов,
                 ответа в группу нет никакого (lib/chatStore.js). */
              chats: { record: recordGroupMessage },
              /* Договоры: «/start agr_<токен>» привязывает соглашение к
                 пришедшему; добавление по пересылке — к ждущему договору
                 роли (lib/contractStore.js). */
              /* Оплата звёздами и подписки — сервис кодов (lib/codes.js). */
              billing: {
                preCheckout: (id, ok) => answerPreCheckout(id, ok),
                paid: async (id, tx) => {
                  const r = await codes.paid(id, tx);
                  return r.status < 400
                    ? { ok: true, plan: r.body.plan, planName: r.body.payment?.planName, days: r.body.payment?.days }
                    : { ok: false, error: r.body?.error || `сервис кодов ответил ${r.status}` };
                },
              },
              contracts: {
                /* Ссылка на договор ведёт в чьё-то хранилище: ищем, в чьё. */
                claim: async (token, who) => {
                  const sid = await findStorage(async () => (await org.listOrg()).agreements
                    .some((a) => a.token === String(token || "")));
                  return inStorage(sid || "main", () => claimAgreement(token, who));
                },
                bind: bindLatestAgreement,
              },
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
