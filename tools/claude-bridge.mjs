#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   ВОРКЕР МОСТА · запускается на вашей машине, не на сервере

   Забирает вопросы, которые вы отправили боту командой «/claude …»,
   запускает Claude Code под вашей же подпиской и приносит ответ обратно.
   Ключ API не нужен и нигде не хранится: вход в Claude Code остаётся тем,
   что вы уже сделали на этой машине командой `claude`.

   Почему воркер здесь, а не на сервере: вход в Claude Code интерактивный и
   привязан к аккаунту — на VPS его не перенести. Заодно сервер ничего не
   исполняет, а домашней машине не нужен ни один открытый порт: воркер сам
   ходит наружу.

   ─── Запуск ───

   На сервере воркер поднимает pm2 рядом с приложением и читает тот же
   .env — руками его запускать не нужно. На своей машине:

     BRIDGE_URL=https://ваш-домен \
     BRIDGE_TOKEN=тот-же-секрет-что-на-сервере \
     BRIDGE_CWD=/путь/к/репозиторию \
     node tools/claude-bridge.mjs

   ─── Вход в аккаунт ───

   Claude Code должен быть залогинен там, где работает воркер. Это
   единственный шаг, который делает только владелец аккаунта: один раз
   выполнить `claude setup-token`, открыть ссылку, разрешить, и положить
   выданный токен в CLAUDE_CODE_OAUTH_TOKEN в .env. Пока входа нет, воркер
   отвечает на каждый вопрос именно этим — что делать, — а не молчит.

   ─── Что важно знать ───

   · Воркер запускает Claude Code в каталоге BRIDGE_CWD и с теми правами,
     которые есть у вас. По умолчанию разрешены только чтение и поиск
     (--allowedTools). Разрешить больше — осознанное решение: см. ниже
     BRIDGE_TOOLS. Права «делать что угодно без вопросов» тут не
     выставляются вовсе: спросить в чате «можно?» всё равно некому.
   · Разговор продолжается: id сессии запоминается и передаётся обратно,
     поэтому следующий вопрос попадает в тот же контекст.
   ════════════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .env приложения — рядом, если воркер запущен pm2 на сервере. Читаем сами,
// без зависимостей: dotenv у воркера нет, а у сервера есть.
const ENV_FILE = path.resolve(process.cwd(), ".env");

function readEnvFile() {
  const out = {};
  if (!existsSync(ENV_FILE)) return out;
  try {
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* файл переписывают прямо сейчас — прочитаем на следующем круге */ }
  return out;
}

for (const [k, v] of Object.entries(readEnvFile())) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const URL_BASE = (process.env.BRIDGE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TOKEN = process.env.BRIDGE_TOKEN || "";
const CWD = process.env.BRIDGE_CWD || process.cwd();
const BIN = process.env.CLAUDE_BIN || "claude";
// Чтение и поиск — то, ради чего это обычно и заводят: «что там в логах»,
// «покажи, где эта функция». Запись и запуск команд включаются осознанно.
const TOOLS = process.env.BRIDGE_TOOLS || "Read,Grep,Glob";
const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 240000);
// Проверка входа — короткая: если Claude Code не залогинен и повис на
// приглашении войти, ждать четыре минуты незачем — ответ уже известен.
const LOGIN_TIMEOUT_MS = Number(process.env.BRIDGE_LOGIN_TIMEOUT_MS || 20000);

