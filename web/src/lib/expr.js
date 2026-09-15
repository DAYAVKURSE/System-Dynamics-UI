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
   ════════════════════════════════════════════════════════════════ */

export const OPS = [">", "<", "=", "!"];
const REF = /^@\{([^}]+)\}/;
const NUM = /^\d+(?:[.,]\d+)?/;

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
    const n = s.slice(i).match(NUM);
    if (n) { i += n[0].length; return { t: "num", v: Number(n[0].replace(",", ".")) }; }
    return fail(`не понимаю «${s[i]}»`);
  };
  /* Процент: «20%» → 0,2. Процент, за которым сразу число, ресурс или
     скобка, — «процент ОТ»: «20% @Заявки» = 0,2 · заявки. */
  const pct = (f) => {
    let a = f;
    ws();
    while (a && s[i] === "%") {
      i += 1; a = { t: "%", a }; ws();
      if (/[\d@(]/.test(s[i] || "")) { const b = factor(); if (!b) return null; a = { t: "*", a, b }; ws(); }
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

/**
 * Значение выражения при данных остатках. `resolve(id)` → число или
 * `undefined`, если ресурса нет: тогда значение не считается, а ошибка
 * названа — считать «ноль» за удалённый ресурс значило бы врать.
 */
export function evalExpr(text = "", resolve = () => undefined) {
  const p = parseExpr(text);
  if (p.error) return { op: p.op, value: null, error: p.error };
  if (!p.ast) return { op: p.op, value: null, error: "" };
  let error = "";
  const go = (n) => {
    switch (n.t) {
      case "num": return n.v;
      case "ref": {
        const v = resolve(n.id);
        if (v === undefined || v === null) { error = error || "ресурс из выражения удалён"; return 0; }
        return num(v);
      }
      case "neg": return -go(n.a);
      case "%": return go(n.a) / 100;
      case "+": return go(n.a) + go(n.b);
      case "-": return go(n.a) - go(n.b);
      case "*": return go(n.a) * go(n.b);
      case "/": { const d = go(n.b); if (d === 0) { error = error || "деление на ноль"; return 0; } return go(n.a) / d; }
      default: return 0;
    }
  };
  const value = go(p.ast);
  return { op: p.op, value: error ? null : value, error };
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
  const v = r.value;
  const h = have == null ? null : num(have);
  const met = h == null ? null
    : r.op === ">" ? h > v : r.op === "<" ? h < v : r.op === "=" ? h === v : h !== v;
  const target = r.op === "=" || r.op === ">" ? v : null;
  return { ...r, target, met };
}

/* ─── имя ↔ идентификатор ───
   В форме — имена, в записи — идентификаторы. Совпадение имени ищется
   САМОЕ ДЛИННОЕ: «@Заявки в работе» не должно читаться как «@Заявки» и
   хвост. Имя с пробелами допустимо — потому и нужно самое длинное. */

/** Для показа: `@{t1}` → «@Заявки»; удалённый ресурс — «@?». */
export function toShown(text = "", nameOf = () => "") {
  return String(text ?? "").replace(/@\{([^}]+)\}/g, (_, id) => {
    const n = nameOf(id);
    return n ? `@${n}` : "@?";
  });
}

/** Для записи: «@Заявки» → `@{t1}` по списку ресурсов `{id, l}`. Неузнанное — как есть. */
export function toStored(text = "", traits = []) {
  const names = traits.filter((t) => t && t.l).map((t) => ({ id: t.id, l: String(t.l) }))
    .sort((a, b) => b.l.length - a.l.length);
  let out = "";
  let i = 0;
  const s = String(text ?? "");
  while (i < s.length) {
    if (s[i] !== "@" || s.startsWith("@{", i)) { out += s[i]; i += 1; continue; }
    const hit = names.find((n) => s.startsWith(n.l, i + 1));
    if (!hit) { out += s[i]; i += 1; continue; }
    out += `@{${hit.id}}`;
    i += 1 + hit.l.length;
  }
  return out;
}

/** Число старой цели → выражение: число значило «ровно столько». */
export const fromQty = (qty) => (qty == null || qty === "" ? "" : `=${num(qty)}`);
