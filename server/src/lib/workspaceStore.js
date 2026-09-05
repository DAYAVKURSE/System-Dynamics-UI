import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ОБЩАЯ МОДЕЛЬ

   Модель одна на всех, и принадлежит она владельцу. Остальные приходят в
   неё за своей работой, поэтому фильтровать надо на сервере, а не в
   интерфейсе: спрятать чужие задачи кнопкой значит не спрятать их вовсе —
   ответ приходит целиком, и его видно в любом отладчике.

   Что видит не-владелец:
   · задачи, где он исполнитель;
   · задачи, где он проверяющий;
   · и только те ресурсы, активы и движения, на которые эти задачи
     ссылаются, — чтобы подписи читались. Остальная структура системы его
     не касается.

   Что не-владелец может изменить: свою сдачу (исполнитель) и приём
   отчёта (проверяющий). Больше ничего — запись модели целиком закрыта.
   ════════════════════════════════════════════════════════════════ */

/* Модель — это активы (со своими воркерами), их ресурсы, их функции и
   задачи-выполнения, цели, факторы и отчёты (карта проектов). Прежние части — `edges` (стрелки «актив → ресурс»),
   `okrs`, `hypos` и `flows` — принадлежали расчёту, которого больше нет;
   они остаются в списке только для чтения уже сохранённых моделей, чтобы
   клиент мог перенести из них числа. Записывать их он перестал. */
const PARTS = ["entities", "traits", "kinds", "tasks", "funcs", "goals", "factors",
  "reports",
  "edges", "okrs", "hypos", "flows"];
const EMPTY = Object.fromEntries(PARTS.map((k) => [k, []]));

function baseDir() {
  return process.env.WORKSPACE_DIR
    ? path.resolve(process.env.WORKSPACE_DIR)
    : path.resolve(process.cwd(), "data", "workspace");
}
const file = () => path.join(baseDir(), "model.json");

export async function readModel() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    const out = { ...EMPTY };
    PARTS.forEach((k) => { if (Array.isArray(parsed[k])) out[k] = parsed[k]; });
    out.savedAt = parsed.savedAt || null;
    return out;
  } catch {
    return { ...EMPTY, savedAt: null };
  }
}

export async function writeModel(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new Error("model is required");
  }
  const out = { ...EMPTY };
  PARTS.forEach((k) => { if (Array.isArray(model[k])) out[k] = model[k]; });
  out.savedAt = new Date().toISOString();
  await fs.mkdir(baseDir(), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(out), "utf8");
  return out;
}

/** Задачи, до которых человеку есть дело. Владелец здесь не проходит. */
export const tasksFor = (model, userId) => {
  const id = String(userId);
  // Три роли, и все три дают право видеть задачу: постановщик написал, что
  // сделать, исполнитель это делает, проверяющий принимает. Спрятать задачу
  // от того, кто её поставил, значило бы отобрать у него собственную работу.
  return (model.tasks || []).filter((t) => String(t.setter || "") === id
    || String(t.assignee || "") === id || String(t.reviewer || "") === id);
};

/**
 * Срез модели под одного человека: его задачи и ровно то, на что они
 * ссылаются. Владельцу возвращается модель целиком.
 */
export function viewFor(model, { id, isOwner }) {
  if (isOwner) return { ...model, mine: model.tasks || [] };

  const tasks = tasksFor(model, id);
  // Задача — это выполнение функции, поэтому видно ему ровно её: саму
  // функцию, её актив и те ресурсы, которые она берёт и выдаёт. Без них
  // сдача превратилась бы в набор безымянных полей.
  const funcIds = new Set(tasks.map((t) => t.funcId).filter(Boolean));
  const funcs = (model.funcs || []).filter((f) => funcIds.has(f.id));

  const traitIds = new Set();
  funcs.forEach((f) => {
    (f.takes || []).forEach((p) => { if (p.trait) traitIds.add(p.trait); });
    (f.gives || []).forEach((p) => { if (p.trait) traitIds.add(p.trait); });
  });
  const traits = (model.traits || []).filter((t) => traitIds.has(t.id));

  const entIds = new Set(traits.map((t) => t.e));
  funcs.forEach((f) => {
    if (f.e) entIds.add(f.e);
    (f.gives || []).forEach((p) => { if (p.to) entIds.add(p.to); });
  });

  return {
    entities: (model.entities || []).filter((e) => entIds.has(e.id)),
    traits,
    funcs,
    kinds: model.kinds || [],          // значки и цвета — не тайна
    tasks,
    savedAt: model.savedAt || null,
    mine: tasks,
  };
}

