import { spawn } from "node:child_process";
import fs from "node:fs";
import { envFile, putEnvValue } from "./envStore.js";

/* ════════════════════════════════════════════════════════════════
   ВХОД В CLAUDE CODE ИЗ ЧАТА

   Мост работает под подпиской владельца, поэтому Claude Code на сервере
   должен быть залогинен. Раньше это значило: зайти по SSH, выполнить
   команду входа, скопировать токен в .env и перезапустить воркер.
   Владельцу без компьютера это недоступно — Claude Code не запускается ни
   в Termux, ни на телефоне вообще. Здесь тот же штатный вход, но его
   вопросы и ответы ходят через бота.

   ─── Два способа, и первый — правильный ───

   1. `claude auth login` — ОБЫЧНАЯ программа: печатает ссылку в stdout,
      читает код из stdin построчно и отвечает словами («Login
      successful.» или «Login failed: …»). Ни псевдотерминала, ни
      угадывания нажатий, ни разбора перерисовки экрана. Вход при этом не
      выдаёт токен, а сохраняется у того пользователя, под которым идёт
      команда (~/.claude/.credentials.json), — то есть ровно там, где его
      возьмёт воркер: он живёт на этой же машине и под тем же
      пользователем. Пока воркер работает, вход обновляется сам.

   2. `claude setup-token` — запасной путь для версий Claude Code, где
      команды `auth` ещё нет. Он печатает токен на год, но ТОЛЬКО в
      настоящем терминале: без псевдотерминала не печатает вообще ничего
      (проверено — пустой вывод и зависание). Отсюда `script`, ширина 400
      колонок (на 80 ссылка переносится посреди параметров) и разбор
      экрана Ink.

   ─── Почему это переписано ───

   Способ 2 ломался в проде на последнем шаге: «claude не выдал токен за
   120 с». Причина — в том, как Ink читает клавиши, и она стоит того,
   чтобы быть записанной:

   · перевод строки «\n» Enter-ом НЕ считается: Ink зовёт его «enter», а
     поле ввода принимает только «return», то есть возврат каретки «\r».
     Код набирался в поле и не отправлялся никогда;
   · «\r», пришедший ОДНИМ куском вместе с кодом, тоже не срабатывает:
     длинную порцию ввода Claude Code принимает за вставку из буфера
     обмена и кладёт в поле целиком, вместе с возвратом каретки.
     Проверено на живой команде: короткий код одним куском отправляется,
     настоящий (сто с лишним знаков) — нет.

   Поэтому в способе 2 код и Enter уходят раздельно, с паузой, а если
   экран не сдвинулся — Enter повторяется. И в обоих способах мы читаем
   ответ команды: «Invalid code», «Login failed: …» приходят словами, и
   владельцу уходит причина, а не молчание до таймаута.

   Токен (если он вообще появляется) не попадает ни в лог, ни в чат: он
   пишется в .env правами 0600, а владельцу уходит только «готово». Код
   подтверждения тоже одноразовый и тоже не логируется.

   Важное ограничение: вход происходит на той машине, где работает сервер.
   В нашей поставке воркер живёт там же (pm2 рядом), поэтому этого хватает.
   ════════════════════════════════════════════════════════════════ */

const URL_TIMEOUT_MS = 90000;      // сколько ждём ссылку
const TOKEN_TIMEOUT_MS = 120000;   // сколько ждём ответ после кода
const FLOW_TTL_MS = 15 * 60 * 1000;
const ENTER_DELAY_MS = 500;        // пауза между кодом и первым Enter
const ENTER_GAP_MS = 1500;         // пауза между повторными Enter
const ENTER_TRIES = 4;             // сколько раз всего жмём Enter
const OUT_LIMIT = 512 * 1024;      // экран перерисовывается — храним только хвост

