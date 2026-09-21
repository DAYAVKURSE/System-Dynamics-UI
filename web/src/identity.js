import { getInitData } from "./telegram.js";
import { codeHeader, ensureToken } from "./codes.js";

/* ════════════════════════════════════════════════════════════════
   КТО Я И ЧТО МНЕ ВИДНО

   Роли живут на сервере: там же, где стоит настоящая проверка. Здесь —
   только их отражение, чтобы не рисовать вкладки, за которыми всё равно
   ответят отказом.

   Без сервера (статичный хостинг, локальная разработка, тесты) владелец —
   ты сам: модель лежит в браузере, делить её не с кем, и прятать что-либо
   от единственного её хозяина было бы странно.
   ════════════════════════════════════════════════════════════════ */

/* Вкладки роли — ВСЕ, что есть в приложении (владелец, 2026-09-20), и
   верхние, и внутренние; то же самое перечислено на сервере (`TABS` в
   `orgStore.js`). Внутренние пишутся через двоеточие: «tools:calls».
   Внутренняя вкладка — такое же место, и роль должна уметь открыть
   «Звонки», не открывая «Выгрузку». */
export const ALL_TABS = ["market", "me", "tasks", "review",
  "scheme", "scheme:edit", "scheme:time", "scheme:sim",
  "reports",
  "tools", "tools:people", "tools:assistant", "tools:virtual", "tools:reminders",
  "tools:calls", "tools:issues", "tools:export"];

/* Имена вкладок — те же слова, что на их кнопках в приложении: роль
   открывает «Отчёты», и называться она должна «Отчёты», а не «reports».
   Список один со `SystemModel.TAB_LIST`; здесь он потому, что вкладки
   выбирают в двух местах — у роли и в коде доступа. */
export const TAB_NAMES = {
  market: "Рынок услуг", me: "Анкета",
  tasks: "Задачи", review: "Проверка", scheme: "Схема",
  "scheme:edit": "Управление", "scheme:time": "Деятельность", "scheme:sim": "Цели",
  reports: "Отчёты", tools: "Инструменты",
  "tools:people": "Роли", "tools:assistant": "Агенты",
  "tools:virtual": "Виртуальные сотрудники",
  "tools:reminders": "Напоминания", "tools:calls": "Звонки",
  "tools:issues": "Issues", "tools:export": "Выгрузка",
};
export const tabName = (t) => TAB_NAMES[t] || t;

/* Право на вкладке: «r» — только смотреть, «rw» — ещё и править. */
export const mayEdit = (me, tab) => !me || !!me.isOwner || !!me.solo
  || (me.access || {})[tab] !== "r";

/* Видна ли ВНУТРЕННЯЯ вкладка. Роль, назвавшая внутренние вкладки,
   открывает ровно их; роль, назвавшая только верхнюю, открывает всю —
   иначе она сегодня потеряла бы то, что было у неё вчера. */
export const tabShown = (me, top, key) => {
  if (!me || me.isOwner || me.solo) return true;
  const tabs = me.tabs || [];
  const inner = tabs.filter((t) => t.startsWith(`${top}:`));
  return inner.length ? inner.includes(`${top}:${key}`) : tabs.includes(top);
};

export const SOLO = {
  id: "local", isOwner: true, known: true, name: "", role: null,
  tabs: [...ALL_TABS],
  access: Object.fromEntries(ALL_TABS.map((t) => [t, "rw"])),
  solo: true,
};

/* ─────── ПОД КЕМ МЫ РАБОТАЕМ ───────

   «Войти под его именем» (владелец, 2026-09-20): всё приложение начинает
   работать со страницы виртуального сотрудника — та же регистрация, те
   же вкладки, те же маршруты. Отличается один заголовок, и он тут: класть
   его в каждый запрос по отдельности значило бы забыть его в одном.

   Живёт в сеансе вкладки, а не в localStorage: чужая страница — это то,
   куда зашли и откуда возвращаются, а не то, с чем просыпаются завтра.
   Право проверяет сервер; здесь только адрес. */
const ACT_KEY = "sd_act_as";
export const actingAs = () => {
  try { return sessionStorage.getItem(ACT_KEY) || ""; } catch { return ""; }
};
export function setActingAs(id) {
  try {
    if (id) sessionStorage.setItem(ACT_KEY, String(id));
    else sessionStorage.removeItem(ACT_KEY);
  } catch { /* приватный режим */ }
  resetIdentity();
}