/**
 * Берёт задачу в работу — только исполнитель и только свою.
 *
 * Отдельная операция, а не запись модели: модель целиком пишет владелец, а
 * взять работу должен уметь тот, кто её делает. Без этого нажатие «Взять в
 * работу» жило бы только в его окне и пропадало при следующей загрузке —
 * то есть доска показывала бы одно, а сервер помнил другое.
 *
 * Правило то же, что в интерфейсе (`autoStatus` в `TasksBoard.jsx`):
 * просроченная задача остаётся в «Дедлайне» — от того, что за неё взялись,
 * срок назад не отматывается.
 */
export async function takeTask(userId, taskId, { now = Date.now() } = {}) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  // Взять можно то, что лежит и ждёт: сданное и принятое брать не во что.
  if (task.status !== "backlog" && task.status !== "deadline") {
    return { error: "not in backlog" };
  }
  const end = task.end ? new Date(task.end).getTime() : null;
  const late = end != null && !Number.isNaN(end) && end < now;
  task.taken = true;
  task.status = late ? "deadline" : "progress";
  await writeModel(model);
  return { task };
}

/** Записывает сдачу — только исполнитель своей задачи. */
export async function submitTask(userId, taskId, submission) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  // Сдача — это фактическое выполнение функции: сколько часов ушло и
  // сколько каждого ресурса взяли и выдали. Из принятых сдач считается
  // среднее арифметическое, которое уточняет прогноз.
  const qty = (v) => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {})
    .map(([k, n]) => [String(k), Number(n) || 0]));
  /* КАКИЕ единицы взяли — карта «ресурс → номера единиц». Количества
     говорят, что израсходована одна заявка, и молчат о том, чья; а
     спрашивают потом именно об этом. Задним числом такую связь не
     восстановить, поэтому её надо не потерять здесь. */
  const took = Object.fromEntries(
    Object.entries(submission?.took && typeof submission.took === "object"
      ? submission.took : {})
      .map(([k, v]) => [String(k),
        [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))]])
      .filter(([, v]) => v.length));
  task.submissions = [...(task.submissions || []), {
    id: "sb" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    hours: Number(submission?.hours) || 0,
    takes: qty(submission?.takes),
    gives: qty(submission?.gives),
    took,
    text: String(submission?.text || ""),
    file: submission?.file || null,
  }];
  /* Сдал — не значит принято: задача уходит на проверку, как и в интерфейсе.

     Кроме случая, когда исполнитель и проверяющий — один человек: принимать
     не у кого, и задача уходит в готовые сразу. Правило то же, что в
     интерфейсе (`selfReview` в `TasksBoard.jsx`): разойдись они — доска и
     бот показывали бы разное про одну и ту же задачу. */
  const selfReview = task.reviewer != null
    && String(task.reviewer) === String(task.assignee);
  task.status = selfReview ? "done" : "review";
  await writeModel(model);
  return { task };
}

/** Приём или возврат отчёта — только назначенный проверяющий. */
export async function reviewTask(userId, taskId, { accept, comment, mark }) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.reviewer || "") !== String(userId)) return { error: "not yours" };
  // Возврат — в бэклог, а не «в работу»: задачу надо переставить заново,
  // прочитав, что именно доработать. Текст доработки — обязателен.
  if (!String(comment || "").trim()) return { error: "comment required" };
  // Принять молча нельзя: оценка и слова — часть истории исполнителя, из
  // которой потом растёт его рейтинг. Оценка вне шкалы — не оценка.
  const value = Number(mark);
  if (accept && !(value >= 1 && value <= 5)) return { error: "mark required" };
  task.status = accept ? "done" : "backlog";
  // Возвращённая задача снова лежит и ждёт: её берут в работу заново, как
  // и в интерфейсе, — иначе она вернулась бы уже взятой.
  if (!accept) task.taken = false;
  task.reviews = [...(task.reviews || []), {
    id: "rv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    by: String(userId),
    accept: !!accept,
    mark: Number.isFinite(value) ? value : null,
    comment: String(comment || ""),
  }];
  if (comment) {
    task.comments = [...(task.comments || []), {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: String(comment), at: new Date().toISOString(), by: String(userId),
    }];
  }
  await writeModel(model);
  return { task };
}