const claudeBin = () => process.env.CLAUDE_BIN || "claude";

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
 * Текст без пробелов и в нижнем регистре — для поиска фраз.
 *
 * Ink расставляет слова не пробелами, а перемещением курсора («\x1b[12G»),
 * и после чистки от управляющих кодов «Hold Shift while selecting»
 * превращается в «HoldShiftwhileselecting». Искать фразу по словам поэтому
 * нельзя — только по слитному виду.
 */
export const squash = (raw) => plainText(raw).replace(/\s+/g, "").toLowerCase();

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

/**
 * Код подтверждения в том виде, в каком его ждёт claude.
 *
 * Владелец копирует со страницы Claude строку «код#состояние» — обе части
 * обязательны, без второй команда отвечает «Invalid code». Присланное
 * бывает и целой ссылкой возврата, и с переносом строки от почтового
 * клиента: разбираем и то, и другое. Всё, что не похоже на код (русские
 * буквы, рассказ вместо кода), сюда не проходит вовсе — в чужой процесс
 * не должно уезжать что попало.
 */
export function normalizeCode(raw) {
  let s = String(raw || "").trim().replace(/^[«"'<(]+|[»"')>]+$/g, "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const code = u.searchParams.get("code") || "";
      const state = u.searchParams.get("state") || "";
      s = state ? `${code}#${state}` : code;
    } catch { return ""; }
  }
  s = s.replace(/\s+/g, "");
  if (!s || s.length > 500) return "";
  return /^[A-Za-z0-9._~:+/=%#-]+$/.test(s) ? s : "";
}

/**
 * Жалоба claude из вывода — словами, как он её написал.
 *
 * Форм у неё две, и вторую легко проглядеть: «OAuth error: …» на экране
 * setup-token и голое «Invalid code. Please make sure the full code was
 * copied.» в stderr у `auth login` — БЕЗ всякого префикса. Пока вторая не
 * ловилась, неполный код оборачивался двумя минутами тишины вместо
 * мгновенного объяснения.
 */
export function findError(text) {
  const clean = plainText(text);
  const m = clean.match(
    /(?:OAuth error|OAuth login failed|Login failed):\s*([\s\S]*?)(?:Press\s*Enter|Press\s*any\s*key|\n|$)/i);
  if (m) return m[1].replace(/\s+/g, " ").trim();
  const bare = clean.match(/Invalid code[^\n]*/i);
  return bare ? bare[0].replace(/\s+/g, " ").trim() : "";
}

/** По-русски о том, что случилось, и что с этим делать. */
export function explainError(message) {
  const s = String(message || "");
  if (/invalid\s*code/i.test(s)) {
    return "код неполный: со страницы Claude его надо скопировать целиком,"
      + " вместе с частью после «#»";
  }
  if (/status\s*code\s*4\d\d|request\s*failed|expired|invalid_grant/i.test(s)) {
    return "Claude не принял код — он действует всего несколько минут";
  }
  if (/subscription|not\s*allowed|forbidden/i.test(s)) {
    return `Claude отказал: ${s}. Вход из чата работает только с подпиской Claude`;
  }
  return s || "claude не объяснил, что не так";
}

/** Хвост вывода для сообщения об ошибке — без токенов и без мусора. */
export function safeTail(text, limit = 300) {
  const clean = plainText(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "«токен»")
    // Прощальные строки `script` — не поломка, а его обычный выход. В чате
    // они читаются как крах, поэтому в объяснение не идут.
    .replace(/Session terminated[^\n]*/gi, "")
    .replace(/killing shell[^\n]*/gi, "")
    .split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
  return clean.length > limit ? `…${clean.slice(-limit)}` : clean;
}

/* ─────── файл .env ─────── */

// Живёт в lib/envStore.js: тем же способом бот сохраняет имя приложения
// звонка, и правило «одна строка, остальные не трогаем» должно быть одно.
export { envFile, putEnvValue };

/** Есть ли токен входа: в окружении процесса или в .env. */
export function hasLogin(file = envFile()) {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  try {
    return /^CLAUDE_CODE_OAUTH_TOKEN=\S+/m.test(fs.readFileSync(file, "utf8"));
  } catch { return false; }
}

/* ─────── что говорит сам claude ─────── */

/**
 * Короткий запуск claude с чтением вывода. Ничего не ждёт вечно.
 *
 * stdout и stderr собираются ПОРОЗНЬ: `auth status` печатает JSON в stdout, а
 * лаунчер иногда роняет в stderr предупреждение — и разбор общего блока
 * ломался бы на нём, тихо превращая «вход сохранён» в «этот claude не умеет
 * auth».
 */
function run(bin, args, { timeoutMs = 15000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env }); }
    catch (e) { return resolve({ code: -1, out: "", err: e.message, timedOut: false }); }
    let out = "", err = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* уже мёртв */ }
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message, timedOut });
    });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut }); });
    return undefined;
  });
}

