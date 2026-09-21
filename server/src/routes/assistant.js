import { Router } from "express";
import express from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { discover, refresh as refreshOauth, stale as staleOauth, startLogin } from "../lib/mcpOauth.js";
import { addAgentUser, agentUserId, identify, removeUser, renameAgentUser } from "../lib/orgStore.js";
import {
  TASKS, addAgent, addMcp, addProvider, agentFor, isBadInput, kindsView, mcpFor, providerFor,
  setMcpAuth,
  removeAgent, removeMcp, removeProvider, setTasks, settingsView, updateAgent, updateMcp,
  updateProvider,
} from "../lib/assistantSettings.js";
import { listTools } from "../lib/mcp.js";
import { listRegistry } from "../lib/mcpRegistry.js";
import { listModels } from "../lib/aiProviders.js";
import { ask, askNow, cancel as cancelAsk, find } from "../lib/assistantQueue.js";
import { askFromApp } from "../lib/botAssistant.js";
import * as memory from "../lib/memoryStore.js";
import { editMessage, sendPhoto, sendWithKeyboard } from "../lib/telegram.js";
import { readSchedule } from "../lib/scheduleStore.js";
import {
  DEFAULT_AGENT, MAX_MEMORY_FILE_BYTES, addMemory, listMemory, removeMemory,
} from "../lib/memoryStore.js";
import { retranscribeFor } from "../lib/transcribe.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК · маршруты

   Всё здесь — только позванным и только своё: настройки, вопросы,
   память. Провайдеры и ключи — у каждого свои (v1.2): владелец за других
   ничего не ставит, и чужие настройки нельзя ни прочитать, ни поменять —
   человек выводится из подписи, а не из запроса, как и у файлов отчётов.
   Ключ наружу не уходит ни в одном ответе — только «есть/нет».
   ════════════════════════════════════════════════════════════════ */

const router = Router();
router.use(telegramUser);

/* Кто спрашивает. claim: false — открывший вкладку «Инструменты» не
   должен становиться владельцем модели, если владелец ещё не назначен.

   Вне прода запросы приходят от единого «разработчика» (см.
   middleware/telegramUser.js): различать людей нечем, и запирать
   локальную разработку было бы запиранием самого себя. */
router.use(async (req, res, next) => {
  try {
    if (process.env.NODE_ENV !== "production" && req.telegramUserId === "dev-user") {
      req.me = { id: "dev-user", isOwner: true, known: true, name: "разработчик" };
      return next();
    }
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    if (!me.known) return res.status(403).json({ error: "not invited" });
    req.me = me;
    return next();
  } catch (e) { return next(e); }
});

/* ─────── чем думает помощник ─────── */

/* Ошибки ввода — 400 словами (по-русски, их читает человек на экране);
   всё остальное — общему обработчику. */
const badInput = (e, res, next) => (isBadInput(e) ? res.status(400).json({ error: e.message }) : next(e));

router.get("/settings", (req, res, next) => {
  try {
    res.json({ ...settingsView(req.me.id), kinds: kindsView(), taskList: TASKS });
  } catch (e) { next(e); }
});

router.post("/providers", (req, res, next) => {
  try {
    const { name, kind, baseUrl, key } = req.body || {};
    return res.status(201).json(addProvider(req.me.id, { name, kind, baseUrl, key }));
  } catch (e) { return badInput(e, res, next); }
});

router.put("/providers/:id", (req, res, next) => {
  try {
    // Чужой или несуществующий провайдер — 404, как у удаления: «не найден»
    // здесь правда, а не ошибка ввода.
    if (!providerFor(req.me.id, req.params.id)) return res.status(404).json({ error: "Провайдер не найден" });
    const { name, baseUrl, key, models } = req.body || {};
    return res.json(updateProvider(req.me.id, req.params.id, { name, baseUrl, key, models }));
  } catch (e) { return badInput(e, res, next); }
});

