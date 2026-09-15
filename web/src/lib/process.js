/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · что за чем следует

   Владелец описывает процесс ТЕКСТОМ, строка за строкой — так он просил
   с самого начала («я буквально должен вводить текст, а он должен
   выдавать подсказки»), и порядок слов в строке назвал сам (2026-09-13):

     Актив, Должность, берёт: Откуда, Что [сколько], Откуда, Что …,
                        отдаёт: Куда, Что [сколько], Куда, Что …

   Слова разделяются запятыми; «берёт:» и «отдаёт:» — метки, с которых
   начинаются входы и выходы (двоеточие не обязательно; «даёт»/«выдаёт»
   читаются как «отдаёт»). Должность можно пропустить — тогда сразу
   «берёт:». Число после имени ресурса — количество, без него 1. Имена
   сравниваются без регистра, лишних пробелов и разницы «е/ё».

   Подсказки — всплывающим окном у поля (`hintAt`): что ожидается на месте
   курсора (актив, должность, откуда, что, куда) и список имён, из которого
   можно выбрать — или ввести своё. Введённое имя, которого на схеме нет,
   не ошибка: так процесс и придумывают. Такое имя показано пунктиром, и
   человек либо принимает его (заводится с пометкой `hypo`; должность —
   на сервере), либо отклоняет.

   ТЕКСТ — ЕДИНСТВЕННЫЙ ИСТОЧНИК. Из него строятся ФУНКЦИИ (по одной на
   строку, в активе строки), и они кладутся в `funcs` наравне с остальными:
   так схема их рисует, карточка актива показывает, а расчёт считает без
   отдельного пути «для процессов». Функция помечена `proc` — по этой
   пометке её пересобирают при правке текста и убирают, когда процесс не
   принят. Вход берётся из ресурса названного актива, выход кладётся в
   ресурс названного актива: ресурс принадлежит активу (`traits[].e`), и
   передача между активами на схеме читается именно по этому.

   ─── три состояния ───

   `off`  — не принято: функций от процесса нет, гипотетические сущности
            убраны;
   `hypo` — принято гипотетически: функции есть, но расчёт берёт их только
            с галочкой «включить гипотезы» (`activeFuncs` в lib/funcs.js);
   `on`   — принято: считается всегда.

   ─── запись ───

   { id, name, text, status,
     steps: [{ line, asset:{id,name}, role:{id,name}|null,
               takes: [{ asset:{id,name}, trait:{id,name}, qty }],
               gives: [{ asset:{id,name}, trait:{id,name}, qty }] }],
     hypo: { entities:[id], traits:[id], roles:[id] },
     missing: { rejected:[имя] } }

   `steps` — разбор текста с найденными id на момент последней правки.
   Хранится ради двух вещей: переименованная на схеме сущность остаётся
   найденной (id помнит, чего имя уже не знает), а удалённая — видна как
   удалённая, а не как никогда не существовавшая: ей просят замену.
   ════════════════════════════════════════════════════════════════ */

let seq = 0;
import { evalExpr, toStored } from "./expr.js";

const nextId = (prefix) => {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
};
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => x != null))] : []);

export const PROC_STATUS = [
  ["off", "Не принято"],
  ["hypo", "Принято гипотетически"],
  ["on", "Принято"],
];
const STATUSES = PROC_STATUS.map(([id]) => id);

export const newProc = () => ({
  id: nextId("pr"),
  name: "",
  text: "",
  status: "off",
  steps: [],
  hypo: { entities: [], traits: [], roles: [] },
  missing: { rejected: [] },
});

/** Достраивает запись до нынешней; молчание прежних записей — «не принято». */
export const normalizeProc = (p = {}) => ({
  ...p,
  id: p.id ?? nextId("pr"),
  name: p.name == null ? "" : String(p.name),
  text: p.text == null ? "" : String(p.text),
  status: STATUSES.includes(p.status) ? p.status : "off",
  steps: Array.isArray(p.steps) ? p.steps : [],
  hypo: { entities: ids(p.hypo?.entities), traits: ids(p.hypo?.traits), roles: ids(p.hypo?.roles) },
  missing: { rejected: (Array.isArray(p.missing?.rejected) ? p.missing.rejected : [])
    .map(String) },
});
export const normalizeProcs = (list) =>
  (Array.isArray(list) ? list.map(normalizeProc) : []);

