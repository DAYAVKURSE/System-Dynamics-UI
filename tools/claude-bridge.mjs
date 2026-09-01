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

     BRIDGE_URL=https://ваш-домен \
     BRIDGE_TOKEN=тот-же-секрет-что-на-сервере \
     BRIDGE_CWD=/путь/к/репозиторию \
     node tools/claude-bridge.mjs

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

const URL_BASE = (process.env.BRIDGE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.BRIDGE_TOKEN || "";
const CWD = process.env.BRIDGE_CWD || process.cwd();
const BIN = process.env.CLAUDE_BIN || "claude";
// Чтение и поиск — то, ради чего это обычно и заводят: «что там в логах»,
// «покажи, где эта функция». Запись и запуск команд включаются осознанно.
const TOOLS = process.env.BRIDGE_TOOLS || "Read,Grep,Glob";
const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 240000);

if (!URL_BASE || !TOKEN) {
  console.error("Нужны BRIDGE_URL и BRIDGE_TOKEN. См. комментарий в начале файла.");
  process.exit(1);
}

const headers = { "Content-Type": "application/json", "X-Bridge-Token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запускает Claude Code и возвращает {text, sid}. */
function runClaude(prompt, sid) {
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
      err += `\n(превышено время ожидания ${Math.round(TIMEOUT_MS / 1000)} с)`;
    }, TIMEOUT_MS);

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

async function loop() {
  console.log(`Мост запущен. Каталог: ${CWD}. Инструменты: ${TOOLS}`);
  for (;;) {
    let task = null;
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
    const res = await runClaude(task.text, task.sid);
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

loop();
