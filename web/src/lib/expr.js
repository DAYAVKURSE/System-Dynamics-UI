/* ════════════════════════════════════════════════════════════════
   ВЫРАЖЕНИЕ ЦЕЛИ · «>10», «=@{t1}*2», «<@{t1}+@{t2}»

   Цель — не число, а условие: сколько ресурса должно быть ПО СРАВНЕНИЮ с
   чем-то. Первым стоит знак — «>», «<», «=» или «!» (не) — дальше числа,
   скобки, четыре действия, ПРОЦЕНТ и ссылки на количество других
   ресурсов. Владелец (2026-09-15): это ОПЕРАЦИИ, и среди них должен быть
   процент от какого-либо значения: «20%» — это 0,2; «20% @Заявки» —
   двадцать процентов от заявок (процент, за которым сразу идёт число,
   ресурс или скобка, умножается на него); «@Заявки*20%» — то же самое.

   Ссылка хранится по ИДЕНТИФИКАТОРУ — `@{t1}`, — а показывается по имени
   — «@Заявки». Имя человек переименовывает, идентификатор нет: ссылка по
   имени рвалась бы от первой правки названия. Набор в форме идёт по
   именам (как в Excel: «@» — и список), а в запись уходят идентификаторы
   (`toStored`); обратно — `toShown`.

   Что выражение значит для расчёта (`goalOf`):
     «=» и «>» — есть цель-число: план считает, сколько произвести;
     «<» и «!» — только условие: произвести «меньше» нельзя, это
       проверяется, а не планируется.

   ─── буквы и диапазоны (владелец, 2026-09-15) ───

   «Операции должны осуществляться не только над общим количеством
   ресурсов, но и в рамках текущего процесса/функции — каждому ресурсу
   присваивается своя буква»: партнёр берёт оплату у заказчика и отдаёт
   мне 50% — или 45–55% — от неё. Ресурсы функции (входы, потом выходы)
   и ресурсы строки процесса (по порядку) получают буквы «а», «б», «в»…;
   буква в операции — количество ТОГО ресурса на одном выполнении:
   «50% а». Латинские a, b, c читаются как те же буквы по порядку — на
   какой раскладке набрали, неважно. У функции буква хранится по
   идентификатору порта — `#{p1}` — и показывается буквой по его
   нынешнему месту (как ресурс: `@{t1}` ↔ «@Заявки»); в тексте процесса
   буква и есть запись — текст единственный источник.

   ДИАПАЗОН — «45-55» (два числа через дефис, без пробелов): значение от
   и до. Выражение считается дважды — по нижним и по верхним границам
   (вычитаемое и делитель берутся наоборот, чтобы границы были
   границами) — и даёт `lo`/`hi`; без диапазонов они равны `value`.
   ════════════════════════════════════════════════════════════════ */

export const OPS = [">", "<", "=", "!"];
const REF = /^@\{([^}]+)\}/;
const PORT = /^#\{([^}]+)\}/;
const NUM = /^\d+(?:[.,]\d+)?/;
const RANGE = /^(\d+(?:[.,]\d+)?)[-–—](\d+(?:[.,]\d+)?)/;
const ALNUM = /[0-9a-zA-Zа-яА-ЯёЁ]/;

/** Буквы ресурсов по порядку: «а», «б», «в»… (без й, ъ, ы, ь, ё). */
export const LETTERS = "абвгдежзиклмнопрстуфхцчшщэюя";
const LATIN = "abcdefghijklmnopqrstuvwxyz";
export const letterOf = (i) => LETTERS[i] || `#${i + 1}`;
/** Номер буквы — кириллической или латинской по тому же месту; −1, если не буква. */
export const letterIndex = (ch) => {
  const c = String(ch || "").toLowerCase();
  const i = LETTERS.indexOf(c);
  return i >= 0 && c ? i : LATIN.indexOf(c);
};
const isLetter = (ch) => !!ch && letterIndex(ch) >= 0 && ch.length === 1;

const num = (v) => Number(v) || 0;

/** Знак и остаток. Без знака — «=»: старые цели были числом, и число значило «ровно». */
export function splitOp(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return { op: "=", rest: "" };
  const op = OPS.includes(t[0]) ? t[0] : "=";
  return { op, rest: OPS.includes(t[0]) ? t.slice(1).trim() : t };
}

