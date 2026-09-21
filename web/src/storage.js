import { getTelegram, getInitData } from "./telegram.js";
import { codeHeader } from "./codes.js";
import { actingAs } from "./identity.js";

/* Под чужой страницей — и здесь: «Войти под его именем» меняет не одну
   вкладку, а всё приложение (см. identity.js). */
const actHeader = () => (actingAs() ? { "X-Act-As": actingAs() } : {});

/* ════════════════════════════════════════════════════════════════
   Хранилище сценариев модели.

   Три реализации, выбираются автоматически по убыванию предпочтения:

   1. "server" — бэкенд /api/scenarios (когда приложение развёрнуто на VPS
      вместе с server/). Сценарии лежат файлами на диске сервера.
   2. "cloud"  — Telegram CloudStorage: облако Telegram, привязанное к
      аккаунту пользователя. Переживает переустановку и виден на всех
      устройствах. Сервер не нужен вообще.
   3. "local"  — localStorage браузера. Запасной вариант, когда приложение
      открыли не в Telegram и бэкенда нет.

   Наружу торчит один и тот же промис-API, поэтому вызывающий код
   (блок сохранения во вкладке «JSON») не знает, куда именно пишет.
   ════════════════════════════════════════════════════════════════ */

const MAX_SCENARIOS = 30;
// Telegram разрешает 4096 символов на одно значение — режем с запасом.
const CHUNK_SIZE = 3800;
const INDEX_KEY = "sd_index";
const LOCAL_KEY = "sd_scenarios";

const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowIso = () => new Date().toISOString();
const byNewest = (a, b) => String(b.savedAt).localeCompare(String(a.savedAt));

/* ─────── определение доступного хранилища ─────── */

let probe = null;
export function detectStorage() {
  if (!probe) probe = probeStorage();
  return probe;
}

async function probeStorage() {
  // Бэкенд есть только в варианте с сервером. На статичном хостинге
  // /api/health вернёт 404 или HTML — это не сервер.
  try {
    const r = await fetch("/api/health", { headers: { Accept: "application/json" } });
    if (r.ok && (r.headers.get("content-type") || "").includes("application/json")) {
      const j = await r.json();
      // Сервер может быть жив, но с выключенным хранилищем сценариев
      // (не задан токен бота) — тогда пишем в облако Telegram.
      if (j && j.ok && j.scenarios) return "server";
    }
  } catch {
    /* бэкенда нет — идём дальше */
  }

  if (cloudApi()) {
    try {
      await cloudKeys();
      return "cloud";
    } catch {
      /* клиент Telegram старше Bot API 6.9 — CloudStorage недоступен */
    }
  }

  return "local";
}

export const STORAGE_LABEL = {
  server: "на диск сервера",
  cloud: "в облако Telegram",
  local: "в память этого браузера",
};

/* Сколько сценариев помещается в хранилище каждого вида. Жёсткие пределы
   стоят там, где пишут: на сервере — MAX_SCENARIOS_PER_USER в
   scenarioStore.js (то же число, что здесь), в облаке — MAX_SCENARIOS выше.
   Но об отказе человек узнавал у самого предела, когда сохранить уже
   нельзя. Число здесь — чтобы сказать заранее, и сказать про то
   хранилище, которое действует сейчас: пределы разные. У памяти браузера
   предела в сценариях нет — её режет размер, и он у каждого свой. */
export const SCENARIO_LIMIT = { server: 200, cloud: MAX_SCENARIOS, local: 0 };

/* Подпись «сколько занято» под списком сохранённых: `count` из предела и
   предупреждение, когда осталось мало (десятая часть, но не меньше трёх)
   или не осталось совсем. Без предела — только число. */
export function savedRoom(count, kind) {
  const n = Math.max(0, Number(count) || 0);
  const max = SCENARIO_LIMIT[kind] || 0;
  if (!max) return { text: `сценариев: ${n}`, warn: false, left: null };
  const left = Math.max(0, max - n);
  const tail = left === 0 ? " — места нет: удали лишние или перезапиши существующий"
    : left <= Math.max(3, Math.ceil(max / 10)) ? ` — осталось ${left}, удали лишние` : "";
  return { text: `сценариев: ${n} из ${max}${tail}`, warn: !!tail, left };
}

/* ─────── публичный API ─────── */

