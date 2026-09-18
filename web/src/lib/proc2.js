/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · язык v2 (владелец, 2026-09-18)

   Текст — единственный источник. Строка начинается с МЕТКИ:

     Функция: <название>            — начало функции
     Задача: <название>             — начало задачи (пустая строка между
                                      задачами, две — между функциями)
     Кто: <Должность> ✎ ⚙ ✓ (рука A) — участник; актив — по должности
                                      (у каждого актива свои должности),
                                      справа в поле — пометка актива.
                                      ✎ постановщик, ⚙ исполнитель,
                                      ✓ проверяющий; при выгрузке — словами
                                      «(постановщик, исполнитель)».
                                      «(рука A)» — не менять руку: одна
                                      буква — один и тот же человек.
                                      Несколько «Кто:» подряд — группа;
                                      актив вместо должности — любой его
                                      воркер.
     Берёт: / Берут:  <ресурс> [сколько] [(переменная: X)], …
     Отдаёт: / Отдают: <ресурс> [сколько] [(переменная: X)], …
                                    — шаги в любом порядке и числе.
                                      «сколько» — как у функций: число,
                                      диапазон, «50% A», «20% @ресурс»;
                                      «Сколько: =1» после точки — то же.
                                      «(X)» без слова «переменная» — тоже
                                      переменная; в «Берёт:» — ссылка на
                                      неё.
     Кому: <Должность|Актив>        — куда уходит выданное (после Отдаёт)
     От кого: <Должность|Актив>     — откуда берётся (после Берёт)
     Или: <ресурс> (флаг C)         — иной выход того же шага
     Если: <условие>, То:           — ветка задачи; условие — переменные и
                                      флаги через «И», «ИЛИ», «!»
     Иначе:                         — другая ветка

   Строка без метки: в начале блока — название (функции после двух пустых
   строк, иначе задачи), дальше — продолжение предыдущей метки (ещё один
   «Кто», ещё ресурсы).

   Обязательно немногое: если есть «Кто», должно быть «Берёт» или
   «Отдаёт». Остальное — по умолчанию: без должности задачу берёт любой
   воркер актива; без постановщика ставит исполнитель; без постановщика и
   исполнителя исполняет проверяющий; без всех трёх — любой воркер с этой
   должностью.

   Разбор хранит `span` каждого слова (в строке поля): по ним поле рисует
   плашки, скобки и пометки, а замена имени правит слово на месте.
   ════════════════════════════════════════════════════════════════ */

import { evalPorts, letterOf, toStored } from "./expr.js";
import { nameKey, splitQty } from "./process.js";

export const ICON = { setter: "✎", doer: "⚙", checker: "✓" };
export const ROLE_WORD = { setter: "постановщик", doer: "исполнитель", checker: "проверяющий" };
const ROLE_BY_WORD = { постановщик: "setter", исполнитель: "doer", проверяющий: "checker",
  "✎": "setter", "⚙": "doer", "✓": "checker" };
export const ROLE_KINDS = ["setter", "doer", "checker"];

const LABELS = [
  ["func", ["функция"]], ["task", ["задача"]], ["who", ["кто"]],
  ["take", ["берет", "берут"]], ["give", ["отдает", "отдают", "выдает", "выдают", "дает", "дают"]],
  ["to", ["кому", "куда"]], ["from", ["от кого", "откуда"]], ["or", ["или"]],
  ["if", ["если"]], ["then", ["то"]], ["else", ["иначе"]],
];
const LABEL_KIND = new Map(LABELS.flatMap(([k, ws]) => ws.map((w) => [w, k])));
export const LABEL_TEXT = { func: "Функция:", task: "Задача:", who: "Кто:", take: "Берёт:", takes: "Берут:",
  give: "Отдаёт:", gives: "Отдают:", to: "Кому:", from: "От кого:", or: "Или:", if: "Если:", then: "То:", else: "Иначе:" };

/** Метка строки: {kind, label:{start,end}, rest:{text,start}} или null. */
export function labelOf(line = "") {
  const m = line.match(/^(\s*)([А-Яа-яЁё][А-Яа-яЁё ]{1,10}?)\s*:\s*/);
  if (!m) return null;
  const kind = LABEL_KIND.get(nameKey(m[2]));
  if (!kind) return null;
  const start = m[1].length;
  return { kind, label: { start, end: start + m[2].length + (m[0].slice(m[1].length + m[2].length).indexOf(":") + 1) },
    rest: { text: line.slice(m[0].length), start: m[0].length }, plural: /(ут|ют)$/.test(nameKey(m[2])) };
}

/* Текст v1 («Актив, Должность, берёт: …») отличается тем, что первая
   непустая строка не начинается с метки v2, а метки стоят внутри строки. */
export const isV1 = (text = "") => {
  const first = String(text || "").split("\n").map((l) => l.trim()).find(Boolean);
  if (!first) return false;
  return !labelOf(first) && /,\s*(бер[её]т|отда[её]т|выда[её]т|да[её]т)(?![а-яё])/i.test(first);
};

/* ─────── разбор ─────── */

/* Части строки через запятую вне скобок; запятая перед цифрой — десятичная. */
function splitItems(text, base = 0) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (i === text.length || (ch === "," && depth === 0 && !/\d/.test(text[i + 1] || ""))) {
      const raw = text.slice(start, i);
      const lead = raw.length - raw.trimStart().length;
      const t = raw.trim();
      if (t) out.push({ text: t, start: base + start + lead, end: base + start + lead + t.length });
      start = i + 1;
    }
  }
  return out;
}

/* Скобки в конце слова: «(переменная: X)», «(X)», «(флаг C)», «(рука A)»,
   «(постановщик, исполнитель)». Возвращает имя без них и список групп. */
function takeParens(text, base) {
  const groups = [];
  let name = text;
  const re = /\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(text))) groups.push({ text: m[1].trim(), start: base + m.index, end: base + m.index + m[0].length });
  name = text.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  return { name, groups };
}

const varOf = (g) => {
  const t = g.text.replace(/^переменная\s*:\s*/i, "").trim();
  if (/^рука\s+/i.test(t) || /^сотрудник\s*:?\s+/i.test(t)) return null;
  return t || null;
};
/* Рука — имя переменной сотрудника: «{space bear}» в поле (владелец,
   2026-09-18: имя в цветном прямоугольнике, два слова), при выгрузке —
   «(переменная: сотрудник space bear)»; прежняя запись «(рука A)» читается. */
const handOf = (g) => {
  const m = g.text.match(/^(?:переменная\s*:\s*)?(?:рука|сотрудник)\s+([^)]+)$/i);
  return m && !/^сотрудник\s*:/i.test(g.text) ? m[1].trim().toLowerCase() : null;
};
/* Конкретный сотрудник: «@Имя Фамилия» в поле, «(сотрудник: Имя)» при выгрузке. */
const personOf = (g) => {
  const m = g.text.match(/^сотрудник\s*:\s*(.+)$/i);
  return m ? m[1].trim() : null;
};
const PERSON_RE = /@([^@{}()✎⚙✓,]+)/g;
const BRACE_RE = /\{([^{}]*)\}/g;