/** Имя для сравнения: без регистра, лишних пробелов и разницы «е/ё». */
export const nameKey = (s) => String(s ?? "").trim().toLowerCase()
  .replace(/ё/g, "е").replace(/\s+/g, " ");

/** Имя процесса: своё, иначе первая строка текста, иначе «процесс». */
export const procLabel = (p = {}) => String(p.name || "").trim()
  || String(p.text || "").split("\n").map((l) => l.trim()).find(Boolean) || "процесс";

/* ─────── разбор ─────── */

// Не `\b`: граница слова в JS знает только латиницу, и после «т» её нет.
const TAKE = /^бер[её]т:?\s*/i;
const GIVE = /^(?:отда|выда|да)[её]т:?\s*/i;
export const MARK_TAKE = "берёт:";
export const MARK_GIVE = "отдаёт:";
const num = (s) => Number(String(s).replace(",", "."));

/** Слова строки с их положением: делятся запятыми; запятая перед цифрой — десятичная. */
export function tokenize(line = "") {
  const out = [];
  let start = 0;
  for (let i = 0; i <= line.length; i += 1) {
    const end = i === line.length;
    if (end || (line[i] === "," && !/\d/.test(line[i + 1] || ""))) {
      const raw = line.slice(start, i);
      const lead = raw.length - raw.trimStart().length;
      out.push({ text: raw.trim(), start: start + lead, end: i });
      start = i + 1;
    }
  }
  return out;
}

/* Слово может нести метку («берёт: Рынок услуг»): метка отделяется, а
   остаток — уже имя. Так строка читается как речь, а не как таблица. */
const splitMark = (t) => {
  if (TAKE.test(t.text)) {
    const m = t.text.match(TAKE)[0];
    return { mark: "take", rest: { text: t.text.slice(m.length).trim(), start: t.start + m.length, end: t.end } };
  }
  if (GIVE.test(t.text)) {
    const m = t.text.match(GIVE)[0];
    return { mark: "give", rest: { text: t.text.slice(m.length).trim(), start: t.start + m.length, end: t.end } };
  }
  return { mark: null, rest: t };
};

/* Ресурс с количеством: «заявки 2» — имя всё до числа, число в конце.
   Количество может быть ОПЕРАЦИЕЙ (владелец, 2026-09-15): «коробки 20%
   @спрос» — тем же языком, что у целей и портов функции; считается по
   нынешним остаткам, выражение остаётся у порта (`expr`). Хвост, похожий
   на операцию, но не посчитавшийся (ресурс не найден), отделяется от
   имени всё равно — иначе он стал бы частью имени ресурса. */
