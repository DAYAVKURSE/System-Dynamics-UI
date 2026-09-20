import { listOrg } from "./orgStore.js";
import { addMessage, deferTask, dropTask, readModel, reviewTask, setupTask, submitTask,
  takeTask, withModel, writeModel } from "./workspaceStore.js";

/* ════════════════════════════════════════════════════════════════
   ЧТО ПОМОЩНИК УМЕЕТ ДЕЛАТЬ (владелец, 2026-09-20)

   «У ассистента должны быть все те же знания, права и возможности, что и
   у пользователя, который к нему обращается».

   Права тут не описаны отдельно — и в этом всё дело. Каждое действие
   зовёт ТУ ЖЕ функцию хранилища, что и кнопка в приложении, и передаёт
   ей id спрашивающего. Значит, помощник может ровно то, что может сам
   человек: взять свою задачу, сдать свою работу, принять то, что
   проверяет он. Не своё — тот же отказ теми же словами. Второго свода
   правил, который пришлось бы держать в согласии с первым, здесь нет.

   Модель целиком (схема, ресурсы, функции, воркеры, техпроцессы) пишет
   только владелец — так устроено приложение, и здесь так же: `model_*`
   у не-владельца отвечает отказом, а не делает исключение для помощника.

   ─── спрашивать или делать ───

   У агента есть настройка: применять изменения сразу или спрашивать
   (владелец). Когда спрашивает, действие не выполняется, а ЗАПОМИНАЕТСЯ:
   помощник описывает его человеку и ждёт «да». Подтверждение разбирает
   сервер, а не модель: «да» должно значить «да» независимо от того, как
   модель его поняла.
   ════════════════════════════════════════════════════════════════ */

const str = (v, limit = 2000) => String(v == null ? "" : v).slice(0, limit);
const ok = (text) => ({ ok: true, text });
const no = (text) => ({ ok: false, text });

/* Отложенное действие ждёт ответа человека. По одному на человека и
   агента: два висящих «вы уверены?» — это вопрос, на который непонятно,
   что отвечает «да». */
const pending = new Map();
const pendKey = (userId, agentId) => `${userId}~${agentId || "assistant"}`;
export const pendingFor = (userId, agentId) => pending.get(pendKey(userId, agentId)) || null;
export const forgetPending = (userId, agentId) => pending.delete(pendKey(userId, agentId));

/* Граница слова тут своя, а не `\b`: в JavaScript `\b` считается по
   `\w`, то есть по латинице, и «да» ему не слово вовсе — проверка молча
   не срабатывала, а подтверждение не доходило. */
const EDGE = "(?=$|[\\s.,!?;:…])";
const YES = new RegExp(`^(да|ага|ок|окей|хорошо|давай|подтверждаю|применяй|применить|делай|go|ok|yes)${EDGE}`, "i");
const NO = new RegExp(`^(нет|не надо|отмена|отменить|стоп|no|cancel)${EDGE}`, "i");
/** Что человек ответил на «вы уверены?»: да, нет или не об этом. */
export const answerToAsk = (text) => {
  const t = String(text || "").trim();
  if (YES.test(t)) return "yes";
  if (NO.test(t)) return "no";
  return "";
};

/* ─────── сами действия ─────── */

const taskWord = (t) => `«${t?.title || "задача"}»`;

