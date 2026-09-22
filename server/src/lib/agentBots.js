import { botKey, isBanned, readDialog, recordDialog, historyText } from "./dialogStore.js";
import { isDialogsAction, onDialogsButton, openDialogs } from "./dialogsUi.js";
import { takeReply } from "./peopleWait.js";
import { CLOCKS, THINKING } from "./botAssistant.js";

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
   ════════════════════════════════════════════════════════════════ */

export const DONE_TEXT = "Готово";
export const FAILED_TEXT = "Не вышло";
const MAX_QUESTION = 4000;

const isPrivate = (chat) => !chat || chat.type === "private" || chat.type == null;
const nameOf = (from) => [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();

/**
 * Одно обновление бота агента.
 * bot: { userId (владелец), agentId, name, token, username }
 * deps: { send(chatId, text, keyboard), edit, answer, run({question, notes, onPlan, chatId}) → text, log }
 */
export async function handleAgentUpdate(bot, update, deps) {
  const key = botKey(bot.userId, bot.agentId);
  const msg = update?.message;
  const cb = update?.callback_query;
  const from = msg?.from || cb?.from;
  if (!from) return { ignored: "no sender" };
  const isOwner = String(from.id) === String(bot.userId);
  const log = deps.log || (() => {});

  if (cb) {
    if (isDialogsAction(cb.data)) {
      if (!isOwner) return { ignored: "not owner" };
      return onDialogsButton(cb, { key, edit: deps.edit, answer: deps.answer, botName: bot.name });
    }
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

  /* Статус «🕐 Думаю…» с планом под ним — как у ассистента. */
  let tick = 0;
  let status = null;
  try { status = await deps.status?.({ chatId, first: `${CLOCKS[0]} ${THINKING}` }); } catch (e) { log(`статус: ${e.message}`); }
  let plan = "";
  const render = () => `${CLOCKS[tick % CLOCKS.length]} ${THINKING}${plan ? `\n\n${plan}` : ""}`;
  const timer = status ? setInterval(() => { tick += 1; status.update(render()); }, 1000) : null;
  timer?.unref?.();
  try {
    const answer = await deps.run({
      question: text.slice(0, MAX_QUESTION), notes, chatId,
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
