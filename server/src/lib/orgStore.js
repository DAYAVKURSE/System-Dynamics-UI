import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ЛЮДИ И РОЛИ

   До этого приложение было однопользовательским: у каждого свой каталог
   сценариев, и никто ничего чужого не видел просто потому, что не было
   общего. Теперь модель одна, и надо отвечать на два вопроса: кто ты и
   что тебе видно.

   Владелец — один. Он задан переменной OWNER_TELEGRAM_ID, а если её нет,
   владельцем становится первый, кто открыл приложение, и это записывается
   на диск навсегда. Второй способ ненадёжен и назван таковым в
   DEPLOYMENT.md: на публичном адресе первым может оказаться не тот.

   Роль — это набор вкладок. Не «уровень доступа» с лесенкой прав: лесенка
   врёт, как только появляется роль, которой нужно одно из середины и
   ничего сверху. Владелец в лесенку тоже не укладывается — он видит всё
   и не ограничен ролью вовсе.
   ════════════════════════════════════════════════════════════════ */

export const TABS = ["tasks", "review", "timeline", "scheme", "sim", "tools"];
// Прежние имена вкладок из сохранённых ролей: «выгрузка» и «звонки» стали
// внутренними вкладками «инструментов». Читаем старое как новое, чтобы роль,
// заведённая вчера, не потеряла вкладку сегодня.
const TAB_ALIAS = { json: "tools", calls: "tools" };
export const normTabs = (tabs) => [...new Set((tabs || [])
  .map((t) => TAB_ALIAS[t] || t).filter((t) => TABS.includes(t)))];

// Встроенные роли переименовать и удалить нельзя: на них ссылается
// приглашение из бота, и остаться без единой роли значит остаться без
// возможности кого-либо добавить.
export const BUILTIN_ROLES = [
  { id: "executor", name: "исполнитель", tabs: ["tasks"], builtin: true },
  { id: "reviewer", name: "проверяющий", tabs: ["review"], builtin: true },
  { id: "worker", name: "исполнитель и проверяющий", tabs: ["tasks", "review"], builtin: true },
  // Созвон нужен всем, кто вообще работает в модели: договориться о
  // встрече — не привилегия.
  { id: "caller", name: "исполнитель со звонками", tabs: ["tasks", "tools"], builtin: true },
];

const EMPTY = { ownerId: null, roles: BUILTIN_ROLES, users: [] };

function baseDir() {
  return process.env.ORG_DIR
    ? path.resolve(process.env.ORG_DIR)
    : path.resolve(process.cwd(), "data", "org");
}
const file = () => path.join(baseDir(), "org.json");

export async function readOrg() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    const roles = Array.isArray(parsed.roles) && parsed.roles.length
      ? parsed.roles : BUILTIN_ROLES;
    return {
      ownerId: parsed.ownerId != null ? String(parsed.ownerId) : null,
      // Роли — как записаны: встроенные тоже можно удалить, и воскрешать их
      // при каждом чтении нельзя. Пустой список — единственный случай, когда
      // подставляются встроенные: иначе позвать в модель станет некого.
      roles: roles.map((r) => ({ ...r, tabs: normTabs(r.tabs) })),
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch {
    return { ...EMPTY, roles: [...BUILTIN_ROLES], users: [] };
  }
}