/** Участник: «Партнёр-фрилансер ✎ ⚙ (рука A)» или со словами в скобках. */
function parseWho(rest, start, model) {
  const clean = rest.replace(/,\s*$/, "");
  const { name: noParen, groups } = takeParens(clean, start);
  const roles = { setter: false, doer: false, checker: false };
  const marks = [];   // значки/слова ролей, рука, сотрудник — с их местом
  let hand = null, person = null;
  groups.forEach((g) => {
    const pn = personOf(g);
    if (pn) { person = pn; marks.push({ ...g, kind: "person", person: pn }); return; }
    const h = handOf(g);
    if (h) { hand = h; marks.push({ ...g, kind: "hand", hand: h }); return; }
    const words = g.text.split(/[,\s]+/).map((w) => nameKey(w)).filter(Boolean);
    const rs = words.map((w) => ROLE_BY_WORD[w]).filter(Boolean);
    if (rs.length && rs.length === words.length) { rs.forEach((r) => { roles[r] = true; }); marks.push({ ...g, kind: "roles", roles: rs }); }
  });
  let m;
  // «{space bear}» — рука; «@Имя» — конкретный сотрудник.
  BRACE_RE.lastIndex = 0;
  while ((m = BRACE_RE.exec(clean))) {
    const h = m[1].trim().toLowerCase();
    if (h) { hand = h; marks.push({ text: m[0], start: start + m.index, end: start + m.index + m[0].length, kind: "hand", hand: h, brace: true }); }
  }
  const noBrace = clean.replace(BRACE_RE, (x) => " ".repeat(x.length));
  PERSON_RE.lastIndex = 0;
  while ((m = PERSON_RE.exec(noBrace))) {
    const pn = m[1].trim();
    if (pn) { person = pn; marks.push({ text: m[0], start: start + m.index, end: start + m.index + 1 + m[1].trimEnd().length, kind: "person", person: pn, at: true }); }
  }
  // Значки вне скобок.
  let name = noParen.replace(BRACE_RE, " ").replace(PERSON_RE, " ");
  const iconRe = /[✎⚙✓]/g;
  while ((m = iconRe.exec(clean))) {
    const r = ROLE_BY_WORD[m[0]];
    roles[r] = true;
    marks.push({ text: m[0], start: start + m.index, end: start + m.index + 1, kind: "icon", role: r });
  }
  name = name.replace(/[✎⚙✓]/g, " ").replace(/\s+/g, " ").trim();
  const at = clean.indexOf(name);
  const span = { start: start + Math.max(0, at), end: start + Math.max(0, at) + name.length };
  const pos = (model.positions || []).find((p) => nameKey(p.name) === nameKey(name)) || null;
  const asset = pos ? assetOfPosition(pos, model) : (model.entities || []).find((e) => nameKey(e.name) === nameKey(name)) || null;
  const people = model.people || [];
  const who = person ? people.find((x) => nameKey(x.name) === nameKey(person)) || null : null;
  return { name, span, roles, hand, person, personId: who ? String(who.id) : null, marks, pos: pos ? { id: pos.id, name: pos.name } : null,
    asset: asset ? { id: asset.id, name: asset.name } : null, anyWorker: !pos && !!asset };
}

/** Актив должности: `entities[].posts` — у каждого актива свои должности (одна — у одного). */
export function assetOfPosition(pos, { entities = [] } = {}) {
  return entities.find((e) => (e.posts || []).some((id) => String(id) === String(pos.id))) || null;
}

/** Один ресурс шага: имя, сколько, переменная. */
function parseItem(it, traits, nPrior) {
  const { name: noParen, groups } = takeParens(it.text, it.start);
  let vname = null, flag = false, varSpan = null;
  groups.forEach((g) => {
    const v = varOf(g);
    if (!v) return;
    vname = v.replace(/^флаг\s+/i, ""); flag = /^флаг\s+/i.test(v);
    // Где стоит имя внутри скобок — для плашки в поле и меню ресурса.
    const raw = it.text.slice(g.start - it.start, g.end - it.start);
    const at = raw.lastIndexOf(vname);
    varSpan = { start: g.start, end: g.end, inner: { start: g.start + Math.max(1, at), end: g.start + Math.max(1, at) + vname.length } };
  });
  // «оффер. Сколько: =1» — количество отдельной меткой.
  let namePart = noParen, expr = null;
  const sk = noParen.match(/^(.*?)\.?\s*сколько\s*:\s*(.+)$/i);
  if (sk) { namePart = sk[1].trim(); expr = sk[2].trim().replace(/^=\s*/, ""); }
  const sq = expr == null ? splitQty(namePart, traits, nPrior) : { name: namePart, qty: 1, expr };
  const name = sq.name;
  const at = it.text.indexOf(name);
  // Хвост после имени до первой скобки — количество или операция (для меню ресурса и значка в поле).
  let ta = Math.max(0, at) + name.length;
  let tb = Math.max(ta, groups.length ? Math.min(...groups.map((g) => g.start)) - it.start : it.text.length);
  while (ta < tb && /\s/.test(it.text[ta])) ta += 1;
  while (tb > ta && /\s/.test(it.text[tb - 1])) tb -= 1;
  return { name, span: { start: it.start, end: it.end },
    nameSpan: { start: it.start + Math.max(0, at), end: it.start + Math.max(0, at) + name.length },
    tailSpan: { start: it.start + ta, end: it.start + tb }, tail: it.text.slice(ta, tb), varSpan,
    qty: sq.qty, ...(sq.expr ? { expr: sq.expr } : {}), var: vname, flag, ref: !name && !!vname };
}

/**
 * Разбор текста. Возвращает функции с задачами; каждая задача — ветки
 * (одна без условия, или «то»/«иначе»); ветка — участники и шаги.
 */