/** Умеет ли эта версия `claude auth login` — способ без псевдотерминала. */
export async function authSupported(bin = claudeBin()) {
  const r = await run(bin, ["auth", "login", "--help"], { timeoutMs: 10000 });
  // Не ответил вовремя — это не «не умеет». Уходить на хрупкий запасной путь
  // молча нельзя: он уже стоил владельцу двух неудачных входов.
  if (r.timedOut) {
    console.warn("[login] `claude auth login --help` не ответил за 10 с —"
      + " иду запасным путём через setup-token");
  }
  return r.code === 0;
}

/**
 * Что claude думает о своём входе.
 *
 * Спрашиваем БЕЗ CLAUDE_CODE_OAUTH_TOKEN в окружении: этот токен стоит в
 * очереди выше сохранённого входа, и с ним ответ был бы про него, а не про
 * то, что мы только что сохранили.
 */
export async function authStatus(bin = claudeBin()) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const r = await run(bin, ["auth", "status"], { timeoutMs: 20000, env });
  if (r.code === -1) return { supported: false, loggedIn: false, method: "" };
  try {
    const j = JSON.parse(plainText(r.out).trim());
    return { supported: true, loggedIn: Boolean(j.loggedIn), method: j.authMethod || "" };
  } catch {
    // Старая версия без `auth` печатает подсказку и выходит с ошибкой.
    return { supported: false, loggedIn: false, method: "" };
  }
}

/**
 * Что claude знает о входе — то же самое, но с оговоркой.
 *
 * «Вошли» здесь значит «есть чем подписать запрос», а не «оно ещё
 * работает»: просроченный токен claude тоже считает входом. Поэтому по
 * этому ответу нельзя обещать владельцу, что мост заработает, — можно
 * только не гонять его входить заново без причины.
 */

/** Вход есть? Токен в .env или сохранённый вход самого claude. */
export async function loggedIn({ bin = claudeBin(), file = envFile() } = {}) {
  if (hasLogin(file)) return true;
  return (await authStatus(bin)).loggedIn;
}

/* ─────── сам разговор с claude ─────── */

let flow = null;   // { kind, child, out, dropped, stage, url, error, timer }

export const loginState = () => (flow
  ? { stage: flow.stage, url: flow.url || "", error: flow.error || "", kind: flow.kind }
  : { stage: "idle", url: "", error: "", kind: "" });

export const awaitingCode = () => Boolean(flow && flow.stage === "code");

export function cancelLogin({ reason = "cancelled" } = {}) {
  if (!flow) return false;
  clearTimeout(flow.timer);
  // Пометка нужна тому, кто прямо сейчас ждёт ссылку: увидев смерть
  // процесса, он иначе расскажет владельцу про «крах», которого не было, —
  // это просто второй /login вытеснил первый.
  flow.dropped = reason;
  try { flow.child.kill("SIGTERM"); } catch { /* уже мёртв */ }
  flow = null;
  return true;
}

/** Общая часть обоих способов: собрать вывод, дождаться ссылки. */
function beginFlow(kind, child, binName, timeoutMs) {
  const state = { kind, child, out: "", cut: 0, stage: "url", url: "", error: "",
    startedAt: Date.now(), closed: false, dropped: "" };
  flow = state;
  // Экран перерисовывается целиком на каждое движение, поэтому вывод растёт
  // без конца. Держим хвост: всё нужное — ссылка, ошибка, токен — в нём.
  const collect = (d) => {
    state.out += d;
    if (state.out.length > OUT_LIMIT) {
      const cut = state.out.length - OUT_LIMIT;
      state.out = state.out.slice(cut);
      state.cut += cut;
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  // Даже удачный вход не должен висеть вечно: забытая попытка держала бы
  // процесс claude на сервере до перезапуска.
  state.timer = setTimeout(() => { if (flow === state) cancelLogin(); }, FLOW_TTL_MS);
  if (state.timer.unref) state.timer.unref();

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, url) => {
      if (done) return undefined;
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
        ? `на сервере нет команды ${binName} — вход из чата недоступен`
        : `не удалось запустить вход: ${e.message}`)));

    // Смерть процесса запоминаем всегда, а не только пока ждём ссылку:
    // иначе код, присланный после неё, ждал бы ответа две минуты от того,
    // кому его уже некому прочитать.
    child.on("close", (code) => {
      state.closed = true;
      state.exitCode = code;
      if (done) return;
      finish(new Error(state.dropped
        ? "вход перезапущен"
        : `claude завершился, не дав ссылку. ${safeTail(state.out)}`));
    });

    const poll = setInterval(() => {
      const url = findAuthUrl(state.out);
      if (url) return finish(null, url);
      if (Date.now() - state.startedAt > timeoutMs) {
        return finish(new Error(`claude не показал ссылку за ${Math.round(timeoutMs / 1000)} с.`
          + ` ${safeTail(state.out)}`));
      }
      return undefined;
    }, 300);
    if (poll.unref) poll.unref();
  });
}