const splitQty = (text, traits = []) => {
  const m = text.match(/^(.*?\S)\s+([\d(@].*)$/);
  if (m && /[\d@]/.test(m[2])) {
    const r = evalExpr(toStored(m[2], traits),
      (id) => { const t = traits.find((x) => x.id === id); return t ? (Number(t.have) || 0) : undefined; });
    if (!r.error && r.value != null) return { name: m[1].trim(), qty: r.value, expr: m[2] };
    if (/[%@]/.test(m[2])) return { name: m[1].trim(), qty: 1, expr: m[2], exprError: r.error || "не посчиталось" };
  }
  const n = text.match(/^(.*\S)\s+(\d+(?:[.,]\d+)?)$/);
  return n ? { name: n[1].trim(), qty: num(n[2]) } : { name: text.trim(), qty: 1 };
};

/**
 * Разбор строки. Слова по порядку: актив, должность (необязательно),
 * «берёт:» и пары «откуда, что», «отдаёт:» и пары «куда, что». Имена
 * ищутся среди активов, должностей и ресурсов названного актива;
 * ненайденное остаётся с `id: null` — это вопрос человеку, не ошибка.
 * Ошибка — только строение: пара без второго слова, слово там, где ждут
 * метку.
 */
export function parseLine(src, { entities = [], traits = [], positions = [] } = {}) {
  const findEntity = (name) => entities.find((e) => nameKey(e.name) === nameKey(name)) || null;
  const findRole = (name) => positions.find((r) => nameKey(r.name) === nameKey(name)) || null;
  /* Ресурс — только в названном активе пары: актив неизвестен — и ресурс
     неизвестен (одноимённый в другом активе — чужой), а если актив был
     переименован, память записи (`resolveProc`) найдёт обоих по именам. */
  const findTrait = (name, assetId) => (assetId
    ? traits.find((t) => t.e === assetId && nameKey(t.l) === nameKey(name)) || null : null);
  const step = { asset: null, role: null, takes: [], gives: [], error: null };
  const tokens = tokenize(src).filter((t, i, all) => t.text || i < all.length - 1);
  if (!tokens.length || !tokens[0].text) return { ...step, error: "не назван актив" };
  let state = "asset";
  let side = null;
  let pending = null;   // актив пары, ждущий ресурса
  for (const raw of tokens) {
    const { mark, rest } = splitMark(raw);
    if (mark) {
      if (pending) return { ...step, error: `у «${pending.name}» не назван ресурс` };
      side = mark === "take" ? "takes" : "gives";
      state = "pair";
      if (!rest.text) continue;
    }
    const text = rest.text;
    if (!text) continue;
    // `span` — где слово стоит в строке: по нему поле подсвечивает
    // ненайденное красным прямо в тексте.
    const span = { start: rest.start, end: rest.end };
    if (state === "asset") {
      const e = findEntity(text);
      step.asset = { name: text, id: e ? e.id : null, span };
      state = "role";
      continue;
    }
    if (state === "role") {
      const r = findRole(text);
      step.role = { name: text, id: r ? r.id : null, span };
      state = "mark";
      continue;
    }
    if (state === "mark") return { ...step, error: `после должности ждут «берёт:» или «отдаёт:», а не «${text}»` };
    // pair: откуда/куда, затем что
    if (!pending) {
      const e = findEntity(text);
      pending = { name: text, id: e ? e.id : null, span };
      continue;
    }
    const { name, qty, expr, exprError } = splitQty(text, traits);
    const t = findTrait(name, pending.id);
    step[side].push({ asset: pending, trait: { name, id: t ? t.id : null,
      span: { start: rest.start, end: rest.start + name.length } }, qty,
      // Где в строке стоит количество (после имени, до конца слова): по
      // нему форма операций подменяет его, не трогая остального.
      qtySpan: { start: rest.start + name.length, end: rest.end },
      ...(expr ? { expr } : {}), ...(exprError ? { exprError } : {}) });
    pending = null;
  }
  if (pending) return { ...step, error: `у «${pending.name}» не назван ресурс` };
  if (!step.takes.length && !step.gives.length) {
    return { ...step, error: "не сказано, что берёт и что отдаёт" };
  }
  return step;
}

/**
 * Разбор текста по строкам. Пустые строки пропускаются; у каждой
 * непустой — свой шаг, даже с ошибкой: строку показывают там же, где
 * ошибка, а не отдельным списком в стороне.
 */
export function parseProcess(text = "", model = {}) {
  const steps = [];
  const errors = [];
  String(text || "").split("\n").forEach((raw, i) => {
    const src = raw.trim();
    if (!src) return;
    const line = i + 1;
    const step = { line, text: src, ...parseLine(src, model) };
    if (step.error) errors.push({ line, message: step.error });
    steps.push(step);
  });
  return { steps, errors };
}

const qtyText = (q) => (q === 1 ? "" : ` ${String(q).replace(".", ",")}`);
/** Строка в каноническом виде — ею заменяют строку, где поменяли имя. */
export const formatStep = (s) => {
  const parts = [s.asset?.name || ""];
  if (s.role?.name) parts.push(s.role.name);
  // Операция остаётся операцией: «коробки 20% @спрос», а не посчитанное число.
  const pairs = (list) => list.map((p) => `${p.asset?.name || ""}, ${p.trait?.name || ""}${p.expr ? ` ${p.expr}` : qtyText(p.qty)}`);
  if ((s.takes || []).length) parts.push(`${MARK_TAKE} ${pairs(s.takes).join(", ")}`);
  if ((s.gives || []).length) parts.push(`${MARK_GIVE} ${pairs(s.gives).join(", ")}`);
  return parts.join(", ");
};

/* ─────── разбор с памятью записи ─────── */

/**
 * Разбор текста поверх прежних `steps` процесса: имя, которое сейчас не
 * находится, получает id из прежнего разбора. Так переименованная на схеме
 * сущность остаётся своей, а удалённая — видна удалённой (`stateOf`).
 */
export function resolveProc(proc = {}, model = {}) {
  const now = parseProcess(proc.text, model);
  const prev = { asset: new Map(), role: new Map(), trait: new Map() };
  const traitKey = (assetName, name) => `${nameKey(assetName)}|${nameKey(name)}`;
  (proc.steps || []).forEach((s) => {
    if (s.asset?.id) prev.asset.set(nameKey(s.asset.name), s.asset.id);
    if (s.role?.id) prev.role.set(nameKey(s.role.name), s.role.id);
    [...(s.takes || []), ...(s.gives || [])].forEach((p) => {
      if (p.asset?.id) prev.asset.set(nameKey(p.asset.name), p.asset.id);
      if (p.trait?.id) prev.trait.set(traitKey(p.asset?.name, p.trait.name), p.trait.id);
    });
  });
  const fill = (it, map, key) => (it && !it.id && map.has(key) ? { ...it, id: map.get(key) } : it);
  const port = (p) => ({ ...p,
    asset: fill(p.asset, prev.asset, nameKey(p.asset?.name)),
    trait: fill(p.trait, prev.trait, traitKey(p.asset?.name, p.trait?.name)) });
  const steps = now.steps.map((s) => ({
    ...s,
    asset: fill(s.asset, prev.asset, nameKey(s.asset?.name)),
    role: fill(s.role, prev.role, nameKey(s.role?.name)),
    takes: s.takes.map(port),
    gives: s.gives.map(port),
  }));
  return { steps, errors: now.errors };
}

/**
 * Записать операцию в строку текста: количество порта (число или прежнее
 * выражение) заменяется на `expr` — по положению в строке, остальное не
 * трогается. Пустое `expr` — количество убирается (значит 1). Текст —
 * единственный источник, и форма операций правит именно его.
 */
export function setPortQty(text = "", lineNo, side, index, expr, model = {}) {
  const lines = String(text || "").split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    n += 1;
    if (n !== lineNo) continue;
    const raw = lines[i];
    const lead = raw.length - raw.trimStart().length;
    const step = parseLine(raw.trim(), model);
    const p = (step[side] || [])[index];
    if (!p?.qtySpan) return text;
    const tail = String(expr || "").trim();
    const { start, end } = p.qtySpan;
    lines[i] = `${raw.slice(0, lead + start)}${tail ? ` ${tail}` : ""}${raw.slice(lead + end)}`;
    return lines.join("\n");
  }
  return text;
}

