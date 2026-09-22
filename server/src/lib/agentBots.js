import { botKey, isBanned, readDialog, recordDialog, historyText } from "./dialogStore.js";
import { isDialogsAction, onDialogsButton, openDialogs } from "./dialogsUi.js";
import { takeReply } from "./peopleWait.js";
import {
  AI_OK, AI_NO, AI_UNDO, APPLIED_LEAD, CLOCKS, CONFIRM_LEAD, REFUSED_LEAD, THINKING, UNDONE_LEAD,
  confirmKeyboard, isAssistantAction, undoKeyboard,
} from "./botAssistant.js";
import { applyPending, cancelPending, pendingById, undoApplied } from "./assistantActions.js";
import { undoById } from "./undoStore.js";
import { identify } from "./orgStore.js";

/* ════════════════════════════════════════════════════════════════
   БОТЫ АГЕНТОВ (владелец, 2026-09-22)

   У агента может быть свой токен (Инструменты → Агенты). Тогда сервер
   опрашивает и его бота: люди пишут агенту, агент отвечает — своей
   моделью, со своим скиллом, помня переписку с этим человеком. Диалог
   ассистента остаётся в основном боте.

   Права агента в модели — как у участника-агента `ag_<id>` (владелец
   его завёл); настройки (модели, ключи) — владельца.

   «/dialogs» и кнопки под ним — только владельцу сценария (id владельца
   = тот, чьи это настройки); остальным — ничего.

   ПОДТВЕРЖДЕНИЕ И ПЛАН (владелец, 2026-09-23: «агенты должны общаться так
   же, как и ассистент, с созданием плана»). У ассистента изменение,
   требующее подтверждения, спрашивается отдельным сообщением с кнопками
   («Подтвердить»/«Отменить»), и план продолжается после кнопки — у бота
   агента этого не было вовсе: `onConfirm` никуда не передавался, и любое
   такое действие само отвечало «подтвердить не вышло», не спросив
   человека ни разу. Здесь та же механика: `confirmOf` помнит, какому
   разговору принадлежит отложенное изменение, `runState` — чем
   продолжить этот разговор после кнопки (тот же вопрос, с места
   остановки, без нового планирования — см. lib/planRunner.js).
   ════════════════════════════════════════════════════════════════ */

export const DONE_TEXT = "Готово";
export const FAILED_TEXT = "Не вышло";
const MAX_QUESTION = 4000;

