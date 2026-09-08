import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { envOwner } from "./orgStore.js";
import { DEFAULT_BASE_URL, KINDS, isKind } from "./aiProviders.js";

/* ════════════════════════════════════════════════════════════════
   ЧЕМ ДУМАЕТ ПОМОЩНИК · у каждого своё

   В v1.1 ключ ставил владелец, и все спрашивали за его счёт. Теперь
   провайдеры, ключи и модели — у каждого человека свои, в файле на
   человека: `ASSISTANT_DIR/<userId>.json`. Общего ключа нет, владелец за
   других ничего не ставит, и чужие настройки нельзя ни прочитать, ни
   поменять даже нарочно — искать их просто негде: id берётся из подписи
   запроса, а не из его тела.

   Провайдер — это ВИД API (совместимый с OpenAI / Anthropic / Hugging
   Face), адрес и ключ. OpenRouter или Groq — не «четвёртый провайдер в
   коде», а ещё одна запись вида «OpenAI» с другим адресом. У провайдера
   несколько моделей, а какая из них отвечает на что — говорит таблица
   «задача → модель»: одна модель отвечает на вопросы, другая
   расшифровывает записи.

   Наружу ключ не уходит никогда — только `hasKey`: есть он или нет.
   Экрану большего не нужно: он спрашивает «можно ли задавать вопросы»,
   а не «какой ключ». Всё, что отдаётся за пределы этого модуля, проходит
   через `providerView`, где поле ключа собирается поимённо.

   Чтение и запись — синхронные: файл в пару килобайт, а `modelFor` зовут
   и очередь, и бот, и расшифровка, — и функция, которая работает и с
   `await`, и без него, не заставляет никого из них угадывать.
   ════════════════════════════════════════════════════════════════ */

/* Задачи, у каждой из которых своя модель. Список здесь и только здесь:
   экран рисует таблицу по нему, очередь спрашивает по id. */
export const TASKS = [
  { id: "chat", name: "Помощник (по умолчанию)" },
  { id: "space", name: "Вопрос в пространстве" },
  { id: "bot", name: "Помощник в чате бота" },
  { id: "transcribe", name: "Расшифровка записей звонков" },
];
export const TASK_IDS = TASKS.map((t) => t.id);

/* Одна фраза на все места — бот, очередь, пространство: кто бы ни
   спросил ненастроенного помощника, ответ обязан звучать одинаково и
   называть, где это чинится. Чинит теперь сам человек, а не владелец. */
export const NOT_CONFIGURED = "Помощник не настроен: добавьте провайдера и ключ в Инструментах → Помощник";

export const MAX_PROVIDERS = 20;
export const MAX_MODELS = 50;
const NAME_LIMIT = 80;
const MODEL_LIMIT = 120;
// Ключи у всех видов — печатная латиница без пробелов. Перевод строки в
// ключе ломал .env целиком в прежней схеме; в JSON он не страшен, но
// ключ с пробелом — это ключ, скопированный с куском страницы.
const KEY_RE = /^[\x21-\x7e]{8,512}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/* Прежняя схема (v1.1): один провайдер и три ключа в .env. Нужна только
   для переноса — один раз, владельцу, у которого ещё нет своего файла. */
export const KEY_VARS = { openai: "OPENAI_API_KEY", claude: "ANTHROPIC_API_KEY", hf: "HF_API_KEY" };
const LEGACY = {
  openai: { kind: "openai", name: "OpenAI", model: "gpt-4o-mini" },
  claude: { kind: "anthropic", name: "Claude", model: "claude-sonnet-4-5" },
  hf: { kind: "hf", name: "Hugging Face", model: "meta-llama/Llama-3.1-8B-Instruct" },
};

/** Ошибка ввода: маршрут отвечает ею 400 словами, а не 500. */
class BadInput extends Error {
  constructor(message) { super(message); this.status = 400; }
}
export const isBadInput = (e) => e instanceof BadInput;

function baseDir() {
  return process.env.ASSISTANT_DIR
    ? path.resolve(process.env.ASSISTANT_DIR)
    : path.resolve(process.cwd(), "data", "assistant");
}

