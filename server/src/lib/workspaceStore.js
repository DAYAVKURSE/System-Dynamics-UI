import fs from "node:fs/promises";
import path from "node:path";
import { assetWorkers, fixedPerson, funcExecutors, handMate, roleOf, whyNotSet } from "./taskRules.js";
import { scopedDir } from "./storages.js";

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

   Что не-владелец может изменить: поставить свою задачу — людей, срок,
   содержимое (постановщик, `setupTask`), взять, отложить и сдать свою
   задачу (исполнитель), принять или вернуть отчёт (проверяющий), написать
   и убрать свой комментарий (участник). Больше ничего — запись модели
   целиком закрыта.

   Файл модели один, а писателей много: владелец пишет её целиком, каждое
   нажатие исполнителя и проверяющего меняет свою задачу, планировщик
   публикует оценки. Каждый из них читает файл, меняет своё и пишет
   обратно, поэтому все такие правки идут через одну очередь в процессе
   (`withModel`): два нажатия в одну миллисекунду иначе затирали бы друг
   друга, и одно из них пропадало бы молча. Сама запись — через временный
   файл и переименование: обрыв на середине записи не оставляет
   обрезанного файла, из которого следующее чтение вернуло бы ПУСТУЮ
   модель.
   ════════════════════════════════════════════════════════════════ */

/* Модель — это активы (со своими воркерами), их ресурсы, их функции и
   задачи-выполнения, цели, факторы, отчёты (карта проектов) и материалы
   — единицы ресурсов, заведённые руками (`web/src/lib/units.js`). Прежние части — `edges` (стрелки «актив → ресурс»),
   `okrs`, `hypos` и `flows` — принадлежали расчёту, которого больше нет;
   они остаются в списке только для чтения уже сохранённых моделей, чтобы
   клиент мог перенести из них числа. Записывать их он перестал. */
const PARTS = ["entities", "traits", "kinds", "tasks", "funcs", "goals", "factors",
  "reports", "materials",
  /* Технологические процессы (`web/src/lib/process.js`): текст, статус и
     заведённые ими гипотезы. Без них функции процессов приезжали бы назад
     сиротами — пересобрать или снять их было бы не по чему. */
  "procs",
  /* Блоки вкладки «Концепты» (web/src/lib/concepts.js): дерево блоков, у
     блока — доска и свои процессы (`blockId` у процесса). Без них процессы
     приезжали бы назад без блоков (владелец, 2026-09-26). */
  "concepts",
  /* Реестр опубликованных оценок (`lib/ratings.js`). Ведёт его сервер, а
     не клиент: клиент присылает модель целиком, и в ней реестр был бы
     на полторы секунды старше серверного — только что опубликованная
     оценка стиралась бы и публиковалась заново. */
  "published",
  "edges", "okrs", "hypos", "flows"];
const EMPTY = Object.fromEntries(PARTS.map((k) => [k, []]));

function baseDir() {
  return scopedDir(process.env.WORKSPACE_DIR
    ? path.resolve(process.env.WORKSPACE_DIR)
    : path.resolve(process.cwd(), "data", "workspace"));
}
const file = () => path.join(baseDir(), "model.json");

/* ─────── АКТИВЫ ПО УМОЛЧАНИЮ (владелец, 2026-09-21) ───────

   У каждого хранилища два актива, которые нельзя удалить: «Владелец» —
   сам человек, в нём появляются услуги и задачи, которые он делает для
   других; «Система» — рынок: все стрелки наружу идут в неё, отдельных
   блоков заказчиков нет. Дописываются при каждом чтении, если их нет:
   так они есть и в прежней модели, и в только что заведённой. */
export const FIXED_ASSETS = [
  { id: "owner", name: "Владелец", color: "#5EEAD4", x: 24, y: 300, fixed: true },
  { id: "system", name: "Система", color: "#FFD166", x: 24, y: 560, fixed: true },
];
export function withFixedAssets(model) {
  const ents = Array.isArray(model.entities) ? model.entities : [];
  const missing = FIXED_ASSETS.filter((f) => !ents.some((e) => e && e.id === f.id));
  const entities = [...ents.map((e) => (FIXED_ASSETS.some((f) => f.id === e?.id)
    ? { ...e, fixed: true } : e)), ...missing.map((f) => ({ ...f }))];
  return { ...model, entities };
}

