/* ════════════════════════════════════════════════════════════════
   ССЫЛКА НА ЗВОНОК

   Звонок — отдельное мини-приложение, а не вкладка модели: у него свой
   вход (/call) и своё окно. Открывается оно ссылкой Telegram, и от того,
   как эта ссылка собрана, зависит, откроется ли что-нибудь вообще:

   · t.me/<бот>/<короткое имя>?startapp=…  — отдельное мини-приложение,
     заведённое в @BotFather (/newapp) с адресом https://<домен>/call.
     Короткое имя приходит в TELEGRAM_CALL_APP;
   · t.me/<бот>?startapp=…  — главное мини-приложение бота, если отдельного
     нет: оно само откроет окно звонка, увидев параметр call_…;
   · mode=compact — окно открывается на пол-экрана; на весь экран человек
     тянет его сам. Так просил владелец: звонок не должен занимать всё.

   Без имени бота (локально, в тестах) — обычный адрес страницы звонка.
   ════════════════════════════════════════════════════════════════ */

export function callLinkFor({ botName = "", callApp = "", appName = "", publicUrl = "" } = {},
  callId) {
  const id = encodeURIComponent(String(callId));
  if (!botName) return `${publicUrl}/call?call=${id}`;
  const app = callApp || appName;
  const base = app ? `https://t.me/${botName}/${app}` : `https://t.me/${botName}`;
  return `${base}?startapp=call_${id}&mode=compact`;
}

/** Из окружения сервера. */
export const callLinkEnv = (env = process.env, botName = "") => ({
  botName,
  callApp: env.TELEGRAM_CALL_APP || "",
  appName: env.TELEGRAM_APP_NAME || "",
  publicUrl: env.PUBLIC_URL || "",
});