/**
 * Красные метки для поля (владелец, 2026-09-15: «пропущенные при вводе
 * сущности должны вставляться в это поле в виде красных меток»): по
 * строкам — где стоят ненайденные, отклонённые и удалённые имена (их
 * место в строке) и что в строке пропущено (ошибка строения словами).
 * Разбор — с памятью записи (`resolveProc`): переименованное на схеме
 * красным не метится.
 */
export function marksOf(text = "", model = {}, proc = {}) {
  const { steps } = resolveProc({ ...proc, text }, model);
  return steps.map((s) => {
    const marks = [];
    const add = (it, kind) => {
      if (!it?.span) return;
      const st = stateOf(it, kind, model, proc);
      if (st !== "ok" && st !== "empty") marks.push({ ...it.span, state: st, name: it.name, kind });
    };
    add(s.asset, "asset"); add(s.role, "role");
    [...(s.takes || []), ...(s.gives || [])].forEach((p) => {
      add(p.asset, "asset"); add(p.trait, "trait");
      if (p.exprError) marks.push({ start: p.trait.span.end, end: p.trait.span.end, state: "expr", name: p.exprError });
    });
    return { line: s.line, marks: marks.sort((a, b) => a.start - b.start), error: s.error || "" };
  });
}

/**
 * Что с именем: найдено, удалено со схемы, отклонено или неизвестно.
 * Четыре состояния — четыре разных действия у человека, и различать их
 * должен разбор, а не форма.
 */
