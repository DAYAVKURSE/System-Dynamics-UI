import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ВХОД В CLAUDE CODE ИЗ ЧАТА

   Мост работает под подпиской владельца, поэтому Claude Code на сервере
   должен быть залогинен. Раньше это значило: зайти по SSH, выполнить
   `claude setup-token`, скопировать токен в .env и перезапустить воркер.
   Владельцу без компьютера это недоступно — Claude Code не запускается ни
   в Termux, ни на телефоне вообще.

   Здесь тот же самый штатный `claude setup-token`, но его вопросы и
   ответы ходят через бота: сервер запускает команду, вылавливает ссылку и
   присылает её кнопкой; владелец подтверждает вход в браузере и вставляет
   выданный код обычным сообщением; сервер отдаёт код команде, забирает
   токен и кладёт его в .env. Ни одного шага в терминале.

   Почему через `script`: `claude setup-token` — интерактивная программа и
   без терминала не печатает ничего вовсе (проверено: пустой вывод и
   зависание). `script` выдаёт ей псевдотерминал, а нам оставляет обычные
   потоки. Ширину терминала ставим большой: на 80 колонках ссылка
   переносится посреди параметров и собрать её обратно нельзя.

   Токен не попадает ни в лог, ни в чат: он пишется в .env правами 0600, а
   владельцу уходит только «готово». Код подтверждения тоже одноразовый и
   тоже не логируется.

   Важное ограничение: вход происходит на той машине, где работает сервер.
   В нашей поставке воркер живёт там же (pm2 рядом), поэтому этого хватает.
   Если воркер вынесен на другую машину, входить надо на ней.
   ════════════════════════════════════════════════════════════════ */

const URL_TIMEOUT_MS = 90000;      // сколько ждём ссылку от claude
const TOKEN_TIMEOUT_MS = 120000;   // сколько ждём токен после кода
const FLOW_TTL_MS = 15 * 60 * 1000;

/** Экранные последовательности терминала: без них в тексте мусор, а ссылка
 *  прячется внутри гиперссылки OSC 8 (её закрывает BEL или ESC-обратный слеш). */
export function plainText(raw) {
  return String(raw)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")   // OSC (в т.ч. ссылки)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")           // CSI (цвета, курсор)
    .replace(/\x1b[()][A-Za-z0-9]/g, "")                 // выбор набора символов
    .replace(/\x1b[=>]/g, "")
    .replace(/\r/g, "");
}

/**
 * Ссылка на подтверждение входа из вывода claude.
 *
 * Проверяем не «похоже на ссылку», а что она целая: в ней обязаны быть
 * code_challenge и state. Обрезанная переносом ссылка их потеряет — и
 * лучше честно сказать «не разобрал», чем прислать владельцу нерабочую.
 */
