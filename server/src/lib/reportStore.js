import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   Файлы отчётов по задачам.

   Раньше файл сдачи жил внутри сценария как data:-URL. Это удобно ровно
   до второго снимка экрана: base64 раздувает файл на треть, сценарий
   целиком лежит в одной ячейке хранилища, и три отчёта с фотографиями
   упирались в лимит. Здесь файл лежит на диске отдельно, а в сценарий
   уезжает только ссылка.

   Владение — по telegram user id, как у сценариев: чужой файл не отдаётся
   даже по угаданной ссылке, потому что манифест у каждого свой.
   ════════════════════════════════════════════════════════════════ */

const CONTROL_OR_SEP = /[\u0000-\u001f\u007f/\\]/g;

// 100 МБ: запись созвона при 300 кбит/с — это около 45 минут. Больше не
// держим: диск сервера общий с моделью, и одна запись не должна его забить.
export const MAX_REPORT_BYTES = 100 * 1024 * 1024;
const MAX_REPORTS_PER_USER = 2000;
const MAX_NAME_LEN = 200;

// Тип берётся от клиента, поэтому отдаём обратно только то, что не может
// исполниться в браузере как разметка или скрипт: иначе загруженный «отчёт»
// открывался бы как страница в origin приложения.
const SAFE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif",
  "application/pdf", "text/plain", "text/csv",
  "audio/mpeg", "audio/ogg", "audio/mp4", "video/mp4", "video/quicktime", "video/webm",
  "application/zip", "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword", "application/vnd.ms-excel",
]);
const FALLBACK_TYPE = "application/octet-stream";

export const safeType = (t) => (SAFE_TYPES.has(String(t || "").toLowerCase())
  ? String(t).toLowerCase() : FALLBACK_TYPE);

function baseDir() {
  return process.env.REPORTS_DIR
    ? path.resolve(process.env.REPORTS_DIR)
    : path.resolve(process.cwd(), "data", "reports");
}

/* Ссылка на файл должна работать из <img src> и из обычной ссылки, а туда
   заголовок с подписью Telegram не подставить: браузер грузит картинку сам.
   Поэтому читается файл по «ссылке-ключу»: каталог пользователя назван
   случайным 32-символьным токеном (scope), и знание пары scope+id и есть
   право на чтение. Токен выдаётся один раз при первой загрузке и лежит
   указателем рядом, чтобы не зависеть ни от id пользователя, ни от токена
   бота: сменится бот — ссылки в старых сценариях продолжат работать.

   Плата за это названа прямо: кто получил ссылку — тот прочитает файл.
   Ссылка живёт внутри сценария, поэтому отдать сценарий целиком значит
   отдать и его отчёты. Запись и удаление по-прежнему требуют подписи. */
export const SCOPE_RE = /^[a-f0-9]{32}$/;

const usersDir = () => path.join(baseDir(), "users");

// id пользователя прогоняется через строгий whitelist — подняться выше
// каталога указателей нельзя никаким вводом.
const userPointer = (userId) =>
  path.join(usersDir(), String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown");

export async function scopeFor(userId, { create = false } = {}) {
  const ptr = userPointer(userId);
  try {
    const scope = (await fs.readFile(ptr, "utf8")).trim();
    if (SCOPE_RE.test(scope)) return scope;
  } catch {
    /* указателя ещё нет */
  }
  if (!create) return null;
  const scope = crypto.randomBytes(16).toString("hex");
  await fs.mkdir(usersDir(), { recursive: true });
  await fs.writeFile(ptr, scope, "utf8");
  return scope;
}

const scopeDir = (scope) => path.join(baseDir(), scope);

async function readManifest(dir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const writeManifest = (dir, m) =>
  fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2), "utf8");

/* Имя показывается пользователю и попадает в заголовок ответа: вырезаем
   разделители путей и управляющие символы, остальное оставляем как есть —
   русские имена файлов ломать незачем. */
export function safeName(name) {
  const cleaned = String(name || "")
    .replace(CONTROL_OR_SEP, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);
  return cleaned || "отчёт";
}

