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

/* Вкладки роли — ровно те, что есть в приложении (`TAB_LIST` в
   `SystemModel.jsx`), и то же самое перечислено на сервере (`TABS` в
   `orgStore.js`). «Анкета» сюда не входит: она открыта всем вошедшим. */
export const ALL_TABS = ["tasks", "review", "scheme", "reports", "tools"];

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
/* Ролей у человека НЕСКОЛЬКО: он и дизайнер, и проверяющий. Список один
   на всё приложение — те же роли открывают вкладки, по ним заключают
   договоры и назначают работу у функции. Должностей больше нет: это был
   тот же вопрос «кто он здесь», заданный вторым списком. */
export const setUserRoles = (id, roles) =>
  json(`/api/org/users/${encodeURIComponent(id)}/roles`,
    { method: "PUT", body: JSON.stringify({ roles }) });
/* Договор роли — шаблон: что человек подписывает, вступая в неё. Пусто —
   снять договор: тогда роль выдаётся без акцепта. */
export const setRoleContract = (id, contract) =>
  json(`/api/org/roles/${encodeURIComponent(id)}/contract`,
    { method: "PUT", body: JSON.stringify({ contract }) });

/* ─────── регистрация: договор и есть акцепт ───────

   Роли с договорами открыты всякому, кто вошёл: в организацию вступают, а
   не заглядывают, поэтому здесь только названия и сами договоры — без
   списка людей. Подписанный экземпляр уезжает строкой base64 вместе с
   выбранной ролью: общее хранилище файлов заперто для участников, и
   открывать его ради регистрации значило бы раздать диск всем подряд. */
export const openRoles = () => json("/api/org/roles").then((o) => o.roles || []);
export async function registerRemote(roleId, file) {
  const body = { roleId };
  if (file) {
    const data = await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result || ""));
      r.onerror = () => no(new Error("не удалось прочитать файл"));
      r.readAsDataURL(file);
    });
    body.file = { name: file.name, type: file.type || "application/octet-stream", data };
  }
  return json("/api/org/register", { method: "POST", body: JSON.stringify(body) });
}
export const setUserRole = (id, roleId) =>
  json(`/api/org/users/${encodeURIComponent(id)}/role`,
    { method: "PUT", body: JSON.stringify({ roleId }) });
export const removeUser = (id) =>
  json(`/api/org/users/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ─────── общая модель ─────── */

export const getWorkspace = () => json("/api/workspace");
export const putWorkspace = (model) =>
  json("/api/workspace", { method: "PUT", body: JSON.stringify({ model }) });
export const takeTaskRemote = (id) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/take`, { method: "POST" });
/* Постановка — своя операция постановщика, как «взять» у исполнителя:
   модель целиком пишет владелец, а ставить задачу должен тот, кого
   назначили постановщиком на схеме. В `fields` — что изменилось в форме
   (название, содержимое, начало, срок, исполнитель, проверяющий) или
   `{status: "backlog"}` за «Поставить». Отказ сервер объясняет словами в
   `why` — теми же, что показывает форма, — и они уходят в ошибку целиком,
   а не кодом «not set». */
export async function setupTaskRemote(id, fields) {
  const r = await fetch(`/api/workspace/tasks/${encodeURIComponent(id)}/setup`,
    { method: "POST", headers: headers(), body: JSON.stringify(fields) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.why || body.error || `Сервер ответил ${r.status}`);
  }
  return r.json();
}
export const submitTaskRemote = (id, submission) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/submit`,
    { method: "POST", body: JSON.stringify(submission) });
export const reviewTaskRemote = (id, { accept, comment, mark, hidden = false }) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/review`,
    { method: "POST", body: JSON.stringify({ accept, comment, mark, hidden }) });
/* Комментарий к задаче: скрытый — только автору и адресату. Своя
   операция, как у сдачи и приёма: модель целиком пишет владелец, а сказать
   в задаче должен уметь любой её участник. */
export const commentTaskRemote = (id, { text, to = null, hidden = false }) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/comments`,
    { method: "POST", body: JSON.stringify({ text, to, hidden }) });
/* Убрать комментарий — своя операция по той же причине: у позванного
   нажатие ✕ иначе жило бы только в окне и комментарий возвращался бы с
   перезагрузкой. Сервер разрешает владельцу любой, остальным — только
   свой; интерфейс показывает ✕ по тому же правилу. */
export const dropCommentRemote = (taskId, commentId) =>
  json(`/api/workspace/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" });
/* Поручения — то, в чём человека выбрали, по всем активам сразу.
   Отдельным запросом, потому что модель позванный не видит: список
   собирает сервер по своим правилам, а не интерфейс по срезу. */
export const getDuty = () => json("/api/workspace/duty").then((r) => r.duty || []);
/* Отказ от поручения и возврат назад тем же нажатием. Выбрать себе
   функцию нельзя — только снять с себя ту, в которой уже выбрали. */
export const refuseFuncRemote = (id, off) =>
  json(`/api/workspace/funcs/${encodeURIComponent(id)}/duty`,
    { method: "POST", body: JSON.stringify({ off }) });
/* Рейтинги глазами спрашивающего: про себя — только адресованные слова,
   про остальных — средние и публичные слова, нигде — автор. Сервер при
   каждом чтении пробует опубликовать то, что стало анонимным. */
export const getRatings = () => json("/api/workspace/ratings");