/**
 * Начинает вход и ждёт ссылку.
 *
 * @param mode "auth" | "token" — обычно определяется само.
 * @returns {Promise<{url: string}>}
 */
export async function startLogin({ bin = claudeBin(), timeoutMs = URL_TIMEOUT_MS,
  mode = "" } = {}) {
  cancelLogin();
  const kind = mode || (await authSupported(bin) ? "auth" : "token");
  if (kind === "auth") {
    // Обычная программа: ссылка в stdout, код в stdin. Ни терминала, ни фокусов.
    return beginFlow("auth", spawn(bin, ["auth", "login"], { stdio: ["pipe", "pipe", "pipe"] }),
      bin, timeoutMs);
  }
  // Ширина 1000 — чтобы ссылка не переносилась ни при каком её росте: Ink
  // рвёт строку по ширине терминала, а разорванную ссылку собрать обратно
  // нельзя. TERM задаём явно, чтобы вывод не зависел от окружения pm2.
  return beginFlow("token",
    spawn("script", ["-qec", `stty cols 1000 rows 60; ${bin} setup-token`, "/dev/null"],
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, TERM: process.env.TERM || "xterm-256color" } }),
    "script", timeoutMs);
}

/** Ошибка, после которой имеет смысл сразу выдать новую ссылку. */
const retryable = (message) => Object.assign(new Error(message), { retry: true });

/**
 * Отдаёт код подтверждения и ждёт ответа.
 *
 * @returns {Promise<{token: string, stored: boolean}>} token пуст, когда
 *          claude сохранил вход у себя (способ `auth login`).
 */