/* Метка вида файла: «call» у записей созвонов, пусто у обычных вложений к
   задачам. Нужна ровно затем, чтобы на вкладке звонков показывать записи, а
   не всё подряд, что человек когда-либо прикладывал. Держим её узкой —
   короткая латиница, — чтобы в манифест не уезжало что попало из заголовка. */
export const safeKind = (k) => (/^[a-z]{1,16}$/.test(String(k || "")) ? String(k) : "");

export async function saveReport(userId, { name, type, bytes, kind } = {}) {
  if (!bytes || !bytes.length) throw new Error("file is required");
  if (bytes.length > MAX_REPORT_BYTES) {
    throw new Error(`file must be at most ${Math.round(MAX_REPORT_BYTES / 1024 / 1024)} MB`);
  }
  const scope = await scopeFor(userId, { create: true });
  const dir = scopeDir(scope);
  await fs.mkdir(dir, { recursive: true });
  const manifest = await readManifest(dir);
  if (manifest.length >= MAX_REPORTS_PER_USER) {
    throw new Error(`limit of ${MAX_REPORTS_PER_USER} report files reached`);
  }
  const id = crypto.randomUUID();
  const entry = {
    id, name: safeName(name), type: safeType(type),
    size: bytes.length, savedAt: new Date().toISOString(),
    ...(safeKind(kind) ? { kind: safeKind(kind) } : {}),
  };
  // Расширения у файла на диске нет намеренно: имя и тип живут в манифесте,
  // а статикой этот каталог не отдаётся — только через маршрут с проверкой.
  await fs.writeFile(path.join(dir, id), bytes);
  manifest.push(entry);
  await writeManifest(dir, manifest);
  return { ...entry, scope, url: `/api/reports/${scope}/${id}` };
}

/**
 * Что у человека лежит. Только своё: scope выводится из подписанного
 * пользователя, а не берётся из запроса, — иначе список стал бы способом
 * заглянуть в чужой.
 *
 * Записи созвонов помечены kind: "call". Файлы, сохранённые до появления
 * метки, её не имеют — и это не повод их прятать: фильтр по виду применяем
 * только когда о нём попросили.
 */
export async function listReports(userId, { kind = "" } = {}) {
  const scope = await scopeFor(userId);
  if (!scope) return [];
  const manifest = await readManifest(scopeDir(scope));
  const want = safeKind(kind);
  return manifest
    .filter((m) => !want || m.kind === want)
    .map((m) => ({ ...m, scope, url: `/api/reports/${scope}/${m.id}` }))
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

/** Своё по id — с байтами. Для отправки в чат: наружу файл не уходит. */
export async function ownReport(userId, id) {
  const scope = await scopeFor(userId);
  if (!scope) return null;
  const entry = (await readManifest(scopeDir(scope))).find((m) => m.id === id);
  if (!entry) return null;
  try {
    return {
      ...entry, scope, url: `/api/reports/${scope}/${entry.id}`,
      bytes: await fs.readFile(path.join(scopeDir(scope), entry.id)),
    };
  } catch { return null; }
}

/** Чтение — по ссылке-ключу: scope из URL, а не из подписи запроса. */
export async function getReport(scope, id) {
  if (!SCOPE_RE.test(String(scope || ""))) return null;
  const dir = scopeDir(scope);
  const entry = (await readManifest(dir)).find((m) => m.id === id);
  if (!entry) return null;
  try {
    return { ...entry, bytes: await fs.readFile(path.join(dir, entry.id)) };
  } catch {
    return null;
  }
}

/** Удаление — только своё: scope выводится из подписанного пользователя,
 *  а не берётся из URL, иначе ссылка давала бы право стирать чужое. */
export async function deleteReport(userId, id) {
  const scope = await scopeFor(userId);
  if (!scope) return false;
  const dir = scopeDir(scope);
  const manifest = await readManifest(dir);
  const idx = manifest.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  const [entry] = manifest.splice(idx, 1);
  await writeManifest(dir, manifest);
  await fs.rm(path.join(dir, entry.id), { force: true });
  return true;
}