export function parseText(text = "", model = {}, proc = {}) {
  const rows = String(text || "").split("\n");
  const traits = model.traits || [];
  const funcs = [];
  const errors = [];
  let blanks = 2;          // сколько пустых строк перед этой (в начале — как две)
  let fn = null, task = null, branch = null, last = null, lastStep = null, lastWho = null;
  const newFunc = (name, row) => { fn = { name, row, tasks: [], span: null }; funcs.push(fn); task = null; branch = null; return fn; };
  const newTask = (name, row) => {
    if (!fn) newFunc("", row);
    task = { name, row, branches: [] }; fn.tasks.push(task);
    branch = { cond: null, who: [], steps: [], row }; task.branches.push(branch);
    lastStep = null; lastWho = null;
    return task;
  };
  const ensureBranch = (row) => { if (!branch) newTask("", row); return branch; };
  const err = (row, message) => errors.push({ row, line: row + 1, message });
  rows.forEach((raw, row) => {
    const line = raw;
    const trimmed = line.trim();
    if (!trimmed) { blanks += 1; last = null; return; }
    const lab = labelOf(line);
    const atStart = blanks >= 1;
    const gap = blanks;
    blanks = 0;
    if (lab) {
      const rest = lab.rest.text, rs = lab.rest.start;
      if (lab.kind === "func") { newFunc(rest.trim(), row); fn.span = { start: rs, end: rs + rest.trimEnd().length }; last = "func"; return; }
      if (lab.kind === "task") { if (gap >= 2 && fn && fn.tasks.length) newFunc("", row); newTask(rest.trim(), row); task.span = { start: rs, end: rs + rest.trimEnd().length }; last = "task"; return; }
      if (gap >= 2 && fn && fn.tasks.length && lab.kind !== "else" && lab.kind !== "then") newFunc("", row);
      else if (gap === 1 && task && (lab.kind === "who" || lab.kind === "if")) { task = null; branch = null; }
      /* «То:» — своей строкой после «Если:» (владелец, 2026-09-18); строение
         ветки не меняет, только помнит строку для раскраски и разницы. */
      if (lab.kind === "then") {
        if (!branch || branch.cond == null) { err(row, "«То:» без «Если:» перед ней"); return; }
        branch.thenRow = row;
        last = "then"; lastStep = null; lastWho = null; return;
      }
      const b = ensureBranch(row);
      if (lab.kind === "if") {
        const cond = rest.replace(/,?\s*то\s*:?\s*$/i, "").trim();
        if (b.who.length || b.steps.length || b.cond) { branch = { cond, who: [], steps: [], row }; task.branches.push(branch); }
        else b.cond = cond;
        // Строка условия своя: ветка могла быть заведена строкой «Задача:».
        branch.condSpan = { start: rs, end: rs + rest.length }; branch.condRow = row;
        last = "if"; lastStep = null; lastWho = null; return;
      }
      if (lab.kind === "else") {
        if (!task) { err(row, "«Иначе:» без «Если:»"); return; }
        branch = { cond: null, isElse: true, who: [], steps: [], row }; task.branches.push(branch);
        last = "else"; lastStep = null; lastWho = null; return;
      }
      if (lab.kind === "who") {
        const w = { ...parseWho(rest, rs, model), row };
        branch.who.push(w); lastWho = w; last = "who"; lastStep = null; return;
      }
      if (lab.kind === "take" || lab.kind === "give") {
        const items = splitItems(rest, rs).map((it) => parseItem(it, traits, countItems(branch)));
        const step = { kind: lab.kind, items, row, label: lab.label, plural: lab.plural, or: [], to: null, from: null, tos: [], froms: [],
          span: items.length ? { start: items[0].span.start, end: items[items.length - 1].span.end } : { start: rs, end: rs } };
        branch.steps.push(step); lastStep = step; last = lab.kind; return;
      }
      if (lab.kind === "to" || lab.kind === "from") {
        if (!lastStep) { err(row, `«${LABEL_TEXT[lab.kind]}» без «Берёт:»/«Отдаёт:» перед ней`); return; }
        /* Получатель/отправитель — как участник (владелец, 2026-09-18):
           «{рука}» и «@сотрудник» читаются, роли на этих строках не в счёт. */
        const w = parseWho(rest, rs, model);
        const side = { name: w.name, span: w.span, row, pos: w.pos, asset: w.asset, hand: w.hand, person: w.person, personId: w.personId,
          marks: w.marks.filter((m) => m.kind === "hand" || m.kind === "person") };
        /* Строк «Кому:»/«От кого:» может быть несколько (владелец, 2026-09-18):
           `tos`/`froms` — все, `to`/`from` — первая (для прежнего кода). */
        const list = lab.kind === "to" ? lastStep.tos : lastStep.froms;
        list.push(side);
        if (!lastStep[lab.kind]) lastStep[lab.kind] = side;
        last = lab.kind; return;
      }
      if (lab.kind === "or") {
        if (!lastStep) { err(row, "«Или:» без «Отдаёт:» перед ней"); return; }
        splitItems(rest, rs).forEach((it) => lastStep.or.push({ ...parseItem(it, traits, countItems(branch)), row }));
        last = "or"; return;
      }
      return;
    }
    // Без метки.
    if (atStart || !last) {
      if (gap >= 2 || !fn || (fn.tasks.length === 0 && !fn.name)) {
        if (fn && !fn.name && fn.tasks.length === 0) { fn.name = trimmed; fn.span = { start: line.length - line.trimStart().length, end: line.trimEnd().length }; fn.row = row; }
        else { newFunc(trimmed, row); fn.span = { start: line.length - line.trimStart().length, end: line.trimEnd().length }; }
        last = "func"; return;
      }
      newTask(trimmed, row); task.span = { start: line.length - line.trimStart().length, end: line.trimEnd().length }; last = "task"; return;
    }
    const lead = line.length - line.trimStart().length;
    if (last === "who" && branch) { const w = { ...parseWho(trimmed, lead, model), row }; branch.who.push(w); lastWho = w; return; }
    if ((last === "take" || last === "give") && lastStep) {
      const items = splitItems(trimmed, lead).map((it) => parseItem(it, traits, countItems(branch)));
      items.forEach((it) => { it.row = row; });
      lastStep.items.push(...items);
      return;
    }
    err(row, `не понимаю строку: ждали метку («Кто:», «Берёт:», «Отдаёт:»…)`);
  });
  /* Переменные: имя в «Берёт:» без скобок, совпадающее с переменной,
     объявленной раньше («Берёт: время A»), — ссылка на неё. */
  const vars = new Set();
  funcs.forEach((f) => f.tasks.forEach((t) => t.branches.forEach((b) => b.steps.forEach((s) => {
    [...s.items, ...s.or].forEach((it) => {
      if (s.kind === "take" && it.name && !it.var && vars.has(nameKey(it.name))) { it.var = it.name; it.name = ""; it.ref = true; }
      if (it.var && s.kind === "give") vars.add(nameKey(it.var));
    });
  }))));
  // Буквы и количества — по задаче (все ресурсы всех веток по порядку).
  funcs.forEach((f) => f.tasks.forEach((t) => letterTask(t, model)));
  // Обязательное: «Кто» без «Берёт»/«Отдаёт».
  funcs.forEach((f) => f.tasks.forEach((t) => t.branches.forEach((b) => {
    if (b.who.length && !b.steps.length) err(b.who[0].row, "после «Кто:» нужно «Берёт:» или «Отдаёт:»");
  })));
  return { funcs, errors, rows };
}

const countItems = (branch) => (branch ? branch.steps.reduce((n, s) => n + s.items.length, 0) : 0);

/* Буквы A, B, C… всем ресурсам задачи по порядку; количества — операциями
   по этим буквам (`evalPorts`); ресурс ищется в активе, откуда берётся /
   куда отдаётся. */
function letterTask(task, model) {
  const traits = model.traits || [];
  const stockOf = (id) => { const t = traits.find((x) => x.id === id); return t ? (Number(t.have) || 0) : undefined; };
  const all = [];
  task.branches.forEach((b) => {
    const doer = b.who.find((w) => w.asset) || null;
    b.steps.forEach((s) => {
      const side = s.kind === "take" ? s.from : s.to;
      const asset = side?.asset || doer?.asset || null;
      s.asset = asset;
      [...s.items, ...s.or].forEach((it) => {
        it.letter = letterOf(all.length);
        it.asset = asset;
        const t = asset && it.name ? traits.find((x) => x.e === asset.id && nameKey(x.l) === nameKey(it.name)) : null;
        it.trait = it.name ? { name: it.name, id: t ? t.id : null } : null;
        all.push(it);
      });
    });
  });
  const res = evalPorts(all.map((p, k) => ({ id: k, lo: p.qty, hi: p.qty, expr: p.expr ? toStored(p.expr, traits) : "" })), stockOf);
  all.forEach((p, k) => {
    if (!p.expr) return;
    if (res[k].error) p.exprError = res[k].error;
    else { p.qty = res[k].lo; p.qtyHi = res[k].hi; }
  });
  task.items = all;
}

/* ─────── состояния имён ─────── */

/** Что с должностью/активом «Кто»: найдено, неизвестно, отклонено. */
export function whoState(w, proc = {}) {
  if (w.asset) return "ok";
  if (w.pos) return "noasset";   // должность есть, но ни одному активу не назначена
  const rejected = (proc.missing?.rejected || []).map(nameKey);
  return rejected.includes(nameKey(w.name)) ? "rejected" : "unknown";
}
export function itemState(it, proc = {}, { traits = [] } = {}) {
  if (it.ref) return "ok";
  if (it.trait?.id) return traits.some((t) => t.id === it.trait.id) ? "ok" : "deleted";
  if (!it.asset) return "noasset";
  const rejected = (proc.missing?.rejected || []).map(nameKey);
  return rejected.includes(nameKey(it.name)) ? "rejected" : "unknown";
}

/** Почему нельзя принять — словами. Пусто — можно. */
export function issuesOf(proc = {}, model = {}) {
  const { funcs, errors } = parseText(proc.text, model, proc);
  const out = errors.map((e) => `строка ${e.line}: ${e.message}`);
  const unknownWho = [], unknownRes = [], noAsset = [], rejected = [], noAssetWho = [], unknownPerson = [];
  funcs.forEach((f) => f.tasks.forEach((t) => t.branches.forEach((b) => {
    b.who.forEach((w) => { const st = whoState(w, proc); if (st === "unknown") unknownWho.push(w.name); if (st === "noasset") noAssetWho.push(w.name); if (st === "rejected") rejected.push(w.name);
      if (w.person && !w.personId) unknownPerson.push(w.person); });
    b.steps.forEach((s) => [...s.items, ...s.or].forEach((it) => {
      const st = itemState(it, proc, model);
      if (st === "unknown") unknownRes.push(it.name); if (st === "rejected") rejected.push(it.name); if (st === "noasset") noAsset.push(it.name);
    }));
  })));
  const uniq = (l) => [...new Set(l)];
  if (unknownWho.length) out.push(`нет такой должности или актива: ${uniq(unknownWho).join(", ")} — заведите в «Правах сотрудников» и назначьте активу`);
  if (noAssetWho.length) out.push(`должность без актива: ${uniq(noAssetWho).join(", ")} — отметьте её во вкладке «Воркеры» актива`);
  if (unknownPerson.length) out.push(`нет такого сотрудника: ${uniq(unknownPerson).join(", ")}`);
  if (noAsset.length) out.push(`не понятно, чей ресурс: ${uniq(noAsset).join(", ")} — назовите «Кто:» с должностью актива или «Кому:»/«От кого:»`);
  if (unknownRes.length) out.push(`сначала примите или отклоните: ${uniq(unknownRes).join(", ")}`);
  if (rejected.length) out.push(`отклонено — исправьте или удалите: ${uniq(rejected).join(", ")}`);
  if (!funcs.some((f) => f.tasks.some((t) => t.branches.some((b) => b.steps.length)))) out.push("процесс пуст");
  return out;
}

