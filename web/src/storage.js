import { getTelegram, getInitData } from "./telegram.js";

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

/* ─────── публичный API ─────── */

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

export async function deleteScenario(id) {
  const kind = await detectStorage();
  if (kind === "server") return serverDelete(id);
  if (kind === "cloud") return cloudDelete(id);
  return localDelete(id);
}

/* ─────── 1. сервер ─────── */

const apiHeaders = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(),
});

async function serverJson(url, opts) {
  const r = await fetch(url, { headers: apiHeaders(), ...opts });
  if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const serverList = () => serverJson("/api/scenarios");
const serverGet = (id) => serverJson(`/api/scenarios/${encodeURIComponent(id)}`);
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

async function cloudList() {
  return (await cloudIndex()).slice().sort(byNewest).map(({ id, name, savedAt }) => ({ id, name, savedAt }));
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

  const entry = {
    id: existing ? existing.id : newId(),
    name,
    savedAt: nowIso(),
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
  return { id: entry.id, name: entry.name, savedAt: entry.savedAt };
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

async function localSave({ id, name, data }) {
  const store = localRead();
  const existing = id ? store.index.find((e) => e.id === id) : null;
  const entry = { id: existing ? existing.id : newId(), name, savedAt: nowIso() };
  store.index = existing ? store.index.map((e) => (e.id === entry.id ? entry : e)) : [...store.index, entry];
  store.data[entry.id] = JSON.stringify(data);
  localWrite(store);
  return entry;
}

async function localDelete(id) {
  const store = localRead();
  store.index = store.index.filter((e) => e.id !== id);
  delete store.data[id];
  localWrite(store);
  return null;
}
