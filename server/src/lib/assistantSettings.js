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

   АГЕНТЫ (v1.3). У человека есть агенты: встроенный «Ассистент», которого
   нельзя удалить, и сколько угодно своих. У агента — коллекция моделей:
   пары `{providerId, model}` из ЕГО провайдеров, которыми агент может
   думать, и отдельная пара для расшифровки записей. Ключей у агента нет —
   он ссылается на провайдера, ключ лежит там. Таблица «задача → модель»
   осталась для совместимости: `modelFor` смотрит сначала в коллекцию
   ассистента, а потом — в неё.

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
  { id: "bot", name: "Помощник в чате бота" },
  { id: "transcribe", name: "Расшифровка записей звонков" },
];
export const TASK_IDS = TASKS.map((t) => t.id);

/* ─────── НАЗНАЧЕНИЯ МОДЕЛЕЙ (владелец, 2026-09-20) ───────

   У агента не одна модель на всё: разговор, голос, рисунок, чтение
   картинок и расшифровка — разные умения, и модели у них разные.
   Назначения — у КАЖДОГО АГЕНТА свои (владелец): один агент рисует одним,
   другой другим.

   Агент всегда знает, что у него есть: список назначенных моделей уходит
   к нему в системную подсказку, а чего нет — там сказано прямо, чтобы он
   говорил «у меня нет модели для рисования», а не выдумывал. */
export const USES = [
  { id: "main", name: "Основная", what: "разговор и работа с приложением" },
  { id: "voice", name: "Отправка голосовых сообщений", what: "речь из текста" },
  { id: "draw", name: "Рисование изображений", what: "картинка по описанию" },
  { id: "vision", name: "Распознавание изображений", what: "что на картинке" },
  { id: "transcribe", name: "Расшифровка записей звонков", what: "текст из записи" },
];
export const USE_IDS = USES.map((u) => u.id);
export const MAX_MCP = 20;

/* Одна фраза на все места — бот, очередь: кто бы ни
   спросил ненастроенного помощника, ответ обязан звучать одинаково и
   называть, где это чинится. Чинит теперь сам человек, а не владелец. */
export const NOT_CONFIGURED = "Помощник не настроен: добавьте провайдера и ключ в Инструментах → Агенты";

export const MAX_PROVIDERS = 20;
export const MAX_MODELS = 50;
export const MAX_AGENTS = 20;
/* Встроенный агент: есть у всех и всегда первый. На него смотрит
   `modelFor`, к нему идёт память из бота, его нельзя удалить. */
export const BUILTIN_AGENT_ID = "assistant";
const emptyUses = () => Object.fromEntries(USE_IDS.map((u) => [u, null]));
/* `ask: true` — спрашивать перед изменением; `false` — применять сразу
   (владелец, 2026-09-20: настройка стоит на форме агента). По умолчанию
   спрашиваем: молча менять чужую работу — не то, чего ждут от первого
   же вопроса. */
const builtinAgent = () => ({ id: BUILTIN_AGENT_ID, name: "Ассистент", builtin: true,
  models: [], transcribe: null, uses: emptyUses(), mcp: [], ask: true, skill: "" });

/* ─────── ИНСТРУКЦИЯ АГЕНТА · СКИЛЛ (владелец, 2026-09-20) ───────

   «Перед разделом „Память" сделай раздел „Инструкции"… введённая
   инструкция должна применяться как скилл».

   Скилл — это то, что агент умеет ВСЕГДА, а не то, что ему напомнили в
   одном вопросе: он уходит в системную подсказку каждого разговора, до
   самого вопроса. Поэтому он один и правится на форме, а не копится
   сообщениями — иначе «умение» зависело бы от того, что человек написал
   последним.

   Чужого поведения он не отменяет: подсказка приложения идёт первой, и
   инструкция стоит после неё — она добавляет умение, а не снимает
   запреты. */
export const MAX_SKILL = 4000;
const NAME_LIMIT = 80;
const MODEL_LIMIT = 120;
// Ключи у всех видов — печатная латиница без пробелов. Перевод строки в
// ключе ломал .env целиком в прежней схеме; в JSON он не страшен, но
// ключ с пробелом — это ключ, скопированный с куском страницы.
const KEY_RE = /^[\x21-\x7e]{8,512}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;
// id агента едет в id участника организации и в запись памяти — только
// то, что безопасно в любом из них.
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
const empty = () => ({ providers: [], tasks: emptyTasks(), agents: [builtinAgent()], mcp: [] });

