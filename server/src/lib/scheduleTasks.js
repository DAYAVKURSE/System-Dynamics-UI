import { readModel } from "./workspaceStore.js";
import { identify } from "./orgStore.js";

/* ════════════════════════════════════════════════════════════════
   ЧТО НАПОМИНАТЬ ЭТОМУ ЧЕЛОВЕКУ — СЧИТАЕТ СЕРВЕР (владелец, 2026-09-20)

   Прежде список напоминаний строился только по расписанию, которое
   ПРИСЫЛАЛА ДОСКА из браузера. Пока браузер не открыли — сервер про задачи
   не знал, и список был пуст: «взял задачу в работу — ничего не
   появилось», «появилась новая задача в бэклоге — ничего не появилось».
   Напоминание, которое приходит, только если приложение уже открыли,
   бессмысленно: за этим и идут к боту, чтобы не открывать.

   Теперь задачи берутся из САМОЙ МОДЕЛИ, той же, что показывает доска.
   Расписание из браузера остаётся — в нём чат для отправки, часовой пояс
   и отметки об отправленном, — но список задач больше от него не зависит.

   Правила те же, что на доске (`scheduled` в SystemModel.jsx), и это не
   совпадение: если они разойдутся, человек увидит в боте не то, что на
   экране.

   · `task` — ИСПОЛНИТЕЛЮ: всё, что ему поручено и не ждёт постановки;
   · `setup` — ПОСТАНОВЩИКУ: то, что ждёт постановки.

   «За сколько предупреждать» — из анкеты человека: это его настройка, а
   не свойство задачи.
   ════════════════════════════════════════════════════════════════ */

const val = (t, f) => (t?.[f] == null || t[f] === "" ? null : String(t[f]));
/* Постановщик — как на доске: названный, иначе исполнитель (`roleOf`). */
const setterOf = (t) => val(t, "setter") ?? val(t, "assignee");

const slim = (t, kind, warn, dead = 0) => ({
  id: String(t.id),
  title: String(t.title ?? "").slice(0, 200),
  body: String(t.body ?? "").slice(0, 1000),
  status: String(t.status ?? "backlog"),
  canceled: t.canceled === true,
  // Исполнителю напоминают о НАЧАЛЕ, постановщику — сразу, и начало ему
  // ни к чему: задача висит непоставленной уже сейчас.
  start: kind === "setup" ? "" : (t.start ? String(t.start) : ""),
  repeat: "once", days: [], time: "",
  warn,
  /* Доля срока, при которой предупредить о сдаче (владелец, 2026-09-21).
     Срок нужен обоим: постановщику — в тексте, исполнителю — для этого
     самого предупреждения. */
  dead: kind === "setup" ? 0 : dead,
  kind,
  assignee: val(t, "assignee"),
  setter: setterOf(t),
  end: t.end ? String(t.end) : "",
  deferredUntil: t.deferredUntil ? String(t.deferredUntil) : null,
});

/** Задачи человека для напоминаний — из модели, а не из браузера. */
export async function scheduleTasksFor(userId, { model = null, warn = null, dead = null } = {}) {
  const m = model || await readModel();
  const id = String(userId);
  const mine = (v) => v != null && v !== "" && String(v) === id;
  let minutes = warn;
  let pct = dead;
  if (minutes == null || pct == null) {
    let profile = null;
    try { profile = (await identify(id, {}, { claim: false }))?.profile || null; }
    catch { profile = null; }
    if (minutes == null) minutes = Number(profile?.warnMin);
    if (pct == null) pct = Number(profile?.deadlinePct);
  }
  const w = Number.isFinite(Number(minutes)) ? Number(minutes) : 10;
  const d = Number.isFinite(Number(pct)) ? Number(pct) : 0;
  const tasks = Array.isArray(m?.tasks) ? m.tasks : [];
  const work = tasks
    .filter((t) => mine(t.assignee) && t.status !== "wait" && t.canceled !== true)
    .map((t) => slim(t, "task", w, d));
  const setup = tasks
    .filter((t) => mine(setterOf(t)) && t.status === "wait" && t.canceled !== true)
    .map((t) => slim(t, "setup", w));
  return [...work, ...setup];
}

/**
 * Расписание с задачами из модели поверх присланного браузером.
 *
 * Из присланного берётся то, чего в модели нет: чат, часовой пояс,
 * отметки об отправленном и висящие напоминания. Сами задачи — из модели:
 * она новее и есть всегда.
 */
export async function scheduleFor(userId, saved = null) {
  const tasks = await scheduleTasksFor(userId);
  return {
    chatId: saved?.chatId ?? String(userId),
    tzOffset: Number.isFinite(Number(saved?.tzOffset)) ? Number(saved.tzOffset) : 0,
    sent: saved?.sent || {},
    reminders: saved?.reminders || {},
    notes: saved?.notes || {},
    ...(saved || {}),
    tasks,
  };
}
