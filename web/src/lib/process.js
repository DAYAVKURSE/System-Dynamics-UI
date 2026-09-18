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
import { evalPorts, letterIndex, letterOf, lettersIn, parseExpr, toStored } from "./expr.js";

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
/* «(переменная: X)» у ресурса → «(X)» (владелец, 2026-09-18: «вместо слова
   „переменная“ большой пробел — убери»): язык читает обе записи одинаково,
   а прозрачное слово оставляло пустое место в поле. Сотрудника
   «(переменная: сотрудник …)» это не трогает — его читает importText. */
export const stripVarWord = (text = "") =>
  String(text || "").replace(/\(\s*переменная\s*:(?!\s*сотрудник(?:\s|\)))\s*([^()]*?)\s*\)/gi, "($1)");
/* «Если: X, То:» → «Если: X» + строка «То:» (владелец, 2026-09-18: «То»
   переносится на новую строку). */
export const splitThen = (text = "") =>
  String(text || "").replace(/^([ \t]*если\s*:[^\n]*?),?[ \t]*то[ \t]*:?[ \t]*$/gim, "$1\nТо:");
export const tidyProcText = (text = "") => splitThen(stripVarWord(text));
export const normalizeProc = (p = {}) => ({
  ...p,
  id: p.id ?? nextId("pr"),
  name: p.name == null ? "" : String(p.name),
  text: p.text == null ? "" : tidyProcText(String(p.text)),
  status: STATUSES.includes(p.status) ? p.status : "off",
  steps: Array.isArray(p.steps) ? p.steps : [],
  hypo: { entities: ids(p.hypo?.entities), traits: ids(p.hypo?.traits), roles: ids(p.hypo?.roles) },
  missing: { rejected: (Array.isArray(p.missing?.rejected) ? p.missing.rejected : [])
    .map(String) },
  // Версии текста (владелец, 2026-09-18): {id, at, text, note}.
  versions: Array.isArray(p.versions) ? p.versions.filter((v) => v && typeof v.text === "string") : [],
});
export const normalizeProcs = (list) =>
  (Array.isArray(list) ? list.map(normalizeProc) : []);

/** Имя для сравнения: без регистра, лишних пробелов и разницы «е/ё». */
export const nameKey = (s) => String(s ?? "").trim().toLowerCase()
  .replace(/ё/g, "е").replace(/\s+/g, " ");

/** Имя процесса: своё, иначе первая строка текста, иначе «процесс». */
export const procLabel = (p = {}) => String(p.name || "").trim()
  || (String(p.text || "").split("\n").map((l) => l.trim()).find(Boolean) || "")
    .replace(/^(?:функция|задача)\s*:\s*/i, "") || "процесс";

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
    return { mark: "take", markSpan: { start: t.start, end: t.start + m.trimEnd().length },
      rest: { text: t.text.slice(m.length).trim(), start: t.start + m.length, end: t.end } };
  }
  if (GIVE.test(t.text)) {
    const m = t.text.match(GIVE)[0];
    return { mark: "give", markSpan: { start: t.start, end: t.start + m.trimEnd().length },
      rest: { text: t.text.slice(m.length).trim(), start: t.start + m.length, end: t.end } };
  }
  return { mark: null, rest: t };
};
/** Начинается ли строка с метки «берёт:»/«отдаёт:» — тогда она продолжает шаг. */
export const startsWithMark = (line = "") => TAKE.test(String(line).trim()) || GIVE.test(String(line).trim());

/* Ресурс с количеством: «заявки 2» — имя всё до числа, число в конце.
   Количество может быть ОПЕРАЦИЕЙ (владелец, 2026-09-15): «коробки 20%
   @спрос», «оплата 50% A», «оплата 45-55% A» — тем же языком, что у
   целей и портов функции; буква — ресурс этой же строки по порядку
   («A» — первый; латинские заглавные, строчная читается так же). Считается после разбора всей строки (`evalPorts`);
   выражение остаётся у порта (`expr`).

   Где кончается имя и начинается количество: первый пробел, после
   которого хвост читается как выражение (число, скобка, «@», одна
   латинская буква). Хвост из одной буквы, которой в строке ещё нет
   («коробки B» при одном ресурсе), — часть имени: ресурс так назвали;
   кириллическая буква — всегда часть имени. */