/* ─────── проверка полей ─────── */

const cleanName = (name) => {
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
  if (!n) throw new BadInput("Название провайдера обязательно");
  return n;
};

const cleanAgentName = (name) => {
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
  if (!n) throw new BadInput("Название агента обязательно");
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
  /* Пара агента живёт, пока провайдер и модель есть в записи: удалили
     провайдера или сняли модель — пара уходит из коллекции сама, как
     строка таблицы. Повторы — тоже след, а не выбор. */
  const pairOf = (row) => {
    const provider = row && rec.providers.find((p) => p.id === String(row.providerId));
    const model = row ? String(row.model || "") : "";
    return provider && provider.models.includes(model) ? { providerId: provider.id, model } : null;
  };
  const pairsOf = (rows) => {
    const out = [];
    for (const pair of (Array.isArray(rows) ? rows : []).map(pairOf)) {
      if (pair && !out.some((x) => x.providerId === pair.providerId && x.model === pair.model)) out.push(pair);
    }
    return out;
  };
  /* MCP-серверы человека: адрес, откуда взят, и список инструментов,
     который сервер о себе рассказал. Общие на всех его агентов — ключ и
     адрес одни, а какие из них агенту разрешены, говорит сам агент. */
  rec.mcp = [];
  for (const m of (Array.isArray(raw?.mcp) ? raw.mcp : [])) {
    if (!m || typeof m !== "object" || !AGENT_ID_RE.test(String(m.id))) continue;
    if (rec.mcp.some((x) => x.id === String(m.id))) continue;
    rec.mcp.push({
      id: String(m.id),
      name: String(m.name || "").trim().slice(0, NAME_LIMIT) || String(m.id),
      url: String(m.url || "").trim().slice(0, 500),
      repo: String(m.repo || "").trim().slice(0, 500),
      tools: (Array.isArray(m.tools) ? m.tools : [])
        .map((t) => String(t || "").trim().slice(0, MODEL_LIMIT)).filter(Boolean).slice(0, 100),
      at: String(m.at || "") || null,
    });
    if (rec.mcp.length >= MAX_MCP) break;
  }
  const mcpOf = (ids) => (Array.isArray(ids) ? ids : [])
    .map((x) => String(x)).filter((x, i, all) => all.indexOf(x) === i)
    .filter((x) => rec.mcp.some((m) => m.id === x));
  /* Назначения: пара «провайдер + модель» на каждое умение, и только та,
     что и правда отмечена у провайдера. */
  const usesOf = (raw2) => {
    const out = emptyUses();
    const src = raw2 && typeof raw2 === "object" ? raw2 : {};
    USE_IDS.forEach((u) => { out[u] = pairOf(src[u]); });
    return out;
  };
  const assistant = builtinAgent();
  if (Array.isArray(raw?.agents)) {
    const own = raw.agents.find((a) => a && a.id === BUILTIN_AGENT_ID);
    if (own) {
      assistant.name = String(own.name || "").trim() || assistant.name;
      assistant.models = pairsOf(own.models);
      assistant.transcribe = pairOf(own.transcribe);
      assistant.uses = usesOf(own.uses);
      assistant.mcp = mcpOf(own.mcp);
      assistant.ask = own.ask !== false;
      assistant.skill = String(own.skill || "").slice(0, MAX_SKILL);
    }
  } else {
    /* Запись до агентов: её выбор — таблица задач. Строка чата становится
       первой моделью ассистента, строка расшифровки — его расшифровкой,
       чтобы после обновления помощник отвечал тем же, чем вчера. */
    assistant.models = pairsOf([rec.tasks.chat]);
    assistant.transcribe = pairOf(rec.tasks.transcribe);
  }
  /* Прежнее поле `transcribe` и назначение `uses.transcribe` — одно и
     то же умение, записанное дважды: старые записи знают только первое,
     форма правит второе. Держим их в согласии, чтобы `modelFor` отвечал
     одинаково, кто бы ни спросил. */
  const tieTranscribe = (a) => {
    if (a.uses.transcribe) a.transcribe = { ...a.uses.transcribe };
    else if (a.transcribe) a.uses.transcribe = { ...a.transcribe };
  };
  tieTranscribe(assistant);
  rec.agents = [assistant];
  for (const a of (Array.isArray(raw?.agents) ? raw.agents : [])) {
    if (!a || typeof a !== "object" || !AGENT_ID_RE.test(String(a.id)) || a.id === BUILTIN_AGENT_ID) continue;
    if (rec.agents.some((x) => x.id === String(a.id))) continue;
    rec.agents.push({
      id: String(a.id), name: String(a.name || "").trim() || "агент", builtin: false,
      models: pairsOf(a.models), transcribe: pairOf(a.transcribe),
      uses: usesOf(a.uses), mcp: mcpOf(a.mcp), ask: a.ask !== false,
      skill: String(a.skill || "").slice(0, MAX_SKILL),
    });
    tieTranscribe(rec.agents[rec.agents.length - 1]);
    if (rec.agents.length >= MAX_AGENTS) break;
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
    if (legacyId === chosen) {
      rec.tasks.chat = { providerId: p.id, model: own };
      rec.agents[0].models = [{ providerId: p.id, model: own }];
    }
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

/* Копия агента: ключей у него нет, но копия — чтобы правка ответа не
   правила запись. */
const agentView = (a) => ({
  id: a.id, name: a.name, builtin: Boolean(a.builtin),
  models: a.models.map((m) => ({ ...m })),
  transcribe: a.transcribe ? { ...a.transcribe } : null,
  uses: Object.fromEntries(USE_IDS.map((u) => [u, a.uses?.[u] ? { ...a.uses[u] } : null])),
  mcp: [...(a.mcp || [])],
  ask: a.ask !== false,
  skill: String(a.skill || ""),
});
const mcpView = (m) => ({ id: m.id, name: m.name, url: m.url, repo: m.repo,
  tools: [...(m.tools || [])], at: m.at || null });

/** Что видно человеку на экране: его провайдеры без ключей, агенты и таблица. */
export function settingsView(userId) {
  const rec = readUserSettings(userId);
  return { providers: rec.providers.map(providerView), tasks: { ...rec.tasks },
    agents: rec.agents.map(agentView), mcp: rec.mcp.map(mcpView), uses: USES.map((u) => ({ ...u })) };
}

/** Агент человека — копия или null. Чужого не найти: файл свой. */
export function agentFor(userId, id) {
  const a = readUserSettings(userId).agents.find((x) => x.id === String(id));
  return a ? agentView(a) : null;
}

/** Виды API — для экрана: название и адрес по умолчанию. */
export const kindsView = () => KINDS.map((k) => ({ ...k }));

/**
 * Чем отвечать на задачу. Правило: коллекция ассистента (первая пара, у
 * чьего провайдера есть ключ) → своя строка таблицы → строка «помощник по
 * умолчанию» → первый провайдер с ключом и первой моделью из его списка →
 * null, и тогда помощник говорит NOT_CONFIGURED. Для расшифровки — пара
 * расшифровки ассистента, потом строка таблицы: коллекция моделей чата
 * записи не расшифровывает. Неизвестная задача считается «по умолчанию»,
 * а не ошибкой: новую задачу проще завести, чем ловить опечатку в id.
 *
 * `fallback: false` — только своя строка, без отката. Так спрашивает
 * расшифровка: откат на модель чата отправлял бы десятки мегабайт записи
 * туда, где расшифровывать не умеют (Anthropic) или не той моделью
 * (gpt-4o-mini на /audio/transcriptions), и человек читал бы «провайдер
 * ответил 400» вместо «модель не выбрана». Для ответа на вопрос откат
 * уместен: любая модель чата ответит словами.
 *
 * @returns {{kind, baseUrl, key, model, providerName} | null}
 */
export function modelFor(userId, task, { fallback = true } = {}) {
  const rec = readUserSettings(userId);
  const pick = (row) => {
    const p = row && rec.providers.find((x) => x.id === row.providerId);
    return p && p.key ? { kind: p.kind, baseUrl: p.baseUrl || DEFAULT_BASE_URL[p.kind], key: p.key,
      model: row.model, providerName: p.name } : null;
  };
  const assistant = rec.agents[0];
  const byAgent = task === "transcribe"
    ? pick(assistant.transcribe)
    : assistant.models.map(pick).find(Boolean) || null;
  if (byAgent) return byAgent;
  const own = TASK_IDS.includes(task) ? pick(rec.tasks[task]) : null;
  if (own || !fallback) return own;
  const byChat = pick(rec.tasks.chat);
  if (byChat) return byChat;
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
 * Модель, пропавшая из списка, снимается со строк таблицы и из коллекций
 * агентов: выбирать можно только то, что в списке есть.
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
  writeUserSettings(userId, rec);   // normalize сам обнулит осиротевшие строки и пары агентов
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

/* ─────── агенты ─────── */

const newAgentId = (rec) => {
  for (;;) {
    const id = `a_${crypto.randomBytes(4).toString("hex")}`;
    if (!rec.agents.some((a) => a.id === id)) return id;
  }
};

/** Пара «провайдер, модель» — из записи и из списка провайдера, иначе — словами. */
const cleanPair = (rec, row, what) => {
  const p = rec.providers.find((x) => x.id === String(row?.providerId || ""));
  if (!p) throw new BadInput(`${what}: выбран провайдер, которого нет`);
  const model = String(row?.model || "");
  if (!p.models.includes(model)) {
    throw new BadInput(`${what}: модели «${model || "пусто"}» нет в списке провайдера «${p.name}»`);
  }
  return { providerId: p.id, model };
};

/** Коллекция моделей агента: каждая пара проверена, повторы убраны, порядок сохранён. */
const cleanPairs = (rec, rows, what) => {
  if (!Array.isArray(rows)) throw new BadInput(`${what}: коллекция моделей должна быть списком`);
  const out = [];
  for (const row of rows) {
    const pair = cleanPair(rec, row, what);
    if (!out.some((x) => x.providerId === pair.providerId && x.model === pair.model)) out.push(pair);
  }
  return out;
};

/** Новый агент — с одним названием; модели он получит правкой. */
export function addAgent(userId, { name } = {}) {
  const rec = readUserSettings(userId);
  if (rec.agents.length >= MAX_AGENTS) throw new BadInput(`Агентов — не больше ${MAX_AGENTS}`);
  const a = { id: newAgentId(rec), name: cleanAgentName(name), builtin: false, models: [], transcribe: null };
  rec.agents.push(a);
  writeUserSettings(userId, rec);
  return agentView(a);
}

/**
 * Правка агента: название, коллекция моделей, пара расшифровки. Присланы
 * только те поля, что есть в теле. Нет такого агента — null: «не найден»
 * здесь правда, а не ошибка ввода.
 */
export function updateAgent(userId, id, { name, models, transcribe, uses, mcp, ask, skill } = {}) {
  const rec = readUserSettings(userId);
  const a = rec.agents.find((x) => x.id === String(id));
  if (!a) return null;
  if (name !== undefined) a.name = cleanAgentName(name);
  if (models !== undefined) a.models = cleanPairs(rec, models, `У агента «${a.name}»`);
  if (transcribe !== undefined) {
    a.transcribe = transcribe == null ? null : cleanPair(rec, transcribe, `У агента «${a.name}» для расшифровки`);
    a.uses = { ...(a.uses || {}), transcribe: a.transcribe ? { ...a.transcribe } : null };
  }
  /* Назначения приходят по одному: правят то умение, которое назвали, а
     остальные остаются как были. */
  if (uses !== undefined && uses && typeof uses === "object") {
    a.uses = { ...(a.uses || {}) };
    for (const [u, row] of Object.entries(uses)) {
      if (!USE_IDS.includes(u)) throw new BadInput(`Нет такого назначения: «${u}»`);
      a.uses[u] = row == null ? null
        : cleanPair(rec, row, `У агента «${a.name}» для «${USES.find((x) => x.id === u).name}»`);
      /* Модель назначения обязана быть и в коллекции агента: назначить
         то, чем агенту не разрешено думать, — обещание без покрытия. */
      if (a.uses[u] && !a.models.some((m) => m.providerId === a.uses[u].providerId
        && m.model === a.uses[u].model)) {
        a.models = [...a.models, { ...a.uses[u] }];
      }
      if (u === "transcribe") a.transcribe = a.uses[u] ? { ...a.uses[u] } : null;
    }
  }
  if (mcp !== undefined) {
    const ids = (Array.isArray(mcp) ? mcp : []).map(String);
    const bad = ids.find((x) => !rec.mcp.some((m) => m.id === x));
    if (bad) throw new BadInput(`Нет такого MCP-сервера: «${bad}»`);
    a.mcp = ids.filter((x, i) => ids.indexOf(x) === i);
  }
  if (ask !== undefined) a.ask = ask !== false;
  /* Инструкция-скилл: пустая строка — «удалить», это одно и то же
     действие, и отдельного маршрута ему не нужно. */
  if (skill !== undefined) a.skill = String(skill || "").trim().slice(0, MAX_SKILL);
  return agentView(writeUserSettings(userId, rec).agents.find((x) => x.id === a.id));
}

/** Удаляет агента; встроенного — нельзя, и это говорится словами, а не «не найден». */
export function removeAgent(userId, id) {
  const rec = readUserSettings(userId);
  const a = rec.agents.find((x) => x.id === String(id));
  if (!a) return false;
  if (a.builtin) throw new BadInput("Ассистента удалить нельзя");
  rec.agents = rec.agents.filter((x) => x.id !== a.id);
  writeUserSettings(userId, rec);
  return true;
}

/* ─────── MCP-СЕРВЕРЫ (владелец, 2026-09-20) ───────

   Адрес сервера и то, что он о себе рассказал: имя и список инструментов.
   Репозиторий — откуда его взяли; он же подсказывает адрес, когда сервер
   опубликован рядом с кодом. Приложение ходит к серверу само
   (`lib/mcp.js`), поэтому здесь хранится именно адрес, а не рецепт
   запуска: запускать чужой код на своём сервере мы не беремся. */
export function addMcp(userId, { name, url, repo } = {}) {
  const rec = readUserSettings(userId);
  if (rec.mcp.length >= MAX_MCP) throw new BadInput(`MCP-серверов — не больше ${MAX_MCP}`);
  const address = cleanBaseUrl(url);
  if (!address) throw new BadInput("Адрес MCP-сервера обязателен: http:// или https://");
  const id = `mcp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const m = { id, name: String(name || "").trim().slice(0, NAME_LIMIT) || address,
    url: address, repo: String(repo || "").trim().slice(0, 500), tools: [], at: null };
  rec.mcp.push(m);
  writeUserSettings(userId, rec);
  return mcpView(m);
}

export function updateMcp(userId, id, { name, url, repo, tools } = {}) {
  const rec = readUserSettings(userId);
  const m = rec.mcp.find((x) => x.id === String(id));
  if (!m) return null;
  if (name !== undefined) m.name = String(name || "").trim().slice(0, NAME_LIMIT) || m.url;
  if (url !== undefined) {
    const address = cleanBaseUrl(url);
    if (!address) throw new BadInput("Адрес MCP-сервера обязателен: http:// или https://");
    m.url = address;
  }
  if (repo !== undefined) m.repo = String(repo || "").trim().slice(0, 500);
  if (tools !== undefined) {
    m.tools = (Array.isArray(tools) ? tools : [])
      .map((t) => String(t || "").trim().slice(0, MODEL_LIMIT)).filter(Boolean).slice(0, 100);
    m.at = new Date().toISOString();
  }
  writeUserSettings(userId, rec);
  return mcpView(rec.mcp.find((x) => x.id === m.id));
}

export function removeMcp(userId, id) {
  const rec = readUserSettings(userId);
  const m = rec.mcp.find((x) => x.id === String(id));
  if (!m) return false;
  rec.mcp = rec.mcp.filter((x) => x.id !== m.id);
  // И у агентов он больше не разрешён: ссылка на то, чего нет, — не право.
  rec.agents.forEach((a) => { a.mcp = (a.mcp || []).filter((x) => x !== m.id); });
  writeUserSettings(userId, rec);
  return true;
}

/** Сервер с адресом — для вызова его инструментов. */
export function mcpFor(userId, id) {
  const m = readUserSettings(userId).mcp.find((x) => x.id === String(id));
  return m ? { ...m } : null;
}

/** Провайдер с ключом — только для вызова его API (список моделей). Наружу не отдавать. */
export function providerFor(userId, id) {
  const p = readUserSettings(userId).providers.find((x) => x.id === String(id));
  return p ? { ...p, baseUrl: p.baseUrl || DEFAULT_BASE_URL[p.kind], providerName: p.name } : null;
}