async function writeOrg(org) {
  await fs.mkdir(baseDir(), { recursive: true });
  // Через временный файл и переименование: иначе читатель, попавший на
  // середину записи, получил бы обрезанный JSON — а разбор здесь молча
  // возвращает пустую организацию, и владелец «терялся» бы.
  const tmp = `${file()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(org, null, 2), "utf8");
  await fs.rename(tmp, file());
  return org;
}

/** Владелец из переменной окружения, если она задана. */
export const envOwner = () =>
  (process.env.OWNER_TELEGRAM_ID ? String(process.env.OWNER_TELEGRAM_ID).trim() : null);

/**
 * Кто спрашивает и что ему видно. Первый вошедший становится владельцем,
 * если владелец не задан ни переменной, ни файлом.
 *
 * `claim: false` выключает это назначение — для случаев, когда человек
 * пришёл не «открыть модель», а по ссылке со стороны: инлайн-запрос,
 * звонок. Хозяином модели такой человек становиться не должен.
 */
export async function identify(userId, profile = {}, { claim = true } = {}) {
  const org = await readOrg();
  const env = envOwner();
  let changed = false;

  if (env && org.ownerId !== env) { org.ownerId = env; changed = true; }
  if (!org.ownerId && claim) { org.ownerId = String(userId); changed = true; }

  const id = String(userId);
  const isOwner = org.ownerId === id;
  let user = org.users.find((u) => u.id === id) || null;

  // Владелец есть в списке всегда — иначе его нельзя ни показать, ни
  // назначить исполнителем собственной задачи.
  if (isOwner && !user) {
    user = { id, name: profile.name || "владелец", username: profile.username || "",
      roleId: null, addedAt: new Date().toISOString(), addedBy: null };
    org.users.push(user); changed = true;
  }
  // Имя из Telegram обновляем на входе: человек мог его сменить, а в
  // приглашении оно записано таким, каким было тогда.
  if (user && profile.name && user.name !== profile.name) {
    user.name = profile.name; changed = true;
  }
  if (changed) await writeOrg(org);

  const role = user && user.roleId ? org.roles.find((r) => r.id === user.roleId) : null;
  return {
    id, isOwner,
    known: isOwner || !!user,
    name: user?.name || profile.name || "",
    // Своя анкета приходит вместе с «кто я»: она нужна на первой же
    // вкладке, и отдельный запрос за ней был бы вторым кругом за тем же.
    profile: profileOf(user || {}),
    role: role || null,
    // Владельцу доступно всё; остальным — то, что даёт роль. Не найдена
    // роль (её удалили) — не показываем ничего, кроме объяснения.
    tabs: isOwner ? [...TABS] : (role ? normTabs(role.tabs) : []),
  };
}

/* ─────── анкета человека ───────

   Рейтинг говорит, как человек работал. Анкета — всё остальное, что он
   счёл нужным о себе сказать, и пишет её сам человек, не владелец за него:
   про себя он знает точнее, а заполненная кем-то другим анкета была бы
   чужим мнением под чужим именем.

   Поле ОДНО. Прежде их было четыре — «чем занимается», «о себе», «что
   умеет», «как связаться», — и это была не анкета, а допрос по форме,
   которую никто не заказывал. Что писать о себе, решает человек.

   Лежит анкета рядом с человеком, в списке организации: она свойство
   человека, а не модели, и переезжать из сценария в сценарий вместе с
   моделью ей незачем. */
export const PROFILE_FIELDS = ["about"];

/* ─────── рабочий график и статус ───────

   Анкета говорит, ЧТО человек умеет; график и статус — РАБОТАЕТ ЛИ ОН
   СЕЙЧАС. Второе спрашивают раньше первого: ставить задачу тому, у кого
   сегодня выходной, значит назначить срок, которого никто не обещал.

   Пишет их сам человек, тем же маршрутом, что и анкету: чужой график,
   записанный за человека, — это догадка под его именем. Правила разбора
   те же, что на клиенте (`scheduleOfPerson` в `web/src/lib/workers.js`):
   день это 0–6, часы — «ЧЧ:ММ» или пусто, статус — один из четырёх. */
export const WORK_STATUSES = ["ready", "break", "off", "busy"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (v) => (HHMM.test(String(v || "")) ? String(v) : "");
const weekDays = (v) => (Array.isArray(v)
  ? [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
  : []);
const scheduleOf = (user = {}) => ({
  days: weekDays(user.days),
  from: hhmm(user.from),
  to: hhmm(user.to),
  status: WORK_STATUSES.includes(user.status) ? user.status : "ready",
});
/* Что было написано в прежних четырёх полях, не пропадает: пока анкета
   пуста, она читается как их склейка — а первое же сохранение переносит
   текст в неё насовсем. Молча выбросить чужие слова было бы хуже всего. */
const LEGACY_FIELDS = ["title", "skills", "contact"];
const LIMIT = 2000;
const profileOf = (user = {}) => {
  const about = String(user.about || "");
  const old = LEGACY_FIELDS.map((k) => String(user[k] || "").trim()).filter(Boolean);
  return { about: about || old.join("\n"), ...scheduleOf(user) };
};

/** Свою анкету человек пишет сам. Чужую — никто. */
export async function setProfile(userId, patch = {}) {
  const org = await readOrg();
  const id = String(userId);
  const user = org.users.find((u) => u.id === id);
  if (!user) return null;
  PROFILE_FIELDS.forEach((k) => {
    if (patch[k] == null) return;
    user[k] = String(patch[k]).slice(0, LIMIT);
  });
  /* График и статус разбираются, а не берутся как есть: сюда приходит то,
     что прислал браузер, и «понедельник» или «25:00» в записи человека
     означали бы график, по которому нельзя сказать ничего. */
  if (patch.days != null) user.days = weekDays(patch.days);
  if (patch.from != null) user.from = hhmm(patch.from);
  if (patch.to != null) user.to = hhmm(patch.to);
  if (patch.status != null) {
    user.status = WORK_STATUSES.includes(patch.status) ? patch.status : "ready";
  }
  await writeOrg(org);
  return profileOf(user);
}

export async function listOrg() {
  const org = await readOrg();
  /* Люди уходят наружу вместе с разобранной анкетой: график и статус нужны
     там же, где список, — при выборе, кому поручить работу. Собирать их
     вторым запросом на каждого человека значило бы спрашивать по одному то,
     что уже лежит рядом. */
  return {
    ownerId: org.ownerId,
    roles: org.roles,
    users: org.users.map((u) => ({ ...u, ...profileOf(u) })),
  };
}

export async function addUser({ id, name, username, roleId, addedBy }) {
  if (!id) throw new Error("id is required");
  const org = await readOrg();
  if (!org.roles.some((r) => r.id === roleId)) throw new Error("unknown role");
  const uid = String(id);
  const idx = org.users.findIndex((u) => u.id === uid);
  const entry = {
    id: uid, name: name || uid, username: username || "", roleId,
    addedAt: new Date().toISOString(), addedBy: addedBy ? String(addedBy) : null,
  };
  if (idx >= 0) org.users[idx] = { ...org.users[idx], ...entry };
  else org.users.push(entry);
  await writeOrg(org);
  return entry;
}

export async function removeUser(id) {
  const org = await readOrg();
  const uid = String(id);
  // Владельца из списка убрать нельзя: он останется владельцем, но
  // пропадёт из выбора исполнителей, и это выглядело бы как поломка.
  if (org.ownerId === uid) return false;
  const before = org.users.length;
  org.users = org.users.filter((u) => u.id !== uid);
  if (org.users.length === before) return false;
  await writeOrg(org);
  return true;
}

export async function setUserRole(id, roleId) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(id));
  if (!user) return null;
  if (!org.roles.some((r) => r.id === roleId)) throw new Error("unknown role");
  user.roleId = roleId;
  await writeOrg(org);
  return user;
}

const slug = (name) => String(name).toLowerCase()
  .replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "role";

export async function addRole({ name, tabs }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("name is required");
  const org = await readOrg();
  if (org.roles.some((r) => r.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error("role already exists");
  }
  let id = slug(clean), n = 2;
  while (org.roles.some((r) => r.id === id)) id = `${slug(clean)}-${n++}`;
  // Новая роль по умолчанию — исполнитель: из бота роль заводится одним
  // именем, а видеть чужие проверки без явного решения она не должна.
  const list = normTabs(tabs);
  const role = { id, name: clean, tabs: list.length ? list : ["tasks"], builtin: false };
  org.roles.push(role);
  await writeOrg(org);
  return role;
}

export async function setRoleTabs(id, tabs) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role) return null;
  role.tabs = normTabs(tabs);
  await writeOrg(org);
  return role;
}

export async function removeRole(id) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  // Удалить можно любую роль, включая встроенную, — кроме последней: без
  // единой роли позвать в модель станет некого.
  if (!role || org.roles.length <= 1) return false;
  org.roles = org.roles.filter((r) => r.id !== id);
  // Люди с удалённой ролью не исчезают — они остаются без роли, и это
  // видно в списке. Молча раздавать им другую роль нельзя.
  org.users = org.users.map((u) => (u.roleId === id ? { ...u, roleId: null } : u));
  await writeOrg(org);
  return true;
}
