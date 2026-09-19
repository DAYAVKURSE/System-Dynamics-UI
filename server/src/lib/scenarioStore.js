import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_NAME_LEN = 120;
const MAX_SCENARIOS_PER_USER = 200;
/* Версии сценария (владелец, 2026-09-19): каждое сохранение — версия, как
   коммит. Держим последние 30: схема весит сотни килобайт, и бесконечная
   история съела бы диск ради того, чего никто не откроет. */
const MAX_VERSIONS = 30;

function baseDir() {
  return process.env.SCENARIOS_DIR
    ? path.resolve(process.env.SCENARIOS_DIR)
    : path.resolve(process.cwd(), "data", "scenarios");
}

// Каталоги пользователей именуются по telegram user id, прогнанному через
// строгий whitelist символов — так что даже если когда-нибудь userId придёт
// из менее доверенного источника, обхода пути (../..) быть не может.
function userDir(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
  return path.join(baseDir(), safe);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readManifest(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(dir, manifest) {
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

export async function listScenarios(userId) {
  const dir = userDir(userId);
  const manifest = await readManifest(dir);
  return manifest
    .slice()
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .map(({ id, name, savedAt, openedAt }) => ({ id, name, savedAt, openedAt: openedAt || null }));
}

/**
 * Отметить, что сценарий открывали.
 *
 * Приложение открывается на той схеме, с которой работали в прошлый раз.
 * Помнить это только в браузере нельзя: сценарии лежат здесь, а память о
 * них — там, и стоит Telegram почистить WebView (а он это делает без
 * предупреждения) или человеку зайти с другого устройства, как открывается
 * не та схема. Метка живёт рядом с самим сценарием и поэтому переживает и
 * то и другое.
 */
export async function touchScenario(userId, id) {
  const dir = userDir(userId);
  const manifest = await readManifest(dir);
  const entry = manifest.find((m) => m.id === id);
  if (!entry) return null;
  entry.openedAt = new Date().toISOString();
  await writeManifest(dir, manifest);
  return { id: entry.id, name: entry.name, savedAt: entry.savedAt, openedAt: entry.openedAt };
}

// id всегда берётся из manifest.json (сгенерирован randomUUID при сохранении),
// поэтому даже произвольный req.params.id безопасен: если он не совпадает
// один-в-один с уже существующей записью, чтение/удаление файла не произойдёт.
export async function getScenario(userId, id) {
  const dir = userDir(userId);
  const manifest = await readManifest(dir);
  const entry = manifest.find((m) => m.id === id);
  if (!entry) return null;
  const raw = await fs.readFile(path.join(dir, `${entry.id}.json`), "utf8");
  return { ...entry, data: JSON.parse(raw) };
}

export async function saveScenario(userId, { id, name, data } = {}) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) throw new Error("name is required");
  if (trimmedName.length > MAX_NAME_LEN) throw new Error(`name must be at most ${MAX_NAME_LEN} characters`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("data is required");

  const dir = userDir(userId);
  await ensureDir(dir);
  const manifest = await readManifest(dir);

  const existingIdx = id ? manifest.findIndex((m) => m.id === id) : -1;
  // Прежние версии берём ДО подмены записи в манифесте — иначе история
  // обнулялась бы каждым сохранением.
  const wasVersions = existingIdx >= 0 ? (manifest[existingIdx].versions || []) : [];
  const scenarioId = existingIdx >= 0 ? id : crypto.randomUUID();
  const savedAt = new Date().toISOString();
  // Сохранение — это тоже работа с этой схемой: она становится последней, с
  // которой работали, и открыться в следующий раз должна именно она.
  const entry = { id: scenarioId, name: trimmedName, savedAt, openedAt: savedAt };

  if (existingIdx >= 0) {
    manifest[existingIdx] = entry;
  } else {
    if (manifest.length >= MAX_SCENARIOS_PER_USER) {
      throw new Error(`limit of ${MAX_SCENARIOS_PER_USER} saved scenarios reached`);
    }
    manifest.push(entry);
  }

  await fs.writeFile(path.join(dir, `${scenarioId}.json`), JSON.stringify(data), "utf8");

  /* Версия — тем же сохранением: пишем снимок и запоминаем его в записи. */
  const was = wasVersions;
  const v = (was[was.length - 1]?.v || 0) + 1;
  await fs.writeFile(path.join(dir, `${scenarioId}.v${v}.json`), JSON.stringify(data), "utf8");
  const versions = [...was, { v, at: savedAt, name: trimmedName }];
  const extra = versions.length - MAX_VERSIONS;
  if (extra > 0) {
    await Promise.all(versions.slice(0, extra).map((old) => fs.rm(path.join(dir, `${scenarioId}.v${old.v}.json`), { force: true })));
    versions.splice(0, extra);
  }
  entry.versions = versions;
  manifest[existingIdx >= 0 ? existingIdx : manifest.length - 1] = entry;
  await writeManifest(dir, manifest);
  return entry;
}

/** Список версий сценария — новые последними. */
export async function listVersions(userId, id) {
  const manifest = await readManifest(userDir(userId));
  const entry = manifest.find((m) => m.id === id);
  if (!entry) return null;
  return (entry.versions || []).map(({ v, at, name }) => ({ v, at, name }));
}

/** Снимок версии: данные схемы, какими они были при том сохранении. */
export async function getVersion(userId, id, v) {
  const dir = userDir(userId);
  const manifest = await readManifest(dir);
  const entry = manifest.find((m) => m.id === id);
  const one = (entry?.versions || []).find((x) => String(x.v) === String(v));
  if (!one) return null;
  try {
    const raw = await fs.readFile(path.join(dir, `${entry.id}.v${one.v}.json`), "utf8");
    return { ...one, data: JSON.parse(raw) };
  } catch { return null; }
}

export async function deleteScenario(userId, id) {
  const dir = userDir(userId);
  const manifest = await readManifest(dir);
  const idx = manifest.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  const [entry] = manifest.splice(idx, 1);
  await writeManifest(dir, manifest);
  await fs.rm(path.join(dir, `${entry.id}.json`), { force: true });
  await Promise.all((entry.versions || []).map((v) => fs.rm(path.join(dir, `${entry.id}.v${v.v}.json`), { force: true })));
  return true;
}