/* ─────── какая схема открывается по умолчанию ───────

   Приложение — не блокнот с одним документом: схем у владельца несколько, и
   открываться должна та, с которой он работал в прошлый раз, а не первая
   попавшаяся и не встроенная демонстрационная. Иначе каждый заход начинается
   с «переключить обратно на свою».

   Память об этом живёт в ДВУХ местах, и это не дублирование, а разные
   сроки жизни:

   · `openedAt` у самого сценария — там же, где лежит сам сценарий. Это
     главный ответ: он переживает и чистку WebView (Telegram делает её без
     предупреждения), и переход на другое устройство.
   · id в localStorage — быстрый ответ на этот же вопрос, пока браузер
     помнит. Он нужен только чтобы не ждать сети там, где ответ уже есть.

   Раньше память была только вторая, и стоило Telegram почистить хранилище —
   открывалась не та схема: приложение падало на «самую свежую по времени
   СОХРАНЕНИЯ», а последняя открытая и последняя сохранённая — разные вещи.
   Порядок ответов теперь такой: запомненный id → самая свежая по openedAt →
   самая свежая по savedAt. */
const LAST_KEY = "sd_last_scenario";
const byOpened = (a, b) => String(b.openedAt || "").localeCompare(String(a.openedAt || ""));

export function rememberScenario(id) {
  try { if (id) localStorage.setItem(LAST_KEY, String(id)); } catch { /* нет хранилища */ }
}
export function forgetScenario(id) {
  try {
    if (!id || localStorage.getItem(LAST_KEY) === String(id)) localStorage.removeItem(LAST_KEY);
  } catch { /* нет хранилища */ }
}
export function lastScenarioId() {
  try { return localStorage.getItem(LAST_KEY) || null; } catch { return null; }
}

/** Какую схему открывать: запомненную, иначе последнюю открытую, иначе свежую. */
export async function pickScenario() {
  const list = await listScenarios();
  if (!list.length) return null;
  const want = lastScenarioId();
  const remembered = list.find((s) => String(s.id) === String(want));
  if (remembered) return remembered;
  const opened = list.filter((s) => s.openedAt).sort(byOpened)[0];
  return opened || list.slice().sort(byNewest)[0];
}

/**
 * Отметить, что схему открывали, — там же, где она лежит.
 *
 * Тихая операция: не получилось отметить (сеть, старый сервер) — беда не
 * велика, останется браузерная память. Ронять открытие схемы из-за отметки
 * о ней было бы обменом важного на второстепенное.
 */
export async function touchScenario(id) {
  rememberScenario(id);
  try {
    const kind = await detectStorage();
    if (kind === "server") await serverTouch(id);
    else if (kind === "cloud") await cloudTouch(id);
    else localTouch(id);
  } catch { /* отметка не обязана удаваться */ }
}

export async function listScenarios() {
  const kind = await detectStorage();
  if (kind === "server") return serverList();
  if (kind === "cloud") return cloudList();
  return localList();
}

export async function getScenario(id) {
  const kind = await detectStorage();
  if (kind === "server") return serverGet(id);
  if (kind === "cloud") return cloudGet(id);
  return localGet(id);
}

export async function saveScenario({ id, name, data }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Впиши имя сценария.");
  const kind = await detectStorage();
  if (kind === "server") return serverSave({ id, name: trimmed, data });
  if (kind === "cloud") return cloudSave({ id, name: trimmed, data });
  return localSave({ id, name: trimmed, data });
}

/** Версии сценария: {v, at, name} — новые последними. Где версий нет, пусто. */
export async function listScenarioVersions(id) {
  if (!id) return [];
  const kind = await detectStorage();
  if (kind === "server") { try { return await serverVersions(id); } catch { return []; } }
  if (kind === "local") return localVersions(id).map(({ v, at, name }) => ({ v, at, name }));
  return [];
}

/** Снимок версии: схема, какой её сохранили. */
export async function getScenarioVersion(id, v) {
  if (!id) return null;
  const kind = await detectStorage();
  if (kind === "server") { try { return await serverVersion(id, v); } catch { return null; } }
  if (kind === "local") return localVersions(id).find((x) => String(x.v) === String(v)) || null;
  return null;
}

export async function deleteScenario(id) {
  const kind = await detectStorage();
  if (kind === "server") return serverDelete(id);
  if (kind === "cloud") return cloudDelete(id);
  return localDelete(id);
}