export function findAuthUrl(text) {
  const m = plainText(text).match(/https:\/\/[^\s"'<>]+/g);
  for (const candidate of m || []) {
    const url = candidate.replace(/[.,)]+$/, "");
    if (!/oauth\/authorize/.test(url)) continue;
    try {
      const u = new URL(url);
      if (u.searchParams.get("code_challenge") && u.searchParams.get("state")) return url;
    } catch { /* не ссылка — смотрим следующую */ }
  }
  return null;
}

/** Токен из вывода. Формат может меняться, поэтому ищем по префиксу. */
export function findToken(text) {
  const m = plainText(text).match(/sk-ant-[A-Za-z0-9_-]{20,}/);
  return m ? m[0] : null;
}

/** Хвост вывода для сообщения об ошибке — без токенов и без мусора. */
export function safeTail(text, limit = 300) {
  const clean = plainText(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "«токен»")
    .split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
  return clean.length > limit ? `…${clean.slice(-limit)}` : clean;
}

/* ─────── файл .env ─────── */

export const envFile = () => process.env.ENV_FILE || path.join(process.cwd(), ".env");

/**
 * Дописывает или заменяет одну строку в .env, не трогая остальные: рядом
 * лежат секреты бота и моста, и перезаписать файл целиком значило бы их
 * потерять.
 */
export function putEnvValue(name, value, file = envFile()) {
  let body = "";
  try { body = fs.readFileSync(file, "utf8"); } catch { /* файла ещё нет */ }
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  const next = re.test(body)
    ? body.replace(re, line)
    : `${body}${body && !body.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* не в нашей власти — не беда */ }
  return next;
}

/** Есть ли уже вход: токен в окружении процесса или в .env. */
export function hasLogin(file = envFile()) {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  try {
    return /^CLAUDE_CODE_OAUTH_TOKEN=\S+/m.test(fs.readFileSync(file, "utf8"));
  } catch { return false; }
}

/* ─────── сам разговор с claude ─────── */

let flow = null;   // { child, out, stage, url, error, startedAt, timer }

export const loginState = () => (flow
  ? { stage: flow.stage, url: flow.url || "", error: flow.error || "" }
  : { stage: "idle", url: "", error: "" });

export const awaitingCode = () => Boolean(flow && flow.stage === "code");

export function cancelLogin() {
  if (!flow) return false;
  clearTimeout(flow.timer);
  try { flow.child.kill("SIGTERM"); } catch { /* уже мёртв */ }
  flow = null;
  return true;
}

/**
 * Запускает `claude setup-token` и ждёт ссылку.
 *
 * @returns {Promise<{url: string}>}
 * @throws  если команды нет, терминал не выдался или ссылка не разобралась
 */
export function startLogin({ bin = process.env.CLAUDE_BIN || "claude",
  timeoutMs = URL_TIMEOUT_MS } = {}) {
  cancelLogin();
  // Ширина 400 — чтобы ссылка не переносилась; строк побольше, чтобы вывод
  // не затирался перерисовкой.
  const child = spawn("script", ["-qec", `stty cols 400 rows 60; ${bin} setup-token`, "/dev/null"],
    { stdio: ["pipe", "pipe", "pipe"] });

  const state = { child, out: "", stage: "url", url: "", error: "", startedAt: Date.now() };
  flow = state;
  const collect = (d) => { state.out += d; };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  // Даже удачный вход не должен висеть вечно: забытая попытка держала бы
  // процесс claude на сервере до перезапуска.
  state.timer = setTimeout(() => { if (flow === state) cancelLogin(); }, FLOW_TTL_MS);
  if (state.timer.unref) state.timer.unref();

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, url) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      if (err) {
        state.stage = "error"; state.error = err.message;
        try { child.kill("SIGTERM"); } catch { /* уже мёртв */ }
        if (flow === state) { clearTimeout(state.timer); flow = null; }
        return reject(err);
      }
      state.stage = "code"; state.url = url;
      return resolve({ url });
    };

    child.on("error", (e) => finish(new Error(
      e.code === "ENOENT"
        ? "на сервере нет команды script или claude — вход из чата недоступен"
        : `не удалось запустить вход: ${e.message}`)));

    child.on("close", () => {
      if (!done) finish(new Error(`claude завершился, не дав ссылку. ${safeTail(state.out)}`));
    });

    const poll = setInterval(() => {
      const url = findAuthUrl(state.out);
      if (url) return finish(null, url);
      if (Date.now() - state.startedAt > timeoutMs) {
        return finish(new Error(`claude не показал ссылку за ${Math.round(timeoutMs / 1000)} с. ${safeTail(state.out)}`));
      }
      return undefined;
    }, 300);
    if (poll.unref) poll.unref();
  });
}

/**
 * Отдаёт код подтверждения и ждёт токен.
 *
 * @returns {Promise<{token: string}>}
 */
export function submitCode(code, { timeoutMs = TOKEN_TIMEOUT_MS } = {}) {
  const state = flow;
  if (!state || state.stage !== "code") {
    return Promise.reject(new Error("вход сейчас не начат — отправьте /login"));
  }
  const clean = String(code || "").trim();
  if (!clean || /\s/.test(clean) || clean.length > 500) {
    return Promise.reject(new Error("это не похоже на код подтверждения"));
  }

  state.stage = "token";
  const from = state.out.length;   // токен ищем в том, что пришло после кода
  try { state.child.stdin.write(`${clean}\n`); }
  catch (e) { return Promise.reject(new Error(`код не удалось передать: ${e.message}`)); }

  return new Promise((resolve, reject) => {
    let done = false;
    const started = Date.now();
    const finish = (err, token) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      try { state.child.kill("SIGTERM"); } catch { /* уже вышел */ }
      if (flow === state) { clearTimeout(state.timer); flow = null; }
      if (err) return reject(err);
      return resolve({ token });
    };

    state.child.on("close", () => {
      if (done) return;
      const token = findToken(state.out.slice(from)) || findToken(state.out);
      if (token) return finish(null, token);
      return finish(new Error(`код не подошёл. ${safeTail(state.out.slice(from))}`));
    });

    const poll = setInterval(() => {
      const token = findToken(state.out.slice(from));
      if (token) return finish(null, token);
      if (Date.now() - started > timeoutMs) {
        return finish(new Error(`claude не выдал токен за ${Math.round(timeoutMs / 1000)} с`));
      }
      return undefined;
    }, 300);
    if (poll.unref) poll.unref();
  });
}

/**
 * Сохраняет токен и поднимает воркер. Перезапуск — попытка: воркер и сам
 * перечитывает .env на каждом круге, поэтому вход подействует и без pm2.
 */
export function saveToken(token, { file = envFile(), restart = true } = {}) {
  putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", token, file);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  if (!restart) return { saved: true, restarted: false };
  try {
    const r = spawn("pm2", ["restart", "claude-bridge"], { stdio: "ignore", detached: true });
    r.unref();
    return { saved: true, restarted: true };
  } catch {
    // pm2 может отсутствовать (локальная разработка) — не беда: воркер
    // подхватит токен сам.
    return { saved: true, restarted: false };
  }
}

/** Полный путь: код → токен → .env → перезапуск. */
export async function finishLogin(code, opts = {}) {
  const { token } = await submitCode(code, opts);
  return saveToken(token, opts);
}