const ACTIONS = {
  task_take: {
    what: "взять задачу в работу",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string",
      description: "id задачи" } }, required: ["taskId"] },
    say: (a) => `взять задачу ${a.taskId} в работу`,
    run: async (userId, a) => {
      const r = await takeTask(userId, str(a.taskId, 80));
      if (r.error) return no(whyNot(r.error));
      return ok(`Взял в работу: ${taskWord(r.task)}.`);
    },
  },
  task_drop: {
    what: "вернуть задачу в бэклог",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
    say: (a) => `вернуть задачу ${a.taskId} в бэклог`,
    run: async (userId, a) => {
      const r = await dropTask(userId, str(a.taskId, 80));
      if (r.error) return no(whyNot(r.error));
      return ok(`Вернул в бэклог: ${taskWord(r.task)}.`);
    },
  },
  task_defer: {
    what: "отложить задачу",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string" },
      until: { type: "string", description: "до какого момента, ISO" } },
    required: ["taskId"] },
    say: (a) => `отложить задачу ${a.taskId}`,
    run: async (userId, a) => {
      const r = await deferTask(userId, str(a.taskId, 80), { until: a.until });
      if (r.error) return no(whyNot(r.error));
      return ok(`Отложил: ${taskWord(r.task)}.`);
    },
  },
  task_submit: {
    what: "сдать работу по задаче",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string" },
      text: { type: "string", description: "отчёт словами" },
      hours: { type: "number", description: "сколько часов ушло" } },
    required: ["taskId", "text"] },
    say: (a) => `сдать задачу ${a.taskId} с отчётом «${str(a.text, 60)}»`,
    run: async (userId, a) => {
      const r = await submitTask(userId, str(a.taskId, 80),
        { text: str(a.text), hours: Number(a.hours) || 0 });
      if (r.error === "missing files") {
        return no(`Не сдал: не приложены обязательные вещи (${(r.missing || []).length}). Это делается в форме задачи.`);
      }
      if (r.error) return no(whyNot(r.error));
      return ok(`Сдал: ${taskWord(r.task)}.`);
    },
  },
  task_review: {
    what: "принять или вернуть сданную работу",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string" },
      accept: { type: "boolean", description: "true — принять, false — вернуть" },
      comment: { type: "string", description: "при возврате обязателен" } },
    required: ["taskId", "accept"] },
    say: (a) => `${a.accept ? "принять" : "вернуть"} работу по задаче ${a.taskId}`,
    run: async (userId, a) => {
      const r = await reviewTask(userId, str(a.taskId, 80),
        { accept: a.accept !== false, comment: str(a.comment, 1000) });
      if (r.error === "comment required") return no("Чтобы вернуть работу, нужно написать, что доработать.");
      if (r.error) return no(whyNot(r.error));
      return ok(`${a.accept !== false ? "Принял" : "Вернул"}: ${taskWord(r.task)}.`);
    },
  },
  task_setup: {
    what: "поставить задачу: срок, исполнитель, проверяющий",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string" },
      title: { type: "string" }, body: { type: "string" },
      end: { type: "string", description: "срок" },
      assignee: { type: "string" }, reviewer: { type: "string" },
      status: { type: "string", description: "backlog — поставить" } },
    required: ["taskId"] },
    say: (a) => `поставить задачу ${a.taskId}`,
    run: async (userId, a, { isOwner }) => {
      const org = await listOrg();
      const posts = new Map((org.users || []).map((u) => [String(u.id), u.roles || []]));
      const fields = {};
      ["title", "body", "end", "assignee", "reviewer", "status", "start"].forEach((k) => {
        if (a[k] !== undefined) fields[k] = a[k];
      });
      const r = await setupTask(userId, str(a.taskId, 80), fields,
        { isOwner, rolesOf: (id) => posts.get(String(id)) || [] });
      if (r.error) return no(r.why || whyNot(r.error));
      return ok(`Поставил: ${taskWord(r.task)}.`);
    },
  },
  task_say: {
    what: "сказать в обсуждении задачи",
    writes: true,
    schema: { type: "object", properties: { taskId: { type: "string" },
      text: { type: "string" },
      role: { type: "string", description: "assignee | setter | reviewer" } },
    required: ["taskId", "text"] },
    say: (a) => `написать в обсуждении задачи ${a.taskId}: «${str(a.text, 60)}»`,
    run: async (userId, a, { isOwner }) => {
      const r = await addMessage(userId, str(a.taskId, 80),
        { text: str(a.text), role: a.role }, { isOwner });
      if (r.error) return no(whyNot(r.error));
      return ok("Сказал в обсуждении.");
    },
  },

  /* ─── модель целиком: только владельцу, как и в приложении ─── */
  proc_write: {
    what: "создать или переписать технологический процесс",
    writes: true, owner: true,
    schema: { type: "object", properties: {
      name: { type: "string", description: "название процесса" },
      text: { type: "string", description: "текст процесса построчно: «Задача: …», «Кто: …», «Берёт: …», «Отдаёт: …»" },
    }, required: ["name", "text"] },
    say: (a) => `записать технологический процесс «${str(a.name, 60)}»`,
    run: async (_userId, a) => withModel(async (model) => {
      const name = str(a.name, 200).trim();
      if (!name) return no("У процесса должно быть название.");
      const procs = Array.isArray(model.procs) ? [...model.procs] : [];
      const i = procs.findIndex((p) => String(p.name || "").trim() === name);
      const text = str(a.text, 20000);
      if (i >= 0) procs[i] = { ...procs[i], text };
      else procs.push({ id: `pr${Date.now().toString(36)}`, name, text });
      await writeModel({ ...model, procs });
      return ok(`${i >= 0 ? "Переписал" : "Записал"} процесс «${name}».`);
    }),
  },
  trait_set: {
    what: "поменять, сколько ресурса есть",
    writes: true, owner: true,
    schema: { type: "object", properties: { traitId: { type: "string" },
      have: { type: "number" } }, required: ["traitId", "have"] },
    say: (a) => `поставить ресурсу ${a.traitId} количество ${a.have}`,
    run: async (_userId, a) => withModel(async (model) => {
      const id = str(a.traitId, 80);
      const traits = Array.isArray(model.traits) ? model.traits : [];
      const t = traits.find((x) => String(x.id) === id);
      if (!t) return no(`Ресурса ${id} в модели нет.`);
      const have = Number(a.have);
      if (!Number.isFinite(have)) return no("Количество должно быть числом.");
      await writeModel({ ...model,
        traits: traits.map((x) => (String(x.id) === id ? { ...x, have } : x)) });
      return ok(`У ресурса «${t.l || id}» теперь ${have}.`);
    }),
  },
  func_set: {
    what: "поменять поля функции",
    writes: true, owner: true,
    schema: { type: "object", properties: { funcId: { type: "string" },
      fields: { type: "object", description: "что поменять: name, dur, durUnit, every, everyUnit" } },
    required: ["funcId", "fields"] },
    say: (a) => `поправить функцию ${a.funcId}`,
    run: async (_userId, a) => withModel(async (model) => {
      const id = str(a.funcId, 80);
      const funcs = Array.isArray(model.funcs) ? model.funcs : [];
      const f = funcs.find((x) => String(x.id) === id);
      if (!f) return no(`Функции ${id} в модели нет.`);
      const allowed = ["name", "dur", "durHi", "durUnit", "every", "everyHi", "everyUnit", "kind"];
      const patch = {};
      Object.entries(a.fields || {}).forEach(([k, v]) => { if (allowed.includes(k)) patch[k] = v; });
      if (!Object.keys(patch).length) return no(`Менять можно: ${allowed.join(", ")}.`);
      await writeModel({ ...model,
        funcs: funcs.map((x) => (String(x.id) === id ? { ...x, ...patch } : x)) });
      return ok(`Поправил функцию «${f.name || id}»: ${Object.keys(patch).join(", ")}.`);
    }),
  },
  crew_set: {
    what: "поменять список воркеров актива",
    writes: true, owner: true,
    schema: { type: "object", properties: { entityId: { type: "string" },
      crew: { type: "array", items: { type: "string" }, description: "id людей" } },
    required: ["entityId", "crew"] },
    say: (a) => `поставить активу ${a.entityId} воркеров: ${(a.crew || []).join(", ") || "никого"}`,
    run: async (_userId, a) => withModel(async (model) => {
      const id = str(a.entityId, 80);
      const entities = Array.isArray(model.entities) ? model.entities : [];
      const e = entities.find((x) => String(x.id) === id);
      if (!e) return no(`Актива ${id} в модели нет.`);
      const crew = (Array.isArray(a.crew) ? a.crew : []).map((x) => String(x)).slice(0, 200);
      await writeModel({ ...model,
        entities: entities.map((x) => (String(x.id) === id ? { ...x, crew } : x)) });
      return ok(`У актива «${e.name || id}» теперь ${crew.length} воркер(ов).`);
    }),
  },

  /* ─── чтение: не требует подтверждения никогда ─── */
  tasks_list: {
    what: "перечислить задачи с их id",
    writes: false,
    schema: { type: "object", properties: {} },
    run: async (userId) => {
      const model = await readModel();
      const rows = (model.tasks || [])
        .filter((t) => [t.assignee, t.setter, t.reviewer].some((x) => String(x) === String(userId)))
        .slice(0, 50)
        .map((t) => `${t.id}: ${t.title || "без названия"} — ${t.status}`);
      return ok(rows.length ? rows.join("\n") : "Задач, где вы участвуете, нет.");
    },
  },
};