/* ─────── расписание напоминаний ───────
   Планировщик живёт на сервере, поэтому задачи нужно ему отдать. Отправляем
   только когда бэкенд есть и напоминания у него включены: на статике или без
   токена бота слать некуда. */

let remindersOk = null;
async function remindersAvailable() {
  if (remindersOk !== null) return remindersOk;
  try {
    const r = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const j = r.ok ? await r.json() : null;
    remindersOk = Boolean(j && j.ok && j.reminders);
  } catch {
    remindersOk = false;
  }
  return remindersOk;
}

/**
 * Отдать планировщику задачи как есть. «За сколько предупредить» (`warn`)
 * в каждой уже подставлено вызывающим — из анкеты того, кто шлёт
 * (`me.profile.warnMin` в SystemModel): это его настройка, а не задачи, и
 * здесь её не откуда взять. Пересылается при входе и при каждой правке.
 */
export async function syncSchedule(tasks) {
  if (!(await remindersAvailable())) return false;
  const r = await fetch("/api/schedule", {
    method: "PUT",
    headers: apiHeaders(),
    // Часовой пояс нужен серверу: в задачах время «настенное», без зоны.
    body: JSON.stringify({ tzOffset: new Date().getTimezoneOffset(), tasks }),
  });
  return r.ok;
}

/* ─────── файлы отчётов ───────
   Файл сдачи хранится на диске сервера, а в сценарий уезжает ссылка. Когда
   сервера нет (статичный хостинг, приложение открыто вне Telegram), падаем
   обратно на data:-URL внутри сценария: потерять отчёт хуже, чем раздуть
   документ. Поэтому у файла в сценарии два возможных вида — `url` и `data`, —
   и показывать надо тот, который есть. */

// Инлайн переживает выгрузку сценария целиком, поэтому лимит здесь жёстче:
// это то, что ляжет в одну ячейку хранилища вместе со всей моделью.
export const MAX_INLINE_REPORT_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_REPORT_BYTES = 100 * 1024 * 1024;   // как MAX_REPORT_BYTES на сервере

let reportsOk = null;
/** Забыть ответ про хранилище — нужно тестам, как resetIdentity рядом. */
export function resetReportsAvailable() { reportsOk = null; }
export async function reportsAvailable() {
  if (reportsOk !== null) return reportsOk;
  try {
    const r = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const j = r.ok ? await r.json() : null;
    reportsOk = Boolean(j && j.ok && j.reports);
  } catch {
    reportsOk = false;
  }
  return reportsOk;
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("не удалось прочитать файл"));
  r.readAsDataURL(file);
});

/** Кладёт файл отчёта туда, где он переживёт перезагрузку, и возвращает
 *  запись для сдачи: `{name, type, size, url}` либо `{name, type, size, data}`. */
export async function putReportFile(file, { kind = "", meeting = "" } = {}) {
  const meta = { name: file.name, type: file.type, size: file.size };
  if (await reportsAvailable()) {
    if (file.size > MAX_UPLOAD_REPORT_BYTES) {
      throw new Error(`файл больше ${Math.round(MAX_UPLOAD_REPORT_BYTES / 1024 / 1024)} МБ — не поместится`);
    }
    // Имя едет в заголовке, а заголовки latin-1: кириллицу шлём base64.
    const nameB64 = btoa(String.fromCharCode(...new TextEncoder().encode(file.name)));
    const r = await fetch("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Report-Name": nameB64,
        "X-Report-Type": file.type || "application/octet-stream",
        // Вид файла: «call» у записей созвонов. По нему вкладка звонков
        // показывает записи, а не всё, что человек когда-либо приложил.
        ...(kind ? { "X-Report-Kind": kind } : {}),
        // Встреча, к которой относится запись: по ней расшифровка ложится
        // и к встрече, а не только к файлу (routes/reports.js).
        ...(meeting ? { "X-Report-Meeting": String(meeting) } : {}),
        "X-Telegram-Init-Data": getInitData(), ...codeHeader(),
        ...actHeader(),
      },
      body: file,
    });
    if (!r.ok) throw new Error(`не удалось загрузить файл (сервер ответил ${r.status})`);
    const saved = await r.json();
    return { ...meta, name: saved.name || meta.name, id: saved.id, url: saved.url };
  }
  if (file.size > MAX_INLINE_REPORT_BYTES) {
    throw new Error(`без сервера файл хранится внутри сценария — не больше ${Math.round(MAX_INLINE_REPORT_BYTES / 1024 / 1024)} МБ`);
  }
  return { ...meta, data: await readAsDataUrl(file) };
}

