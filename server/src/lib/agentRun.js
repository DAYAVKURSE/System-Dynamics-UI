import * as oauth from "./mcpOauth.js";
import * as settings from "./assistantSettings.js";
import { ASKED_TEXT, actionsNote, mcpNote, modelsNote, runAgent, skillNote } from "./assistantAgent.js";
import { contextFor as contextForDefault } from "./assistantContext.js";
import { complete as completeDefault } from "./aiProviders.js";
import { identify } from "./orgStore.js";
import { PLAN_NOTE, runPlanned } from "./planRunner.js";

/* ════════════════════════════════════════════════════════════════
   ОДИН РАЗГОВОР АГЕНТА — С ПЛАНОМ (владелец, 2026-09-22)

   Общее для трёх дверей: вопрос ассистенту в основном боте (очередь),
   сообщение человека боту агента, задача агента по расписанию. Здесь
   собирается подсказка (правила, модели, действия, MCP, скилл, план,
   данные) и вопрос прогоняется через планировщик (lib/planRunner.js).
   ════════════════════════════════════════════════════════════════ */

export const SYSTEM_PROMPT = [
  "Ты — помощник в приложении, где ведётся модель живого дела: активы, их функции,",
  "ресурсы, цели, задачи и отчёты. Отвечай по-русски, коротко и по делу.",
  "Отвечай ТОЛЬКО по данным ниже. Чего в данных нет — так и говори: «в данных этого нет».",
  "Не придумывай числа, имена, сроки и содержание файлов. Не пересчитывай прогноз:",
  "если вопрос требует расчёта, которого в данных нет, скажи, что расчёт делает приложение.",
  "Слова «план», «вилка» и «факт» различай: план — то, что записано в модели, факт — сдачи.",
].join(" ");

/**
 * MCP-серверы агента — с урезанным списком инструментов и входом.
 * Берём ПОЛНУЮ запись (`mcpFor`): в ней вход на сервер. Токен OAuth,
 * если истёк, обновляется по refresh-токену.
 */
export async function mcpServersFor(userId, agent) {
  const picked = agent?.mcp && typeof agent.mcp === "object" && !Array.isArray(agent.mcp) ? agent.mcp : {};
  const servers = [];
  for (const [id, tools] of Object.entries(picked)) {
    const m = settings.mcpFor(userId, id);
    if (!m || !tools.length) continue;
    let auth = m.auth || null;
    if (oauth.stale(auth)) {
      try { const next = await oauth.refresh(auth); if (next) { settings.setMcpAuth(userId, m.id, next); auth = next; } }
      catch { /* сервер скажет 401 — и человека позовут войти */ }
    }
    servers.push({ ...m, auth, tools: [...tools] });
  }
  return servers;
}

/** Подсказка агента целиком. `notes` — что добавить перед данными (переписка, задача). */
export function systemFor({ agent, providers = [], servers = [], context = "", notes = [], plan = true, actions = true }) {
  return [
    SYSTEM_PROMPT,
    modelsNote(agent, providers),
    actions ? actionsNote(agent.ask !== false) : "",
    mcpNote(servers),
    skillNote(agent.skill),
    plan ? PLAN_NOTE : "",
    ...notes,
    `# Данные\n${context}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * Разговор своего агента (не ассистента) — с планом.
 * `ownerId` — чьи настройки (модели, ключи, скилл); `asUserId` — от чьего
 * имени действовать: участник-агент `ag_<id>` у владельца, иначе сам
 * владелец. Ответ — текст; план по ходу — `onPlan`.
 */
export const STRANGER_CONTEXT = "Этот человек — не участник модели. Данных о модели, задачах и людях у тебя НЕТ,"
  + " и говорить о них нечего: отвечай только по переписке с ним и его словам.";

/**
 * `asUserId` — чьими данными и правами живёт разговор: участник, который
 * пишет агенту (его задачи, его права — как у ассистента), или сам
 * участник-агент `ag_<id>` для задачи по расписанию. `null` — посторонний
 * (владелец, 2026-09-22: «агент не должен знать никакой информации,
 * которая не относится к пользователю, который к нему обращается»): без
 * данных модели и без её инструментов, только переписка и скилл.
 */
export async function runAgentPlanned({
  ownerId, agentId, asUserId = null, question, notes = [], onPlan = null, signal = null,
  extra = [], onConfirm = null, onAuthNeeded = null, title = "", stranger = false, resume = null,
  complete = completeDefault, contextFor = contextForDefault, modelFor = settings.modelForAgent,
}) {
  const agent = settings.agentFor(ownerId, agentId);
  if (!agent) throw new Error("Агент не найден");
  const model = await modelFor(ownerId, agentId);
  if (!model) throw new Error(`У агента «${agent.name}» не выбрана модель — назначьте её в Инструментах → Агенты`);
  const who = String(asUserId || ownerId);
  let context = "";
  let isOwner = false;
  if (stranger) context = STRANGER_CONTEXT;
  else {
    try { context = await contextFor(who); } catch (e) { context = `(данные не собрались: ${e.message})`; }
    try { isOwner = Boolean((await identify(who, {}, { claim: false })).isOwner); } catch { isOwner = false; }
  }
  const servers = await mcpServersFor(ownerId, agent);
  const providers = settings.settingsView(ownerId).providers || [];
  const system = systemFor({ agent, providers, servers, context, notes, actions: !stranger });
  const run = (q) => runAgent({
    userId: who, agentId, question: q, system, model, complete,
    isOwner, ask: agent.ask !== false, servers, signal, onConfirm, onAuthNeeded,
    extra: stranger ? [] : extra, ownTools: !stranger,
  });
  return runPlanned({ question, run, onPlan, signal, title, resume, stopWhen: (t) => t.startsWith(ASKED_TEXT) });
}

/* ─────── сообщение-статус с планом ───────
   Одно сообщение в чате, которое правится по ходу: «🕐 Думаю…» и под ним
   план. Правки — цепочкой и не чаще раза в секунду: Telegram столько
   держит для одного чата. */
export const STATUS_GAP_MS = 1000;
export async function statusMessage({ send, edit, chatId, first, log = () => {} }) {
  let messageId = null;
  let shown = "";
  let chain = Promise.resolve();
  let last = 0;
  try {
    const m = await send(chatId, first);
    messageId = m?.message_id ?? null;
    shown = first;
  } catch (e) { log(`статус не отправлен: ${e.message}`); }
  const put = (text, keyboard = null) => {
    chain = chain.then(async () => {
      if (messageId == null || text === shown) return;
      const wait = STATUS_GAP_MS - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      shown = text;
      last = Date.now();
      try { await edit(chatId, messageId, text, keyboard); } catch { /* не поправилось */ }
    });
    return chain;
  };
  return { messageId, update: put, finish: (text) => put(text, null), get shown() { return shown; } };
}
