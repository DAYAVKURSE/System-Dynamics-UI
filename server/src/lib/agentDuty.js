import { dueNotifications } from "./scheduler.js";

/* ════════════════════════════════════════════════════════════════
   АГЕНТЫ ПО РАСПИСАНИЮ (владелец, 2026-09-22)

   «Агенты должны получать напоминания и начинать задачи в назначенное
   время». Напоминание агенту — не сообщение, а запуск: в час начала
   задачи, поставленной участнику-агенту, он берётся за неё сам (план в
   чате владельца). Расписание агента считается так же, как у человека
   (`tasksFor`), отметка «уже было» лежит в его файле расписания —
   поэтому одна задача запускается один раз.

   Предупреждения «через N минут» и постановки агенту не нужны:
   отмечаются как отправленные и молчат.
   ════════════════════════════════════════════════════════════════ */

export async function runAgentDuty({ agents, store, tasksFor, start, now = Date.now(), log = () => {} }) {
  let started = 0;
  for (const a of agents) {
    const userId = String(a.id);
    let schedule;
    try {
      const saved = (await store.read(userId)) || null;
      schedule = await tasksFor(userId, saved);
    } catch (e) { log(`расписание агента ${userId} не собралось: ${e.message}`); continue; }
    const due = dueNotifications(schedule, now, schedule.sent || {});
    for (const n of due) {
      try { await store.markSent(userId, n.key, now); }
      catch (e) { log(`отметка агента ${userId} не записалась: ${e.message}`); continue; }
      if (n.kind !== "start") continue;
      started += 1;
      // Срок — из самой задачи: уведомление о начале его не несёт.
      const src = (schedule.tasks || []).find((t) => String(t.id) === String(n.taskId)) || {};
      const task = { ...n, end: n.end || src.end || "" };
      // Не ждём: задача агента может идти долго, а тик — раз в минуту.
      Promise.resolve(start({ agentUserId: userId, agentId: a.agentId, name: a.name, task }))
        .catch((e) => log(`агент ${userId} не начал задачу «${n.title}»: ${e.message}`));
    }
  }
  return started;
}

/** Текст задачи агенту — что делать и к какому сроку. */
export function taskQuestion(n) {
  const lines = [`Начни задачу «${n.title || "Задача"}» и доведи её до результата.`];
  if (n.body) lines.push(`Описание: ${n.body}`);
  if (n.end) lines.push(`Срок: ${n.end}`);
  lines.push("Сначала возьми её в работу (task_take), по завершении сдай (task_submit).");
  return lines.join("\n");
}