const TAIL_START = /^(?:[\d(@=]|[a-zA-Z](?![0-9a-zA-Zа-яА-ЯёЁ]))/;
const PLAIN_NUM = /^\d+(?:[.,]\d+)?$/;
export const splitQty = (text, traits = [], nPrior = 0) => {
  const s = String(text || "").trim();
  const re = /\s+/g;
  let m;
  while ((m = re.exec(s))) {
    const name = s.slice(0, m.index).trim();
    const tail = s.slice(m.index + m[0].length);
    if (!name || !TAIL_START.test(tail)) continue;
    /* «=1» — «ровно» (владелец, 2026-09-18): знак в начале хвоста ничего
       не меняет в счёте, но ставится из списка, а не руками. */
    const core = tail.replace(/^=\s*/, "");
    const stored = toStored(core, traits);
    const p = parseExpr(stored);
    /* Хвост с «@», «%», «=» или начатый как число — операция даже с
       ошибкой (недописанная «5 +»): имя ресурса им не портится, а поле
       показывает, что операция не закончена. */
    if (p.error && (/[%@=]/.test(tail) || /^[\d(]/.test(tail))) return { name, qty: 1, expr: tail };
    if (p.error || !p.ast) { if (tail.startsWith("=")) return { name, qty: 1, expr: tail }; continue; }
    if (lettersIn(stored).some((k) => k >= nPrior) && !/[\d%@(=]/.test(tail)) continue;
    if (PLAIN_NUM.test(core)) return { name, qty: num(core) };
    return { name, qty: 1, expr: tail };
  }
  return { name: s, qty: 1 };
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
  /* `marks` — где стоят «берёт:»/«отдаёт:»; `sides` — от первого слова
     после метки до конца последней пары той же метки: по ним поле рисует
     скобки цветом стороны. */
  const step = { asset: null, role: null, takes: [], gives: [], error: null, marks: [], sides: [] };
  const tokens = tokenize(src).filter((t, i, all) => t.text || i < all.length - 1);
  if (!tokens.length || !tokens[0].text) return { ...step, error: "не назван актив" };
  let state = "asset";
  let side = null;
  let pending = null;   // актив пары, ждущий ресурса
  const order = [];     // порты по порядку появления — им и даются буквы
  let range = null;     // скобка текущей стороны
  for (const raw of tokens) {
    const { mark, markSpan, rest } = splitMark(raw);
    if (mark) {
      if (pending) return { ...step, error: `у «${pending.name}» не назван ресурс` };
      side = mark === "take" ? "takes" : "gives";
      state = "pair";
      step.marks.push({ ...markSpan, side: mark });
      range = { side: mark, start: rest.text ? rest.start : rest.end, end: rest.end };
      step.sides.push(range);
      if (!rest.text) continue;
    }
    const text = rest.text;
    if (!text) continue;
    if (range && state === "pair") { if (range.start > rest.start) range.start = rest.start; range.end = rest.end; }
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
    const { name, qty, expr } = splitQty(text, traits, order.length);
    const t = findTrait(name, pending.id);
    const port = { asset: pending, trait: { name, id: t ? t.id : null,
      span: { start: rest.start, end: rest.start + name.length } }, qty,
      // Всё слово — имя с количеством: одной плашкой в поле.
      span: { start: rest.start, end: rest.end },
      letter: letterOf(order.length), ...(expr ? { expr } : {}) };
    step[side].push(port);
    order.push(port);
    pending = null;
  }
  if (pending) return { ...step, error: `у «${pending.name}» не назван ресурс` };
  if (!step.takes.length && !step.gives.length) {
    return { ...step, error: "не сказано, что берёт и что отдаёт" };
  }
  /* Операции — по всей строке разом: буква ссылается на другой порт, и
     он должен быть посчитан первым. Ошибка остаётся у порта словами. */
  const stockOf = (id) => { const t = traits.find((x) => x.id === id); return t ? (Number(t.have) || 0) : undefined; };
  const res = evalPorts(order.map((p, k) => ({ id: k, lo: p.qty, hi: p.qty,
    expr: p.expr ? toStored(p.expr, traits) : "" })), stockOf);
  order.forEach((p, k) => {
    if (!p.expr) return;
    if (res[k].error) p.exprError = res[k].error;
    else { p.qty = res[k].lo; p.qtyHi = res[k].hi; }
  });
  return step;
}

/**
 * Разбор текста по строкам. Пустые строки пропускаются; у каждой
 * непустой — свой шаг, даже с ошибкой: строку показывают там же, где
 * ошибка, а не отдельным списком в стороне.
 */
/**
 * Шаги из строк текста (владелец, 2026-09-16: «разделение на разные
 * строки по смыслу»): строка, начинающаяся с «берёт:» или «отдаёт:»,
 * продолжает шаг предыдущей строки; строка без метки начинает шаг.
 * Пустая строка шаг закрывает. Строки шага склеиваются через «, » в
 * одну (`text`), и разбор идёт по ней; `rows` помнят, с какого места
 * склейки начинается каждая строка — по ним метки возвращаются в поле.
 */
export function stepsOf(text = "") {
  const groups = [];
  let open = null;
  String(text || "").split("\n").forEach((raw, row) => {
    const src = raw.trim();
    if (!src) { open = null; return; }
    const lead = raw.length - raw.trimStart().length;
    if (open && startsWithMark(src)) {
      open.rows.push({ row, lead, offset: open.text.length + 2, len: src.length });
      open.text += `, ${src}`;
      return;
    }
    open = { line: row + 1, text: src, rows: [{ row, lead, offset: 0, len: src.length }] };
    groups.push(open);
  });
  return groups;
}

export function parseProcess(text = "", model = {}) {
  const steps = [];
  const errors = [];
  stepsOf(text).forEach((g) => {
    const step = { line: g.line, text: g.text, rows: g.rows, ...parseLine(g.text, model) };
    if (step.error) errors.push({ line: g.line, message: step.error });
    steps.push(step);
  });
  return { steps, errors };
}

/** Положение куска склеенной строки шага в исходной строке поля: {row, start, end}. */
export const toRow = (step, start, end) => {
  const rows = step.rows || [{ row: step.line - 1, offset: 0, len: Infinity, lead: 0 }];
  const r = [...rows].reverse().find((x) => start >= x.offset) || rows[0];
  return { row: r.row, lead: r.lead, start: start - r.offset, end: Math.min(end, r.offset + r.len) - r.offset };
};

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
    return { line: s.line, marks: marks.sort((a, b) => a.start - b.start).map((k) => ({ ...k, ...toRow(s, k.start, k.end), start: k.start, end: k.end })), error: s.error || "" };
  });
}