const isPrivate = (chat) => !chat || chat.type === "private" || chat.type == null;
const nameOf = (from) => [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();

/* pending-действия → разговор, который их ждёт; разговор — по ключу
   бота и чату (один активный вопрос на чат, как у ассистента). */
const confirmOf = new Map();   // id отложенного действия → ключ разговора
const runState = new Map();    // ключ разговора → { question, notes, from, resume }
const stateKeyOf = (key, chatId) => `${key}:${chatId}`;
/* Отложенные действия истекают сами (PENDING_TTL_MS в assistantActions.js);
   забытая кнопка не должна оставлять запись здесь навсегда. */
const sweepConfirm = () => { for (const pid of confirmOf.keys()) if (!pendingById(pid)) confirmOf.delete(pid); };

/**
 * Задать боту агента вопрос и ответить в чат: статус «🕐 Думаю…» с планом
 * под ним, как у ассистента; подтверждение — отдельным сообщением с
 * кнопками; где план остановился — запоминается в `runState`, чтобы
 * кнопка могла его продолжить (см. `onConfirmButton`).
 */
async function runAndReply(bot, key, deps, { chatId, from, question, notes, resume = null }) {
  const log = deps.log || (() => {});
  const stateKey = stateKeyOf(key, chatId);
  runState.set(stateKey, { question, notes, from, resume: null });

  let tick = 0;
  let status = null;
  try { status = await deps.status?.({ chatId, first: `${CLOCKS[0]} ${THINKING}` }); } catch (e) { log(`статус: ${e.message}`); }
  let plan = "";
  const render = () => `${CLOCKS[tick % CLOCKS.length]} ${THINKING}${plan ? `\n\n${plan}` : ""}`;
  const timer = status ? setInterval(() => { tick += 1; status.update(render()); }, 1000) : null;
  timer?.unref?.();

  /* Изменение, требующее подтверждения, — отдельным сообщением с кнопками
     (владелец, 2026-09-23), тем же путём, что и у ассистента: приложение
     спрашивает кнопками, а не словами модели. */
  const onConfirm = async ({ id, words }) => {
    try {
      await deps.send(chatId, `${CONFIRM_LEAD}\n${words}`, confirmKeyboard(id));
      confirmOf.set(String(id), stateKey);
      return true;
    } catch (e) { log(`подтверждение не отправлено: ${e.message}`); return false; }
  };
  const onStopped = (state) => { const st = runState.get(stateKey); if (st) st.resume = state; };

  try {
    const answer = await deps.run({
      question, notes, chatId, from, onConfirm, onStopped, resume,
      onPlan: (t) => { plan = t; if (status) status.update(render()); },
    });
    /* Планировщик отдаёт не строку, а `{answer, plan, …}` (владелец,
       2026-09-22: в чат уходило «[object Object]»). Слова — в `answer`. */
    const words = answer && typeof answer === "object" ? answer.answer : answer;
    const out = String(words || "").trim() || "Ответ пуст.";
    await deps.send(chatId, out);
    await recordDialog(key, chatId, { from: "bot", text: out });
    if (timer) clearInterval(timer);
    if (status) await status.finish(`${DONE_TEXT}${plan ? `\n\n${plan}` : ""}`);
    return { answered: true };
  } catch (e) {
    if (timer) clearInterval(timer);
    log(`агент «${bot.name}» не ответил: ${e.message}`);
    try { await deps.send(chatId, e.message || "Не вышло."); } catch { /* тишина */ }
    if (status) await status.finish(`${FAILED_TEXT}${plan ? `\n\n${plan}` : ""}`);
    return { error: e.message };
  }
}

/**
 * Кнопки под подтверждением бота агента: «Подтвердить»/«Отменить»,
 * «Отменить изменения» — та же механика, что у ассистента
 * (lib/botAssistant.js, `onAssistantButton`), но продолжение плана идёт
 * через `deps.run`/`runState`, а не через очередь.
 */
async function onConfirmButton(bot, key, deps, cb) {
  sweepConfirm();
  const data = String(cb?.data || "");
  const chatId = cb?.message?.chat?.id;
  const mid = cb?.message?.message_id;
  const from = cb?.from;
  const userId = String(from?.id ?? "");
  const log = deps.log || (() => {});
  const answer = deps.answer || (async () => {});
  const restyle = async (text, keyboard) => {
    if (!deps.edit || mid == null) return;
    try { await deps.edit(chatId, mid, text, keyboard); } catch { /* не поправилось */ }
  };
  /* Тот же вопрос — заново, с места остановки: сделанные шаги остаются
     сделанными, нового планирования нет (владелец, 2026-09-22, lib/planRunner.js). */
  const goOn = async (outcome, stateKey) => {
    const st = runState.get(stateKey);
    if (!st?.resume) return null;
    const resume = { ...st.resume, outcome };
    st.resume = null;
    return runAndReply(bot, key, deps, {
      chatId, from: st.from || from, question: st.question, notes: st.notes, resume });
  };

  if (data.startsWith(AI_OK) || data.startsWith(AI_NO)) {
    const yes = data.startsWith(AI_OK);
    const pid = data.slice((yes ? AI_OK : AI_NO).length);
    const p = pendingById(pid);
    if (!p || p.userId !== userId) {
      await answer(cb.id, p ? "Это не ваше изменение" : "Это подтверждение уже не действует");
      return { stale: true };
    }
    const stateKey = confirmOf.get(String(pid));
    confirmOf.delete(String(pid));
    if (!yes) {
      cancelPending(pid);
      await answer(cb.id, "Отменено");
      await restyle(`${REFUSED_LEAD}\n${p.words}`, null);
      const next = stateKey ? await goOn("refused", stateKey) : null;
      return { cancelled: pid, ...(next ? { resumed: true } : {}) };
    }
    let who = { isOwner: false };
    try { who = await identify(userId, {}, { claim: false }) || who; } catch { /* гость: права решит хранилище */ }
    const r = await applyPending(pid, { isOwner: !!who.isOwner });
    await answer(cb.id, r?.ok ? "Готово" : "Не вышло");
    if (r?.ok && r.undoId) await restyle(`${APPLIED_LEAD}\n${p.words}`, undoKeyboard(r.undoId));
    else await restyle(`${p.words}`, null);
    await deps.send(chatId, r?.text || "Изменение уже не действует.");
    const next = r?.ok && stateKey ? await goOn("applied", stateKey) : null;
    return { applied: pid, ok: !!r?.ok, ...(next ? { resumed: true } : {}) };
  }

  if (data.startsWith(AI_UNDO)) {
    const uid = data.slice(AI_UNDO.length);
    const r = await undoApplied(uid, { userId });
    if (!r) {
      await answer(cb.id, "Откатывать уже нечего");
      await restyle(`${APPLIED_LEAD}\n${(await undoById(uid))?.words || ""}`.trim(), null);
      return { stale: true };
    }
    if (r.foreign) { await answer(cb.id, "Это не ваше изменение"); return { stale: true }; }
    await answer(cb.id, "Откатил");
    await restyle(`${UNDONE_LEAD}\n${r.words}`, null);
    await deps.send(chatId, r.text);
    return { undone: uid };
  }

  log(`бот агента «${bot.name}»: неизвестная кнопка «${data}»`);
  await answer(cb.id, "");
  return { ignored: "unknown callback" };
}

/**
 * Одно обновление бота агента.
 * bot: { userId (владелец), agentId, name, token, username }
 * deps: { send(chatId, text, keyboard), edit, answer, run({question, notes, onPlan, onConfirm, onStopped,
 *         resume, from, chatId}) → text, status({chatId, first}), log }
 */
export async function handleAgentUpdate(bot, update, deps) {
  const key = botKey(bot.userId, bot.agentId);
  const msg = update?.message;
  const cb = update?.callback_query;
  const from = msg?.from || cb?.from;
  if (!from) return { ignored: "no sender" };
  const isOwner = String(from.id) === String(bot.userId);

  if (cb) {
    if (isDialogsAction(cb.data)) {
      if (!isOwner) return { ignored: "not owner" };
      return onDialogsButton(cb, { key, edit: deps.edit, answer: deps.answer, botName: bot.name });
    }
    if (isAssistantAction(cb.data)) return onConfirmButton(bot, key, deps, cb);
    if (deps.answer) await deps.answer(cb.id, "");
    return { ignored: "unknown callback" };
  }
  if (!msg || !isPrivate(msg.chat)) return { ignored: "not private" };
  const chatId = msg.chat?.id ?? from.id;
  const text = String(msg.text || msg.caption || "").trim();
  if (!text) return { ignored: "no text" };

  if (/^\/dialogs(?:@\w+)?\s*$/.test(text)) {
    if (!isOwner) return { ignored: "not owner" };
    await openDialogs({ key, chatId, send: deps.send });
    return { dialogs: true };
  }
  if (/^\/start(?:@\w+)?(\s|$)/.test(text)) {
    await deps.send(chatId, `Здравствуйте! Я — ${bot.name}. Напишите мне, что нужно.`);
    return { welcomed: true };
  }
  if (/^\//.test(text)) return { ignored: "command" };
  if (await isBanned(key, chatId)) return { ignored: "banned" };

  await recordDialog(key, chatId, { from: "user", name: nameOf(from), username: from.username || "", text });
  /* Ждали ответ от этого человека (ask_person) — это он: агенту в работу,
     а не новый разговор. */
  if (takeReply(key, chatId, text)) return { replied: true };

  const dialog = await readDialog(key, chatId);
  const history = historyText((dialog?.messages || []).slice(0, -1), { botName: bot.name });
  const notes = [
    `# С кем говоришь\n${nameOf(from) || "человек"}${from.username ? ` (@${from.username})` : ""}, id ${chatId}. Ты — агент «${bot.name}», отвечаешь ему от своего имени.`,
    history ? `# Переписка с ним до этого\n${history}` : "",
  ].filter(Boolean);

  return runAndReply(bot, key, deps, { chatId, from, question: text.slice(0, MAX_QUESTION), notes });
}

/**
 * Опрос ботов агентов: по опросчику на токен; `refresh()` сверяет список с
 * настройками и заводит/останавливает опросчики.
 */
export function createAgentBots({ list, getUpdates, handle, log = () => {}, pauseMs = 5000 }) {
  const running = new Map();   // token → { bot, stop }
  const startOne = (bot) => {
    const st = { bot, stopped: false, offset: 0 };
    (async () => {
      while (!st.stopped) {
        try {
          const updates = await getUpdates(st.offset, 25, bot.token);
          for (const u of updates) {
            st.offset = u.update_id + 1;
            if (st.stopped) break;
            try { await handle(st.bot, u); }
            catch (e) { log(`бот агента «${bot.name}»: обновление не обработано: ${e.message}`); }
          }
        } catch (e) {
          log(`бот агента «${bot.name}»: опрос не удался: ${e.message}`);
          await new Promise((r) => setTimeout(r, pauseMs));
        }
      }
    })();
    running.set(bot.token, st);
  };
  const refresh = () => {
    let bots = [];
    try { bots = list(); } catch (e) { log(`список ботов агентов не прочитался: ${e.message}`); return; }
    const want = new Map(bots.map((b) => [b.token, b]));
    for (const [token, st] of running) {
      if (!want.has(token)) { st.stopped = true; running.delete(token); log(`бот агента «${st.bot.name}» остановлен`); }
      else st.bot = want.get(token);
    }
    for (const [token, b] of want) {
      if (!running.has(token)) { startOne(b); log(`бот агента «${b.name}» (@${b.username || "?"}) запущен`); }
    }
  };
  const stop = () => { for (const st of running.values()) st.stopped = true; running.clear(); };
  return { refresh, stop, size: () => running.size, bots: () => [...running.values()].map((s) => s.bot) };
}
