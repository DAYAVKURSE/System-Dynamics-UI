/* ════════════════════════════════════════════════════════════════
   Числовые выражения со ссылками на ресурсы модели.

   Выражение — это формула со ссылками на ресурсы: «активные реферы * 2»,
   «пользователи / 100 + 5». Наверху разбора стоит сравнение, поэтому
   «10 - x > y + z» читается без скобок и даёт 1 или 0 — на этом держится
   условие вида «пропускает, если верно».

   Два представления одного выражения:
   · хранение  — ссылка по id ресурса:   {r5} * 2
   · показ     — ссылка по имени:        [активные реферы] * 2

   Хранится id, потому что ресурс можно переименовать: имя изменится, а
   выражение продолжит указывать на ту же величину. Пользователю же имя
   показывается, потому что id он не знает и знать не должен.
   ════════════════════════════════════════════════════════════════ */

const REF_STORAGE = /\{([^{}]+)\}/g;
const REF_DISPLAY = /\[([^[\]]*)\]/g;

/* Сравнения. Пишут их по-разному — принимаем все написания и приводим к
   одному, чтобы дальше о разнице не думать. */
const CMP2 = [">=", "<=", "<>", "!=", "=="];
const CMP1 = [">", "<", "=", "\u2265", "\u2264", "\u2260"];
const CMP_NORM = {
  ">=": ">=", "\u2265": ">=", "<=": "<=", "\u2264": "<=",
  "<>": "\u2260", "!=": "\u2260", "\u2260": "\u2260",
  "==": "=", "=": "=", ">": ">", "<": "<",
};

/* ─────── разбор и вычисление ─────── */

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = String(src ?? "");

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) { i++; continue; }

    // Двухсимвольные раньше односимвольных, иначе «>=» прочтётся как «>».
    const two = s.slice(i, i + 2);
    if (CMP2.includes(two)) { tokens.push({ t: "cmp", v: CMP_NORM[two] }); i += 2; continue; }
    if (CMP1.includes(ch)) { tokens.push({ t: "cmp", v: CMP_NORM[ch] }); i++; continue; }

    if ("+-*/()".includes(ch)) { tokens.push({ t: ch }); i++; continue; }

    // Запятая как десятичный разделитель: на телефоне её набрать проще точки.
    if (/[0-9.,]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      const raw = s.slice(i, j).replace(",", ".");
      const num = Number(raw);
      if (!isFinite(num)) return { error: `не число: «${s.slice(i, j)}»` };
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }

    if (ch === "{") {
      const end = s.indexOf("}", i);
      if (end === -1) return { error: "незакрытая ссылка на ресурс" };
      tokens.push({ t: "ref", v: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Имя ресурса, не переведённое в ссылку, — обычно опечатка в названии.
    if (ch === "[") {
      const end = s.indexOf("]", i);
      const name = end === -1 ? s.slice(i + 1) : s.slice(i + 1, end);
      return { error: `неизвестный ресурс: «${name}»` };
    }

    return { error: `непонятный символ: «${ch}»` };
  }
  return { tokens };
}

/* Рекурсивный спуск: сравнение → слагаемые → множители → атом.
   Сравнение — на самом верху, поэтому «10 - x > y + z» читается как
   «(10 - x) > (y + z)», а не требует скобок. Результат сравнения — 1 или 0. */
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => (tokens[pos]?.t === t ? tokens[pos++] : null);

  // Сравнение не цепочечное: «a > b > c» — почти всегда описка, и молча
  // посчитать это как «(a > b) > c» значило бы выдать бессмыслицу за ответ.
  function compare() {
    const a = sum();
    if (a.error) return a;
    const op = eat("cmp");
    if (!op) return a;
    const b = sum();
    if (b.error) return b;
    if (peek()?.t === "cmp") {
      return { error: "два сравнения подряд — раздели на два условия" };
    }
    return { op: "cmp", cmp: op.v, a, b };
  }

  function sum() {
    let node = term();
    if (node.error) return node;
    for (;;) {
      const op = eat("+") || eat("-");
      if (!op) return node;
      const rhs = term();
      if (rhs.error) return rhs;
      node = { op: op.t, a: node, b: rhs };
    }
  }

  function term() {
    let node = unary();
    if (node.error) return node;
    for (;;) {
      const op = eat("*") || eat("/");
      if (!op) return node;
      const rhs = unary();
      if (rhs.error) return rhs;
      node = { op: op.t, a: node, b: rhs };
    }
  }

  function unary() {
    if (eat("-")) {
      const node = unary();
      return node.error ? node : { op: "neg", a: node };
    }
    if (eat("+")) return unary();
    return atom();
  }

  function atom() {
    const tok = peek();
    if (!tok) return { error: "выражение обрывается" };
    if (eat("num")) return { num: tok.v };
    if (eat("ref")) return { ref: tok.v };
    if (eat("(")) {
      const node = compare();
      if (node.error) return node;
      if (!eat(")")) return { error: "не закрыта скобка" };
      return node;
    }
    return { error: `лишний символ: «${tok.t}»` };
  }

  const node = compare();
  if (node.error) return node;
  if (pos < tokens.length) return { error: "лишнее в конце выражения" };
  return node;
}