// id пользователя — через строгий whitelist, как у памяти: подняться
// выше каталога настроек нельзя никаким вводом.
const fileFor = (userId) => path.join(baseDir(),
  `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown"}.json`);

const emptyTasks = () => Object.fromEntries(TASK_IDS.map((t) => [t, null]));
const empty = () => ({ providers: [], tasks: emptyTasks() });

/* ─────── проверка полей ─────── */

const cleanName = (name) => {
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
  if (!n) throw new BadInput("Название провайдера обязательно");
  return n;
};

const cleanBaseUrl = (url) => {
  const u = String(url ?? "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\/\S+$/.test(u)) throw new BadInput("Адрес должен начинаться с http:// или https://");
  return u;
};

const cleanKey = (key) => {
  const k = String(key ?? "").trim();
  if (k && !KEY_RE.test(k)) throw new BadInput("Ключ выглядит неверно: 8–512 печатных знаков без пробелов");
  return k;
};

const cleanModel = (model) => {
  const m = String(model ?? "").trim().slice(0, MODEL_LIMIT);
  if (!MODEL_RE.test(m)) throw new BadInput(`Имя модели выглядит неверно: «${m || "пусто"}» — буквы, цифры и . _ : / -`);
  return m;
};

/** Список моделей: без пустых и повторов, не длиннее предела. */
const cleanModels = (models) => {
  if (!Array.isArray(models)) throw new BadInput("Список моделей должен быть списком");
  const out = [];
  for (const m of models) {
    const id = cleanModel(m);
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > MAX_MODELS) throw new BadInput(`Моделей у провайдера — не больше ${MAX_MODELS}`);
  return out;
};

/* ─────── файл на человека ─────── */

/* Читаем строго: файл правят только эти функции, но битую запись после
   сбоя диска лучше пережить пустотой по полю, чем падением всего
   помощника. Ключ не проверяем на форму — он уже был проверен при записи. */
function normalize(raw) {
  const rec = empty();
  const providers = Array.isArray(raw?.providers) ? raw.providers : [];
  for (const p of providers) {
    if (!p || typeof p !== "object" || !isKind(p.kind) || !p.id) continue;
    rec.providers.push({
      id: String(p.id),
      name: String(p.name || "").trim() || "провайдер",
      kind: p.kind,
      baseUrl: String(p.baseUrl || "").trim(),
      key: String(p.key || ""),
      models: (Array.isArray(p.models) ? p.models : [])
        .map((m) => String(m || "").trim()).filter((m) => m && MODEL_RE.test(m)),
    });
    if (rec.providers.length >= MAX_PROVIDERS) break;
  }
  for (const t of TASK_IDS) {
    const row = raw?.tasks?.[t];
    const provider = row && rec.providers.find((p) => p.id === String(row.providerId));
    const model = row ? String(row.model || "") : "";
    // Строка, которая ссылается на удалённого провайдера или на модель не
    // из его списка, — это не выбор, а след прежнего выбора: пусто.
    rec.tasks[t] = provider && provider.models.includes(model)
      ? { providerId: provider.id, model } : null;
  }
  return rec;
}

function readFile(userId) {
  try { return JSON.parse(fs.readFileSync(fileFor(userId), "utf8")); } catch { return null; }
}

/** Пишет запись человека. Права 0600: в файле ключи. */
export function writeUserSettings(userId, rec) {
  const clean = normalize(rec);
  fs.mkdirSync(baseDir(), { recursive: true });
  // Через временный файл и переименование: читатель видит либо прежнюю
  // запись, либо новую целиком, но никогда половину.
  const file = fileFor(userId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return clean;
}

/* ─────── перенос из .env ───────

   Владелец в v1.1 уже вставил ключ — заставлять его вставлять тот же
   ключ второй раз значило бы потерять его настройку при обновлении.
   Переносится один раз: как только файл владельца появился, .env больше
   не читается, и что бы там ни лежало, оно не воскреснет после удаления
   провайдера с экрана. Сам .env не чистим: его переносит деплой, и
   лишняя строка там безвредна. */

/* Владелец — из переменной или из org.json. Файл читается здесь напрямую,
   а не через orgStore.readOrg(): та функция асинхронная, а чтение
   настроек нарочно синхронное (см. шапку). Путь тот же, что у orgStore. */
function ownerId() {
  const env = envOwner();
  if (env) return env;
  const dir = process.env.ORG_DIR ? path.resolve(process.env.ORG_DIR)
    : path.resolve(process.cwd(), "data", "org");
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "org.json"), "utf8"));
    return parsed?.ownerId != null ? String(parsed.ownerId) : null;
  } catch { return null; }
}