export function stateOf(item, kind, { entities = [], traits = [], positions = [] } = {}, proc = {}) {
  if (!item) return "empty";
  const list = kind === "asset" ? entities : kind === "role" ? positions : traits;
  if (item.id != null) return list.some((x) => String(x.id) === String(item.id)) ? "ok" : "deleted";
  const rejected = (proc.missing?.rejected || []).map(nameKey);
  return rejected.includes(nameKey(item.name)) ? "rejected" : "unknown";
}

/**
 * Почему процесс нельзя принять — словами, по пунктам. Пусто — можно.
 * Один список на кнопки и подсказку: они не должны спорить.
 */
export function procIssues(proc = {}, model = {}) {
  const { steps, errors } = resolveProc(proc, model);
  const out = errors.map((e) => `строка ${e.line}: ${e.message}`);
  const unknown = [];
  const deleted = [];
  const rejected = [];
  steps.forEach((s) => {
    if (s.error) return;
    const put = (it, kind) => {
      const st = stateOf(it, kind, model, proc);
      if (st === "unknown") unknown.push(it.name);
      if (st === "deleted") deleted.push(it.name);
      if (st === "rejected") rejected.push(it.name);
    };
    put(s.asset, "asset");
    if (s.role) put(s.role, "role");
    [...s.takes, ...s.gives].forEach((p) => { put(p.asset, "asset"); put(p.trait, "trait"); });
  });
  const uniq = (l) => [...new Set(l)];
  if (deleted.length) out.push(`сначала поставьте замену: ${uniq(deleted).join(", ")}`);
  if (unknown.length) out.push(`сначала примите или отклоните: ${uniq(unknown).join(", ")}`);
  if (rejected.length) out.push(`отклонено — исправьте или удалите строку: ${uniq(rejected).join(", ")}`);
  if (!steps.length) out.push("процесс пуст");
  return out;
}
export const canAcceptProc = (proc, model) => procIssues(proc, model).length === 0;

/* ─────── функции из шагов ─────── */

/**
 * По функции на строку, в активе строки. Идентификаторы выводятся из
 * процесса и номера строки: при каждой пересборке функция остаётся той
 * же — и задачи, поставленные на неё, не повисают.
 *
 * Строка, где чего-то нет (неизвестное, отклонённое, удалённое), функции
 * не даёт: у такого шага нечего брать или некуда отдавать.
 *
 * Количество точное — `lo = hi = число`. Должность — исполнителям
 * функции (`posts.owners`). Время выполнения — как у любой новой функции
 * (день): процесс про то, что за чем следует, а не про сроки.
 */
export function procFuncs(proc = {}, model = {}) {
  if (proc.status === "off") return [];
  const { steps } = resolveProc(proc, model);
  const label = `процесс: ${procLabel(proc)}`;
  const ok = (it, kind) => stateOf(it, kind, model, proc) === "ok";
  return steps.filter((s) => !s.error && ok(s.asset, "asset") && (!s.role || ok(s.role, "role"))
    && [...s.takes, ...s.gives].every((p) => ok(p.asset, "asset") && ok(p.trait, "trait")))
    .map((s) => {
      const port = (p, j, side) => ({
        id: `p_${proc.id}_${s.line}_${side}${j}`, trait: p.trait.id, lo: p.qty, hi: p.qty,
      });
      return {
        id: `${proc.id}_${s.line}`,
        e: s.asset.id,
        name: label,
        proc: proc.id,
        takes: s.takes.map((p, j) => port(p, j, "t")),
        gives: s.gives.map((p, j) => port(p, j, "g")),
        dur: 1, durHi: 1, durUnit: "дн",
        accepted: true,
        ...(s.role ? { posts: { owners: [String(s.role.id)] } } : {}),
      };
    });
}

/**
 * Функции процессов — заново по нынешним текстам.
 *
 * Свои поля у собранной прежде функции (положение на схеме, роли
 * постановщика и проверяющего, люди) остаются: их правили в карточке, и
 * текст про них ничего не говорит. Рецепт — что берёт и что отдаёт — и
 * должность исполнителя всегда из текста.
 */