/* ─────── раскраска поля ─────── */

/**
 * По строкам поля: плашки (`spans`), скобки сторон (`brackets`), пометка
 * справа (`note` — актив у «Кто:»), ошибка строки. Координаты — в строке.
 */
export function paintOf(text = "", model = {}, proc = {}) {
  const { funcs, errors } = parseText(text, model, proc);
  const rows = new Map();
  const rowOf = (row) => { if (!rows.has(row)) rows.set(row, { row, spans: [], brackets: [], note: "", error: "" }); return rows.get(row); };
  const put = (row, span, extra) => span && rowOf(row).spans.push({ start: span.start, end: span.end, ...extra });
  const lines = String(text || "").split("\n");
  lines.forEach((l, row) => { const lab = labelOf(l); if (lab) put(row, lab.label, { kind: "mark", label: lab.kind }); });
  funcs.forEach((f) => {
    if (f.span) put(f.row, f.span, { kind: "func", name: f.name });
    f.tasks.forEach((t) => {
      if (t.span) put(t.row, t.span, { kind: "task", name: t.name });
      t.branches.forEach((b) => {
        if (b.condSpan) put(b.condRow ?? b.row, b.condSpan, { kind: "cond" });
        b.who.forEach((w) => {
          const st = whoState(w, proc);
          // Пустое имя («Кто:» без значения) плашкой не красится — там стоит «?».
          if (w.name) put(w.row, w.span, { kind: w.anyWorker ? "asset" : "role", state: st, name: w.name });
          w.marks.forEach((m) => put(w.row, m, { kind: m.kind === "hand" ? "hand" : m.kind === "person" ? "person" : "roles",
            roles: m.roles || (m.role ? [m.role] : []), hand: m.hand, person: m.person, brace: !!m.brace, at: !!m.at, known: m.kind !== "person" || !!w.personId }));
          if (w.asset && !w.anyWorker) rowOf(w.row).note = w.asset.name;
        });
        b.steps.forEach((s) => {
          const side = s.kind;
          [...s.items, ...s.or].forEach((it) => {
            const r = it.row ?? s.row;
            /* Плашка ресурса — имя и количество; переменная в скобках —
               своей плашкой цветом имени (2026-09-18), ссылка «(X)» — только она. */
            const st = itemState(it, proc, model);
            if (it.name) put(r, { start: it.span.start, end: Math.max(it.nameSpan.end, it.tailSpan?.end ?? 0, it.span.start) },
              { kind: "trait", side, state: st, name: it.name, letter: it.letter, exprError: it.exprError || "",
                nameSpan: it.nameSpan, tailSpan: it.tailSpan, tail: it.tail || "", itemSpan: it.span, varName: it.var || "" });
            if (it.varSpan) put(r, it.varSpan, { kind: "var", side, state: it.ref ? st : "ok", varName: it.var, ref: !!it.ref, flag: !!it.flag,
              inner: it.varSpan.inner, itemSpan: it.span, letter: it.letter });
          });
          if (s.items.length) {
            const byRow = new Map();
            s.items.forEach((it) => { const r = it.row ?? s.row; const cur = byRow.get(r); byRow.set(r, cur ? { start: Math.min(cur.start, it.span.start), end: Math.max(cur.end, it.span.end) } : { ...it.span }); });
            byRow.forEach((sp, r) => rowOf(r).brackets.push({ ...sp, side }));
          }
          [...(s.tos || []), ...(s.froms || [])].forEach((x) => {
            if (!x) return;
            put(x.row, x.span, { kind: "asset", state: x.asset ? "ok" : "unknown", name: x.name });
            (x.marks || []).forEach((m) => put(x.row, m, { kind: m.kind, hand: m.hand, person: m.person, brace: !!m.brace, at: !!m.at,
              known: m.kind !== "person" || !!x.personId }));
          });
        });
      });
    });
  });
  errors.forEach((e) => { rowOf(e.row).error = e.message; });
  return [...rows.values()].map((r) => ({ ...r, spans: r.spans.sort((a, b) => a.start - b.start) }));
}

/** Переименовать переменную ресурса во всём тексте: «(переменная: X)», «(X)», «(флаг X)». */
export function renameVar(text = "", from = "", to = "") {
  const esc = String(from).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!esc) return String(text || "");
  const re = new RegExp(`\\(\\s*((?:переменная\\s*:\\s*|флаг\\s+)?)${esc}\\s*\\)`, "gi");
  return String(text || "").replace(re, (m, pre) => `(${pre}${String(to).trim()})`);
}

/* ─────── подсказки ─────── */

/** Сотрудники должности (или воркеры актива): `people` с `roles`, `rolesOf(id)` — из модели. */
export function peopleOfPosition(posName, model = {}) {
  const { positions = [], people = [], entities = [] } = model;
  const rolesOf = model.rolesOf || ((id) => people.find((p) => String(p.id) === String(id))?.roles || []);
  const pos = positions.find((p) => nameKey(p.name) === nameKey(posName));
  if (pos) return people.filter((p) => (rolesOf(p.id) || []).some((r) => String(r) === String(pos.id)));
  const asset = entities.find((e) => nameKey(e.name) === nameKey(posName));
  if (asset) { const crew = new Set((asset.crew || []).map(String)); return people.filter((p) => crew.has(String(p.id))); }
  return [];
}

export const HINT = {
  label: "начало строки — выберите метку",
  person: "сотрудник должности — именно он будет выполнять",
  who: "кто — должность (актив подставится сам) или актив (любой его воркер)",
  trait: "что — ресурс; после имени через пробел — сколько",
  qty: "сколько — число, диапазон 45-55, доля другого ресурса «50% A», «20% @ресурс»",
  to: "кому — должность или актив",
  from: "от кого — должность или актив",
  cond: "условие — переменные, флаги, сравнения: «время B > 5 И !флаг C», в конце «, То:»",
  name: "название",
};

