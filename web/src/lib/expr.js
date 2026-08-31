/* ════════════════════════════════════════════════════════════════
   Числовые выражения со ссылками на ресурсы модели.

   Условие перетекания сравнивает две величины, и каждая из них может быть
   не просто числом, а формулой: «активные реферы * 2», «пользователи / 100 + 5».

   Два представления одного выражения:
   · хранение  — ссылка по id ресурса:   {r5} * 2
   · показ     — ссылка по имени:        [активные реферы] * 2

   Хранится id, потому что ресурс можно переименовать: имя изменится, а
   выражение продолжит указывать на ту же величину. Пользователю же имя
   показывается, потому что id он не знает и знать не должен.
   ════════════════════════════════════════════════════════════════ */

const REF_STORAGE = /\{([^{}]+)\}/g;
const REF_DISPLAY = /\[([^[\]]*)\]/g;

/* ─────── разбор и вычисление ─────── */

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = String(src ?? "");

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) { i++; continue; }

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

/* Рекурсивный спуск: выражение → слагаемые → множители → атом.
   Приоритет операций обычный, скобки поддерживаются. */
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => (tokens[pos]?.t === t ? tokens[pos++] : null);

  function expr() {
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
      const node = expr();
      if (node.error) return node;
      if (!eat(")")) return { error: "не закрыта скобка" };
      return node;
    }
    return { error: `лишний символ: «${tok.t}»` };
  }

  const node = expr();
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
export function evaluate(src, valueOf) {
  const text = String(src ?? "").trim();
  if (!text) return { error: "пусто" };

  const lexed = tokenize(text);
  if (lexed.error) return { error: lexed.error };
  if (!lexed.tokens.length) return { error: "пусто" };

  const ast = parse(lexed.tokens);
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