/**
 * Раскраска поля (владелец, 2026-09-16): по исходным строкам — плашки
 * слов с их видом и состоянием и скобки сторон. Координаты — в
 * обрезанной строке (`lead` — её отступ). Актив — плашка как блок на
 * схеме, должность — фиолетовая, ресурс с количеством — одна плашка
 * цветом стороны, ненайденное — красная; «берёт:»/«отдаёт:» — серые.
 * Ошибка строения — у первой строки шага.
 */
export function paintOf(text = "", model = {}, proc = {}) {
  const { steps } = resolveProc({ ...proc, text }, model);
  const rows = new Map();
  const rowOf = (row) => { if (!rows.has(row)) rows.set(row, { row, spans: [], brackets: [], error: "" }); return rows.get(row); };
  steps.forEach((s) => {
    const put = (span, extra) => {
      if (!span) return;
      const at = toRow(s, span.start, span.end);
      rowOf(at.row).spans.push({ start: at.start, end: at.end, lead: at.lead, ...extra });
    };
    const named = (it, kind, side) => it?.span && put(it.span, { kind, side, name: it.name, state: stateOf(it, kind, model, proc) });
    named(s.asset, "asset"); named(s.role, "role");
    (s.marks || []).forEach((m) => put(m, { kind: "mark", side: m.side }));
    (s.sides || []).forEach((r) => {
      if (r.end <= r.start) return;
      const at = toRow(s, r.start, r.end);
      rowOf(at.row).brackets.push({ start: at.start, end: at.end, lead: at.lead, side: r.side });
    });
    [["takes", "take"], ["gives", "give"]].forEach(([list, side]) => (s[list] || []).forEach((p) => {
      named(p.asset, "asset", side);
      if (p.span) put(p.span, { kind: "trait", side, name: p.trait?.name, letter: p.letter,
        state: stateOf(p.trait, "trait", model, proc), exprError: p.exprError || "" });
    }));
    if (s.error) rowOf(s.line - 1).error = s.error;
    (s.rows || []).forEach((r) => rowOf(r.row));
  });
  return [...rows.values()].map((r) => ({ ...r, spans: r.spans.sort((a, b) => a.start - b.start) }));
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
const letterIndexOf = (p) => { const k = LETTER_LIST.indexOf(p.letter); return k < 0 ? 0 : k; };
const LETTER_LIST = Array.from({ length: 26 }, (_, i) => letterOf(i));
export function procFuncs(proc = {}, model = {}) {
  if (proc.status === "off") return [];
  const { steps } = resolveProc(proc, model);
  const label = `процесс: ${procLabel(proc)}`;
  const ok = (it, kind) => stateOf(it, kind, model, proc) === "ok";
  return steps.filter((s) => !s.error && ok(s.asset, "asset") && (!s.role || ok(s.role, "role"))
    && [...s.takes, ...s.gives].every((p) => ok(p.asset, "asset") && ok(p.trait, "trait")))
    .map((s) => {
      /* Буквы строки → идентификаторы портов функции: буква в тексте —
         по порядку появления, у функции — по идентификатору (`#{id}`),
         чтобы карточка показывала свою букву, а смысл не менялся. */
      const pid = (p, j, side) => `p_${proc.id}_${s.line}_${side}${j}`;
      const byLetter = [];
      s.takes.forEach((p, j) => { byLetter[letterIndexOf(p)] = pid(p, j, "t"); });
      s.gives.forEach((p, j) => { byLetter[letterIndexOf(p)] = pid(p, j, "g"); });
      const port = (p, j, side) => ({
        id: pid(p, j, side), trait: p.trait.id, lo: p.qty, hi: p.qtyHi ?? p.qty,
        ...(p.expr ? { expr: toStored(p.expr, model.traits || [], byLetter) } : {}),
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
export function syncProcFuncs(funcs = [], procs = [], model = {}, normalize = (f) => f, build = procFuncs) {
  const alive = new Set(procs.filter((p) => p.status !== "off").map((p) => p.id));
  const was = new Map(funcs.filter((f) => f.proc).map((f) => [f.id, f]));
  const rest = funcs.filter((f) => !f.proc);
  const built = procs.filter((p) => alive.has(p.id))
    .flatMap((p) => build(p, model))
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
  trait: "что (ресурс)",
  qty: "сколько — число, диапазон 45-55, доля другого ресурса «50% A», «20% @ресурс»",
};

/**
 * Что ожидается у курсора и с какого места набранное заменяется именем.
 * Считается по словам строки ДО курсора: актив → должность → метка →
 * пары «откуда, что» → «отдаёт:» → пары «куда, что». Слово с курсором —
 * `query`; `assetName` — актив пары, чтобы подсказать его ресурсы.
 *
 * @returns {{kind, start, query, assetName}}
 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* Имя ресурса в начале набранного и пробел за ним: «оплата 50% » → хвост
   «50% ». Без регистра, «е/ё» равны, пробелы — сколько угодно. */
const nameThenTail = (q, name) => {
  const re = new RegExp(`^\\s*${escapeRe(name).replace(/[её]/gi, "[еёЕЁ]").replace(/\\?\s+/g, "\\s+")}(\\s+)([\\s\\S]*)$`, "i");
  const m = q.match(re);
  return m ? { tail: m[2], tailAt: q.length - m[2].length } : null;
};

export function hintAt(text = "", at = 0, model = {}) {
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
  const prior = [];   // ресурсы шага до курсора — им уже даны буквы
  /* Строка с меткой продолжает шаг: сперва проходим строки шага выше
     (до строки без метки включительно), потом слова этой строки. */
  const above = [];
  if (startsWithMark(line)) {
    const rowsAbove = text.slice(0, lineStart).split("\n").slice(0, -1);
    for (let i = rowsAbove.length - 1; i >= 0; i -= 1) {
      const l = rowsAbove[i];
      if (!l.trim()) break;
      above.unshift(l);
      if (!startsWithMark(l)) break;
    }
  }
  const step = (raw) => {
    const { mark, rest } = splitMark(raw);
    if (mark) { side = mark; state = "pair"; pending = null; if (!rest.text) return; }
    if (!rest.text) return;
    if (state === "asset") state = "role";
    else if (state === "role") state = "mark";
    else if (state === "mark") state = "mark";
    else if (!pending) pending = rest.text;
    else {
      const { name } = splitQty(rest.text, model.traits || [], prior.length);
      prior.push({ letter: letterOf(prior.length), name, asset: pending });
      pending = null;
    }
  };
  above.forEach((l) => tokenize(l).forEach(step));
  tokens.slice(0, idx).forEach(step);
  // Слово с курсором могло начаться с метки: тогда ждут актив после неё.
  const { mark, rest } = splitMark(cur);
  let start = cur.start;
  let queryText = cur.text;
  if (mark && caret >= rest.start) {
    side = mark; state = "pair"; pending = null;
    // Пробелы после метки — не часть набранного: подстановка их не съедает.
    start = rest.start + (line.slice(rest.start, caret).match(/^\s*/) || [""])[0].length;
    queryText = rest.text;
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
  /* Имя ресурса набрано и за ним пробел — дальше ждут КОЛИЧЕСТВО (владелец,
     2026-09-15: операции — прямо в поле, с подсказками). Имя узнаётся по
     ресурсам актива пары; незнакомое — по хвосту, который читается как
     выражение из того, что в строке уже есть. Подсказка подставляет не
     весь хвост, а слово у курсора: после «50% » — букву, после «@» — имя. */
  if (kind === "trait") {
    const q = line.slice(start, caret);
    const entities = model.entities || [], traits = model.traits || [];
    const asset = entities.find((e) => nameKey(e.name) === nameKey(pending));
    const own = (asset ? traits.filter((t) => t.e === asset.id) : [])
      .map((t) => String(t.l)).sort((a, b) => b.length - a.length);
    let hit = null;
    let traitName = "";
    /* Хвост после известного имени — количество, если начинается с числа,
       скобки, «@» или буквы ресурса, который в строке уже есть: «заявки в»
       при одном ресурсе — ещё имя, «заявки 45-» — уже количество. */
    const qtyStart = (tail) => !tail || /^[\d(@%]/.test(tail)
      || (TAIL_START.test(tail) && letterIndex(tail[0]) < prior.length);
    for (const n of own) {
      const h = nameThenTail(q, n);
      if (h && qtyStart(h.tail)) { hit = h; traitName = n; break; }
    }
    if (!hit) {
      const m = q.match(/^(.*?\S)(\s+)([\s\S]*)$/);
      if (m && !m[3]) {
        // Имя (любое, хоть новое) и пробел за ним — уже ждут количество.
        hit = { tail: "", tailAt: q.length }; traitName = m[1].trim();
      } else if (m && TAIL_START.test(m[3])) {
        const stored = toStored(m[3], traits);
        const p = parseExpr(stored);
        if (!p.error && p.ast && lettersIn(stored).every((k) => k < prior.length)) {
          hit = { tail: m[3], tailAt: q.length - m[3].length }; traitName = m[1].trim();
        }
      }
    }
    if (hit) {
      const tail = hit.tail;
      const cut = Math.max(...[" ", "%", "*", "/", "+", "-", "(", ")"].map((ch) => tail.lastIndexOf(ch)));
      const atPos = tail.lastIndexOf("@");
      const sub = atPos >= 0 && atPos > cut ? atPos : cut + 1;
      const subStart = start + hit.tailAt + sub;
      return { kind: "qty", start: lineStart + subStart, query: line.slice(subStart, caret),
        assetName: pending, traitName, prior, raw: tail, nameStart: lineStart + start };
    }
  }
  return { kind, start: lineStart + start, query, assetName: pending, raw: queryText, prior };
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
  } else if (hint.kind === "qty") {
    /* Количество: буквы ресурсов строки (что за буквой — рядом), после
       «@» — ресурсы всей схемы, и знаки. Буква и имя заменяют слово у
       курсора без запятой; знак вставляется как есть. */
    const q0 = String(hint.query || "");
    if (q0.startsWith("@")) {
      const assetOf = (t) => entities.find((e) => e.id === t.e)?.name || "";
      items = traits.filter((t) => t.l).map((t) => ({ name: `@${t.l}`, kind: "ресурс",
        note: assetOf(t), suffix: "", fresh: fresh("traits", t.id) }));
    } else {
      items = (hint.prior || []).map((p) => ({ name: p.letter, kind: "буква",
        note: `${p.name} (${p.asset})`, suffix: "" }));
      /* Имя могло быть не дописано («заявки » → «заявки в работе»): ресурсы
         актива пары, начинающиеся с набранного, остаются в списке и
         подставляются целиком, с самого имени. */
      if (!q0 && hint.traitName) {
        const asset = entities.find((e) => nameKey(e.name) === nameKey(hint.assetName));
        const own = asset ? traits.filter((t) => t.e === asset.id) : [];
        const head = `${nameKey(hint.traitName)} `;
        own.filter((t) => nameKey(t.l).startsWith(head)).forEach((t) =>
          items.push({ name: t.l, kind: "ресурс", whole: true, fresh: fresh("traits", t.id) }));
      }
      items.push(...[["%", "процент"], ["@", "ресурс схемы"], ["-", "диапазон: 45-55"], ["*", ""], ["/", ""],
        ["+", ""], ["(", ""], [")", ""]].map(([name, note]) => ({ name, kind: "знак", note, suffix: "", insert: true })));
      // Количество набрано (или не нужно — тогда 1): запятая к следующему ресурсу.
      items.push({ name: "→", kind: "дальше", note: "запятая — к следующему ресурсу", insert: true,
        text: ",", suffix: " ", trimBefore: true });
    }
  }
  const seen = new Set();
  items = items.filter((it) => { const k = nameKey(it.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const starts = items.filter((it) => it.insert || !q || nameKey(it.name).startsWith(q));
  const inside = items.filter((it) => !it.insert && q && !nameKey(it.name).startsWith(q) && nameKey(it.name).includes(q));
  const list = [...starts, ...inside];
  return [...list.filter((it) => it.fresh), ...list.filter((it) => !it.fresh)];
}

/**
 * Замена имени в тексте — в тех строках, где оно стоит, и только в роли,
 * в которой стояло: актив на актив, должность на должность, ресурс на
 * ресурс. Меняется само слово на своём месте (по `span`): строки,
 * разбитые по смыслу, остаются как их набрал человек.
 */
export function replaceName(text = "", kind, oldName, newName) {
  const key = nameKey(oldName);
  const { steps } = parseProcess(text);
  const lines = String(text || "").split("\n");
  const edits = [];   // {row, start, end} в исходной строке (с отступом)
  steps.forEach((s) => {
    if (s.error) return;
    const hit = (it) => it && nameKey(it.name) === key;
    const put = (it) => { const at = toRow(s, it.span.start, it.span.end); edits.push({ row: at.row, start: at.lead + at.start, end: at.lead + at.end }); };
    if (kind === "asset") { if (hit(s.asset)) put(s.asset); [...s.takes, ...s.gives].forEach((p) => hit(p.asset) && put(p.asset)); }
    if (kind === "role" && hit(s.role)) put(s.role);
    if (kind === "trait") [...s.takes, ...s.gives].forEach((p) => hit(p.trait) && put(p.trait));
  });
  edits.sort((a, b) => (a.row - b.row) || (b.start - a.start)).forEach((e) => {
    lines[e.row] = `${lines[e.row].slice(0, e.start)}${newName}${lines[e.row].slice(e.end)}`;
  });
  return lines.join("\n");
}