const TAIL_START = /^(?:[\d(@%=]|[a-zA-Z](?![0-9a-zA-Zа-яА-ЯёЁ]))/;

/**
 * Что ожидается у курсора. Возвращает {kind, start, query, ...}: `start` —
 * с какого места набранное заменяется подстановкой.
 */
export function hintAt(text = "", at = 0, model = {}) {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEndRaw = text.indexOf("\n", at);
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);
  const caret = at - lineStart;
  const before = line.slice(0, caret);
  const lab = labelOf(line);
  // Контекст: что было выше в этом блоке (для выбора меток и множественного числа).
  const ctx = contextAbove(text, lineStart, model);
  if (!lab || caret < lab.rest.start) {
    const lead = line.length - line.trimStart().length;
    const q = before.trim();
    return { kind: "label", start: lineStart + lead, query: q, ctx };
  }
  const rest = before.slice(lab.rest.start);
  const restStart = lineStart + lab.rest.start;
  if (lab.kind === "func" || lab.kind === "task") return { kind: "name", start: restStart, query: rest.trim(), label: lab.kind, ctx };
  if (lab.kind === "who" || lab.kind === "to" || lab.kind === "from") {
    // «@» в строке «Кто:» — сотрудник должности.
    const atPos = lab.kind === "who" ? rest.lastIndexOf("@") : -1;
    if (atPos >= 0 && !/[{}()]/.test(rest.slice(atPos))) {
      const posName = rest.slice(0, atPos).replace(/[✎⚙✓]/g, " ").replace(/\{[^{}]*\}/g, " ").replace(/\([^)]*\)/g, " ").trim();
      return { kind: "person", start: restStart + atPos, query: rest.slice(atPos + 1).trim(), posName, ctx };
    }
    // Слово у курсора после последней запятой/скобки.
    const cut = Math.max(rest.lastIndexOf(","), rest.lastIndexOf("("), rest.lastIndexOf(")"));
    const sub = rest.slice(cut + 1);
    const lead = sub.length - sub.trimStart().length;
    return { kind: lab.kind === "who" ? "who" : lab.kind, start: restStart + cut + 1 + lead, query: sub.trim(), ctx, label: lab.kind };
  }
  if (lab.kind === "if") return { kind: "cond", start: restStart + rest.length - (rest.match(/[^\s,И!()=<>≠≥≤]*$/) || [""])[0].length, query: (rest.match(/[^\s,И!()=<>≠≥≤]*$/) || [""])[0], ctx, vars: ctx.vars,
    afterOp: /[=<>≠≥≤]\s*$/.test(rest) };
  if (lab.kind === "else" || lab.kind === "then") return { kind: "label", start: at, query: "", ctx };
  // take / give / or: ресурс у курсора.
  const parts = splitItems(rest, 0);
  const lastComma = rest.lastIndexOf(",");
  const itemStart = lastComma >= 0 && !/\d/.test(rest[lastComma + 1] || "") ? lastComma + 1 : 0;
  const itemText = rest.slice(itemStart);
  const lead = itemText.length - itemText.trimStart().length;
  const q = itemText.slice(lead);   // хвостовой пробел важен: он значит «дальше — сколько»
  const side = lab.kind;
  const asset = sideAsset(ctx, side, text, lineStart, model);
  const prior = ctx.items;
  // Имя набрано и пробел — количество.
  const m = q.match(/^(.*?\S)(\s+)([\s\S]*)$/);
  const known = asset ? (model.traits || []).filter((t) => t.e === asset.id).map((t) => String(t.l)).sort((a, b) => b.length - a.length) : [];
  let hit = null, traitName = "";
  for (const n of known) {
    const re = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[её]/gi, "[еёЕЁ]")}(\\s+)([\\s\\S]*)$`, "i");
    const mm = q.match(re);
    if (mm && (!mm[2] || TAIL_START.test(mm[2]))) { hit = { tail: mm[2], tailAt: q.length - mm[2].length }; traitName = n; break; }
  }
  if (!hit && m && (!m[3] || TAIL_START.test(m[3]))) { hit = { tail: m[3], tailAt: q.length - m[3].length }; traitName = m[1].trim(); }
  if (hit && !/\(/.test(q)) {
    const tail = hit.tail;
    const cut = Math.max(...[" ", "%", "*", "/", "+", "-", "(", ")", "="].map((ch) => tail.lastIndexOf(ch)));
    const atPos = tail.lastIndexOf("@");
    const sub = atPos >= 0 && atPos > cut ? atPos : cut + 1;
    const subStart = restStart + itemStart + lead + hit.tailAt + sub;
    return { kind: "qty", start: subStart, query: rest.slice(itemStart + lead + hit.tailAt + sub), traitName, ctx, prior, side, asset,
      nameStart: restStart + itemStart + lead };
  }
  return { kind: "trait", start: restStart + itemStart + lead, query: q.trim(), side, asset, ctx, prior, nItems: parts.length };
}

/* Что выше по тексту в этом блоке: сколько «Кто» подряд перед курсором,
   участники задачи, переменные всего текста, ресурсы задачи (для букв). */
function contextAbove(text, lineStart, model) {
  const above = text.slice(0, lineStart);
  const parsed = parseText(above, model, {});
  const fn = parsed.funcs[parsed.funcs.length - 1] || null;
  const task = fn ? fn.tasks[fn.tasks.length - 1] || null : null;
  const branch = task ? task.branches[task.branches.length - 1] : null;
  const rowsAbove = above.split("\n").slice(0, -1);
  let whoRun = 0;
  for (let i = rowsAbove.length - 1; i >= 0; i -= 1) {
    const l = rowsAbove[i].trim();
    if (!l) break;
    const lab = labelOf(l);
    if (lab && lab.kind === "who") { whoRun += 1; continue; }
    if (!lab && whoRun) { whoRun += 1; continue; }
    break;
  }
  const lastLab = [...rowsAbove].reverse().map((l) => labelOf(l)?.kind).find(Boolean) || null;
  const blankBefore = rowsAbove.length && !rowsAbove[rowsAbove.length - 1].trim();
  const vars = [];
  parsed.funcs.forEach((f) => f.tasks.forEach((t) => (t.items || []).forEach((it) => { if (it.var && !vars.includes(it.var)) vars.push(it.var); })));
  const items = (task?.items || []).map((it) => ({ letter: it.letter, name: it.name || `(${it.var})`, asset: it.asset?.name || "" }));
  return { fn, task, branch, whoRun, lastLab, blankBefore, vars, items, hasWho: !!branch?.who.length, hasStep: !!branch?.steps.length };
}

function sideAsset(ctx, side, text, lineStart, model) {
  // Актив стороны: «От кого:»/«Кому:» ещё не написаны — актив исполнителя.
  const w = ctx.branch?.who.find((x) => x.asset);
  return w?.asset ? (model.entities || []).find((e) => e.id === w.asset.id) || null : null;
}

/**
 * Подсказки под место: метки, должности с активом, ресурсы, буквы и
 * знаки, переменные. Пункты несут `suffix` (что ставится после) и
 * `insert` (вставить у курсора, не заменяя набранное).
 */
export function suggest(hint, model = {}, proc = {}) {
  if (!hint) return [];
  const q = nameKey(hint.query);
  const { entities = [], traits = [], positions = [] } = model;
  let items = [];
  const label = (kind, note = "") => ({ name: LABEL_TEXT[kind], kind: "метка", note, suffix: " ", mark: kind });
  if (hint.kind === "label") {
    const c = hint.ctx;
    const plural = c.whoRun >= 2;
    if (c.lastLab === "take" && !c.blankBefore) items.push(label("from", "откуда"), label(plural ? "gives" : "give"), label(plural ? "takes" : "take"), label("who"));
    else if (c.lastLab === "give" && !c.blankBefore) items.push(label("to", "куда"), label("or", "иной выход"), label(plural ? "takes" : "take"), label(plural ? "gives" : "give"), label("who"));
    else if (c.lastLab === "to" && !c.blankBefore) items.push(label("to", "ещё кому"), label("or", "иной выход"), label(plural ? "takes" : "take"), label(plural ? "gives" : "give"), label("who"));
    else if (c.lastLab === "from" && !c.blankBefore) items.push(label("from", "ещё от кого"), label(plural ? "gives" : "give"), label(plural ? "takes" : "take"), label("who"));
    else if ((c.lastLab === "then" || c.lastLab === "if") && !c.blankBefore) items.push(label("who", "участник"), label("take", "что берёт"), label("give", "что отдаёт"));
    else if ((c.hasWho || c.whoRun) && !c.blankBefore) items.push(label(plural ? "takes" : "take", "что берёт"), label(plural ? "gives" : "give", "что отдаёт"), label("who", "ещё участник"));
    else items.push(label("who", "участник"), label("task", "новая задача"), label("func", "новая функция"));
    if (!items.some((i) => i.mark === "who")) items.push(label("who"));
    ["task", "func", "if", "else"].forEach((k) => { if (!items.some((i) => i.mark === k)) items.push(label(k)); });
    items = items.map((i) => ({ ...i, name: i.name }));
  } else if (hint.kind === "who" || hint.kind === "to" || hint.kind === "from") {
    positions.forEach((p) => {
      const a = assetOfPosition(p, model);
      items.push({ name: p.name, kind: "должность", note: a ? a.name : "без актива", suffix: hint.kind === "who" ? "\n" : "\n", pos: p.id });
    });
    entities.forEach((e) => items.push({ name: e.name, kind: "актив", note: hint.kind === "who" ? "любой воркер" : "", suffix: "\n" }));
  } else if (hint.kind === "person") {
    peopleOfPosition(hint.posName, model).forEach((p) => items.push({ name: `@${p.name}`, kind: "сотрудник", suffix: "\n" }));
  } else if (hint.kind === "trait") {
    const a = hint.asset;
    const own = a ? traits.filter((t) => t.e === a.id) : [];
    own.forEach((t) => items.push({ name: t.l, kind: "ресурс", note: a.name, suffix: " " }));
    if (hint.side === "take") (hint.ctx?.vars || []).forEach((v) => items.push({ name: `(${v})`, kind: "переменная", suffix: " " }));
    if (!a) {
      /* Актив исполнителя не определён (нет «Кто:» или у должности нет
         актива) — ресурсы всех активов с пометкой актива. «Сперва назовите
         кто» после «Отдаёт:» неприменимо: отдают только своё (владелец,
         2026-09-18). */
      const assetOf = (t) => entities.find((e) => e.id === t.e)?.name || "";
      traits.filter((t) => t.l).forEach((t) => items.push({ name: t.l, kind: "ресурс", note: assetOf(t), suffix: " " }));
      items.push({ name: "", kind: "", note: hint.side === "give"
        ? "отдают ресурс актива исполнителя; актив пока не определён — показаны ресурсы всех активов"
        : "актив пока не определён — показаны ресурсы всех активов", info: true });
    }
  } else if (hint.kind === "qty") {
    const q0 = String(hint.query || "");
    if (q0.startsWith("@")) {
      const assetOf = (t) => entities.find((e) => e.id === t.e)?.name || "";
      items = traits.filter((t) => t.l).map((t) => ({ name: `@${t.l}`, kind: "ресурс", note: assetOf(t), suffix: "" }));
    } else {
      items = (hint.prior || []).map((p) => ({ name: p.letter, kind: "буква", note: `${p.name} (${p.asset})`, suffix: "" }));
      items.push(...[["=", "ровно"], ["%", "процент"], ["@", "ресурс схемы"], ["-", "диапазон: 45-55"], ["*", ""], ["/", ""], ["+", ""], ["(", ""], [")", ""]]
        .map(([name, note]) => ({ name, kind: "знак", note, suffix: "", insert: true })));
      items.push({ name: "(…)", kind: "закрепить", note: "имя в скобках — взять в другой задаче", insert: true, text: " ()", suffix: "", caretBack: 1 });
      items.push({ name: "→", kind: "дальше", note: "и ещё ресурс — через запятую", insert: true, text: ",", suffix: " ", trimBefore: true });
      /* «Или» (владелец, 2026-09-18): запятая — «и», а иной выход — строка «Или:». */
      if (hint.side === "give" || hint.side === "or") items.push({ name: "или", kind: "дальше", note: "иной выход — новая строка: Или:", insert: true,
        text: `\n${LABEL_TEXT.or}`, suffix: " ", trimBefore: true });
      items.push({ name: "↵", kind: "дальше", note: hint.side === "give" ? "новая строка: Кому:" : "новая строка: От кого:", insert: true,
        text: `\n${LABEL_TEXT[hint.side === "give" ? "to" : "from"]}`, suffix: " ", trimBefore: true });
      items.push({ name: "↵", kind: "дальше", note: "новая строка", insert: true, text: "\n", suffix: "", trimBefore: true });
    }
  } else if (hint.kind === "cond") {
    (hint.vars || []).forEach((v) => items.push({ name: v, kind: "переменная", suffix: " " }));
    if (hint.afterOp) {
      // После знака сравнения — число или переменная (владелец, 2026-09-18: «нет операторов равно, больше, меньше»).
      items.push({ name: "", kind: "", note: "введите число или выберите переменную", info: true });
    } else {
      items.push(...[["=", "равно"], [">", "больше"], ["<", "меньше"], ["≥", "не меньше"], ["≤", "не больше"], ["≠", "не равно"]]
        .map(([name, note]) => ({ name, kind: "знак", note, suffix: " ", insert: true, text: name, trimBefore: false })));
      items.push({ name: "И", kind: "знак", suffix: " ", insert: true, text: "И" }, { name: "ИЛИ", kind: "знак", suffix: " ", insert: true, text: "ИЛИ" },
        { name: "!", kind: "знак", note: "не", suffix: "", insert: true, text: "!" },
        { name: "↵", kind: "дальше", note: "новая строка: То:", suffix: "\n", insert: true, text: "\nТо:", trimBefore: true });
    }
  } else if (hint.kind === "name") {
    items.push({ name: "↵", kind: "дальше", note: hint.label === "func" ? "новая строка: Задача:" : "новая строка: Кто:", insert: true,
      text: `\n${LABEL_TEXT[hint.label === "func" ? "task" : "who"]}`, suffix: " ", trimBefore: true });
  }
  const seen = new Set();
  items = items.filter((it) => { const k = `${it.kind}|${nameKey(it.name)}|${it.note || ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const starts = items.filter((it) => it.insert || it.info || !q || nameKey(it.name).startsWith(q));
  const inside = items.filter((it) => !it.insert && !it.info && q && !nameKey(it.name).startsWith(q) && nameKey(it.name).includes(q));
  return [...starts, ...inside];
}