const whyNot = (error) => ({
  "not found": "Такой задачи нет.",
  "not yours": "Это не ваша задача.",
  "not in backlog": "Задача не в бэклоге.",
  "not in progress": "Задача не в работе.",
  "not set": "Задача ещё не поставлена.",
  "nothing to review": "Проверять нечего: сдачи нет.",
}[error] || `Не вышло: ${error}.`);

export const ACTION_IDS = Object.keys(ACTIONS);

/** Инструменты для модели: имя, что делает и какие поля принимает. */
export const toolsFor = ({ isOwner = false } = {}) => ACTION_IDS
  .filter((id) => !ACTIONS[id].owner || isOwner)
  .map((id) => ({ name: id, description: ACTIONS[id].what, schema: ACTIONS[id].schema }));

/**
 * Выполнить действие от имени человека.
 *
 * `ask` — агент спрашивает перед изменением: тогда действие не делается, а
 * запоминается, и помощнику возвращается просьба описать его человеку.
 */
export async function runAction(name, args, { userId, agentId, isOwner = false, ask = true }) {
  const action = ACTIONS[name];
  if (!action) return no(`Нет такого действия: ${name}.`);
  if (action.owner && !isOwner) {
    return no("Это меняет модель целиком — так может только владелец.");
  }
  if (action.writes && ask) {
    const words = action.say ? action.say(args || {}) : action.what;
    pending.set(pendKey(userId, agentId), { name, args: args || {}, words });
    return no(`Нужно подтверждение. Скажите человеку: «Собираюсь ${words}. Подтвердите?» — и ждите ответа.`);
  }
  try {
    return await action.run(userId, args || {}, { isOwner });
  } catch (e) {
    return no(`Не вышло: ${String(e?.message || e).slice(0, 300)}`);
  }
}

/** Применить отложенное действие — когда человек сказал «да». */
export async function applyPending(userId, agentId, { isOwner = false } = {}) {
  const p = pendingFor(userId, agentId);
  if (!p) return null;
  forgetPending(userId, agentId);
  return runAction(p.name, p.args, { userId, agentId, isOwner, ask: false });
}