/** Куда смотреть за содержимым файла — ссылка на диск или инлайн. */
export const reportSrc = (f) => (f ? (f.url || f.data || "") : "");

/* ─────── «Скачать» = прислать себе в чат с ботом ───────

   Сохранить файл из мини-приложения на телефон нельзя: WebView Telegram
   не даёт, и ссылка со скачиванием там просто ничего не делает (владелец,
   2026-09-20). Из чата с ботом — можно, и это один путь на все «Скачать»:
   договор участника, материал на входе, вещь на выходе. Без файла (текст
   или код) уходит сообщением. */
export async function deliverFile({ url, text, name } = {}) {
  const r = await fetch("/api/reports/deliver", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": getInitData(), ...codeHeader(),
      ...actHeader() },
    body: JSON.stringify({ url, text, name }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `не удалось отправить (сервер ответил ${r.status})`);
  return out;
}

/* Файл для скачивания текста или кода: вещь без файла всё равно скачивают.
   Правило одно на все места, где единицу дают скачать, — «Отчёты», форма
   задачи, «Проверка»: у одной вещи одна ссылка. */
export const textHref = (text) => `data:text/plain;charset=utf-8,${encodeURIComponent(text || "")}`;

/* ─────── 1. сервер ─────── */

const apiHeaders = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(), ...codeHeader(),
  ...actHeader(),
});