router.delete("/providers/:id", (req, res, next) => {
  try {
    if (!removeProvider(req.me.id, req.params.id)) return res.status(404).json({ error: "Провайдер не найден" });
    return res.status(204).end();
  } catch (e) { return next(e); }
});

/* Список моделей у провайдера — по его ключу, но сам ключ остаётся на
   сервере: клиент просит список по id, а не шлёт ключ туда-обратно. */
router.get("/providers/:id/models", async (req, res, next) => {
  try {
    const p = providerFor(req.me.id, req.params.id);
    if (!p) return res.status(404).json({ error: "Провайдер не найден" });
    return res.json(await listModels(p));
  } catch (e) {
    // Ошибка провайдера — словами и с его статусом наружу не идёт: 502
    // от нас значило бы «сервер сломан», а сломан ключ или адрес.
    if (/ответил|недоступен|не ответил|не задан/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

/* Выбрали модель расшифровки — записи без текста (модели не было, не
   удалось, оборвалось) расшифровываются ей в фоне, ПОСЛЕ ответа: иначе
   выбор модели ничего не менял бы для уже сохранённых записей, и они
   оставались бы без текста навсегда. Итог — в контексте помощника. */
const retranscribeLater = (userId) => {
  retranscribeFor(userId)
    .then((done) => { if (done.length) console.log(`[transcribe] повтор для ${userId}: ${done.map((d) => `${d.fileId} ${d.status}`).join(", ")}`); })
    .catch((e) => console.error(`[transcribe] повтор для ${userId} не удался: ${e.message}`));
};

router.put("/tasks", (req, res, next) => {
  try {
    const body = req.body || {};
    const tasks = setTasks(req.me.id, body);
    res.json(tasks);
    if (body.transcribe != null && tasks.transcribe) retranscribeLater(req.me.id);
  } catch (e) { badInput(e, res, next); }
});

/* ─────── агенты ───────

   Агент — в настройках человека; участником организации (чтобы выбирать
   его в ролях и делать воркером) он становится только у ВЛАДЕЛЬЦА: список
   организации ведёт владелец, и чужой агент в нём был бы чужим решением.
   Участник заводится после записи в настройках: агент без участника
   допустим (не-владелец), участник без агента — нет. */

router.post("/agents", async (req, res, next) => {
  try {
    const agent = addAgent(req.me.id, { name: req.body?.name });
    if (req.me.isOwner) await addAgentUser({ id: agent.id, name: agent.name, addedBy: req.me.id });
    return res.status(201).json(agent);
  } catch (e) { return badInput(e, res, next); }
});

router.put("/agents/:id", async (req, res, next) => {
  try {
    const { name, models, transcribe, uses, mcp, ask: askMode, skill } = req.body || {};
    const agent = updateAgent(req.me.id, req.params.id,
      { name, models, transcribe, uses, mcp, ask: askMode, skill });
    if (!agent) return res.status(404).json({ error: "Агент не найден" });
    if (name !== undefined && req.me.isOwner) await renameAgentUser(agent.id, agent.name);
    res.json(agent);
    // Расшифровку выбрали у ассистента — то же, что строка transcribe в
    // таблице: записи без текста дорасшифровываются ей в фоне, после ответа.
    if (agent.builtin && transcribe != null && agent.transcribe) retranscribeLater(req.me.id);
    return undefined;
  } catch (e) { return badInput(e, res, next); }
});

router.delete("/agents/:id", async (req, res, next) => {
  try {
    if (!removeAgent(req.me.id, req.params.id)) return res.status(404).json({ error: "Агент не найден" });
    // Участника-агента может уже не быть — владелец убрал его из списка сам.
    if (req.me.isOwner) await removeUser(agentUserId(req.params.id));
    return res.status(204).end();
  } catch (e) { return badInput(e, res, next); }
});

/* ─────── MCP-СЕРВЕРЫ (владелец, 2026-09-20) ───────

   Форма под провайдерами: адрес сервера, откуда он взят (репозиторий) и
   список его инструментов. Список спрашивается у самого сервера — так же,
   как список моделей у провайдера: вводить его руками значило бы держать
   копию чужого списка и ошибаться в ней.

   Серверы — у каждого человека свои, как и ключи: адрес может вести в
   его сеть, и чужому там делать нечего. */
router.post("/mcp", (req, res, next) => {
  try {
    return res.status(201).json(addMcp(req.me.id, {
      name: req.body?.name, url: req.body?.url, repo: req.body?.repo }));
  } catch (e) { return badInput(e, res, next); }
});

router.put("/mcp/:id", (req, res, next) => {
  try {
    const m = updateMcp(req.me.id, req.params.id, req.body || {});
    if (!m) return res.status(404).json({ error: "MCP-сервер не найден" });
    return res.json(m);
  } catch (e) { return badInput(e, res, next); }
});

/* Вход на сервер: ключ или логин с паролем. Наружу он не возвращается —
   ответ говорит только, что вход теперь есть. */
router.put("/mcp/:id/auth", (req, res, next) => {
  try {
    const m = setMcpAuth(req.me.id, req.params.id, req.body || {});
    if (!m) return res.status(404).json({ error: "MCP-сервер не найден" });
    return res.json(m);
  } catch (e) { return badInput(e, res, next); }
});

router.delete("/mcp/:id", (req, res, next) => {
  try {
    if (!removeMcp(req.me.id, req.params.id)) {
      return res.status(404).json({ error: "MCP-сервер не найден" });
    }
    return res.status(204).end();
  } catch (e) { return badInput(e, res, next); }
});

/* СПИСОК ДОСТУПНЫХ СЕРВЕРОВ ИЗ РЕЕСТРА (владелец, 2026-09-20): форма
   показывает его и умеет обновить. Реестр общий, поэтому маршрут ничего
   не хранит — он только спрашивает и отдаёт как есть. */
router.get("/mcp/registry", async (req, res, next) => {
  try {
    const r = await listRegistry();
    return res.json(r);
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 300) });
  }
});

/* Спросить у сервера, что он умеет, и запомнить список. */
/* ─── ВХОД ЧЕРЕЗ OAUTH (владелец, 2026-09-21) ───
   «Должна выдаваться страница входа, а не ввод bearer». Ссылку на страницу
   входа даёт сервер авторизации (lib/mcpOauth.js); человек входит там,
   код возвращается на callback (app.js), токен ложится к серверу. */
router.post("/mcp/:id/oauth/start", async (req, res, next) => {
  try {
    const m = mcpFor(req.me.id, req.params.id);
    if (!m) return res.status(404).json({ error: "MCP-сервер не найден" });
    if (!process.env.PUBLIC_URL) return res.status(503).json({ error: "PUBLIC_URL не задан — callback некуда вести" });
    const r = await startLogin({ userId: req.me.id, mcpId: m.id, serverUrl: m.url,
      hint: String(req.body?.hint || ""), client: m.auth?.oauth || null, publicUrl: process.env.PUBLIC_URL });
    return res.json({ url: r.url });
  } catch (e) { return res.status(502).json({ error: String(e?.message || e).slice(0, 300) }); }
});

/* Токен OAuth истёк — обновляем по refresh-токену, тихо. */
async function freshAuth(userId, m) {
  if (!m?.auth || !staleOauth(m.auth)) return m?.auth || null;
  try {
    const next = await refreshOauth(m.auth);
    if (next) { setMcpAuth(userId, m.id, next); return next; }
  } catch { /* не вышло — пойдём со старым, сервер скажет 401 */ }
  return m.auth;
}

router.post("/mcp/:id/tools", async (req, res, next) => {
  try {
    const m = mcpFor(req.me.id, req.params.id);
    if (!m) return res.status(404).json({ error: "MCP-сервер не найден" });
    let tools = [];
    try { tools = await listTools(m.url, { auth: await freshAuth(req.me.id, m) }); }
    catch (e) {
      /* «Нужен вход» — не поломка, а развилка: экран на неё открывает окно
         входа, а не показывает строчку с номером. Отдаём это отдельным
         полем, а не угадыванием по тексту. Есть ли у сервера страница
         входа (OAuth) — выясняем тут же. */
      if (e?.needsAuth) {
        const oauth = process.env.PUBLIC_URL
          ? await discover(m.url, e.hint || "").then(Boolean).catch(() => false) : false;
        return res.status(401).json({ error: "Сервер требует входа", needsAuth: true,
          where: e.where || "", scheme: e.scheme || "", realm: e.realm || "",
          hint: e.hint || "", server: m.name, oauth });
      }
      return res.status(502).json({ error: String(e?.message || e).slice(0, 300) });
    }
    const saved = updateMcp(req.me.id, m.id, { tools: tools.map((t) => t.name) });
    return res.json({ ...saved, offered: tools });
  } catch (e) { return badInput(e, res, next); }
});

/* ─────── вопрос в два шага ─────── */

router.post("/ask", (req, res, next) => {
  try {
    // task («bot» из чата бота) выбирает строку
    // таблицы «задача → модель»; очередь (B) принимает его как есть.
    const { question, context, task } = req.body || {};
    if (!String(question || "").trim()) return res.status(400).json({ error: "question is required" });
    const { id } = ask({ userId: req.me.id, question, context, task });
    return res.status(202).json({ id });
  } catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

/* ─────── ВОПРОС ИЗ ПРИЛОЖЕНИЯ — ОТВЕТ В ЧАТ (владелец, 2026-09-21) ───────

   Волшебная палочка в шапке. Вместе с вопросом приходит то, что человек
   видел: `screen` — экран словами, `log` — последние действия, `shot` —
   снимок экрана (PNG в base64). Экран и действия уходят модели
   подсказкой; снимок — в чат, чтобы было видно, о чём спрашивали. Ответ
   приходит в чат бота, продолжают там же («Уточнить»).

   Данные о модели и коде модели и так доступны: контекст помощника
   собирается на сервере из данных человека, как и на любой вопрос. */
const MAX_SCREEN = 12000;
const MAX_LOG = 3000;
const MAX_SHOT_B64 = 2 * 1024 * 1024;
const APP_DEPS = {
  assistant: { ask: askNow, cancel: cancelAsk, memory },
  send: (chatId, text, keyboard) => sendWithKeyboard(chatId, text, keyboard),
  edit: (chatId, messageId, text, keyboard) => editMessage(chatId, messageId, text, keyboard),
  tg: { sendPhoto },
  log: (m) => console.warn(`[wand] ${m}`),
};
export const appContextOf = ({ screen = "", log = "" } = {}) => {
  const parts = [];
  const sc = String(screen || "").trim().slice(0, MAX_SCREEN);
  const lg = String(log || "").trim().slice(0, MAX_LOG);
  if (sc) parts.push(`## Что человек видел на экране приложения в момент вопроса\n${sc}`);
  if (lg) parts.push(`## Последние действия человека в приложении\n${lg}`);
  return parts.join("\n\n");
};
router.post("/ask-from-app", async (req, res, next) => {
  try {
    const { question, screen, log, shot } = req.body || {};
    if (!String(question || "").trim()) return res.status(400).json({ error: "question is required" });
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: "Бот не подключён — ответу некуда прийти" });
    }
    let bytes = null;
    if (typeof shot === "string" && shot) {
      const b64 = shot.replace(/^data:image\/\w+;base64,/, "");
      if (b64.length > MAX_SHOT_B64) return res.status(413).json({ error: "Снимок экрана слишком большой" });
      try { bytes = Buffer.from(b64, "base64"); } catch { bytes = null; }
    }
    const chatId = (await readSchedule(req.me.id).catch(() => null))?.chatId || req.me.id;
    const r = await askFromApp(APP_DEPS, { userId: req.me.id, chatId, question,
      context: appContextOf({ screen, log }), shot: bytes });
    return res.status(202).json({ id: r?.id || null });
  } catch (e) {
    if (e?.userMessage) return res.status(400).json({ error: e.userMessage });
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

router.get("/ask/:id", (req, res) => {
  const state = find(req.params.id, req.me.id);
  if (!state) {
    return res.status(404).json({
      error: "Ответ не найден или устарел: ответы живут три минуты после вопроса",
    });
  }
  return res.json(state);
});

/* ─────── память ─────── */

/* Память — у агента: без `agent` — ассистента, как было всегда. Агент,
   которого нет в записи, — 400 словами: память «ничьего» агента нельзя
   было бы ни увидеть на экране, ни удалить. */
class BadAgent extends Error {
  constructor(id) { super(`Агент «${id}» не найден`); this.status = 400; }
}
const agentOf = (req, raw) => {
  const id = String(raw || "").trim() || DEFAULT_AGENT;
  if (!agentFor(req.me.id, id)) throw new BadAgent(id);
  return id;
};

router.get("/memory", async (req, res, next) => {
  try {
    res.json(await listMemory(req.me.id, agentOf(req, req.query.agent)));
  } catch (e) {
    if (e instanceof BadAgent) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

/* Имя файла и название едут в заголовках, а заголовки — latin-1: клиент
   шлёт base64 от UTF-8, как и у файлов отчётов. Битый заголовок — не повод
   отказать: имя подставится из файла. */
function headerText(raw) {
  if (!raw) return "";
  try { return Buffer.from(String(raw), "base64").toString("utf8"); } catch { return ""; }
}

/* Файл принимаем сырыми байтами, как файлы отчётов: multipart потребовал
   бы зависимости ради одного поля, а base64 внутри JSON раздул бы файл на
   треть и упёрся бы в предел тела JSON (2 МБ на весь сервер). JSON-тело
   уже разобрано на уровне приложения, поэтому сюда сырым приходит только
   то, что не JSON. */
router.post("/memory",
  express.raw({ type: (req) => !req.is("application/json"), limit: MAX_MEMORY_FILE_BYTES }),
  async (req, res, next) => {
    try {
      const isFile = Buffer.isBuffer(req.body) && req.body.length > 0;
      /* Имя файла есть, а байтов нет — значит файл пришёл как
         application/json и его уже разобрал общий разбор тела: .json-файл
         из старого клиента становился бы записью с полями из содержимого.
         Лучше отказать словами, чем молча положить не то. */
      if (req.header("X-Memory-Name") && !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "send the file as application/octet-stream, not as JSON" });
      }
      // У файла агент едет в заголовке, как и название; у JSON — полем.
      const agent = agentOf(req, isFile ? req.header("X-Memory-Agent") : req.body?.agent);
      const saved = isFile
        ? await addMemory(req.me.id, {
          agent,
          title: headerText(req.header("X-Memory-Title")),
          text: headerText(req.header("X-Memory-Text")),
          file: {
            name: headerText(req.header("X-Memory-Name")),
            type: req.header("X-Memory-Type") || req.header("Content-Type"),
            bytes: req.body,
          },
        })
        : await addMemory(req.me.id, {
          agent, title: req.body?.title, text: req.body?.text,
        });
      res.status(201).json(saved);
    } catch (e) {
      if (e instanceof BadAgent || /required|at most|limit/.test(e.message)) {
        return res.status(400).json({ error: e.message });
      }
      return next(e);
    }
  });

router.delete("/memory/:id", async (req, res, next) => {
  try {
    const ok = await removeMemory(req.me.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    return res.status(204).end();
  } catch (e) { return next(e); }
});

/* Тело больше предела режет сам разбор тела, ДО обработчика: иначе человек
   видел бы «сервер ответил 500» вместо «файл слишком большой». */
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      error: `file must be at most ${Math.round(MAX_MEMORY_FILE_BYTES / 1024 / 1024)} MB`,
    });
  }
  return next(err);
});

export default router;