export function syncProcFuncs(funcs = [], procs = [], model = {}, normalize = (f) => f) {
  const alive = new Set(procs.filter((p) => p.status !== "off").map((p) => p.id));
  const was = new Map(funcs.filter((f) => f.proc).map((f) => [f.id, f]));
  const rest = funcs.filter((f) => !f.proc);
  const built = procs.filter((p) => alive.has(p.id))
    .flatMap((p) => procFuncs(p, model))
    .map((f) => {
      const old = was.get(f.id) || {};
      const posts = f.posts ? { ...(old.posts || {}), ...f.posts } : old.posts;
      return normalize({ ...old, ...f, ...(posts ? { posts } : {}) });
    });
  return [...rest, ...built];
}

/**
 * Уборка гипотетических сущностей процесса — когда его сняли или удалили.
 *
 * Уходит только то, чем больше никто не пользуется: ресурс, который взяла
 * или выдаёт чужая функция, остаётся — он уже не гипотеза, а часть
 * схемы. Актив уходит, когда в нём не осталось ни функций, ни ресурсов.
 * Должности не уходят: они — запись организации, а не схемы.
 */
export function dropHypo(proc = {}, { entities = [], traits = [], funcs = [] } = {}) {
  const left = funcs.filter((f) => f.proc !== proc.id);
  const usedTrait = (id) => left.some((f) => (f.takes || []).some((p) => p.trait === id)
    || (f.gives || []).some((p) => p.trait === id));
  const goneT = new Set((proc.hypo?.traits || []).filter((id) => !usedTrait(id)));
  const traits2 = traits.filter((t) => !goneT.has(t.id));
  const goneE = new Set((proc.hypo?.entities || []).filter((id) => !left.some((f) => f.e === id)
    && !traits2.some((t) => t.e === id)));
  return {
    entities: entities.filter((e) => !goneE.has(e.id)),
    traits: traits2,
    funcs: left,
    proc: { ...proc,
      hypo: { ...proc.hypo,
        entities: (proc.hypo?.entities || []).filter((id) => !goneE.has(id)),
        traits: (proc.hypo?.traits || []).filter((id) => !goneT.has(id)) } },
  };
}

/** Задействует ли процесс актив — как актив шага или как сторону входа/выхода. */
export const procUsesAsset = (p = {}, assetId) => assetId != null && (p.steps || []).some((s) =>
  String(s.asset?.id) === String(assetId)
  || [...(s.takes || []), ...(s.gives || [])].some((x) => String(x.asset?.id) === String(assetId)));

/* ─────── подсказки при наборе ─────── */

export const HINT_WORD = {
  asset: "актив",
  role: "должность — или сразу «берёт:»",
  mark: "«берёт:» или «отдаёт:»",
  fromAsset: "откуда берёт (актив) — или «отдаёт:»",
  toAsset: "куда отдаёт (актив)",
  trait: "что (ресурс, можно с числом)",
};

/**
 * Что ожидается у курсора и с какого места набранное заменяется именем.
 * Считается по словам строки ДО курсора: актив → должность → метка →
 * пары «откуда, что» → «отдаёт:» → пары «куда, что». Слово с курсором —
 * `query`; `assetName` — актив пары, чтобы подсказать его ресурсы.
 *
 * @returns {{kind, start, query, assetName}}
 */