function walk(node, valueOf) {
  if (node.num != null) return { value: node.num };
  if (node.ref != null) {
    const v = valueOf(node.ref);
    if (v == null || !isFinite(Number(v))) {
      return { error: "ресурс не найден или без значения" };
    }
    return { value: Number(v) };
  }
  const a = walk(node.a, valueOf);
  if (a.error) return a;
  if (node.op === "neg") return { value: -a.value };
  const b = walk(node.b, valueOf);
  if (b.error) return b;
  if (node.op === "cmp") {
    // Допуск на погрешность: после деления и умножения точное равенство
    // почти никогда не выполняется, и «=» без допуска был бы бесполезен.
    const e = 1e-9, d = a.value - b.value;
    switch (node.cmp) {
      case ">": return { value: d > e ? 1 : 0 };
      case "<": return { value: d < -e ? 1 : 0 };
      case ">=": return { value: d >= -e ? 1 : 0 };
      case "<=": return { value: d <= e ? 1 : 0 };
      case "=": return { value: Math.abs(d) <= e ? 1 : 0 };
      case "\u2260": return { value: Math.abs(d) > e ? 1 : 0 };
      default: return { error: "неизвестное сравнение" };
    }
  }
  switch (node.op) {
    case "+": return { value: a.value + b.value };
    case "-": return { value: a.value - b.value };
    case "*": return { value: a.value * b.value };
    case "/":
      // Деление на ноль не должно давать Infinity: в модели это почти всегда
      // означает «нет данных», а не «бесконечно много».
      if (b.value === 0) return { error: "деление на ноль" };
      return { value: a.value / b.value };
    default: return { error: "неизвестная операция" };
  }
}

/* Вычисляет выражение в форме хранения. valueOf(id) отдаёт текущее значение
   ресурса. Возвращает {value} либо {error} — исключения не бросает: битое
   выражение не должно ронять пересчёт всей модели. */
// Разбор кэшируется по тексту: условия проверяются на каждой попытке внутри
// месяца, и разбирать одну и ту же строку тысячи раз за пересчёт нельзя.
const AST_CACHE = new Map();
const AST_CACHE_MAX = 500;

function astOf(text) {
  const hit = AST_CACHE.get(text);
  if (hit) return hit;
  const lexed = tokenize(text);
  const ast = lexed.error ? { error: lexed.error }
    : (!lexed.tokens.length ? { error: "пусто" } : parse(lexed.tokens));
  if (AST_CACHE.size >= AST_CACHE_MAX) AST_CACHE.clear();
  AST_CACHE.set(text, ast);
  return ast;
}

export function evaluate(src, valueOf) {
  const text = String(src ?? "").trim();
  if (!text) return { error: "пусто" };

  const ast = astOf(text);
  if (ast.error) return { error: ast.error };

  const out = walk(ast, valueOf);
  if (out.error) return out;
  if (!isFinite(out.value)) return { error: "получилось не число" };
  return { value: out.value };
}

/* ─────── ссылки: id ⇄ имя ─────── */

// Хранение → показ: {r5} превращается в [активные реферы].
export function toDisplay(src, nameOf) {
  return String(src ?? "").replace(REF_STORAGE, (_, id) => `[${nameOf(id) ?? "?"}]`);
}

// Показ → хранение: [активные реферы] превращается в {r5}.
// Неузнанное имя намеренно остаётся в квадратных скобках — так пользователь
// видит, что именно не распозналось, а не молча получает сломанный расчёт.
export function toStorage(src, idOf) {
  return String(src ?? "").replace(REF_DISPLAY, (whole, name) => {
    const id = idOf(String(name).trim());
    return id ? `{${id}}` : whole;
  });
}

// Какие ресурсы участвуют в выражении — нужно, чтобы подсветить зависимости.
export function refsOf(src) {
  return [...String(src ?? "").matchAll(REF_STORAGE)].map((m) => m[1]);
}

/* Верхнеуровневое сравнение в выражении: «10 - {a} > {b} + 2» разбирается на
   левую часть, знак и правую. Нужно, чтобы показать человеку обе стороны
   числами и чтобы переключение вида условия не теряло написанное.
   Скобки и ссылки пропускаются целиком — знак внутри них не считается. */
export function splitComparison(src) {
  const s = String(src ?? "");
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (ch === "{" || ch === "[") {
      const end = s.indexOf(ch === "{" ? "}" : "]", i);
      i = end === -1 ? s.length : end;
      continue;
    }
    if (depth !== 0) continue;
    const two = s.slice(i, i + 2);
    if (CMP2.includes(two)) {
      return { left: s.slice(0, i).trim(), op: CMP_NORM[two], right: s.slice(i + 2).trim() };
    }
    if (CMP1.includes(ch)) {
      return { left: s.slice(0, i).trim(), op: CMP_NORM[ch], right: s.slice(i + 1).trim() };
    }
  }
  return null;
}
