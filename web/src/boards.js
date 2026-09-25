import { getInitData } from "./telegram.js";
import { sessionHeaders } from "./session.js";
import { actingAs } from "./identity.js";

/* ════════════════════════════════════════════════════════════════
   БРЕЙНШТОРМ-ДОСКИ · разговор с сервером (владелец, 2026-09-25)

   См. server/src/routes/boards.js. Два рода запросов:

   · список и создание — из основного приложения, вкладка «Брейншторм».
     Там сервер знает хранилище и право на вкладку, поэтому уходят все
     заголовки основного приложения: подпись Telegram, хранилище и токен
     кодов (sessionHeaders) и «под чьим именем» (X-Act-As), как в market.js.

   · сама доска — и из вкладки, и из мини-приложения в общем чате. Сюда
     приходит кто угодно со ссылкой, и различает людей сервер ТОЛЬКО по
     подписи Telegram: блокируют и удаляют настоящий Telegram-id, а не
     то, что о себе рассказал браузер. Лишних заголовков здесь нет — в
     мини-приложении их и взять неоткуда.

   Живое обновление — длинный опрос по HTTP, как у звонков: nginx на
   сервере проксирует без Upgrade, и вебсокет через него не пройдёт.
   ════════════════════════════════════════════════════════════════ */

const appHeaders = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(), ...sessionHeaders(),
  ...(actingAs() ? { "X-Act-As": actingAs() } : {}),
});

const boardHeaders = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(),
});

/* Отказ сервера — Error с его словами и тем, что из них следует для
   экрана: `blocked` и `removed` показывают вместо доски предупреждение,
   `status` отличает «доски нет» от сбоя сети. */
const call = async (url, opts, headers) => {
  const r = await fetch(url, { ...opts, headers });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const e = new Error(body.error || `Сервер ответил ${r.status}`);
    e.status = r.status;
    e.blocked = Boolean(body.blocked);
    e.removed = Boolean(body.removed);
    throw e;
  }
  return r.status === 204 ? null : r.json();
};
const enc = encodeURIComponent;
const boardUrl = (id) => `/api/boards/${enc(id)}`;
const onBoard = (url, opts) => call(url, opts, boardHeaders());

/* ─────── основное приложение ─────── */

/** Доски текущего хранилища: `{ boards, canCreate }`. */
export const listBoards = () => call("/api/boards", {}, appHeaders());

/** Новая доска: `{ board }` — сводка, как в списке. */
export const createBoard = (name) => call("/api/boards",
  { method: "POST", body: JSON.stringify({ name }) }, appHeaders());

/* ─────── доска ─────── */

/**
 * Состояние доски: `{ board }`. Без `rev` — сразу; с `rev`, равным
 * нынешнему, сервер держит запрос, пока на доске что-нибудь не изменится
 * (или не выйдет срок), — это и есть «живое» обновление. `signal` —
 * чтобы уйти с доски, не дожидаясь ответа.
 */
export const getBoard = (id, rev, signal) => {
  const q = rev == null ? "" : `?rev=${enc(rev)}`;
  return onBoard(`${boardUrl(id)}${q}`, { signal });
};

/** Новый пустой стикер моего авторства — в конец: `{ board }`. */
export const addSticker = (id) => onBoard(`${boardUrl(id)}/stickers`, { method: "POST" });

/**
 * Текст своего стикера: `{ rev }`. `keepalive` — запрос довезётся, даже
 * если страницу закрывают (мини-приложение свернули или закрыли). Браузер
 * держит на такие запросы общий предел (64 КБ); не принял — обычным.
 */
export const setStickerText = (id, sid, text, { keepalive = false } = {}) => {
  const url = `${boardUrl(id)}/stickers/${enc(sid)}`;
  const opts = { method: "PATCH", body: JSON.stringify({ text }) };
  if (!keepalive) return onBoard(url, opts);
  return onBoard(url, { ...opts, keepalive: true })
    .catch((e) => (e?.status ? Promise.reject(e) : onBoard(url, opts)));
};

/** Удалить свой стикер: `{ rev }`. */
export const deleteSticker = (id, sid) => onBoard(`${boardUrl(id)}/stickers/${enc(sid)}`,
  { method: "DELETE" });

/* Участниками управляет только создатель доски — проверяет сервер. */
export const blockMember = (id, uid) => onBoard(`${boardUrl(id)}/members/${enc(uid)}/block`,
  { method: "POST" });
export const unblockMember = (id, uid) => onBoard(`${boardUrl(id)}/members/${enc(uid)}/unblock`,
  { method: "POST" });
export const removeMember = (id, uid) => onBoard(`${boardUrl(id)}/members/${enc(uid)}`,
  { method: "DELETE" });

/**
 * Доска, с которой открыли мини-приложение: `?board=…` или
 * `startapp=board_…`.
 *
 * Как и у звонка (calls.js callFromLocation): свои параметры Telegram
 * кладёт во ФРАГМЕНТ адреса, поэтому смотрим и в строку запроса, и во
 * фрагмент, и в разобранный SDK-ом `start_param`.
 */
export function boardFromLocation() {
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const direct = q.get("board") || h.get("board");
    if (direct) return direct;
    const start = q.get("tgWebAppStartParam") || h.get("tgWebAppStartParam")
      || window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
    const m = String(start).match(/^board_(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