const headers = () => {
  const act = actingAs();
  return {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": getInitData(),
    ...(act ? { "X-Act-As": act } : {}),
    // Токен сервиса кодов (codes.js): без него хранилище не отвечает.
    ...codeHeader(),
  };
};

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

    /* Сервис кодов включён — сначала токен по сохранённому ключу. Ключа
       нет — «кто я» и спрашивать не у кого: приложение ведёт человека
       за ключом (владелец, 2026-09-21). */
    if (j.codes && !(await ensureToken())) {
      cached = { ...SOLO, solo: false, isOwner: false, known: false, needsCode: true,
        tabs: [], access: {} };
      return cached;
    }
    const r = await fetch("/api/org/me", { headers: headers() });
    if (!r.ok) { cached = { ...SOLO, solo: false, isOwner: false, known: false, tabs: [], access: {} }; return cached; }
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
export const renameRole = (id, name) =>
  json(`/api/org/roles/${encodeURIComponent(id)}/name`,
    { method: "PUT", body: JSON.stringify({ name }) });
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
/* Анкеты — словари вопросов; какую заполнять, говорит роль. Заводит и
   правит их владелец, а ответы человек шлёт сам через `putProfile`
   (`answers`): анкета лишь говорит, о чём его спросить. */
export const addForm = (name, questions = []) =>
  json("/api/org/forms", { method: "POST",
    body: JSON.stringify(questions.length ? { name, questions } : { name }) });
export const setForm = (id, patch) =>
  json(`/api/org/forms/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(patch) });
export const removeForm = (id) =>
  json(`/api/org/forms/${encodeURIComponent(id)}`, { method: "DELETE" });
export const setRoleForm = (id, formId) =>
  json(`/api/org/roles/${encodeURIComponent(id)}/form`,
    { method: "PUT", body: JSON.stringify({ formId }) });

/* ─────── регистрация: договор и есть акцепт ───────

   Роли с договорами открыты всякому, кто вошёл: в организацию вступают, а
   не заглядывают, поэтому здесь только названия и сами договоры — без
   списка людей. Подписанный экземпляр уезжает строкой base64 вместе с
   выбранной ролью: общее хранилище файлов заперто для участников, и
   открывать его ради регистрации значило бы раздать диск всем подряд. */
export const openRoles = () => json("/api/org/roles").then((o) => o.roles || []);
export async function registerRemote(roleId, file, answers, dates) {
  const body = { roleId,
    ...(answers && Object.keys(answers).length ? { answers } : {}),
    ...(dates?.start ? { start: dates.start } : {}),
    ...(dates?.end ? { end: dates.end } : {}) };
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
/* Подписанный договор участника — для окна просмотра: Word приходит
   текстом, остальное ссылкой на файл. */
export const contractHtml = (userId, roleId) =>
  json(`/api/org/users/${encodeURIComponent(userId)}/contracts/${encodeURIComponent(roleId)}/html`);
export const setUserRole = (id, roleId) =>
  json(`/api/org/users/${encodeURIComponent(id)}/role`,
    { method: "PUT", body: JSON.stringify({ roleId }) });
export const removeUser = (id) =>
  json(`/api/org/users/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ─────── сообщения об ошибках ───────
   Пишет любой позванный — кнопкой со значком в шапке; читает и удаляет
   тот, кому открыта вкладка «Issues». */
export const sendIssue = (text) =>
  json("/api/issues", { method: "POST", body: JSON.stringify({ text }) });
export const listIssues = () => json("/api/issues").then((r) => r.issues || []);
export const dropIssue = (id) =>
  json(`/api/issues/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ─────── виртуальные сотрудники ───────
   Страница, за которой ещё нет человека: её заводит рекрутер, заполняет
   за будущего сотрудника анкету и договор и присылает ссылку. */
export const listVirtual = () => json("/api/org/virtual");
export const addVirtual = (roleId) =>
  json("/api/org/virtual", { method: "POST", body: JSON.stringify({ roleId }) });
/* Код доступа на «+ сотрудник»: страница настоящего человека, который сам
   пустил к себе, появляется в том же списке (владелец, 2026-09-20). */
export const addByCode = (code) =>
  json("/api/org/virtual", { method: "POST", body: JSON.stringify({ code }) });
export const removeVirtual = (id) =>
  json(`/api/org/virtual/${encodeURIComponent(id)}`, { method: "DELETE" });
/* Свой код для техподдержки: срок в минутах, «r» или «rw» и вкладки. */
export const getAccessCode = () => json("/api/org/access-code");
export const makeAccessCode = (minutes, access, tabs) =>
  json("/api/org/access-code",
    { method: "POST", body: JSON.stringify({ minutes, access, tabs }) });
export const dropAccessCode = () =>
  json("/api/org/access-code", { method: "DELETE" });
/* Ролей у виртуального сотрудника несколько, как у обычного участника. */
export const setVirtualRoles = (id, roles) =>
  json(`/api/org/virtual/${encodeURIComponent(id)}/role`,
    { method: "PUT", body: JSON.stringify({ roles }) });
/* Ссылка заводится вместе со страницей и приходит в списке; этот маршрут
   остался для случая «выдать новую взамен разосланной». */
export const virtualLink = (id) =>
  json(`/api/org/virtual/${encodeURIComponent(id)}/link`, { method: "POST" });
/* Что ждёт по ссылке — без подписи: её читает тот, кто ещё не вошёл. */
export async function peekJoin(token) {
  const r = await fetch(`/api/org/join/${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "ссылка не открывается");
  return r.json();
}
export const joinRemote = (token) =>
  json("/api/org/join", { method: "POST", body: JSON.stringify({ token }) });

/* Ключ из ссылки — так же, как у ссылки на звонок: и из адреса, и из
   `startapp` Telegram. */
export function joinFromLocation() {
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const direct = q.get("join") || h.get("join");
    if (direct) return direct;
    const start = q.get("tgWebAppStartParam") || h.get("tgWebAppStartParam")
      || window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
    const m = String(start).match(/^join_(.+)$/);
    return m ? m[1] : null;
  } catch { return null; }
}

