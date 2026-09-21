import { codeHeader } from "./codes.js";

/* ════════════════════════════════════════════════════════════════
   В КАКОМ ХРАНИЛИЩЕ РАБОТАЕМ (владелец, 2026-09-21)

   Своё — по умолчанию; чужое — то, куда позвали, пока в него зашли.
   Сервер решает, можно ли; здесь только адрес, заголовком `X-Storage`
   в каждом запросе — вместе с токеном ключа. Живёт в сеансе вкладки:
   чужое хранилище — куда зашли и откуда вернутся.
   ════════════════════════════════════════════════════════════════ */
const KEY = "sd_storage";
export const currentStorage = () => {
  try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; }
};
export function setStorage(id) {
  try {
    if (id) sessionStorage.setItem(KEY, String(id));
    else sessionStorage.removeItem(KEY);
  } catch { /* приватный режим */ }
}
/** Заголовки, по которым сервер узнаёт человека и хранилище. */
export const sessionHeaders = () => {
  const s = currentStorage();
  return { ...codeHeader(), ...(s ? { "X-Storage": s } : {}) };
};