/* ─────── выгрузка и загрузка ─────── */

/** Текст для выгрузки: роли словами в скобках, значки убраны. */
export function exportText(text = "") {
  return String(text || "").split("\n").map((line) => {
    const lab = labelOf(line);
    if (!lab || !["who", "to", "from"].includes(lab.kind)) return line;
    const rest = lab.rest.text;
    const icons = lab.kind === "who" ? (rest.match(/[✎⚙✓]/g) || []).map((c) => ROLE_WORD[ROLE_BY_WORD[c]]) : [];
    if (!icons.length && !/[{@]/.test(rest)) return line;
    if (!icons.length) {
      // Без значков — только рука и сотрудник словами.
      return `${line.slice(0, lab.rest.start)}${rest.replace(/\s*\{([^{}]*)\}/g, (m0, h) => ` (переменная: сотрудник ${h.trim()})`)
        .replace(/\s*@([^@{}()✎⚙✓,]+)/g, (m0, n) => ` (сотрудник: ${n.trim()})`)}`;
    }
    const cleaned = rest.replace(/\s*[✎⚙✓]/g, "");
    const hand = cleaned.match(/\s*\((?:рука|переменная\s*:\s*сотрудник)\s+[^)]*\)/i) || cleaned.match(/\s*\{[^{}]*\}/);
    const person = cleaned.match(/\s*@[^@{}()✎⚙✓,]+/);
    let base = hand ? cleaned.replace(hand[0], "") : cleaned;
    base = person ? base.replace(person[0], "") : base;
    const trail = base.match(/,\s*$/) ? "," : "";
    const core = base.replace(/,\s*$/, "").trimEnd();
    const handWord = hand ? (hand[0].trim().startsWith("{") ? `(переменная: сотрудник ${hand[0].trim().slice(1, -1).trim()})` : hand[0].trim()) : "";
    const personWord = person ? `(сотрудник: ${person[0].trim().slice(1).trim()})` : "";
    return `${line.slice(0, lab.rest.start)}${core} (${icons.join(", ")})${handWord ? ` ${handWord}` : ""}${personWord ? ` ${personWord}` : ""}${trail}`;
  }).join("\n");
}