export function submitCode(code, {
  timeoutMs = TOKEN_TIMEOUT_MS,
  enterDelayMs = ENTER_DELAY_MS,
  enterGapMs = ENTER_GAP_MS,
  enterTries = ENTER_TRIES,
} = {}) {
  const state = flow;
  if (!state || state.stage !== "code") {
    return Promise.reject(new Error("вход сейчас не начат — отправьте /login"));
  }
  const clean = normalizeCode(code);
  if (!clean) return Promise.reject(new Error("это не похоже на код подтверждения"));

  // Процесс мог умереть, пока владелец ходил в браузер: у claude свой срок
  // на подтверждение. Молчать об этом две минуты незачем — причина уже
  // написана в его выводе.
  if (state.closed) {
    const why = findError(state.out);
    cancelLogin();
    return Promise.reject(retryable(why
      ? explainError(why)
      : `claude закрыл вход, не дождавшись кода. ${safeTail(state.out)}`));
  }

  state.stage = "token";
  // Разговор получает свой срок заново: код пришёл под конец окна — это не
  // повод убить процесс посреди проверки.
  clearTimeout(state.timer);
  state.timer = setTimeout(() => { if (flow === state) cancelLogin({ reason: "timeout" }); },
    FLOW_TTL_MS);
  if (state.timer.unref) state.timer.unref();

  const from = state.out.length + state.cut;   // ответ ищем в том, что после кода
  const tail = () => state.out.slice(Math.max(0, from - state.cut));
  const auth = state.kind === "auth";

  try {
    // `auth login` читает строку из stdin — как любая обычная программа.
    // `setup-token` читает клавиши: код и Enter надо разделить (см. шапку).
    state.child.stdin.write(auth ? `${clean}\n` : clean);
  } catch (e) { return Promise.reject(new Error(`код не удалось передать: ${e.message}`)); }

  return new Promise((resolve, reject) => {
    let done = false;
    let enters = 0;
    let nextEnterAt = Date.now() + enterDelayMs;
    const started = Date.now();

    const finish = (err, result) => {
      if (done) return undefined;
      done = true;
      clearInterval(poll);
      try { state.child.kill("SIGTERM"); } catch { /* уже вышел */ }
      if (flow === state) { clearTimeout(state.timer); flow = null; }
      if (err) return reject(err);
      return resolve(result);
    };

    const look = (seen) => {
      const token = findToken(seen);
      if (token) return { token, stored: false };
      if (auth && /Login successful/i.test(plainText(seen))) return { token: "", stored: true };
      return null;
    };

    state.child.on("close", () => {
      if (done) return undefined;
      const got = look(tail()) || look(state.out);
      if (got) return finish(null, got);
      const err = findError(tail()) || findError(state.out);
      return finish(retryable(err
        ? explainError(err)
        : `код не подошёл. ${safeTail(tail())}`));
    });

    const poll = setInterval(() => {
      const seen = tail();
      const got = look(seen) || (state.closed ? look(state.out) : null);
      if (got) return finish(null, got);

      const err = findError(seen) || (state.closed ? findError(state.out) : "");
      if (err) return finish(retryable(explainError(err)));

      if (state.closed) {
        return finish(retryable(`claude закрыл вход. ${safeTail(state.out)}`));
      }

      // Способ с терминалом: экран сдвинулся — код принят, Enter не нужен.
      if (!auth) {
        const moved = /processingauthentication|createdsuccessfully/.test(squash(seen));
        if (!moved && enters < enterTries && Date.now() >= nextEnterAt) {
          enters += 1;
          nextEnterAt = Date.now() + enterGapMs;
          try { state.child.stdin.write("\r"); }
          catch { /* процесс ушёл — увидим по close */ }
        }
      }

      if (Date.now() - started > timeoutMs) {
        return finish(retryable(`claude не ответил на код за ${Math.round(timeoutMs / 1000)} с`));
      }
      return undefined;
    }, 300);
    if (poll.unref) poll.unref();
  });
}

/**
 * Перезапуск воркера — попытка, а не обязанность: он и сам перечитывает
 * .env на каждом круге опроса.
 *
 * Обработчик «error» здесь не для порядка. spawn сообщает об отсутствии
 * команды АСИНХРОННО, событием, а не исключением: без слушателя Node
 * валит весь процесс — сервер и бота — ровно в тот момент, когда вход
 * наконец удался, и владелец вместо «Готово» не получает ничего.
 * Проверено: с пустым PATH сервер падал именно так.
 */
function restartWorker() {
  return new Promise((resolve) => {
    let child;
    try { child = spawn("pm2", ["restart", "claude-bridge"], { stdio: "ignore" }); }
    catch { return resolve(false); }
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    child.on("error", () => done(false));        // pm2 нет — не беда
    child.on("close", (code) => done(code === 0));
    // Ждать вечно тоже не будем: ответ владельцу важнее точности отчёта.
    const t = setTimeout(() => done(false), 10000);
    if (t.unref) t.unref();
    return undefined;
  });
}

/** Сохраняет токен способа `setup-token` и поднимает воркер. */
export async function saveToken(token, { file = envFile(), restart = true } = {}) {
  putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", token, file);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return { saved: true, mode: "token", restarted: restart ? await restartWorker() : false };
}

/**
 * Закрепляет вход способа `auth login`: сам токен тут не выдаётся, claude
 * сохранил его у себя. Наше дело — убрать из .env прежний
 * CLAUDE_CODE_OAUTH_TOKEN: он стоит в очереди ВЫШЕ сохранённого входа, и
 * со старым просроченным токеном свежий вход не подействовал бы вовсе.
 */
export async function storeLogin({ file = envFile(), restart = true, bin = claudeBin() } = {}) {
  const st = await authStatus(bin);
  if (st.supported && !st.loggedIn) {
    throw retryable("claude сказал, что вход прошёл, но подтвердить его не смог");
  }
  putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", "", file);
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return { saved: true, mode: "auth", restarted: restart ? await restartWorker() : false };
}

/** Полный путь: код → вход сохранён → воркер поднят. */
export async function finishLogin(code, opts = {}) {
  const r = await submitCode(code, opts);
  return r.token ? await saveToken(r.token, opts) : storeLogin(opts);
}
