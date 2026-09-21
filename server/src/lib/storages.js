import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ХРАНИЛИЩА · у каждого своё (владелец, 2026-09-21)

   Хранилище — всё, что принадлежит одному человеку: его организация
   (роли, участники, договоры), модель, сценарии, ссылки, откаты.
   Прежняя модель становится хранилищем ВЛАДЕЛЬЦА, а позванные — его
   участниками; у каждого зарегистрированного — своё, пустое, с двумя
   активами по умолчанию. Хранилища изолированы: каждое — свой каталог,
   и завтра его можно унести на другой сервер целиком.

   Как оно выбирается. В запросе — заголовок `X-Storage`: своё (по
   умолчанию) или чужое, куда человека позвали. Дальше по всему запросу
   хранилище известно из контекста (`AsyncLocalStorage`): стор берёт
   свой каталог через `scopedDir(base)`, и ни один маршрут не носит id
   хранилища в руках. Вне запросов (бот, планировщик) хранилище задаётся
   явно: `inStorage(id, fn)`; не задано — MAIN, как было всегда.

   Что НЕ по хранилищам: напоминания, память и настройки помощника,
   файлы отчётов, встречи, рынок, сообщения об ошибках, связь кода с
   записью — это про человека, а не про его модель.
   ════════════════════════════════════════════════════════════════ */
export const MAIN = "main";
const als = new AsyncLocalStorage();

export const current = () => als.getStore() || MAIN;
export const inStorage = (id, fn) => als.run(String(id || MAIN), fn);
export const isMain = (id = current()) => String(id) === MAIN;

const safe = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_") || "x";
/** Каталог стора внутри текущего хранилища. MAIN живёт там, где жил. */
export function scopedDir(base) {
  const id = current();
  return id === MAIN ? base : path.join(base, "storages", safe(id));
}

/* ─────── реестр хранилищ ───────
   Один файл в ORG_DIR: кто какое завёл. MAIN в нём не записан — оно
   есть всегда. Организацию и модель хранилища читают их сторы; здесь
   org.json читается напрямую только ради вопроса «кто участник» — стор
   организации сам зависит от этого модуля, и звать его отсюда нельзя. */
const orgBase = () => (process.env.ORG_DIR
  ? path.resolve(process.env.ORG_DIR) : path.resolve(process.cwd(), "data", "org"));
const indexFile = () => path.join(orgBase(), "storages.json");

async function readIndex() {
  try {
    const j = JSON.parse(await fs.readFile(indexFile(), "utf8"));
    return Array.isArray(j?.list) ? j.list : [];
  } catch { return []; }
}
async function writeIndex(list) {
  await fs.mkdir(orgBase(), { recursive: true });
  const tmp = `${indexFile()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ list }, null, 2), "utf8");
  await fs.rename(tmp, indexFile());
}
const rawOrg = async (id) => {
  try {
    const dir = id === MAIN ? orgBase() : path.join(orgBase(), "storages", safe(id));
    return JSON.parse(await fs.readFile(path.join(dir, "org.json"), "utf8"));
  } catch { return null; }
};

/** Все хранилища: MAIN и заведённые. */
export async function listStorages() {
  return [{ id: MAIN, ownerId: null }, ...(await readIndex())];
}

/** Владелец MAIN: из переменной или из его org.json. */
export async function mainOwnerId() {
  const env = process.env.OWNER_TELEGRAM_ID ? String(process.env.OWNER_TELEGRAM_ID).trim() : "";
  if (env) return env;
  const org = await rawOrg(MAIN);
  return org?.ownerId != null ? String(org.ownerId) : null;
}

/** Своё хранилище человека: владельцу MAIN — MAIN, остальным — по их id.
    У MAIN ещё нет владельца — первый пришедший и есть владелец (то же
    правило, что было у модели): его хранилище — MAIN. */
export async function ownStorageOf(userId) {
  const id = String(userId);
  const owner = await mainOwnerId();
  return owner === null || owner === id ? MAIN : id;
}

let q = Promise.resolve();
const serial = (fn) => { const run = q.then(fn); q = run.catch(() => {}); return run; };

/**
 * Завести человеку его хранилище, если его ещё нет: запись в реестре и
 * организация с ним во главе. Модель с активами по умолчанию появится
 * при первом чтении (workspaceStore). Возвращает id хранилища.
 */
export async function ensureStorage(userId, { name = "" } = {}) {
  const id = await ownStorageOf(userId);
  if (id === MAIN) return id;
  return serial(async () => {
    const list = await readIndex();
    if (list.some((s) => s.id === id)) return id;
    await inStorage(id, async () => {
      const dir = scopedDir(orgBase());
      await fs.mkdir(dir, { recursive: true });
      const org = { ownerId: String(userId), users: [{ id: String(userId), name: name || "владелец",
        username: "", roleId: null, addedAt: new Date().toISOString(), addedBy: null }] };
      await fs.writeFile(path.join(dir, "org.json"), JSON.stringify(org, null, 2), "utf8");
    });
    await writeIndex([...list, { id, ownerId: String(userId), createdAt: new Date().toISOString() }]);
    return id;
  });
}

/** Участник ли человек хранилища: его владелец или записан среди людей. */
export async function memberOf(storageId, userId) {
  const id = String(userId);
  const org = await rawOrg(storageId);
  if (!org) return storageId === MAIN && (await mainOwnerId()) === id;
  if (String(org.ownerId ?? "") === id) return true;
  if (storageId === MAIN && (await mainOwnerId()) === id) return true;
  return (org.users || []).some((u) => String(u.id) === id || String(u.tg || "") === id);
}

/**
 * Хранилища, где человек есть: своё — первым, дальше те, куда позвали.
 * С именем владельца: так их и показывают.
 */
export async function storagesOf(userId) {
  const own = await ownStorageOf(userId);
  const out = [];
  for (const s of await listStorages()) {
    if (s.id !== own && !(await memberOf(s.id, userId))) continue;
    const org = await rawOrg(s.id);
    const ownerId = s.id === MAIN ? await mainOwnerId() : s.ownerId;
    const owner = (org?.users || []).find((u) => String(u.id) === String(ownerId));
    out.push({ id: s.id, own: s.id === own, ownerId: ownerId != null ? String(ownerId) : null,
      owner: owner?.name || "" });
  }
  out.sort((a, b) => (a.own === b.own ? 0 : a.own ? -1 : 1));
  return out;
}

/** Первое хранилище, где `pred` (внутри его контекста) вернул истину. */
export async function findStorage(pred) {
  for (const s of await listStorages()) {
    if (await inStorage(s.id, () => pred(s.id))) return s.id;
  }
  return null;
}

/**
 * Выполнить `fn` в том хранилище, где лежит задача. Задача ищется
 * среди хранилищ человека: id задач случайные, и двух одинаковых нет.
 */
export async function inTaskStorage(userId, taskId, hasTask, fn) {
  for (const s of await storagesOf(userId)) {
    if (await inStorage(s.id, () => hasTask(taskId))) return inStorage(s.id, fn);
  }
  return inStorage(MAIN, fn);
}