const headers = { "Content-Type": "application/json", "X-Bridge-Token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запускает Claude Code и возвращает {text, sid}. */
function runClaude(prompt, sid, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "json", "--allowedTools", TOOLS];
    // Продолжаем ту же сессию, если она уже была: иначе каждый вопрос
    // начинался бы с чистого листа и «а теперь поправь то же самое» не
    // работало бы.
    if (sid) args.push("--resume", sid);
    args.push(prompt);

    const child = spawn(BIN, args, { cwd: CWD, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      err += `\n(превышено время ожидания ${Math.round(timeoutMs / 1000)} с)`;
    }, timeoutMs);

    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ text: "", sid, error: `не удалось запустить ${BIN}: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        return resolve({ text: "", sid, error: err.trim() || `claude вышел с кодом ${code}` });
      }
      try {
        const j = JSON.parse(out);
        // Формат json у -p: {result, session_id, is_error, ...}. Если он
        // когда-нибудь изменится, лучше отдать сырой вывод, чем промолчать.
        return resolve({
          text: j.result ?? j.text ?? out,
          sid: j.session_id || sid,
          error: j.is_error ? (j.error || "claude сообщил об ошибке") : "",
        });
      } catch {
        return resolve({ text: out.trim(), sid, error: "" });
      }
    });
  });
}

const LOGIN_HELP = [
  "Claude Code ещё не вошёл в ваш аккаунт.",
  "",
  "Откройте чат с ботом и отправьте /login — он пришлёт ссылку, вы",
  "подтвердите вход и вставите код ответным сообщением. Всё, больше",
  "ничего делать не нужно.",
].join("\n");

/** Есть ли вход: пробуем самый короткий запрос. Ответ кэшируется на 10 минут —
 *  проверка стоит одного вызова Claude, и спрашивать её каждый раз незачем. */
let loginOk = null, loginCheckedAt = 0;

/** Токен могли дописать в .env только что — входом из чата. Перечитываем его
 *  на каждом круге: иначе вход подействовал бы лишь после перезапуска, а
 *  перезапуск не всегда в наших руках. */
export function refreshToken(read = readEnvFile) {
  const fresh = read().CLAUDE_CODE_OAUTH_TOKEN || "";
  if (fresh && fresh !== process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = fresh;
    loginOk = null; loginCheckedAt = 0;   // проверять вход заново
    return true;
  }
  return false;
}

async function loggedIn() {
  if (loginOk && Date.now() - loginCheckedAt < 600000) return true;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) { loginOk = true; loginCheckedAt = Date.now(); return true; }
  const r = await runClaude("Ответь одним словом: ок", null, LOGIN_TIMEOUT_MS);
  loginOk = !r.error && /ок|ok/i.test(String(r.text || ""));
  loginCheckedAt = Date.now();
  if (!loginOk) console.error(`вход в Claude Code не подтверждён: ${(r.error || r.text || "пустой ответ").slice(0, 200)}`);
  return loginOk;
}

async function loop() {
  console.log(`Мост запущен. Каталог: ${CWD}. Инструменты: ${TOOLS}. Сервер: ${URL_BASE}`);
  for (;;) {
    let task = null;
    if (refreshToken()) console.log("подхватил новый вход в Claude Code из .env");
    try {
      const r = await fetch(`${URL_BASE}/api/bridge/next`, { headers });
      if (r.status === 401) { console.error("Секрет не подошёл — проверьте BRIDGE_TOKEN."); await sleep(10000); continue; }
      if (r.status === 503) { console.error("Мост выключен на сервере — не задан BRIDGE_TOKEN."); await sleep(15000); continue; }
      if (!r.ok) { await sleep(3000); continue; }
      task = await r.json();
    } catch (e) {
      // Сеть моргнула — ждём и продолжаем: упасть здесь значило бы тихо
      // перестать отвечать.
      console.error(`опрос не удался: ${e.message}`);
      await sleep(5000);
      continue;
    }
    if (!task?.id) continue;

    console.log(`→ вопрос ${task.id}: ${task.text.slice(0, 80)}`);
    const res = (await loggedIn())
      ? await runClaude(task.text, task.sid)
      : { text: "", sid: null, error: LOGIN_HELP };
    try {
      await fetch(`${URL_BASE}/api/bridge/${task.id}/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: res.text, error: res.error, sid: res.sid }),
      });
      console.log(`← ответ ${task.id}${res.error ? ` (ошибка: ${res.error})` : ""}`);
    } catch (e) {
      console.error(`ответ не доставлен: ${e.message}`);
    }
  }
}

// Цикл запускается, только когда воркер вызвали как программу: иначе его
// нельзя было бы разобрать тестами — импорт сразу уходил бы в опрос сервера.
const runDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  if (!URL_BASE || !TOKEN) {
    console.error("Нужны BRIDGE_URL и BRIDGE_TOKEN. См. комментарий в начале файла.");
    process.exit(1);
  }
  loop();
}