/* ─────── общая модель ─────── */

export const getWorkspace = () => json("/api/workspace");
export const putWorkspace = (model) =>
  json("/api/workspace", { method: "PUT", body: JSON.stringify({ model }) });
export const takeTaskRemote = (id) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/take`, { method: "POST" });
/* Бросить работу — своя операция по той же причине, что и «взять»: модель
   целиком пишет владелец, а отказаться от работы должен тот, кто её
   делает. Задача возвращается в бэклог. */
export const dropTaskRemote = (id) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/drop`, { method: "POST" });
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
/* Сообщение в обсуждение задачи. Своя операция, как у сдачи и приёма:
   модель целиком пишет владелец, а сказать в задаче должен уметь любой,
   кому она видна. Убрать сказанное нельзя — маршрута нет. */
export const messageTaskRemote = (id, text, role) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/chat`,
    { method: "POST", body: JSON.stringify({ text, role }) });
/* Обсуждение открыли — непрочитанного в нём для этого человека больше
   нет. Метка живёт у задачи, а не в браузере: непрочитанное должно
   считаться одинаково на всех устройствах. */
export const seeChatRemote = (id, role) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/chat/seen`,
    { method: "POST", body: JSON.stringify({ role }) });
/* Оценка человеку в задаче: пять звёзд, отзыв и его видимость. Своя
   операция, как у сдачи и приёма: модель целиком пишет владелец, а
   оценить должен уметь тот, кто в задаче работал. */
export const markTaskRemote = (id, { to, mark, text, pub }) =>
  json(`/api/workspace/tasks/${encodeURIComponent(id)}/mark`,
    { method: "POST", body: JSON.stringify({ to, mark, text, pub }) });
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

/* ─────── договоры: документы с версиями и соглашения ───────
   (server/src/lib/contractStore.js). Файлы едут JSON-ом в base64, как при
   регистрации: общее хранилище файлов заперто, и открывать его ради
   договоров не нужно. Владельцу — документы и выдача, человеку — свои
   соглашения, их текст и подпись. */
export async function fileToData(file) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result || ""));
    r.onerror = () => no(new Error("не удалось прочитать файл"));
    r.readAsDataURL(file);
  });
}
const fileBody = async (file) => (file
  ? { name: file.name, type: file.type || "application/octet-stream", data: await fileToData(file) }
  : null);
export const addDoc = async ({ name, file, note }) =>
  json("/api/org/docs", { method: "POST", body: JSON.stringify({ name, note, file: await fileBody(file) }) });
export const addDocVersion = async (id, { file, html, note }) =>
  json(`/api/org/docs/${encodeURIComponent(id)}/versions`,
    { method: "POST", body: JSON.stringify({ note, html, file: file ? await fileBody(file) : undefined }) });
export const updateDoc = (id, patch) =>
  json(`/api/org/docs/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) });
export const removeDoc = (id) => json(`/api/org/docs/${encodeURIComponent(id)}`, { method: "DELETE" });
export const removeDocVersion = (id, vid) =>
  json(`/api/org/docs/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}`, { method: "DELETE" });
export const docHtml = (id, vid) =>
  json(`/api/org/docs/${encodeURIComponent(id)}/html${vid ? `?v=${encodeURIComponent(vid)}` : ""}`);
export const setRoleDoc = (id, docId) =>
  json(`/api/org/roles/${encodeURIComponent(id)}/doc`, { method: "PUT", body: JSON.stringify({ docId }) });
export const createAgreement = (fields) =>
  json("/api/org/agreements", { method: "POST", body: JSON.stringify(fields) });
export const listAgreements = () => json("/api/org/agreements").then((r) => r.agreements || []);
export const revokeAgreement = (id) =>
  json(`/api/org/agreements/${encodeURIComponent(id)}`, { method: "DELETE" });
export const myAgreements = () => json("/api/org/agreements/mine").then((r) => r.agreements || []);
export const agreementHtml = (id) => json(`/api/org/agreements/${encodeURIComponent(id)}/html`);
export const signAgreement = (id, { values, sign2 }) =>
  json(`/api/org/agreements/${encodeURIComponent(id)}/sign`,
    { method: "POST", body: JSON.stringify({ values, sign2 }) });

/* ─────── напоминания: что и когда пришлёт бот ─────── */
export const listReminders = () => json("/api/schedule/reminders").then((r) => r.reminders || []);
/* Убрать напоминание из списка: из него ничего не пропадает само, и
   убрать может только сам человек (владелец, 2026-09-20). */
export const dropReminder = (id) =>
  json(`/api/schedule/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