export function hintAt(text = "", at = 0) {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEndRaw = text.indexOf("\n", at);
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);
  const tokens = tokenize(line);
  const caret = at - lineStart;
  const idx = Math.max(0, tokens.findIndex((t) => caret <= t.end));
  const cur = tokens[idx] || { text: "", start: caret, end: caret };
  let state = "asset";
  let side = null;
  let pending = null;
  const step = (raw) => {
    const { mark, rest } = splitMark(raw);
    if (mark) { side = mark; state = "pair"; pending = null; if (!rest.text) return; }
    if (!rest.text) return;
    if (state === "asset") state = "role";
    else if (state === "role") state = "mark";
    else if (state === "mark") state = "mark";
    else if (!pending) pending = rest.text;
    else pending = null;
  };
  tokens.slice(0, idx).forEach(step);
  // Слово с курсором могло начаться с метки: тогда ждут актив после неё.
  const { mark, rest } = splitMark(cur);
  let start = cur.start;
  let queryText = cur.text;
  if (mark && caret >= rest.start) {
    side = mark; state = "pair"; pending = null;
    start = rest.start; queryText = rest.text;
  } else if (mark) {
    start = cur.start; queryText = cur.text;
  }
  const query = line.slice(start, caret).trim();
  let kind;
  if (state === "asset") kind = "asset";
  else if (state === "role") kind = "role";
  else if (state === "mark") kind = "mark";
  else if (pending) kind = "trait";
  else kind = side === "take" ? "fromAsset" : "toAsset";
  return { kind, start: lineStart + start, query, assetName: pending, raw: queryText };
}

/**
 * Имена под подсказку: по виду места — активы, должности, ресурсы актива
 * пары; метки там, где их ждут. Сперва по началу набранного, потом по
 * вхождению; заведённое из процесса — первым.
 */
export function suggestNames(hint, { entities = [], traits = [], positions = [] } = {}, proc = {}) {
  if (!hint) return [];
  const q = nameKey(hint.query);
  const fresh = (kind, id) => (proc.hypo?.[kind] || []).includes(id);
  let items = [];
  if (hint.kind === "asset" || hint.kind === "fromAsset" || hint.kind === "toAsset") {
    items = entities.map((e) => ({ name: e.name, kind: "актив", fresh: fresh("entities", e.id) }));
    if (hint.kind === "fromAsset") items.unshift({ name: MARK_GIVE, kind: "метка", mark: true });
  } else if (hint.kind === "role") {
    items = positions.map((r) => ({ name: r.name, kind: "должность", fresh: fresh("roles", r.id) }));
    items.unshift({ name: MARK_TAKE, kind: "метка", mark: true }, { name: MARK_GIVE, kind: "метка", mark: true });
  } else if (hint.kind === "mark") {
    items = [{ name: MARK_TAKE, kind: "метка", mark: true }, { name: MARK_GIVE, kind: "метка", mark: true }];
  } else if (hint.kind === "trait") {
    const asset = entities.find((e) => nameKey(e.name) === nameKey(hint.assetName));
    const own = asset ? traits.filter((t) => t.e === asset.id) : [];
    items = own.map((t) => ({ name: t.l, kind: "ресурс", fresh: fresh("traits", t.id) }));
  }
  const seen = new Set();
  items = items.filter((it) => { const k = nameKey(it.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const starts = items.filter((it) => !q || nameKey(it.name).startsWith(q));
  const inside = items.filter((it) => q && !nameKey(it.name).startsWith(q) && nameKey(it.name).includes(q));
  const list = [...starts, ...inside];
  return [...list.filter((it) => it.fresh), ...list.filter((it) => !it.fresh)];
}

/**
 * Замена имени в тексте — в тех строках, где оно стоит, и только в роли,
 * в которой стояло: актив на актив, должность на должность, ресурс на
 * ресурс. Строка с заменой переписывается в каноническом виде.
 */
export function replaceName(text = "", kind, oldName, newName) {
  const key = nameKey(oldName);
  const { steps } = parseProcess(text);
  const byLine = new Map(steps.map((s) => [s.line, s]));
  return String(text || "").split("\n").map((raw, i) => {
    const s = byLine.get(i + 1);
    if (!s || s.error) return raw;
    const swap = (it) => (it && nameKey(it.name) === key ? { ...it, name: newName } : it);
    const port = (p) => (kind === "asset" ? { ...p, asset: swap(p.asset) }
      : kind === "trait" ? { ...p, trait: swap(p.trait) } : p);
    const next = {
      ...s,
      asset: kind === "asset" ? swap(s.asset) : s.asset,
      role: kind === "role" ? swap(s.role) : s.role,
      takes: s.takes.map(port),
      gives: s.gives.map(port),
    };
    const hit = JSON.stringify(next) !== JSON.stringify(s);
    return hit ? formatStep(next) : raw;
  }).join("\n");
}
