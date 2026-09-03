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

const PARTS = ["entities", "traits", "edges", "kinds", "okrs", "tasks", "hypos", "funcs"];
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
  return (model.tasks || []).filter((t) =>
    String(t.assignee || "") === id || String(t.reviewer || "") === id);
};

/**
 * Срез модели под одного человека: его задачи и ровно то, на что они
 * ссылаются. Владельцу возвращается модель целиком.
 */
export function viewFor(model, { id, isOwner }) {
  if (isOwner) return { ...model, mine: model.tasks || [] };

  const tasks = tasksFor(model, id);
  const edgeIds = new Set(tasks.map((t) => t.edgeId).filter(Boolean));
  const goalIds = new Set(tasks.map((t) => t.goalId).filter(Boolean));
  const edges = (model.edges || []).filter((e) => edgeIds.has(e.id));

  // Ресурсы: цели задач, концы их движений и источники этих движений —
  // без них подпись «Я → заявки» превратилась бы в «? → ?».
  const traitIds = new Set([...goalIds]);
  edges.forEach((e) => {
    if (e.to) traitIds.add(e.to);
    if (e.fromTrait) traitIds.add(e.fromTrait);
  });
  const traits = (model.traits || []).filter((t) => traitIds.has(t.id));

  const entIds = new Set(traits.map((t) => t.e));
  edges.forEach((e) => { if (e.from) entIds.add(e.from); });

  return {
    entities: (model.entities || []).filter((e) => entIds.has(e.id)),
    traits,
    edges,
    kinds: model.kinds || [],          // значки и цвета — не тайна
    okrs: (model.okrs || []).filter((o) => goalIds.has(o.goalId)),
    tasks,
    hypos: [],                          // черновики гипотез — дело владельца
    savedAt: model.savedAt || null,
    mine: tasks,
  };
}

/** Записывает сдачу — только исполнитель своей задачи. */
export async function submitTask(userId, taskId, submission) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  task.submissions = [...(task.submissions || []), {
    id: "sb" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    amount: Number(submission?.amount) || 0,
    text: String(submission?.text || ""),
    file: submission?.file || null,
  }];
  // Сдал — не значит принято: задача уходит на проверку, как и в интерфейсе.
  task.status = "review";
  await writeModel(model);
  return { task };
}

/** Приём или возврат отчёта — только назначенный проверяющий. */
export async function reviewTask(userId, taskId, { accept, comment }) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.reviewer || "") !== String(userId)) return { error: "not yours" };
  // Возврат — в бэклог, а не «в работу»: задачу надо переставить заново,
  // прочитав, что именно доработать. Текст доработки — обязателен.
  if (!accept && !String(comment || "").trim()) return { error: "comment required" };
  task.status = accept ? "done" : "backlog";
  if (comment) {
    task.comments = [...(task.comments || []), {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: String(comment), at: new Date().toISOString(), by: String(userId),
    }];
  }
  await writeModel(model);
  return { task };
}
