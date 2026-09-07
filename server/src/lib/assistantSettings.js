import { setSetting } from "./envStore.js";
import { DEFAULT_MODELS, PROVIDERS, isProvider } from "./aiProviders.js";

/* ════════════════════════════════════════════════════════════════
   ЧЕМ ДУМАЕТ ПОМОЩНИК

   Провайдер, модель и ключи лежат в .env — там же, где токен бота и
   секрет TURN, и тем же способом (envStore.setSetting): владелец задаёт их
   с телефона, деплой их переносит, перезапуск не теряет.

   Ключей три, по одному на провайдера, и все три хранятся, даже если
   выбран один: переключиться обратно на OpenAI не должно значить
   «найти ключ заново». Наружу ни один ключ не уходит никогда — только
   `hasKey`: есть он или нет. Интерфейсу большего не нужно: он спрашивает
   «можно ли задавать вопросы», а не «какой ключ».
   ════════════════════════════════════════════════════════════════ */

export const KEY_VARS = {
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  hf: "HF_API_KEY",
};

/* Одна фраза на два места — бот и очередь: кто бы ни спросил ненастроенного
   помощника, ответ обязан звучать одинаково и называть, кто это чинит. */
export const NOT_CONFIGURED = "Помощник не настроен: владелец должен указать ключ в Инструментах";

const MODEL_LIMIT = 120;
// Ключи у всех трёх — печатная латиница без пробелов. Перевод строки в
// ключе сломал бы .env целиком: он построчный, и соседний секрет
// оказался бы приклеен к чужому значению.
const KEY_RE = /^[\x21-\x7e]{8,512}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/* Читаем из process.env, а не из файла: при старте .env туда кладёт
   dotenv, при смене настройки — setSetting, в оба места сразу. Файл
   читать незачем, а в тестах окружение подменить проще, чем файл. */
const value = (name, env = process.env) => String(env[name] ?? "").trim();

/** Что выбрано. Провайдер не выбран — так и говорится пустой строкой. */
export function readSettings(env = process.env) {
  const stored = value("AI_PROVIDER", env);
  const provider = isProvider(stored) ? stored : "";
  const model = value("AI_MODEL", env).slice(0, MODEL_LIMIT);
  return { provider, model };
}

/** Ключ выбранного провайдера — только для внутреннего вызова модели. */
export const keyFor = (provider, env = process.env) =>
  (isProvider(provider) ? value(KEY_VARS[provider], env) : "");

/** Провайдер, модель (с умолчанием) и ключ — для очереди. Наружу не отдавать. */
export function currentFor(env = process.env) {
  const { provider, model } = readSettings(env);
  if (!provider) return null;
  const apiKey = keyFor(provider, env);
  if (!apiKey) return null;
  return { provider, model: model || DEFAULT_MODELS[provider], apiKey };
}

export const isConfigured = (env = process.env) => currentFor(env) != null;

/**
 * Что видно всем позванным: провайдер, модель и есть ли ключ у каждого из
 * трёх. Ключей здесь нет и не может появиться — поле собирается поимённо.
 */
export function settingsView(env = process.env) {
  const { provider, model } = readSettings(env);
  return {
    provider,
    model,
    hasKey: Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(keyFor(p, env))])),
    // Умолчания уезжают отсюда, а не переписываются на клиенте: одно место,
    // где сказано, какая модель подставится, если поле пусто.
    defaults: { ...DEFAULT_MODELS },
  };
}

/**
 * Сохраняет выбор владельца. Ключ пишется только когда прислан непустым:
 * форма отправляет всё сразу, и пустое поле ключа значит «не трогать»,
 * а не «стереть».
 */
export function saveSettings({ provider, model, key } = {}, file) {
  const p = String(provider || "").trim();
  if (!isProvider(p)) throw new Error("provider must be one of: " + PROVIDERS.join(", "));
  const m = String(model ?? "").trim().slice(0, MODEL_LIMIT);
  if (m && !MODEL_RE.test(m)) throw new Error("model looks wrong: only letters, digits, . _ : / -");
  const k = key == null ? "" : String(key).trim();
  if (k && !KEY_RE.test(k)) throw new Error("key looks wrong: expected 8–512 printable characters without spaces");
  // Сначала все проверки, потом запись: половина настроек на диске —
  // это провайдер без ключа или ключ без провайдера, и ни то ни другое
  // не то, что владелец нажал.
  setSetting("AI_PROVIDER", p, file);
  setSetting("AI_MODEL", m, file);
  if (k) setSetting(KEY_VARS[p], k, file);
  return settingsView();
}