/** Текст после загрузки: роли словами → значки, «переменная: сотрудник A» → «рука A». */
export function importText(text = "") {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const lab = labelOf(line);
    if (!lab || !["who", "to", "from"].includes(lab.kind)) return line;
    let rest = lab.rest.text;
    rest = rest.replace(/\s*\(([^()]*)\)/g, (m, inner) => {
      const words = inner.split(/[,\s]+/).map((w) => nameKey(w)).filter(Boolean);
      const rs = words.map((w) => ROLE_BY_WORD[w]).filter(Boolean);
      if (rs.length && rs.length === words.length) return ` ${rs.map((r) => ICON[r]).join(" ")}`;
      const pn = inner.match(/^сотрудник\s*:\s*(.+)$/i);
      if (pn) return ` @${pn[1].trim()}`;
      const h = inner.match(/^(?:переменная\s*:\s*)?(?:рука|сотрудник)\s+(.+)$/i);
      if (h) return ` {${h[1].trim().toLowerCase()}}`;
      return m;
    });
    return `${line.slice(0, lab.rest.start)}${rest}`;
  }).join("\n");
}

/** Старый текст v1 → v2: шаг на задачу, актив пары — «От кого:»/«Кому:». */
export function fromV1(text = "", steps = []) {
  const blocks = steps.filter((s) => !s.error).map((s) => {
    const lines = [`Задача: ${s.asset?.name || ""}`.trim()];
    lines.push(`Кто: ${s.role?.name || s.asset?.name || ""}`);
    const items = (list) => list.map((p) => `${p.trait?.name || ""}${p.expr ? ` ${p.expr}` : p.qty && p.qty !== 1 ? ` ${p.qty}` : ""}`);
    (s.takes || []).forEach((p) => { lines.push(`Берёт: ${items([p]).join(", ")}`); if (p.asset?.name && p.asset.name !== s.asset?.name) lines.push(`От кого: ${p.asset.name}`); });
    (s.gives || []).forEach((p) => { lines.push(`Отдаёт: ${items([p]).join(", ")}`); if (p.asset?.name && p.asset.name !== s.asset?.name) lines.push(`Кому: ${p.asset.name}`); });
    return lines.join("\n");
  });
  return blocks.join("\n\n") || text;
}

/* ─────── функции из текста ─────── */

/**
 * Функции для расчёта и доски: КАЖДАЯ ЗАДАЧА текста — своя функция
 * (владелец, 2026-09-18: функция состоит из задач; берёт/отдаёт — в любом
 * порядке). Задачи одной функции связаны `chain` {id, name, step, of}:
 * форма функции и схема показывают их вместе, а прогноз и доска считают
 * каждую как обычную функцию в активе её исполнителя — цепочка выходит
 * сама, через ресурсы: следующая задача берёт то, что выдала предыдущая
 * (ссылка на переменную — вход из актива, куда ту выдали). Порядок шагов
 * — `steps` [{kind, ports}]: если первый шаг «берёт», взятое выдаётся при
 * взятии задачи, если «отдаёт» — после проверки (`takesAt`). Участники —
 * `who` (должность, актив, роли, рука); должности «Кто» — в `posts` по
 * ролям; без ролей — любая. Ветка «Если» — первая, «Иначе» — в `alt`.
 * Идентификаторы — из процесса, строки функции и номера задачи: при
 * пересборке функции остаются теми же.
 */
export function procFuncs(proc = {}, model = {}) {
  if (proc.status === "off") return [];
  const { funcs } = parseText(proc.text, model, proc);
  const traits = model.traits || [];
  const out = [];
  // Где объявлены переменные: имя → {trait, asset, qty, qtyHi}.
  const vars = new Map();
  funcs.forEach((f) => f.tasks.forEach((t) => t.branches.forEach((b) => b.steps.forEach((s) => {
    if (s.kind !== "give") return;
    [...s.items, ...s.or].forEach((it) => { if (it.var && !vars.has(nameKey(it.var))) vars.set(nameKey(it.var), { trait: it.trait?.id ?? null, asset: s.asset?.id ?? null, qty: it.qty, qtyHi: it.qtyHi ?? it.qty, flag: !!it.flag }); });
  }))));
  funcs.forEach((f) => {
    const fid = `${proc.id}_${f.row + 1}`;
    const fname = f.name || (f.tasks[0]?.name ? `процесс: ${f.tasks[0].name}` : "процесс");
    f.tasks.forEach((t, ti) => {
      const tid = `${fid}_t${ti + 1}`;
      const build = (b, bi) => {
        let ok = true;
        const who = b.who.map((w) => {
          if (whoState(w, proc) !== "ok") ok = false;
          const any = !w.roles.setter && !w.roles.doer && !w.roles.checker;
          return { name: w.name, pos: w.pos?.id ?? null, asset: w.asset?.id ?? null, hand: w.hand,
            ...(w.personId ? { person: w.personId } : {}),
            roles: any ? { setter: true, doer: true, checker: true, any: true } : { ...w.roles } };
        });
        const posts = { setters: [], owners: [], reviewers: [] };
        who.forEach((w) => {
          if (!w.pos) return;
          if (w.roles.setter && !posts.setters.includes(w.pos)) posts.setters.push(w.pos);
          if (w.roles.doer && !posts.owners.includes(w.pos)) posts.owners.push(w.pos);
          if (w.roles.checker && !posts.reviewers.includes(w.pos)) posts.reviewers.push(w.pos);
        });
        const doer = who.find((w) => w.roles.doer && w.asset) || who.find((w) => w.asset) || null;
        const takes = [], gives = [], steps = [];
        const letters = t.items.map((it, k) => `p_${tid}_${k}`);
        b.steps.forEach((s, si) => {
          const ids = [];
          s.items.forEach((it) => {
            const k = t.items.indexOf(it);
            const id = `p_${tid}_${k}`;
            let port;
            if (it.ref) {
              const d = vars.get(nameKey(it.var));
              if (!d || !d.trait) { ok = false; return; }
              port = { id, trait: d.trait, lo: d.qty, hi: d.qtyHi, from: d.asset, var: it.var };
            } else {
              if (itemState(it, proc, model) !== "ok") ok = false;
              port = { id, trait: it.trait?.id ?? null, lo: it.qty, hi: it.qtyHi ?? it.qty,
                ...(it.var ? { var: it.var } : {}), ...(s.kind === "give" && s.to?.asset ? { to: s.to.asset.id } : {}),
                ...(s.kind === "take" && s.from?.asset ? { from: s.from.asset.id } : {}),
                ...(s.kind === "give" && s.to?.hand ? { toHand: s.to.hand } : {}), ...(s.kind === "give" && s.to?.person ? { toPerson: s.to.person } : {}),
                ...(s.kind === "take" && s.from?.hand ? { fromHand: s.from.hand } : {}), ...(s.kind === "take" && s.from?.person ? { fromPerson: s.from.person } : {}),
                ...(it.expr ? { expr: toStored(it.expr, traits, letters) } : {}) };
            }
            (s.kind === "take" ? takes : gives).push(port);
            ids.push(id);
            /* Ещё получатели/отправители — тот же ресурс каждому, порт на каждого. */
            const more = (s.kind === "give" ? s.tos || [] : s.froms || []).slice(1);
            more.forEach((x, j) => {
              if (!x.asset) return;
              const pid = `${id}_${j + 1}`;
              const extra = s.kind === "give"
                ? { to: x.asset.id, ...(x.hand ? { toHand: x.hand } : {}), ...(x.person ? { toPerson: x.person } : {}) }
                : { from: x.asset.id, ...(x.hand ? { fromHand: x.hand } : {}), ...(x.person ? { fromPerson: x.person } : {}) };
              const { to: _t, toHand: _th, toPerson: _tp, from: _f, fromHand: _fh, fromPerson: _fp, ...base } = port;
              (s.kind === "take" ? takes : gives).push({ ...base, id: pid, ...extra });
              ids.push(pid);
            });
          });
          const or = s.or.map((it) => { const k = t.items.indexOf(it); return { id: `p_${tid}_${k}`, trait: it.trait?.id ?? null, lo: it.qty, hi: it.qtyHi ?? it.qty, var: it.var, flag: !!it.flag }; });
          steps.push({ kind: s.kind, ports: ids, ...(or.length ? { or } : {}) });
        });
        const e = doer?.asset ?? b.steps.find((s) => s.asset)?.asset?.id ?? null;
        return { ok: ok && !!e, e, who, posts, takes, gives, steps, cond: b.cond || null, isElse: !!b.isElse, bi };
      };
      const main = build(t.branches[0], 0);
      if (!main.ok) return;
      const alt = t.branches.slice(1).map((b, i) => build(b, i + 1)).filter((x) => x.ok).map(({ ok, bi, ...rest }) => rest);   // eslint-disable-line no-unused-vars
      out.push({
        id: tid, e: main.e, name: t.name || `задача ${ti + 1}`, proc: proc.id,
        chain: { id: fid, name: fname, step: ti + 1, of: f.tasks.length },
        takes: main.takes, gives: main.gives, steps: main.steps, who: main.who, posts: main.posts,
        ...(main.cond ? { cond: main.cond } : {}), ...(alt.length ? { alt } : {}),
        dur: 1, durHi: 1, durUnit: "дн", accepted: true,
      });
    });
  });
  return out;
}