const envValue = (env, name) => String(env[name] ?? "").trim();

/** Запись из прежних переменных .env — или null, если переносить нечего. */
export function fromLegacyEnv(env = process.env) {
  const rec = empty();
  const chosen = envValue(env, "AI_PROVIDER");
  const model = envValue(env, "AI_MODEL");
  for (const [legacyId, spec] of Object.entries(LEGACY)) {
    const key = envValue(env, KEY_VARS[legacyId]);
    if (!KEY_RE.test(key)) continue;
    // Модель из .env — только у выбранного провайдера: она задавалась
    // под него; остальным — прежнее умолчание, чтобы список не был пуст.
    const own = legacyId === chosen && model && MODEL_RE.test(model) ? model : spec.model;
    const p = { id: `p_${legacyId}`, name: spec.name, kind: spec.kind, baseUrl: "", key,
      models: [own] };
    rec.providers.push(p);
    if (legacyId === chosen) rec.tasks.chat = { providerId: p.id, model: own };
  }
  return rec.providers.length ? rec : null;
}

/**
 * Запись человека: провайдеры с ключами и таблица задач. Наружу — только
 * через `settingsView`. Файла нет — пусто, а владельцу один раз
 * переносятся прежние настройки из .env.
 */
export function readUserSettings(userId, { env = process.env } = {}) {
  const raw = readFile(userId);
  if (raw) return normalize(raw);
  if (String(userId) === ownerId()) {
    const moved = fromLegacyEnv(env);
    if (moved) return writeUserSettings(userId, moved);
  }
  return empty();
}

/* ─────── наружу — без ключа ─────── */

/* Поле ключа не копируется, а заменяется признаком — поимённо, чтобы
   новое поле в записи не уехало наружу само собой. */
const providerView = (p) => ({
  id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, models: [...p.models],
  hasKey: Boolean(p.key),
});

/** Что видно человеку на экране: его провайдеры без ключей и таблица. */
export function settingsView(userId) {
  const rec = readUserSettings(userId);
  return { providers: rec.providers.map(providerView), tasks: { ...rec.tasks } };
}

/** Виды API — для экрана: название и адрес по умолчанию. */
export const kindsView = () => KINDS.map((k) => ({ ...k }));

/**
 * Чем отвечать на задачу. Правило: своя строка таблицы → строка
 * «помощник по умолчанию» → первый провайдер с ключом и первой моделью
 * из его списка → null, и тогда помощник говорит NOT_CONFIGURED.
 * Неизвестная задача считается «по умолчанию», а не ошибкой: новую
 * задачу проще завести, чем ловить опечатку в id.
 *
 * @returns {{kind, baseUrl, key, model, providerName} | null}
 */
export function modelFor(userId, task) {
  const rec = readUserSettings(userId);
  const pick = (row) => {
    const p = row && rec.providers.find((x) => x.id === row.providerId);
    return p && p.key ? { kind: p.kind, baseUrl: p.baseUrl || DEFAULT_BASE_URL[p.kind], key: p.key,
      model: row.model, providerName: p.name } : null;
  };
  const own = TASK_IDS.includes(task) ? pick(rec.tasks[task]) : null;
  if (own) return own;
  const fallback = pick(rec.tasks.chat);
  if (fallback) return fallback;
  const first = rec.providers.find((p) => p.key && p.models.length);
  return first ? pick({ providerId: first.id, model: first.models[0] }) : null;
}

/* ─────── правки ─────── */

const newId = (rec) => {
  for (;;) {
    const id = `p_${crypto.randomBytes(4).toString("hex")}`;
    if (!rec.providers.some((p) => p.id === id)) return id;
  }
};

