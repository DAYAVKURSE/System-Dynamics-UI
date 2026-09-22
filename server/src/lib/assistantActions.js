import { listOrg, setProfile } from "./orgStore.js";
import { addMessage, deferTask, dropTask, readModel, reviewTask, setupTask, submitTask,
  takeTask, withModel, writeModel } from "./workspaceStore.js";
import { addUndo, takeUndo, undoById } from "./undoStore.js";

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

/* Отложенные изменения — по id: кнопка под сообщением называет именно то,
   что подтверждают. Живут час и не больше сотни: это оперативная память
   разговора, а не хранилище. */
const pending = new Map();
export const PENDING_TTL_MS = 60 * 60 * 1000;
const MAX_PENDING = 100;

const sweepPending = (now = Date.now()) => {
  for (const [id, p] of pending) {
    if (now - p.at > PENDING_TTL_MS) pending.delete(id);
  }
  while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
};

export const pendingById = (id) => {
  const p = pending.get(String(id));
  if (!p) return null;
  if (Date.now() - p.at > PENDING_TTL_MS) { pending.delete(String(id)); return null; }
  return p;
};
export const forgetPending = (id) => pending.delete(String(id));
export function resetPendingActions() { pending.clear(); }

/** Сколько изменений ждёт подтверждения у этого человека. */
export const pendingCount = (userId, agentId) => {
  sweepPending();
  let n = 0;
  for (const p of pending.values()) {
    if (p.userId === String(userId) && p.agentId === String(agentId || "assistant")) n += 1;
  }
  return n;
};

/* ─────── сами действия ─────── */

const taskWord = (t) => `«${t?.title || "задача"}»`;