/** Когда выдаётся взятое: «start» — при взятии задачи (первый шаг «берёт»), «done» — после проверки. */
export const takesAt = (f = {}) => {
  const first = Array.isArray(f.steps) && f.steps.length ? f.steps[0].kind : ((f.takes || []).length ? "take" : "give");
  return first === "take" ? "start" : "done";
};

/** Задействует ли процесс актив. */
export const usesAsset = (proc = {}, model = {}, assetId) => {
  if (assetId == null) return false;
  const { funcs } = parseText(proc.text, model, proc);
  return funcs.some((f) => f.tasks.some((t) => t.branches.some((b) =>
    b.who.some((w) => String(w.asset?.id) === String(assetId))
    || b.steps.some((s) => String(s.asset?.id) === String(assetId) || [...(s.tos || []), ...(s.froms || [])].some((x) => String(x.asset?.id) === String(assetId)) || String(s.to?.asset?.id) === String(assetId) || String(s.from?.asset?.id) === String(assetId)))));
};

/* ─────── замена и правка на месте ─────── */

/** Замена имени на месте: ресурс, должность/актив в «Кто», «Кому», «От кого». */
export function replaceName(text = "", kind, oldName, newName, model = {}) {
  const key = nameKey(oldName);
  const { funcs } = parseText(text, model, {});
  const lines = String(text || "").split("\n");
  const edits = [];
  funcs.forEach((f) => f.tasks.forEach((t) => t.branches.forEach((b) => {
    if (kind !== "trait") b.who.forEach((w) => { if (nameKey(w.name) === key) edits.push({ row: w.row, ...w.span }); });
    b.steps.forEach((s) => {
      if (kind === "trait") [...s.items, ...s.or].forEach((it) => { if (it.name && nameKey(it.name) === key) edits.push({ row: it.row ?? s.row, ...it.nameSpan }); });
      else [...(s.tos || []), ...(s.froms || [])].forEach((x) => { if (x && nameKey(x.name) === key) edits.push({ row: x.row, ...x.span }); });
    });
  })));
  edits.sort((a, b) => (a.row - b.row) || (b.start - a.start)).forEach((e) => {
    lines[e.row] = `${lines[e.row].slice(0, e.start)}${newName}${lines[e.row].slice(e.end)}`;
  });
  return lines.join("\n");
}

/** Переключить роль участника в строке «Кто:» (значок после имени). */
export function toggleRole(text = "", row, role) {
  const lines = String(text || "").split("\n");
  const line = lines[row] ?? "";
  const lab = labelOf(line);
  if (!lab || lab.kind !== "who") return text;
  const icon = ICON[role];
  const rest = lab.rest.text;
  let next;
  if (rest.includes(icon)) next = rest.replace(new RegExp(`\\s*${icon}`), "");
  else {
    const hand = rest.match(/\s*\((?:рука|переменная)[^)]*\)\s*,?\s*$/i);
    const trail = rest.match(/,\s*$/) ? "," : "";
    const core = rest.replace(/\s*\((?:рука|переменная)[^)]*\)\s*,?\s*$/i, "").replace(/,\s*$/, "").trimEnd();
    next = `${core} ${icon}${hand ? ` ${hand[0].trim().replace(/,\s*$/, "")}` : ""}${trail}`;
  }
  lines[row] = `${line.slice(0, lab.rest.start)}${next}`;
  return lines.join("\n");
}

const stripHand = (rest) => rest.replace(/\s*\((?:рука|переменная\s*:\s*сотрудник)\s+[^)]*\)/gi, "").replace(/\s*\{[^{}]*\}/g, "");
const stripPerson = (rest) => rest.replace(/\s*\(сотрудник\s*:[^)]*\)/gi, "").replace(/\s*@[^@{}()✎⚙✓,]+/g, "");
const rewriteWho = (text, row, make) => {
  const lines = String(text || "").split("\n");
  const line = lines[row] ?? "";
  const lab = labelOf(line);
  if (!lab || !["who", "to", "from"].includes(lab.kind)) return text;
  const rest = lab.rest.text;
  const trail = rest.match(/,\s*$/) ? "," : "";
  const core = make(rest.replace(/,\s*$/, "")).replace(/\s+$/, "");
  lines[row] = `${line.slice(0, lab.rest.start)}${core}${trail}`;
  return lines.join("\n");
};
/** Поставить/снять «руку» участника: «{имя}» после имени и значков (сотрудник при этом снимается). */
export function setHand(text = "", row, hand) {
  return rewriteWho(text, row, (rest) => `${stripPerson(stripHand(rest)).trimEnd()}${hand ? ` {${String(hand).trim().toLowerCase()}}` : ""}`);
}
/** Назначить/снять конкретного сотрудника: «@Имя» (рука при этом снимается). */
export function setPerson(text = "", row, name) {
  return rewriteWho(text, row, (rest) => `${stripHand(stripPerson(rest)).trimEnd()}${name ? ` @${String(name).trim()}` : ""}`);
}
/** «Автоматически»: ни руки, ни сотрудника. */
export const setAuto = (text = "", row) => rewriteWho(text, row, (rest) => stripHand(stripPerson(rest)).trimEnd());

/* ─────── разница версий по задачам ─────── */

/** Задачи текста как записи {key, text}: ключ — функция/название, текст — тело. */
export function taskBlocks(text = "", model = {}) {
  const { funcs } = parseText(text, model, {});
  const lines = String(text || "").split("\n");
  const out = [];
  funcs.forEach((f, fi) => f.tasks.forEach((t, ti) => {
    const rows = new Set();
    rows.add(t.row);
    t.branches.forEach((b) => { rows.add(b.row); if (b.thenRow != null) rows.add(b.thenRow); b.who.forEach((w) => rows.add(w.row)); b.steps.forEach((s) => { rows.add(s.row); s.items.forEach((it) => rows.add(it.row ?? s.row)); [...(s.tos || []), ...(s.froms || [])].forEach((x) => rows.add(x.row)); s.or.forEach((it) => rows.add(it.row ?? s.row)); }); });
    const body = [...rows].sort((a, b) => a - b).map((r) => lines[r]).join("\n");
    out.push({ key: `${f.name || fi}|${t.name || ti}`, name: t.name || `задача ${ti + 1}`, func: f.name, text: body });
  }));
  return out;
}

/** Что добавилось/изменилось (зелёное) и что убрано/заменено (красное) между версиями. */
export function diffTasks(fromText = "", toText = "", model = {}) {
  const a = taskBlocks(fromText, model), b = taskBlocks(toText, model);
  const byKeyA = new Map(a.map((x) => [x.key, x]));
  const byKeyB = new Map(b.map((x) => [x.key, x]));
  const added = b.filter((x) => !byKeyA.has(x.key) || byKeyA.get(x.key).text !== x.text);
  const removed = a.filter((x) => !byKeyB.has(x.key) || byKeyB.get(x.key).text !== x.text);
  return { added, removed };
}