/* ─── разбор ───
   Рекурсивный спуск: сумма → произведение → множитель. Ошибка — словами,
   с позицией; выражение с ошибкой не считается, а не считается как ноль. */
export function parseExpr(text = "") {
  const { op, rest } = splitOp(text);
  let i = 0;
  const s = rest;
  const err = (m) => ({ op, ast: null, error: `${m} (позиция ${i + 1})` });
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i += 1; };
  let failed = null;
  const fail = (m) => { if (!failed) failed = err(m); return null; };
  const factor = () => {
    ws();
    if (i >= s.length) return fail("ожидалось число или @ресурс");
    if (s[i] === "(") {
      i += 1;
      const inner = sum();
      ws();
      if (s[i] !== ")") return fail("нет закрывающей скобки");
      i += 1;
      return inner;
    }
    if (s[i] === "-") { i += 1; const f = factor(); return f && { t: "neg", a: f }; }
    const ref = s.slice(i).match(REF);
    if (ref) { i += ref[0].length; return { t: "ref", id: ref[1] }; }
    if (s[i] === "@") return fail("ресурс не выбран из списка");
    const port = s.slice(i).match(PORT);
    if (port) { i += port[0].length; return { t: "port", id: port[1] }; }
    const rg = s.slice(i).match(RANGE);
    if (rg) {
      i += rg[0].length;
      const a = Number(rg[1].replace(",", ".")), b = Number(rg[2].replace(",", "."));
      return { t: "range", lo: Math.min(a, b), hi: Math.max(a, b) };
    }
    const n = s.slice(i).match(NUM);
    if (n) { i += n[0].length; return { t: "num", v: Number(n[0].replace(",", ".")) }; }
    // Буква — ресурс функции/строки по порядку; слово из букв — не буква.
    if (/[a-zA-Zа-яА-ЯёЁ]/.test(s[i]) && !ALNUM.test(s[i + 1] || "")) {
      const k = letterIndex(s[i]);
      if (k < 0) return fail(`«${s[i]}» — не буква ресурса`);
      i += 1;
      return { t: "letter", i: k, ch: LETTERS[k] };
    }
    if (/[a-zA-Zа-яА-ЯёЁ]/.test(s[i])) {
      const w = s.slice(i).match(/^[0-9a-zA-Zа-яА-ЯёЁ]+/)[0];
      return fail(`не понимаю «${w}»: ресурс — через @, буква — одна`);
    }
    return fail(`не понимаю «${s[i]}»`);
  };
  /* Процент: «20%» → 0,2. Процент, за которым сразу число, ресурс или
     скобка, — «процент ОТ»: «20% @Заявки» = 0,2 · заявки. */
  const pct = (f) => {
    let a = f;
    ws();
    while (a && s[i] === "%") {
      i += 1; a = { t: "%", a }; ws();
      if (/[\d@(#a-zA-Zа-яА-ЯёЁ]/.test(s[i] || "")) { const b = factor(); if (!b) return null; a = { t: "*", a, b }; ws(); }
    }
    return a;
  };
  const term = () => {
    let a = pct(factor());
    for (;;) {
      ws();
      if (!a || (s[i] !== "*" && s[i] !== "/")) return a;
      const o = s[i]; i += 1;
      const b = pct(factor());
      if (!b) return null;
      a = { t: o, a, b };
    }
  };
  const sum = () => {
    let a = term();
    for (;;) {
      ws();
      if (!a || (s[i] !== "+" && s[i] !== "-")) return a;
      const o = s[i]; i += 1;
      const b = term();
      if (!b) return null;
      a = { t: o, a, b };
    }
  };
  if (!s) return { op, ast: null, error: "" };   // пусто — это «ничего не задано», не ошибка
  const ast = sum();
  if (failed) return failed;
  ws();
  if (i < s.length) return err(`лишнее «${s.slice(i)}»`);
  return { op, ast, error: "" };
}

/** Идентификаторы ресурсов, на которые ссылается выражение. */
export function refsOf(text = "") {
  const out = [];
  const re = /@\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

const walk = (n, fn) => { if (!n) return; fn(n); walk(n.a, fn); walk(n.b, fn); };
/** Номера букв, на которые ссылается выражение (по разбору; с ошибкой — пусто). */
export function lettersIn(text = "") {
  const p = parseExpr(text);
  const out = [];
  if (p.error || !p.ast) return out;
  walk(p.ast, (n) => { if (n.t === "letter" && !out.includes(n.i)) out.push(n.i); });
  return out;
}
/** Есть ли в выражении диапазон, буква или порт — то, из-за чего границы могут разойтись. */
export const hasRange = (text = "") => {
  const p = parseExpr(text);
  let yes = false;
  if (!p.error) walk(p.ast, (n) => { if (n.t === "range") yes = true; });
  return yes;
};

/**
 * Значение выражения при данных остатках. `resolve(id)` → число или
 * `undefined`, если ресурса нет: тогда значение не считается, а ошибка
 * названа — считать «ноль» за удалённый ресурс значило бы врать.
 */
export function evalExpr(text = "", resolve = () => undefined, portOf = () => undefined) {
  const p = parseExpr(text);
  if (p.error) return { op: p.op, value: null, lo: null, hi: null, error: p.error };
  if (!p.ast) return { op: p.op, value: null, lo: null, hi: null, error: "" };
  let error = "";
  const flip = (m) => (m === "lo" ? "hi" : "lo");
  const bound = (v, m) => (v && typeof v === "object" ? num(m === "lo" ? v.lo : v.hi) : num(v));
  const go = (n, m) => {
    switch (n.t) {
      case "num": return n.v;
      case "range": return m === "lo" ? n.lo : n.hi;
      case "ref": {
        const v = resolve(n.id);
        if (v === undefined || v === null) { error = error || "ресурс из выражения удалён"; return 0; }
        return bound(v, m);
      }
      case "letter": {
        const v = portOf({ i: n.i });
        if (v === undefined || v === null) { error = error || `нет ресурса с буквой «${n.ch}»`; return 0; }
        if (v.bad) { error = error || `«${n.ch}» не посчиталась`; return 0; }
        return bound(v, m);
      }
      case "port": {
        const v = portOf({ id: n.id });
        if (v === undefined || v === null) { error = error || "ресурс из операции убран из функции"; return 0; }
        if (v.bad) { error = error || "ресурс из операции сам не посчитался"; return 0; }
        return bound(v, m);
      }
      case "neg": return -go(n.a, flip(m));
      case "%": return go(n.a, m) / 100;
      case "+": return go(n.a, m) + go(n.b, m);
      case "-": return go(n.a, m) - go(n.b, flip(m));
      case "*": return go(n.a, m) * go(n.b, m);
      case "/": { const d = go(n.b, flip(m)); if (d === 0) { error = error || "деление на ноль"; return 0; } return go(n.a, m) / d; }
      default: return 0;
    }
  };
  const a = go(p.ast, "lo");
  const b = go(p.ast, "hi");
  if (error) return { op: p.op, value: null, lo: null, hi: null, error };
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return { op: p.op, value: lo, lo, hi, error };
}

/* ─── количества портов по операциям ───
   Порты функции (входы, затем выходы) или строки процесса — по порядку,
   буквами. Операция порта может ссылаться на другие порты буквой (или
   `#{id}`); те считаются первыми, круг — ошибка. Числа округляются до
   сотых. Порт без операции остаётся со своими `lo`/`hi`. */
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * @param ports [{id, lo, hi, expr}] в порядке букв
 * @param resolve id ресурса → остаток
 * @returns [{id, lo, hi, error, letter}]
 */
export function evalPorts(ports = [], resolve = () => undefined) {
  const out = ports.map((p, i) => ({ id: p.id, lo: num(p.lo), hi: num(p.hi), error: "", letter: letterOf(i) }));
  const state = new Map();
  const solve = (k) => {
    if (k < 0 || k >= out.length) return undefined;
    const BAD = { bad: true };
    if (state.get(k) === "done") return out[k].error ? BAD : out[k];
    if (state.get(k) === "busy") { out[k].error = "операции ссылаются друг на друга по кругу"; return BAD; }
    state.set(k, "busy");
    const p = ports[k];
    if (String(p.expr || "").trim()) {
      const r = evalExpr(p.expr, resolve, (ref) => solve("i" in ref ? ref.i : ports.findIndex((x) => x.id === ref.id)));
      if (r.error) out[k].error = out[k].error || r.error;
      else if (r.value != null) { out[k].lo = round2(r.lo); out[k].hi = round2(r.hi); }
    }
    state.set(k, "done");
    return out[k].error ? BAD : out[k];
  };
  ports.forEach((_, k) => solve(k));
  return out;
}

/**
 * Что цель значит здесь и сейчас: знак, число, цель для плана и выполнено ли.
 *
 * `target` — сколько должно быть, чтобы план считал; у «<» и «!» его нет.
 * «>» планируется до самого числа: «больше десяти» — это «дойти до десяти
 * и ещё», и сколько «ещё», выражение не говорит.
 */
export function goalOf(text = "", stock = {}, have = null) {
  const r = evalExpr(text, (id) => (id in stock ? num(stock[id]) : undefined));
  if (r.error || r.value == null) return { ...r, target: null, met: null };
  const { lo, hi } = r;
  const h = have == null ? null : num(have);
  /* Диапазон в цели — «от и до»: «=45-55» выполнено между границами,
     «>» — выше верхней, «<» — ниже нижней, «!» — вне. Без диапазона
     `lo` = `hi`, и это прежние правила. */
  const met = h == null ? null
    : r.op === ">" ? h > hi : r.op === "<" ? h < lo : r.op === "=" ? h >= lo && h <= hi : h < lo || h > hi;
  const target = r.op === "=" ? lo : r.op === ">" ? hi : null;
  return { ...r, target, met };
}

/* ─── имя ↔ идентификатор ───
   В форме — имена, в записи — идентификаторы. Совпадение имени ищется
   САМОЕ ДЛИННОЕ: «@Заявки в работе» не должно читаться как «@Заявки» и
   хвост. Имя с пробелами допустимо — потому и нужно самое длинное. */

/**
 * Для показа: `@{t1}` → «@Заявки»; удалённый ресурс — «@?». Порт
 * `#{p1}` → его буква по списку идентификаторов портов `ports` (в
 * порядке букв); убранный порт — «?».
 */
export function toShown(text = "", nameOf = () => "", ports = []) {
  return String(text ?? "")
    .replace(/@\{([^}]+)\}/g, (_, id) => { const n = nameOf(id); return n ? `@${n}` : "@?"; })
    .replace(/#\{([^}]+)\}/g, (_, id) => { const k = ports.indexOf(id); return k >= 0 ? letterOf(k) : "?"; });
}

/**
 * Для записи: «@Заявки» → `@{t1}` по списку ресурсов `{id, l}`; буква
 * (отдельно стоящая, кириллицей или латиницей) → `#{id}` порта по
 * списку `ports`, если такой порт есть. Неузнанное — как есть.
 */
export function toStored(text = "", traits = [], ports = []) {
  const names = traits.filter((t) => t && t.l).map((t) => ({ id: t.id, l: String(t.l) }))
    .sort((a, b) => b.l.length - a.l.length);
  let out = "";
  let i = 0;
  const s = String(text ?? "");
  while (i < s.length) {
    if (s[i] === "@" && !s.startsWith("@{", i)) {
      const hit = names.find((n) => s.startsWith(n.l, i + 1));
      if (hit) { out += `@{${hit.id}}`; i += 1 + hit.l.length; continue; }
      out += s[i]; i += 1; continue;
    }
    if (s.startsWith("@{", i) || s.startsWith("#{", i)) {
      const end = s.indexOf("}", i);
      const stop = end < 0 ? s.length : end + 1;
      out += s.slice(i, stop); i = stop; continue;
    }
    if (ports.length && isLetter(s[i]) && !ALNUM.test(s[i - 1] || "") && !ALNUM.test(s[i + 1] || "")) {
      const k = letterIndex(s[i]);
      if (k < ports.length) { out += `#{${ports[k]}}`; i += 1; continue; }
    }
    out += s[i]; i += 1;
  }
  return out;
}

/** Число старой цели → выражение: число значило «ровно столько». */
export const fromQty = (qty) => (qty == null || qty === "" ? "" : `=${num(qty)}`);