export async function readModel() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    const out = { ...EMPTY };
    PARTS.forEach((k) => { if (Array.isArray(parsed[k])) out[k] = parsed[k]; });
    out.savedAt = parsed.savedAt || null;
    return withFixedAssets(out);
  } catch {
    return withFixedAssets({ ...EMPTY, savedAt: null });
  }
}

export async function writeModel(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new Error("model is required");
  }
  const out = { ...EMPTY };
  PARTS.forEach((k) => { if (Array.isArray(model[k])) out[k] = model[k]; });
  out.entities = withFixedAssets(out).entities;
  /* Модель без реестра опубликованного (её присылает клиент владельца) не
     стирает реестр: опубликованное — это то, что случилось, и правка
     модели этого не отменяет. */
  if (!Array.isArray(model.published)) out.published = (await readModel()).published;
  out.savedAt = new Date().toISOString();
  await fs.mkdir(baseDir(), { recursive: true });
  /* Сначала во временный файл, потом переименование: оно атомарно, и
     читающий в этот момент видит либо прежнюю модель, либо новую — но не
     половину. Имя временного файла — своё у каждой записи, чтобы две
     записи целиком (их владелец шлёт без очереди) не писали в один. */
  const tmp = `${file()}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(out), "utf8");
    await fs.rename(tmp, file());
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return out;
}

/* Очередь правок модели — одна на процесс, цепочка обещаний, как
   `inOrder` в `memoryStore.js`. Работа получает свежепрочитанную модель,
   меняет её и сама решает, писать ли (`writeModel`): отказ «не твоя
   задача» ничего не пишет. Что работа вернула — то и наружу; упавшая
   работа очередь не останавливает. Процесс один, поэтому очереди в памяти
   достаточно — файла-замка не нужно. */
let chain = Promise.resolve();
export function withModel(job) {
  const run = async () => job(await readModel());
  const next = chain.then(run, run);
  chain = next.then(() => {}, () => {});
  return next;
}

/** Задачи, до которых человеку есть дело. Владелец здесь не проходит. */
export const tasksFor = (model, userId) => {
  const id = String(userId);
  // Три роли, и все три дают право видеть задачу: постановщик написал, что
  // сделать, исполнитель это делает, проверяющий принимает. Спрятать задачу
  // от того, кто её поставил, значило бы отобрать у него собственную работу.
  /* Подразумеваемая роль — тоже роль: у задачи без постановщика им
     считается исполнитель, без проверяющего — постановщик (`roleOf`). */
  return (model.tasks || []).filter((t) => String(roleOf(t, "setter") || "") === id
    || String(t.assignee || "") === id || String(roleOf(t, "reviewer") || "") === id);
};

/**
 * Задача глазами одного человека — без того, что ему в ней не положено.
 *
 * · Отметка в решении проверяющего — только автору. Остальным — `null`:
 *   исполнитель своих оценок не видит вовсе, постановщик — только
 *   опубликованные средние (`lib/ratings.js`), а отдельная отметка в
 *   задаче называла бы автора не хуже имени. Скрытая — тем более: она
 *   скрыта от всех, кроме автора, и в средние при этом входит.
 * · Слова решения: скрытые — исполнителю (адресату) и автору, публичные —
 *   всем, кто видит задачу. Скрытость одна на отметку и слова.
 * · Оценка постановки в сдаче — только тому, кто её поставил: она про
 *   постановщика и доходит до него по правилам публикации (средние — как
 *   у всех, скрытые слова — сразу, через `commentsFor`), а не из сдачи.
 * · Приватная оценка человеку (`marks`) — только тому, кто её поставил, и
 *   тому, кому она оставлена. Публичную видят все, кто видит задачу.
 * · Обсуждение задачи (`chat`) видно ВСЕМ, кому видна сама задача
 *   (владелец, 2026-09-20): это общий разговор постановщика, исполнителя
 *   и проверяющего, а не переписка по углам.
 *
 * Режет сервер, а не интерфейс: спрятанное кнопкой видно в любом
 * отладчике. Владелец получает модель целиком — она его; правило про
 * скрытую отметку для него повторено в интерфейсе (`visibleStats`).
 */
export function taskViewFor(task, userId) {
  const id = String(userId);
  const mine = (v) => v != null && String(v) === id;
  return {
    ...task,
    reviews: (task.reviews || []).map((rv) => {
      if (mine(rv.by)) return rv;
      const out = { ...rv, mark: null };
      if (rv.hidden && !mine(task.assignee)) out.comment = "";
      return out;
    }),
    submissions: (task.submissions || []).map((sb) => (
      mine(task.assignee) || !sb.setterRating ? sb : { ...sb, setterRating: null })),
    marks: (task.marks || []).filter((m) => m.pub || mine(m.by) || mine(m.to)),
  };
}

/**
 * Срез модели под одного человека: его задачи и ровно то, на что они
 * ссылаются. Владельцу возвращается модель целиком.
 */
export function viewFor(model, { id, isOwner }) {
  if (isOwner) return { ...model, mine: model.tasks || [] };

  const tasks = tasksFor(model, id).map((t) => taskViewFor(t, id));
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
    /* Материалы видимых ему ресурсов: из них считается «есть», и без них
       исполнитель не увидел бы, что именно может взять. Чужих ресурсов
       здесь нет — как и самих ресурсов. */
    materials: (model.materials || []).filter((m) => m && traitIds.has(m.trait)),
    /* Процессы, чьи функции попали в срез: без них функция гипотезы читалась
       бы у позванного как принятая («процесс неизвестен — значит, принят»,
       `activeFuncs`), и его прогноз считал бы то, чего владелец не решил. */
    procs: (model.procs || []).filter((p) => p && funcs.some((f) => f.proc === p.id)),
    /* Реестр опубликованного — только по его задачам: по остальным он
       называл бы, кто кого оценивал в работе, которой человек не видит. */
    published: (model.published || [])
      .filter((rid) => tasks.some((t) => String(rid).startsWith(`${t.id}~`))),
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
/* Два состояния бэклога: «ожидает» — время ещё не пришло, «отложено» —
   уже позвали, а работа не началась. Список один на весь сервер, чтобы не
   разойтись с интерфейсом (`BACKLOG_STATES` в `TasksBoard.jsx`). */
export const BACKLOG = ["backlog", "deferred"];

/**
 * Бросить работу: задача возвращается в бэклог.
 *
 * Своя операция на сервере по той же причине, что и «взять»: модель
 * целиком пишет владелец, а отказаться от работы должен тот, кто её
 * делает, — иначе нажатие жило бы только в его окне.
 *
 * Бросают ТО, ЧТО ДЕЛАЮТ: лежащую в бэклоге бросать не за что, сданную
 * проверяют, принятую сделали. Взятие снимается вместе со статусом —
 * иначе задача висела бы «в работе» у того, кто от неё отказался.
 */
export const dropTask = (userId, taskId) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  if (task.status !== "progress" && task.status !== "deadline") {
    return { error: "not in progress" };
  }
  task.taken = false;
  task.status = "backlog";
  task.deferredAt = null;
  task.deferredUntil = null;
  await writeModel(model);
  return { task };
});

export const takeTask = (userId, taskId, { now = Date.now() } = {}) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  /* Взять можно то, что лежит и ждёт: сданное и принятое брать не во что.
     У бэклога два состояния — «ожидает» и «отложено», — и берутся оба:
     отложенная задача не выбывает из работы, её просто ещё не начали. */
  if (!BACKLOG.includes(task.status) && task.status !== "deadline") {
    return { error: "not in backlog" };
  }
  const end = task.end ? new Date(task.end).getTime() : null;
  const late = end != null && !Number.isNaN(end) && end < now;
  task.taken = true;
  // Взялись — отметка об отложенности снимается, иначе задача вернулась бы
  // в «отложено» на первом же пересчёте доски. И «до какого момента» тоже:
  // напоминать о начале того, что уже начали, не за что.
  task.deferredAt = null;
  task.deferredUntil = null;
  task.status = late ? "deadline" : "progress";
  await writeModel(model);
  return { task };
});

/**
 * Откладывает задачу — только исполнитель и только свою.
 *
 * Задача остаётся в бэклоге и никуда не переносится: «отложено» — это не
 * полка «потом», а честная отметка о том, что человека позвали, а работа
 * не началась. Перенести срок отсюда нельзя: срок ставит постановщик, и
 * менять его нажатием того, кто исполняет, значило бы переписывать
 * договорённость в одну сторону.
 *
 * Правило то же, что в интерфейсе (`autoStatus` в `TasksBoard.jsx`):
 * просроченная остаётся в «Дедлайне» — от того, что её отложили, срок
 * назад не отматывается.
 *
 * `until` — до какого момента (ISO): в этот момент планировщик присылает
 * уведомление о начале заново. Момент обязан быть в будущем — отложить «до
 * вчера» значит не отложить вовсе, и такая дата не записывается, а не
 * ловится как ошибка: сама отметка «отложено» при этом верна. Не назван —
 * задача отложена без срока напоминания, и прежний срок, если был,
 * снимается: новое «отложить» ничего о времени не сказало.
 */
export const deferTask = (userId, taskId, { now = Date.now(), until = null } = {}) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  if (!BACKLOG.includes(task.status) && task.status !== "deadline") {
    return { error: "not in backlog" };
  }
  const end = task.end ? new Date(task.end).getTime() : null;
  const late = end != null && !Number.isNaN(end) && end < now;
  const untilMs = until ? Date.parse(String(until)) : NaN;
  task.taken = false;
  task.deferredAt = new Date(now).toISOString();
  task.deferredUntil = Number.isFinite(untilMs) && untilMs > now
    ? new Date(untilMs).toISOString() : null;
  task.status = late ? "deadline" : "deferred";
  await writeModel(model);
  return { task };
});

/**
 * Задача вместе с тем, что нужно, чтобы её сдать: функция и ресурсы, на
 * которые функция ссылается. Только своя — боту, как и доске, чужие задачи
 * не показываются, и отказ приходит словом, а не пустой задачей.
 */
export async function taskFor(userId, taskId) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  const func = (model.funcs || []).find((f) => f.id === task.funcId) || null;
  const ids = new Set();
  [...(func?.takes || []), ...(func?.gives || [])].forEach((p) => { if (p?.trait) ids.add(p.trait); });
  const traits = (model.traits || []).filter((t) => ids.has(t.id));
  return { task, func, traits };
}

/* ─────── что человеку поручено ───────

   Роли у функции — должности, и назначает их владелец. Человек своего
   поручения не выбирает: он видит, что на нём висит, и может ОТКАЗАТЬСЯ —
   то же исключение (`funcs[].except`), что владелец ставит в карточке
   актива. Обратное (взять функцию, которую не давали) здесь невозможно
   нарочно: это решение того, кто отвечает за актив. */
const postsOfFunc = (f, role) => {
  const all = f && typeof f.posts === "object" && f.posts ? f.posts : {};
  return (Array.isArray(all[role]) ? all[role] : []).map(String).filter(Boolean);
};
const ROLE_WORDS = { setters: "ставит", owners: "выполняет", reviewers: "проверяет" };

/** По должности ли человек попал в эту роль (или записан в ней по старой модели). */
function inRole(f, role, userId, roles = []) {
  const posts = postsOfFunc(f, role);
  // Ролей у человека несколько — хватает одной названной у функции.
  if (posts.length) return roles.some((r) => posts.includes(String(r)));
  return (Array.isArray(f[role]) ? f[role] : []).map(String).includes(String(userId));
}

/**
 * Поручения человека — по всем активам сразу: где он воркер и его выбрали.
 *
 * Позванный не видит модель, поэтому список собирает сервер. Отказ (`off`)
 * — его собственный, и он же виден владельцу в карточке актива.
 */
export function dutyFor(model = {}, userId, roles = []) {
  const id = String(userId);
  const crewOf = (e) => {
    const ent = (model.entities || []).find((x) => x.id === e) || {};
    const out = new Set();
    ["crew", "setters", "owners", "reviewers"].forEach((k) => {
      (Array.isArray(ent[k]) ? ent[k] : []).forEach((x) => {
        if (x != null && x !== "") out.add(String(x));
      });
    });
    return out;
  };
  const seen = {};
  return (model.funcs || []).map((f) => {
    if (!(f.e in seen)) seen[f.e] = crewOf(f.e);
    if (!seen[f.e].has(id)) return null;
    const mine = ["setters", "owners", "reviewers"].filter((r) => inRole(f, r, id, roles));
    if (!mine.length) return null;
    const ent = (model.entities || []).find((x) => x.id === f.e) || null;
    return { func: f.id, name: String(f.name || "без названия"),
      asset: f.e, assetName: String(ent?.name || "актив удалён"),
      roles: mine, words: mine.map((r) => ROLE_WORDS[r]),
      off: (Array.isArray(f.except) ? f.except : []).map(String).includes(id) };
  }).filter(Boolean);
}

/**
 * Отказаться от функции или взять её назад.
 *
 * Отказаться можно только от того, что тебе и правда поручено: иначе
 * запись превратилась бы в список посторонних людей. Берут назад тем же
 * нажатием — отказ не окончателен.
 */
export const refuseFunc = (userId, funcId, off, { roles = [] } = {}) =>
  withModel(async (model) => {
    const f = (model.funcs || []).find((x) => x.id === funcId);
    if (!f) return { error: "not found" };
    const mine = dutyFor(model, userId, roles).find((d) => d.func === funcId);
    if (!mine) return { error: "not yours" };
    const id = String(userId);
    const list = (Array.isArray(f.except) ? f.except : []).map(String);
    f.except = off ? [...new Set([...list, id])] : list.filter((x) => x !== id);
    await writeModel(model);
    return { func: funcId, off: Boolean(off) };
  });

/**
 * Поставлена ли задача — глазами того, кто её ставит.
 *
 * Кнопка «Готово» под напоминанием о постановке не верит нажатию: она
 * спрашивает склад. Поставлена — это `status !== "wait"` И нет причин
 * отказать (`whyNotSet`: три роли, срок, ресурсы). Не поставлена — причина
 * возвращается словами, теми же, что видит постановщик в форме.
 */
export async function setupStateFor(userId, taskId) {
  const model = await readModel();
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.setter || "") !== String(userId)) return { error: "not yours" };
  const title = String(task.title || "Задача");
  if (task.canceled === true) return { set: true, title, why: "" };
  const why = whyNotSet(task, model);
  return { set: task.status !== "wait" && !why, title, why };
}

/* Единицы сдачи: по записи на вещь. Вид — файл, текст или уникальный код;
   чем подтверждается единица, решает РЕСУРС (`traitKind` в
   `web/src/lib/units.js`), а сдача только приносит содержимое. */
const unitsIn = (v) => Object.fromEntries(
  Object.entries(v && typeof v === "object" ? v : {})
    .map(([k, list]) => [String(k), (Array.isArray(list) ? list : []).map((u) => ({
      kind: ["file", "text", "code"].includes(u?.kind) ? u.kind : "file",
      file: fileRef(u?.file),
      text: String(u?.text || ""),
      code: String(u?.code || ""),
    }))])
    .filter(([, list]) => list.length));

/* Заполнена ли каждая единица. У файла — файл, у текста — слова, у кода
   — сам код и подтверждение выдачи, одно на всю сдачу: код показать
   нечем, кроме бумаги о том, что его выдали. */
const unitsFilled = (list = [], proof = null) => list.length > 0 && list.every((u) => (
  u.kind === "file" ? !!u.file
    : u.kind === "text" ? !!u.text.trim()
      : !!u.code && !!proof));

/* Ссылка на файл: имя, тип, размер и адрес — то, что отдаёт
   `reportStore.saveReport`. Лишнего не храним, а без адреса это не файл. */
const fileRef = (f) => (f && typeof f === "object" && f.url
  ? { name: String(f.name || ""), type: String(f.type || ""),
    size: Number(f.size) || 0, url: String(f.url) }
  : null);

/* Обязательные выходы функции — те, у которых нижняя граница вилки больше
   нуля: функция обещала выдать хотя бы столько, и без вещи работа не
   сделана. То же правило, что `requiredGives` в web/src/lib/funcs.js:
   бот и доска обязаны отказывать одинаково. */
const requiredGives = (func) => (func?.gives || [])
  .filter((p) => p && p.trait && (Number(p.lo) || 0) > 0)
  .map((p) => String(p.trait));

/**
 * Оценка постановки — часть сдачи: исполнитель говорит, как ему поставили
 * задачу. Отметка необязательна (`null` — не ставил), слова необязательны;
 * пусто и там, и там — оценки нет. Себе её не ставят: постановщик,
 * равный исполнителю, оценивал бы сам себя. `hidden` — одна скрытость на
 * отметку и слова: скрытую отметку видит только исполнитель-автор,
 * скрытые слова — он и постановщик; умолчание — публично.
 */
const setterRatingOf = (r, { self }) => {
  if (self || !r || typeof r !== "object") return null;
  const n = Number(r.mark);
  const mark = Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
  const comment = String(r.comment || "").trim();
  if (mark == null && !comment) return null;
  return { mark, comment, hidden: !!r.hidden };
};

/** Записывает сдачу — только исполнитель своей задачи. */
export const submitTask = (userId, taskId, submission) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(task.assignee || "") !== String(userId)) return { error: "not yours" };
  /* Сама выданная вещь — файлом, по каждому выходу. Без файла по
     обязательному выходу сдачи не бывает: работа, от которой ждали
     макет, без макета не сделана, сколько бы часов на неё ни ушло. Список
     недостающего — в ответе, чтобы сказать словами, что приложить. */
  const files = Object.fromEntries(
    Object.entries(submission?.files && typeof submission.files === "object"
      ? submission.files : {})
      .map(([k, v]) => [String(k), fileRef(v)])
      .filter(([, v]) => v));
  const func = (model.funcs || []).find((f) => f.id === task.funcId) || null;
  /* ЕДИНИЦЫ: по записи на каждую сданную вещь, со своим содержимым —
     файл, текст или уникальный код. Сколько единиц сдают, столько и
     прикладывают: одна запись на десять штук говорила «десять есть» и
     молчала о том, какие они.

     Прежняя сдача (и бот) присылает один файл на ресурс — она читается
     по-старому: `files`. Требование тогда прежнее — по файлу на каждый
     обязательный выход. */
  const units = unitsIn(submission?.units);
  const proof = fileRef(submission?.proof);
  const missing = requiredGives(func).filter((trait) => (units[trait]
    ? !unitsFilled(units[trait], proof)
    : !files[trait]));
  if (missing.length) return { error: "missing files", missing };
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
    files,
    units,
    proof,
    text: String(submission?.text || ""),
    file: submission?.file || null,
    setterRating: setterRatingOf(submission?.setterRating, {
      self: task.setter == null || task.setter === ""
        || String(task.setter) === String(task.assignee) }),
  }];
  /* Сдал — не значит принято: задача уходит на проверку, как и в интерфейсе.

     Кроме случая, когда исполнитель и проверяющий — один человек: принимать
     не у кого, и задача уходит в готовые сразу. Правило то же, что в
     интерфейсе (`selfReview` в `TasksBoard.jsx`): разойдись они — доска и
     бот показывали бы разное про одну и ту же задачу. */
  const selfReview = task.reviewer == null || task.reviewer === ""
    || String(task.reviewer) === String(task.assignee);
  task.status = selfReview ? "done" : "review";
  await writeModel(model);
  return { task };
});

/** Приём или возврат отчёта — только назначенный проверяющий. */
export const reviewTask = (userId, taskId, { accept, comment, mark, hidden }) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  if (String(roleOf(task, "reviewer") || "") !== String(userId)) return { error: "not yours" };
  /* Возврат — в бэклог, а не «в работу»: задачу надо переставить заново,
     прочитав, что именно доработать. Текст доработки — обязателен.
     ПРИНЯТЬ можно молча: оценка человеку — отдельное дело, своей кнопкой
     «Поставить оценку» (владелец, 2026-09-20), и держать ею приём работы
     больше не надо. */
  if (!accept && !String(comment || "").trim()) return { error: "comment required" };
  const value = Number(mark);
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
    /* Скрытость одна на отметку и слова: скрытую отметку видит только
       автор (в средние она входит — `lib/ratings.js`), скрытые слова —
       автор и исполнитель, которому они адресованы. Публичное после
       публикации видят все, без имени. */
    hidden: !!hidden,
  }];
  if (comment) {
    // Те же слова — и в обсуждение задачи: возврат читают как «что
    // доработать», а не ищут в решениях.
    task.chat = [...(task.chat || []), {
      id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: String(comment), at: new Date().toISOString(), by: String(userId),
      role: "reviewer",
    }];
  }
  await writeModel(model);
  return { task };
});

/** Кто в задаче есть: постановщик, исполнитель, проверяющий. */
const participants = (task) => [task.setter, task.assignee, task.reviewer]
  .filter((v) => v != null && v !== "").map(String);

/**
 * Кого позванному нужно знать по имени: воркеров активов, которые ему
 * видны, и участников его задач. Постановщик выбирает исполнителя и
 * проверяющего из воркеров актива — без имён выбирать было бы не из чего,
 * а список людей организации целиком отдаётся только владельцу.
 * Возвращает идентификаторы; имена к ним подставляет маршрут.
 */
export function peopleOf(view = {}) {
  const out = new Set();
  const add = (list) => (Array.isArray(list) ? list : [])
    .forEach((id) => { if (id != null && id !== "") out.add(String(id)); });
  (view.entities || []).forEach((e) => ["crew", "setters", "owners", "reviewers"]
    .forEach((k) => add(e[k])));
  (view.funcs || []).forEach((f) => ["setters", "owners", "reviewers"].forEach((k) => add(f[k])));
  (view.tasks || []).forEach((t) => participants(t).forEach((id) => out.add(id)));
  return out;
}

/* ─────── постановка ───────

   Постановка — работа постановщика, а не владельца: ROADMAP v1.2, «форма
   постановки — для постановщика». Модель целиком пишет владелец, поэтому
   у постановщика, которого позвали, своя операция — как «взять» у
   исполнителя и приём у проверяющего: иначе его правки жили бы только в
   его окне, а «Поставить» меняло бы статус в памяти и нигде больше.

   Что он меняет: название, содержимое, начало, срок и кем срок поставлен,
   исполнителя и проверяющего — из воркеров актива функции. Постановщика —
   нет: его назначают на схеме, в ролях функции. И только пока задача ждёт
   постановки: поставленная уже у исполнителя, и переписывать ему людей и
   сроки из формы значило бы менять договорённость в одну сторону
   (владелец, если надо, правит модель целиком).

   «Поставить» (`status: "backlog"`) проходит ту же проверку, что кнопка в
   форме (`whyNotSet`): все три роли, срок и ресурсы. Отказ — словами, теми
   же, что видит форма. */
const parseWhen = (v) => {
  if (v == null || v === "") return null;
  const s = String(v);
  return Number.isFinite(Date.parse(s)) ? s : undefined;
};
export const setupTask = (userId, taskId, fields = {}, { isOwner = false, rolesOf = null } = {}) =>
  withModel(async (model) => {
    const task = (model.tasks || []).find((t) => t.id === taskId);
    if (!task) return { error: "not found" };
    if (!isOwner && String(roleOf(task, "setter") || "") !== String(userId)) return { error: "not yours" };
    const f = fields && typeof fields === "object" ? fields : {};
    /* ОТЗЫВ ИЗ БЭКЛОГА (владелец, 2026-09-19): «должна быть возможность
       отозвать те задачи, которые в бэклоге, для редактирования». Задача
       возвращается в «ждут постановки» с пометкой `held` — без неё она
       тут же встала бы обратно сама. Взятую в работу и сданную не
       отзывают: отобрать работу у того, кто её делает, отзыв не вправе. */
    if (task.status !== "wait") {
      const canRecall = f.status === "wait" && ["backlog", "deferred"].includes(task.status)
        && task.taken !== true && !(task.submissions || []).length;
      if (!canRecall) {
        return { error: "already set", why: "Задача уже поставлена — постановка закрыта." };
      }
      task.status = "wait";
      task.held = true;
      task.taken = false;
      task.deferredAt = null;
      task.deferredUntil = null;
      await writeModel(model);
      return { task };
    }
    const patch = {};
    if ("title" in f) patch.title = String(f.title ?? "");
    if ("body" in f) patch.body = String(f.body ?? "");
    for (const k of ["start", "end"]) {
      if (!(k in f)) continue;
      const when = parseWhen(f[k]);
      if (when === undefined) {
        return { error: "bad date", why: `${k === "start" ? "Начало" : "Срок"} — не дата.` };
      }
      patch[k] = when;
    }
    if ("endBy" in f && (f.endBy === "auto" || f.endBy === "hand")) patch.endBy = f.endBy;
    const workers = assetWorkers(model, task);
    const doers = funcExecutors(model, task, rolesOf);
    for (const [k, word] of [["assignee", "Исполнитель"], ["reviewer", "Проверяющий"]]) {
      if (!(k in f)) continue;
      const id = f[k] == null || f[k] === "" ? null : String(f[k]);
      if (id != null && !workers.has(id)) {
        return { error: "not a worker", why: `${word} не из воркеров актива этой функции.` };
      }
      /* Исполнитель — только тот, у кого функция отмечена «может
         выполнять»: то же правило, что в форме постановки. */
      if (k === "assignee" && id != null && !doers.has(id)) {
        return { error: "not an executor",
          why: "Исполнитель не может выполнять эту функцию: нет нужной должности или она ему закрыта исключением." };
      }
      /* «Не менять руку»: в другой задаче процесса эту руку уже держит
         человек — здесь может быть только он. */
      const fixed = id != null ? fixedPerson(model, task, k) : null;
      if (fixed && fixed !== id) {
        return { error: "fixed", why: `${word}: в техпроцессе на эту задачу назначен конкретный сотрудник.` };
      }
      const mate = id != null ? handMate(model, task, k) : null;
      if (mate && mate !== id) {
        return { error: "hand", why: `${word}: «не менять руку» — в этом процессе это уже другой человек.` };
      }
      patch[k] = id;
    }
    if ("status" in f && f.status !== "backlog") {
      return { error: "bad status", why: "Отсюда задача может только встать в бэклог." };
    }
    Object.assign(task, patch);
    if (f.status === "backlog") {
      const why = whyNotSet(task, model);
      if (why) return { error: "not set", why };
      task.status = "backlog";
      task.held = false;
      task.taken = false;
      task.deferredAt = null;
      task.deferredUntil = null;
      /* Момент постановки — час сервера, а не тот, что прислал клиент:
         дату «когда поставлена» (владелец, 2026-09-20) читают все, и
         подсунуть её задним числом со своего телефона нельзя. Отзыв и
         повторная постановка её переписывают: поставлена она заново. */
      task.setAt = new Date().toISOString();
    }
    await writeModel(model);
    return { task };
  });

/* ─────── ОБСУЖДЕНИЕ ЗАДАЧИ ───────

   Разговор постановщика, исполнителя и проверяющего — один на задачу и
   общий (владелец, 2026-09-20). Прежних комментариев с адресатом и
   скрытостью больше нет: скрытое слово в общем разговоре — это не
   разговор, а записка мимо него, и отзывы для этого есть свои.

   Сообщение пишет любой, кому видна задача: её участники и владелец.
   Убрать сказанное нельзя — сказанное сказано. */
/* Роль в разговоре — не аккаунт, а МЕСТО, откуда сказано (владелец,
   2026-09-20): с «Задач» говорит исполнитель, с «Проверки» до постановки
   — постановщик, после — проверяющий. Непрочитанное считается по ролям:
   написал один — остальные видят кружок, даже когда за всех сидит один
   человек. */
export const CHAT_ROLES = ["assignee", "setter", "reviewer"];
const chatRole = (v) => (CHAT_ROLES.includes(String(v)) ? String(v) : "assignee");

export const addMessage = (userId, taskId, { text, role } = {},
  { isOwner = false } = {}) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  const me = String(userId);
  if (!isOwner && !participants(task).includes(me)) return { error: "not yours" };
  const body = String(text || "").trim();
  if (!body) return { error: "text required" };
  const said = chatRole(role);
  const message = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: body, at: new Date().toISOString(), by: me, role: said,
  };
  task.chat = [...(task.chat || []), message];
  /* Сказанное своей ролью непрочитанным быть не может: метка двигается сама. */
  task.seenBy = { ...(task.seenBy || {}), [said]: message.at };
  await writeModel(model);
  return { task, message };
});

/* ─────── ОЦЕНКА ЧЕЛОВЕКУ ───────

   Оценка — не про задачу, а про ЧЕЛОВЕКА в ней: исполнитель оценивает
   постановщика, проверяющий — исполнителя (владелец, 2026-09-20). Пять
   звёзд, отзыв словами и одно решение: публичный он или приватный.

   Публичный виден всем, кто видит задачу; приватный — только тому, кому
   он оставлен, и тому, кто оставил. Себе оценку не ставят: это была бы
   не оценка, а объявление о себе.

   Одна оценка от человека человеку на задачу: вторая ЗАМЕНЯЕТ первую —
   передумал, а не сказал дважды. */
export const rateTask = (userId, taskId, { to, mark, text, pub } = {},
  { isOwner = false } = {}) => withModel(async (model) => {
  const task = (model.tasks || []).find((t) => t.id === taskId);
  if (!task) return { error: "not found" };
  const me = String(userId);
  const people = participants(task);
  if (!isOwner && !people.includes(me)) return { error: "not yours" };
  const whom = String(to ?? "");
  if (!whom || !people.includes(whom)) return { error: "bad addressee" };
  if (whom === me) return { error: "not yourself" };
  const value = Number(mark);
  if (!(value >= 1 && value <= 5)) return { error: "mark required" };
  const row = {
    id: "mk" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(), by: me, to: whom,
    mark: Math.round(value), text: String(text || "").trim(), pub: !!pub,
  };
  task.marks = [...(task.marks || []).filter((m) => !(String(m.by) === me
    && String(m.to) === whom)), row];
  await writeModel(model);
  return { task, mark: row };
});

/** Обсуждение открыли — непрочитанного в нём для этого человека больше нет. */
export const seeChat = (userId, taskId, { role, isOwner = false } = {}) =>
  withModel(async (model) => {
    const task = (model.tasks || []).find((t) => t.id === taskId);
    if (!task) return { error: "not found" };
    const me = String(userId);
    if (!isOwner && !participants(task).includes(me)) return { error: "not yours" };
    task.seenBy = { ...(task.seenBy || {}), [chatRole(role)]: new Date().toISOString() };
    await writeModel(model);
    return { task };
  });