/** Новый провайдер: название, вид, адрес (можно пустой — умолчание вида) и ключ. */
export function addProvider(userId, { name, kind, baseUrl, key } = {}) {
  if (!isKind(kind)) throw new BadInput("Неизвестный вид API: выберите «совместимый с OpenAI», «Anthropic» или «Hugging Face»");
  const k = cleanKey(key);
  if (!k) throw new BadInput("Ключ обязателен: без него провайдер не ответит");
  const rec = readUserSettings(userId);
  if (rec.providers.length >= MAX_PROVIDERS) throw new BadInput(`Провайдеров — не больше ${MAX_PROVIDERS}`);
  const p = { id: newId(rec), name: cleanName(name), kind, baseUrl: cleanBaseUrl(baseUrl), key: k,
    models: [] };
  rec.providers.push(p);
  writeUserSettings(userId, rec);
  return providerView(p);
}

/**
 * Правка провайдера. Пустой ключ значит «не трогать», а не «стереть»:
 * форма шлёт поля разом, и стереть ключ можно только удалив провайдера.
 * Модель, пропавшая из списка, снимается со строк таблицы: выбирать
 * можно только то, что в списке есть.
 */
export function updateProvider(userId, id, { name, baseUrl, key, models } = {}) {
  const rec = readUserSettings(userId);
  const p = rec.providers.find((x) => x.id === String(id));
  if (!p) throw new BadInput("Провайдер не найден");
  if (name !== undefined) p.name = cleanName(name);
  if (baseUrl !== undefined) p.baseUrl = cleanBaseUrl(baseUrl);
  if (key !== undefined) { const k = cleanKey(key); if (k) p.key = k; }
  if (models !== undefined) p.models = cleanModels(models);
  return providerView(writeUserSettings(userId, rec).providers.find((x) => x.id === p.id));
}

/** Удаляет провайдера вместе с ключом; строки таблицы на него — пусто. */
export function removeProvider(userId, id) {
  const rec = readUserSettings(userId);
  const before = rec.providers.length;
  rec.providers = rec.providers.filter((p) => p.id !== String(id));
  if (rec.providers.length === before) return false;
  writeUserSettings(userId, rec);   // normalize сам обнулит осиротевшие строки
  return true;
}

/**
 * Таблица «задача → модель». Присланы только те строки, что есть в теле:
 * экран шлёт одну изменённую строку, и остальные не должны обнуляться.
 * Строка — `{providerId, model}` из списка этого провайдера или null.
 */
export function setTasks(userId, tasks = {}) {
  if (!tasks || typeof tasks !== "object") throw new BadInput("Таблица задач должна быть объектом");
  const rec = readUserSettings(userId);
  for (const t of TASK_IDS) {
    if (!(t in tasks)) continue;
    const row = tasks[t];
    if (row == null) { rec.tasks[t] = null; continue; }
    const p = rec.providers.find((x) => x.id === String(row?.providerId || ""));
    const taskName = TASKS.find((x) => x.id === t).name;
    if (!p) throw new BadInput(`У задачи «${taskName}» выбран провайдер, которого нет`);
    const model = String(row?.model || "");
    if (!p.models.includes(model)) {
      throw new BadInput(`У задачи «${taskName}» выбрана модель, которой нет в списке провайдера «${p.name}»`);
    }
    rec.tasks[t] = { providerId: p.id, model };
  }
  return { ...writeUserSettings(userId, rec).tasks };
}

/** Провайдер с ключом — только для вызова его API (список моделей). Наружу не отдавать. */
export function providerFor(userId, id) {
  const p = readUserSettings(userId).providers.find((x) => x.id === String(id));
  return p ? { ...p, baseUrl: p.baseUrl || DEFAULT_BASE_URL[p.kind], providerName: p.name } : null;
}

/* ─────── совместимость до перехода очереди ───────

   Очередь v1.1 звала `currentFor()` без человека — «модель владельца».
   Очередь v1.2 зовёт `modelFor(userId, task)`; пока переход не сделан,
   прежнее имя отдаёт модель владельца по задаче «chat», чтобы помощник не
   замолчал на время сборки. Удалить, когда в assistantQueue.js не
   останется `currentFor`. */
export function currentFor() {
  const owner = ownerId();
  return owner ? modelFor(owner, "chat") : null;
}
