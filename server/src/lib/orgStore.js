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

export const TABS = ["tasks", "review", "timeline", "scheme", "sim", "json"];

// Встроенные роли переименовать и удалить нельзя: на них ссылается
// приглашение из бота, и остаться без единой роли значит остаться без
// возможности кого-либо добавить.
export const BUILTIN_ROLES = [
  { id: "executor", name: "исполнитель", tabs: ["tasks"], builtin: true },
  { id: "reviewer", name: "проверяющий", tabs: ["review"], builtin: true },
  { id: "worker", name: "исполнитель и проверяющий", tabs: ["tasks", "review"], builtin: true },
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
      // Встроенные роли дописываем всегда: файл мог быть сохранён версией,
      // которая их ещё не знала, а без них приглашать некого.
      roles: [...roles, ...BUILTIN_ROLES.filter((b) => !roles.some((r) => r.id === b.id))],
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch {
    return { ...EMPTY, roles: [...BUILTIN_ROLES], users: [] };
  }
}

async function writeOrg(org) {
  await fs.mkdir(baseDir(), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(org, null, 2), "utf8");
  return org;
}

/** Владелец из переменной окружения, если она задана. */
export const envOwner = () =>
  (process.env.OWNER_TELEGRAM_ID ? String(process.env.OWNER_TELEGRAM_ID).trim() : null);

/**
 * Кто спрашивает и что ему видно. Первый вошедший становится владельцем,
 * если владелец не задан ни переменной, ни файлом.
 */
export async function identify(userId, profile = {}) {
  const org = await readOrg();
  const env = envOwner();
  let changed = false;

  if (env && org.ownerId !== env) { org.ownerId = env; changed = true; }
  if (!org.ownerId) { org.ownerId = String(userId); changed = true; }

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
    role: role || null,
    // Владельцу доступно всё; остальным — то, что даёт роль. Не найдена
    // роль (её удалили) — не показываем ничего, кроме объяснения.
    tabs: isOwner ? [...TABS] : (role ? role.tabs.filter((t) => TABS.includes(t)) : []),
  };
}

export async function listOrg() {
  const org = await readOrg();
  return { ownerId: org.ownerId, roles: org.roles, users: org.users };
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
  const list = Array.isArray(tabs) ? tabs.filter((t) => TABS.includes(t)) : [];
  const role = { id, name: clean, tabs: list.length ? list : ["tasks"], builtin: false };
  org.roles.push(role);
  await writeOrg(org);
  return role;
}

export async function setRoleTabs(id, tabs) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role) return null;
  role.tabs = (Array.isArray(tabs) ? tabs : []).filter((t) => TABS.includes(t));
  await writeOrg(org);
  return role;
}

export async function removeRole(id) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role || role.builtin) return false;
  org.roles = org.roles.filter((r) => r.id !== id);
  // Люди с удалённой ролью не исчезают — они остаются без роли, и это
  // видно в списке. Молча раздавать им другую роль нельзя.
  org.users = org.users.map((u) => (u.roleId === id ? { ...u, roleId: null } : u));
  await writeOrg(org);
  return true;
}
