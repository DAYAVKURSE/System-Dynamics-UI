import { getInitData } from "./telegram.js";
import { actingAs } from "./identity.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК · клиент

   Всё, что здесь есть, — тонкая обёртка над /api/assistant: свои
   провайдеры и модели (ключ — только «есть/нет»), таблица «задача →
   модель», вопрос в два шага и память.

   Подпись — та же, что у остальных запросов приложения (identity.js):
   заголовок X-Telegram-Init-Data, по которому сервер узнаёт человека и
   собирает контекст только из его данных. Здесь она повторена, а не
   импортирована: identity.js свой json() наружу не отдаёт, и трогать его
   ради одной строки — трогать общий файл, который правят параллельно.
   ════════════════════════════════════════════════════════════════ */

const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(),
  /* Под чужой страницей — и здесь: «Войти под его именем» меняет не
     одну вкладку, а всё приложение (см. identity.js). */
  ...(actingAs() ? { "X-Act-As": actingAs() } : {}),
});

const json = async (url, opts) => {
  const r = await fetch(url, { headers: headers(), ...opts });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Сервер ответил ${r.status}`);
  return r.status === 204 ? null : r.json();
};

/* ─────── чем думает помощник ───────

   Всё — только своё: сервер выводит человека из подписи. Ключ уходит
   на сервер один раз при добавлении или замене и обратно не приходит. */

export const getAssistantSettings = () => json("/api/assistant/settings");
export const addProvider = (p) =>
  json("/api/assistant/providers", { method: "POST", body: JSON.stringify(p) });
export const updateProvider = (id, p) =>
  json(`/api/assistant/providers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(p) });
export const dropProvider = (id) =>
  json(`/api/assistant/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
// Список моделей просит сервер по ключу провайдера — ключ в браузер не едет.
export const providerModels = (id) =>
  json(`/api/assistant/providers/${encodeURIComponent(id)}/models`);
export const putTasks = (t) =>
  json("/api/assistant/tasks", { method: "PUT", body: JSON.stringify(t) });

/* ─────── агенты ───────
   «Ассистент» есть всегда (`builtin`), остальных заводит человек. У агента
   — коллекция моделей из своих провайдеров и своя память. */
export const addAgent = (name) =>
  json("/api/assistant/agents", { method: "POST", body: JSON.stringify({ name }) });
export const updateAgent = (id, patch) =>
  json(`/api/assistant/agents/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) });
export const dropAgent = (id) =>
  json(`/api/assistant/agents/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ─────── вопрос ───────

   В два шага: поставить вопрос и опрашивать ответ короткими запросами.
   Один длинный запрос nginx и WebView Telegram рвут на минуте —
   интерфейс видел только «Failed to fetch». Так уже было с черновиком
   задачи, и урок тот же.

   `task` — строка таблицы «задача → модель» («bot» из чата бота);
   без него сервер берёт «помощник по умолчанию».

   Ошибка приходит словами из статуса: «не настроен», «OpenAI ответил
   401». Их показывают как есть — они и написаны для человека. */
export async function askAssistant(question, context = "",
  { intervalMs = 1000, timeoutMs = 190000, signal, task } = {}) {
  const started = await json("/api/assistant/ask",
    { method: "POST", body: JSON.stringify({ question, context: context || "", ...(task ? { task } : {}) }) });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new Error("отменено");
    await new Promise((r) => setTimeout(r, intervalMs));
    const st = await json(`/api/assistant/ask/${encodeURIComponent(started.id)}`);
    if (st.status === "done") return st.text;
    if (st.status !== "pending") throw new Error(st.error || "Помощник не ответил");
    if (Date.now() > deadline) throw new Error("Помощник не ответил вовремя — попробуйте ещё раз");
  }
}

/* ─────── память ─────── */

export const listMemory = (agent = "assistant") =>
  json(`/api/assistant/memory?agent=${encodeURIComponent(agent)}`);
export const dropMemory = (id) =>
  json(`/api/assistant/memory/${encodeURIComponent(id)}`, { method: "DELETE" });

// Имя и название едут в заголовке, а заголовки latin-1: кириллицу шлём
// base64, как и у файлов отчётов (storage.js).
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(String(s || ""))));

/**
 * Положить в память: `{title, text}` — заметка, `File` (или `{file, title}`) —
 * файл сырыми байтами. Текстовый файл сервер прочитает в саму запись.
 */
export async function addMemory(item, agent = "assistant") {
  const isFile = typeof File !== "undefined" && item instanceof File;
  const file = isFile ? item : item?.file;
  if (!file) {
    return json("/api/assistant/memory", { method: "POST",
      body: JSON.stringify({ title: item?.title || "", text: item?.text || "", agent }) });
  }
  /* Файл уходит как байты без типа, а настоящий тип — в X-Memory-Type:
     сервер разбирает JSON-тела для всех маршрутов разом, и .json-файл,
     посланный как application/json, доезжал до памяти не файлом, а
     разобранной записью — с полями из содержимого или «text or file is
     required», если полей там не было. */
  const r = await fetch("/api/assistant/memory", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Memory-Name": b64(file.name),
      "X-Memory-Type": file.type || "application/octet-stream",
      "X-Memory-Agent": agent,
      ...(item?.title && !isFile ? { "X-Memory-Title": b64(item.title) } : {}),
      "X-Telegram-Init-Data": getInitData(),
    },
    body: file,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Сервер ответил ${r.status}`);
  return r.json();
}
