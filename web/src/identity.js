import { getInitData } from "./telegram.js";

/* ════════════════════════════════════════════════════════════════
   КТО Я И ЧТО МНЕ ВИДНО

   Роли живут на сервере: там же, где стоит настоящая проверка. Здесь —
   только их отражение, чтобы не рисовать вкладки, за которыми всё равно
   ответят отказом.

   Без сервера (статичный хостинг, локальная разработка, тесты) владелец —
   ты сам: модель лежит в браузере, делить её не с кем, и прятать что-либо
   от единственного её хозяина было бы странно.
   ════════════════════════════════════════════════════════════════ */

export const ALL_TABS = ["tasks", "review", "timeline", "scheme", "sim", "tools"];

export const SOLO = {
  id: "local", isOwner: true, known: true, name: "", role: null,
  tabs: [...ALL_TABS], solo: true,
};

const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(),
});

let cached = null;
export function resetIdentity() { cached = null; }

/** Кто я. Ответ запоминается: роль в течение сессии не меняется. */
export async function whoAmI() {
  if (cached) return cached;
  try {
    const h = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const j = h.ok ? await h.json() : null;
    // Сервер жив, но роли выключены (нет токена бота) — значит, различать
    // людей нечем, и приложение работает как одиночное.
    if (!j || !j.ok || !j.org) { cached = SOLO; return cached; }

    const r = await fetch("/api/org/me", { headers: headers() });
    if (!r.ok) { cached = { ...SOLO, solo: false, isOwner: false, known: false, tabs: [] }; return cached; }
    const me = await r.json();
    cached = { ...me, solo: false };
    return cached;
  } catch {
    cached = SOLO;
    return cached;
  }
}

const json = async (url, opts) => {
  const r = await fetch(url, { headers: headers(), ...opts });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Сервер ответил ${r.status}`);
  return r.status === 204 ? null : r.json();
};

/* ─────── своя анкета ───────
   Единственное, что человек меняет о себе сам: про себя он знает точнее,
   а анкета, заполненная кем-то другим, была бы чужим мнением под чужим
   именем. Поэтому маршрут открыт всем позванным, а не владельцу. */
export const putProfile = (fields) =>
  json("/api/org/me/profile", { method: "PUT", body: JSON.stringify(fields) });

/* ─────── ссылки на блоки карты отчётов ───────

   Заводит и отзывает их владелец, а ЧИТАЮТСЯ они без подписи: тому, кому
   показывают сделанное, аккаунт заводить незачем — в этом весь смысл
   ссылки. Поэтому чтение идёт голым fetch, без заголовка Telegram. */
export const putShare = (node) =>
  json("/api/shares", { method: "POST", body: JSON.stringify({ node }) });
export const listShares = () => json("/api/shares");
export const dropShare = (token) =>
  json(`/api/shares/${encodeURIComponent(token)}`, { method: "DELETE" });

export async function getShare(token) {
  const r = await fetch(`/api/shares/${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(r.status === 404 ? "Ссылка не открывается" : `Сервер ответил ${r.status}`);
  return r.json();
}

/* ─────── люди и роли (только владельцу) ─────── */

export const listOrg = () => json("/api/org");
export const addRole = (name, tabs) =>
  json("/api/org/roles", { method: "POST", body: JSON.stringify({ name, tabs }) });
export const setRoleTabs = (id, tabs) =>
  json(`/api/org/roles/${encodeURIComponent(id)}/tabs`,
    { method: "PUT", body: JSON.stringify({ tabs }) });
export const removeRole = (id) =>
  json(`/api/org/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
export const setUserRole = (id, roleId) =>
  json(`/api/org/users/${encodeURIComponent(id)}/role`,
    { method: "PUT", body: JSON.stringify({ roleId }) });
export const removeUser = (id) =>
  json(`/api/org/users/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ─────── общая модель ─────── */

export const getWorkspace = () => json("/api/workspace");
export const putWorkspace = (model) =>
  json("/api/workspace", { method: "PUT", body: JSON.stringify({ model }) });
export const submitTaskRemote = (id, submission) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/submit`,
    { method: "POST", body: JSON.stringify(submission) });
export const reviewTaskRemote = (id, { accept, comment, mark }) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/review`,
    { method: "POST", body: JSON.stringify({ accept, comment, mark }) });

/** Черновик содержимого задачи от Claude — через мост, только владельцу. */
/** Черновик задачи от Claude. В два шага: поставить вопрос и опрашивать
 *  ответ короткими запросами. Один длинный запрос nginx и WebView Telegram
 *  рвали на минуте — интерфейс видел только «Failed to fetch». */
export async function draftTask(fields, { intervalMs = 1500, timeoutMs = 190000, signal } = {}) {
  const started = await json("/api/workspace/draft",
    { method: "POST", body: JSON.stringify(fields) });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new Error("отменено");
    await new Promise((r) => setTimeout(r, intervalMs));
    const st = await json(`/api/workspace/draft/${encodeURIComponent(started.id)}`);
    if (st.status === "done") return st.text;
    if (st.status !== "pending") throw new Error(st.error || "Claude не ответил");
    if (Date.now() > deadline) throw new Error("Claude не ответил вовремя — напишите текст сами");
  }
}