const ACTIONS = {
  task_take: {
    what: "взять задачу в работу",
    writes: true, category: "tasks",
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
    writes: true, category: "tasks",
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
    writes: true, category: "tasks",
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
    writes: true, category: "tasks",
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
    writes: true, category: "tasks",
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
    what: "поставить УЖЕ СУЩЕСТВУЮЩУЮ задачу: срок, исполнитель, проверяющий."
      + " Новую задачу этим не завести — id берётся из tasks_list, а не придумывается",
    writes: true, category: "tasks",
    schema: { type: "object", properties: {
      taskId: { type: "string", description: "id СУЩЕСТВУЮЩЕЙ задачи — из tasks_list, не выдуманный" },
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
    writes: true, category: "tasks",
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
    writes: true, owner: true, category: "process",
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
    writes: true, owner: true, category: "scheme",
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
    writes: true, owner: true, category: "functions",
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
    writes: true, owner: true, category: "scheme",
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

  /* ─── напоминания собеседника (владелец, 2026-09-23) ───
     За сколько предупреждать — решает сам человек, а не тот, кто ставит
     задачу («предупреждают ЕГО, и на сколько заранее ему удобно, знает
     он»). Поэтому действие всегда меняет самого СПРАШИВАЮЩЕГО, того же
     `userId`, с кем идёт разговор, — никогда чужие настройки. */
  reminder_set: {
    what: "поменять свои напоминания: за сколько предупреждать до начала задачи и до дедлайна",
    writes: true, category: "reminders",
    schema: { type: "object", properties: {
      warnMin: { type: "number", description: "минут до начала задачи, 0–1440" },
      deadlinePct: { type: "number", description: "доля срока до дедлайна, от 0 до 1" },
    } },
    say: (a) => {
      const bits = [];
      if (a.warnMin != null) bits.push(`за ${a.warnMin} мин до начала`);
      if (a.deadlinePct != null) bits.push(`за ${Math.round(Number(a.deadlinePct) * 100)}% срока до дедлайна`);
      return `изменить напоминания: ${bits.join(", ") || "без изменений"}`;
    },
    run: async (userId, a) => {
      if (a.warnMin == null && a.deadlinePct == null) {
        return no("Скажите, что поменять: за сколько минут до начала или за какую долю срока до дедлайна.");
      }
      const p = await setProfile(userId, { warnMin: a.warnMin, deadlinePct: a.deadlinePct });
      if (!p) return no("Вас ещё нет среди участников — напоминания настраивать пока нечему.");
      return ok(`Напоминания: за ${p.warnMin} мин до начала, за ${Math.round((p.deadlinePct || 0) * 100)}% срока до дедлайна.`);
    },
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

/* Названия прав — только для слов отказа здесь; сам список категорий и
   их подписи для экрана — в assistantSettings.js (RIGHTS), это поле их не
   повторяет, а просто читает. */
const RIGHT_NAME = { scheme: "редактировать схему", process: "редактировать техпроцесс",
  functions: "редактировать функции", tasks: "редактировать задачи", reminders: "менять напоминания" };

/** Может ли действие сработать при данных правах агента: без прав (`rights` не задан) — всегда да. */
const rightsAllow = (action, rights) => !action.category || !rights || rights[action.category] === true;

/** Инструменты для модели: имя, что делает и какие поля принимает.
 * `rights` — права АГЕНТА (владелец, 2026-09-23): нет — ограничений нет
 * (так у ассистента, он работает под правами того, кто спросил); есть —
 * действие категории, которой в правах не хватает, в список не попадает
 * вовсе — агент физически не может его позвать, не только не должен. */
export const toolsFor = ({ isOwner = false, rights = null } = {}) => ACTION_IDS
  .filter((id) => !ACTIONS[id].owner || isOwner)
  .filter((id) => rightsAllow(ACTIONS[id], rights))
  .map((id) => ({ name: id, description: ACTIONS[id].what, schema: ACTIONS[id].schema }));

/* Слова подтверждения — одни на все места: и в сообщении человеку, и в
   ответе инструменту. Расходиться им нельзя: человек подтверждает ровно
   то, о чём отчитается помощник. */
export const CONFIRM_ASKED = "Изменение НЕ сделано: человеку отправлено подтверждение кнопками."
  + " Не проси разрешения словами, не зови это действие снова и не говори,"
  + " что сделал. Скажи одной строкой, что ждёшь подтверждения.";

/**
 * Выполнить действие от имени человека.
 *
 * `ask` — изменения применяются только после подтверждения: тогда
 * действие не делается, а откладывается, и `onConfirm` зовут показать его
 * человеку кнопками. Спрашивать разрешение словами модели не нужно и
 * нельзя: об этом ей говорит сам ответ инструмента.
 */
export async function runAction(name, args, {
  userId, agentId, isOwner = false, ask = true, onConfirm = null, rights = null,
}) {
  const action = ACTIONS[name];
  if (!action) return no(`Нет такого действия: ${name}.`);
  if (action.owner && !isOwner) {
    return no("Это меняет модель целиком — так может только владелец.");
  }
  /* Вторая граница, не только список инструментов (владелец, 2026-09-23:
     «физически не смогут сделать то, чего нет у них в правах»): даже если
     имя действия пришло вызовом мимо схемы (или список составили раньше,
     чем права поменялись), делать его без права всё равно нельзя. */
  if (!rightsAllow(action, rights)) {
    return no(`У агента нет права «${RIGHT_NAME[action.category] || action.category}» — так он не может.`);
  }
  if (action.writes && ask) {
    /* Спрашивать подтверждение имеет смысл только для того, что МОЖЕТ
       получиться: несуществующая задача не появится оттого, что человек
       нажал кнопку (владелец, 2026-09-23: «нажал подтверждение, после
       чего агент сказал, что такой задачи нет»). Проверяем это здесь, а
       не только в самом действии при нажатии, — иначе клик уходит
       впустую, а отказ приходит только ПОСЛЕ него. */
    if (args?.taskId != null) {
      const exists = ((await readModel()).tasks || []).some((t) => String(t.id) === String(args.taskId));
      if (!exists) return no("Такой задачи нет.");
    }
    sweepPending();
    const words = action.say ? action.say(args || {}) : action.what;
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    pending.set(id, { id, userId: String(userId), agentId: String(agentId || "assistant"),
      name, args: args || {}, words, at: Date.now() });
    /* Показать человека просят СНАРУЖИ: кто зовёт помощника, тот и знает,
       как с человеком говорить, — бот кнопками, очередь ничем. Не вышло
       показать — откладывать нечего: подтвердить это будет некому. */
    try {
      const shown = onConfirm ? await onConfirm({ id, words, name, args: args || {} }) : false;
      if (!shown) {
        forgetPending(id);
        return no("Изменение не сделано: спросить подтверждение не вышло, и делать без него нельзя.");
      }
    } catch (e) {
      forgetPending(id);
      return no(`Изменение не сделано: спросить подтверждение не вышло (${String(e?.message || e).slice(0, 200)}).`);
    }
    return { ok: false, asked: true, id, words, text: CONFIRM_ASKED };
  }
  try {
    return await action.run(userId, args || {}, { isOwner });
  } catch (e) {
    return no(`Не вышло: ${String(e?.message || e).slice(0, 300)}`);
  }
}

/** Что именно откладывали — словами, для сообщения с кнопками. */
export const pendingWords = (id) => pendingById(id)?.words || "";

/* ─────── ОТКАТ: ЧТО БЫЛО ДО (владелец, 2026-09-21) ───────

   «Ассистент должен откатить ровно те изменения, которые внёс, и вернуть
   значения, которые были до внесения изменений».

   Ровно те — значит не всю модель: вернуть её целиком значило бы отменить
   заодно всё, что человек сделал руками после. Поэтому снимается РАЗНИЦА
   между моделью до и после, запись за записью по их id, и откат кладёт
   назад только эти записи.

   Списки записей с id (задачи, процессы, ресурсы, функции, активы)
   сравниваются поштучно; всё остальное — целиком: обратного разбора у
   него нет, а прежнее значение есть всегда. */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byId = (v) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && x.id != null);

export function diffOf(before = {}, after = {}) {
  const lists = {};
  const fields = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (same(a, b)) continue;
    if (byId(b) && byId(a)) {
      const was = new Map(b.map((x) => [String(x.id), x]));
      const now = new Map(a.map((x) => [String(x.id), x]));
      const changed = {};
      const added = [];
      now.forEach((v, id) => {
        if (!was.has(id)) added.push(id);
        else if (!same(was.get(id), v)) changed[id] = was.get(id);
      });
      was.forEach((v, id) => { if (!now.has(id)) changed[id] = v; });
      if (added.length || Object.keys(changed).length) lists[k] = { changed, added };
    } else {
      fields[k] = { has: b !== undefined, value: b === undefined ? null : b };
    }
  }
  return { lists, fields };
}

export const diffEmpty = (d) =>
  !Object.keys(d?.lists || {}).length && !Object.keys(d?.fields || {}).length;

/** Вернуть модели те значения, что были до. */
export function restoreDiff(model = {}, d = {}) {
  const next = { ...model };
  Object.entries(d.lists || {}).forEach(([k, { changed = {}, added = [] }]) => {
    const drop = new Set(added.map(String));
    const left = new Map(Object.entries(changed));
    const out = (Array.isArray(next[k]) ? next[k] : [])
      .filter((x) => !drop.has(String(x?.id)))
      .map((x) => {
        const was = left.get(String(x?.id));
        if (was === undefined) return x;
        left.delete(String(x?.id));
        return was;
      });
    /* Что действие удалило — возвращается в конец списка: где именно оно
       стояло, разница не помнит, а потерять запись нельзя. */
    left.forEach((v) => out.push(v));
    next[k] = out;
  });
  Object.entries(d.fields || {}).forEach(([k, { has, value }]) => {
    if (has) next[k] = value; else delete next[k];
  });
  return next;
}

/** Применить отложенное — человек нажал «Подтвердить». */
export async function applyPending(id, { isOwner = false } = {}) {
  const p = pendingById(id);
  if (!p) return null;
  forgetPending(id);
  const before = await readModel();
  const r = await runAction(p.name, p.args,
    { userId: p.userId, agentId: p.agentId, isOwner, ask: false });
  if (!r?.ok) return r;
  /* Снимаем разницу СРАЗУ после действия: чем позже, тем больше чужого
     попадёт в откат. */
  const diff = diffOf(before, await readModel());
  if (diffEmpty(diff)) return r;
  try {
    await addUndo({ id, userId: p.userId, agentId: p.agentId, words: p.words, diff });
  } catch { return r; }   // не записали откат — само изменение уже сделано
  return { ...r, undoId: id };
}

/** Откатить сделанное — человек нажал «Отменить изменения». */
export async function undoApplied(id, { userId = null } = {}) {
  const rec = await undoById(id);
  if (!rec) return null;
  if (userId != null && String(rec.userId) !== String(userId)) return { foreign: true };
  const taken = await takeUndo(id);
  if (!taken) return null;
  await withModel(async (model) => writeModel(restoreDiff(model, taken.diff)));
  return { ok: true, words: taken.words, text: `Откатил: ${taken.words}.` };
}

/** Отменить отложенное — человек нажал «Отменить». */
export function cancelPending(id) {
  const p = pendingById(id);
  if (!p) return null;
  forgetPending(id);
  return p;
}
