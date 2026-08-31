import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_NAME_LEN = 120;
const MAX_SCENARIOS_PER_USER = 200;

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
    .map(({ id, name, savedAt }) => ({ id, name, savedAt }));
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
  const scenarioId = existingIdx >= 0 ? id : crypto.randomUUID();
  const savedAt = new Date().toISOString();
  const entry = { id: scenarioId, name: trimmedName, savedAt };

  if (existingIdx >= 0) {
    manifest[existingIdx] = entry;
  } else {
    if (manifest.length >= MAX_SCENARIOS_PER_USER) {
      throw new Error(`limit of ${MAX_SCENARIOS_PER_USER} saved scenarios reached`);
    }
    manifest.push(entry);
  }

  await fs.writeFile(path.join(dir, `${scenarioId}.json`), JSON.stringify(data), "utf8");
  await writeManifest(dir, manifest);
  return entry;
}

export async function deleteScenario(userId, id) {
  const dir = userDir(userId);
  const manifest = await readManifest(dir);
  const idx = manifest.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  const [entry] = manifest.splice(idx, 1);
  await writeManifest(dir, manifest);
  await fs.rm(path.join(dir, `${entry.id}.json`), { force: true });
  return true;
}