async function serverJson(url, opts) {
  const r = await fetch(url, { headers: apiHeaders(), ...opts });
  if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const serverList = () => serverJson("/api/scenarios");
const serverGet = (id) => serverJson(`/api/scenarios/${encodeURIComponent(id)}`);
/* Версии сценария (владелец, 2026-09-19): каждое сохранение — версия. */
const serverVersions = (id) => serverJson(`/api/scenarios/${encodeURIComponent(id)}/versions`);
const serverVersion = (id, v) => serverJson(`/api/scenarios/${encodeURIComponent(id)}/versions/${encodeURIComponent(v)}`);
const serverTouch = (id) =>
  serverJson(`/api/scenarios/${encodeURIComponent(id)}/open`, { method: "POST" });
const serverDelete = (id) =>
  serverJson(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" });

function serverSave({ id, name, data }) {
  const body = JSON.stringify({ name, data });
  return id
    ? serverJson(`/api/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body })
    : serverJson("/api/scenarios", { method: "POST", body });
}

/* ─────── 2. Telegram CloudStorage ─────── */

function cloudApi() {
  const cs = getTelegram()?.CloudStorage;
  return cs && typeof cs.setItem === "function" ? cs : null;
}

// Колбэчный API Telegram → промисы.
const cloudCall = (method, ...args) =>
  new Promise((resolve, reject) => {
    const cs = cloudApi();
    if (!cs) return reject(new Error("CloudStorage недоступен"));
    try {
      cs[method](...args, (err, result) => (err ? reject(new Error(String(err))) : resolve(result)));
    } catch (e) {
      reject(e);
    }
  });

const cloudKeys = () => cloudCall("getKeys");
const cloudGetItem = (k) => cloudCall("getItem", k);
const cloudGetItems = (keys) => cloudCall("getItems", keys);
const cloudSetItem = (k, v) => cloudCall("setItem", k, v);
const cloudRemoveItems = (keys) => (keys.length ? cloudCall("removeItems", keys) : Promise.resolve());

async function cloudIndex() {
  const raw = await cloudGetItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const chunkKeys = (entry) =>
  Array.from({ length: entry.chunks }, (_, i) => `sd_${entry.id}_${i}`);

async function cloudTouch(id) {
  const index = await cloudIndex();
  if (!index.some((e) => e.id === id)) return;
  const next = index.map((e) => (e.id === id ? { ...e, openedAt: nowIso() } : e));
  await cloudSetItem(INDEX_KEY, JSON.stringify(next));
}

async function cloudList() {
  return (await cloudIndex()).slice().sort(byNewest)
    .map(({ id, name, savedAt, openedAt }) => ({ id, name, savedAt, openedAt: openedAt || null }));
}

async function cloudGet(id) {
  const entry = (await cloudIndex()).find((e) => e.id === id);
  if (!entry) return null;
  const keys = chunkKeys(entry);
  const map = await cloudGetItems(keys);
  const raw = keys.map((k) => map?.[k] ?? "").join("");
  return { id: entry.id, name: entry.name, savedAt: entry.savedAt, data: JSON.parse(raw) };
}

async function cloudSave({ id, name, data }) {
  const index = await cloudIndex();
  const existing = id ? index.find((e) => e.id === id) : null;
  if (!existing && index.length >= MAX_SCENARIOS) {
    throw new Error(`В облаке Telegram помещается ${MAX_SCENARIOS} сценариев — удали лишние.`);
  }

  const raw = JSON.stringify(data);
  const parts = [];
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) parts.push(raw.slice(i, i + CHUNK_SIZE));
  if (!parts.length) parts.push("");

  // Сохранение — тоже работа с этой схемой: она становится последней.
  const entry = {
    id: existing ? existing.id : newId(),
    name,
    savedAt: nowIso(),
    openedAt: nowIso(),
    chunks: parts.length,
  };

  // Пишем куски, затем индекс: если запись оборвётся, индекс останется
  // указывать на прежнее консистентное состояние.
  for (let i = 0; i < parts.length; i++) await cloudSetItem(`sd_${entry.id}_${i}`, parts[i]);

  // Хвост от прошлой, более длинной версии этого же сценария.
  if (existing && existing.chunks > parts.length) {
    const stale = Array.from(
      { length: existing.chunks - parts.length },
      (_, i) => `sd_${entry.id}_${parts.length + i}`,
    );
    await cloudRemoveItems(stale);
  }

  const next = existing ? index.map((e) => (e.id === entry.id ? entry : e)) : [...index, entry];
  await cloudSetItem(INDEX_KEY, JSON.stringify(next));
  return { id: entry.id, name: entry.name, savedAt: entry.savedAt, openedAt: entry.openedAt };
}

async function cloudDelete(id) {
  const index = await cloudIndex();
  const entry = index.find((e) => e.id === id);
  if (!entry) return null;
  await cloudSetItem(INDEX_KEY, JSON.stringify(index.filter((e) => e.id !== id)));
  await cloudRemoveItems(chunkKeys(entry));
  return null;
}

/* ─────── 3. localStorage ─────── */

function localRead() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (parsed && Array.isArray(parsed.index) && parsed.data) return parsed;
  } catch {
    /* повреждённое или недоступное хранилище — начинаем с чистого */
  }
  return { index: [], data: {} };
}

function localWrite(store) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch {
    throw new Error("Браузер не дал сохранить (нет места или запрещено хранилище).");
  }
}

async function localList() {
  return localRead().index.slice().sort(byNewest);
}

async function localGet(id) {
  const store = localRead();
  const entry = store.index.find((e) => e.id === id);
  if (!entry) return null;
  return { ...entry, data: JSON.parse(store.data[id]) };
}

/* В браузере версий держим немного: памяти там мало, и схема в ней не одна. */
const LOCAL_VERSIONS = 10;
function localVersions(id) {
  const store = localRead();
  return (store.versions && store.versions[id]) || [];
}
async function localSave({ id, name, data }) {
  const store = localRead();
  const existing = id ? store.index.find((e) => e.id === id) : null;
  const entry = { id: existing ? existing.id : newId(), name, savedAt: nowIso(),
    openedAt: nowIso() };
  store.index = existing ? store.index.map((e) => (e.id === entry.id ? entry : e)) : [...store.index, entry];
  store.data[entry.id] = JSON.stringify(data);
  const was = (store.versions && store.versions[entry.id]) || [];
  const v = (was[was.length - 1]?.v || 0) + 1;
  store.versions = { ...(store.versions || {}), [entry.id]: [...was, { v, at: entry.savedAt, name, data }].slice(-LOCAL_VERSIONS) };
  localWrite(store);
  return entry;
}

function localTouch(id) {
  const store = localRead();
  if (!store.index.some((e) => e.id === id)) return;
  store.index = store.index.map((e) => (e.id === id ? { ...e, openedAt: nowIso() } : e));
  localWrite(store);
}

async function localDelete(id) {
  const store = localRead();
  store.index = store.index.filter((e) => e.id !== id);
  delete store.data[id];
  localWrite(store);
  return null;
}
