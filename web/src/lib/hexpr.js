import { splitComparison, toDisplay } from "./expr.js";

/* ════════════════════════════════════════════════════════════════
   ГИПОТЕЗА КАК ВЫРАЖЕНИЕ

   Гипотеза пишется в одном поле, но поле это не текстовое: оно состоит из
   элементов, у каждого из которых свои параметры. Причина простая — у
   движения параметров восемь (срок, окно дат, отчёт, повтор, потоки…), и
   в строку текста они не помещаются, а прятать их в отдельную форму значит
   снова разорвать фразу и её смысл.

   Элементы:
   · res   — значение ресурса из актива:      [рабочее время]
   · text  — то, что набирается руками:       10, +, >, (
   · op    — если / иначе / пока / повторить
   · arrow — движение между соседними ресурсами: [время] → [заявки]

   Раскладывается всё это в обычные стрелки модели (`edges`): своего
   механизма влияния у гипотезы нет и быть не должно — см. инвариант 4
   в ARCHITECTURE.md.
   ════════════════════════════════════════════════════════════════ */

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const OPS = [
  { id: "if", name: "если", hint: "движения после него идут, только когда условие верно" },
  { id: "else", name: "иначе", hint: "движения после него идут, когда условие выше неверно" },
  { id: "while", name: "пока", hint: "то же условие, но проверяется на каждой попытке" },
  { id: "for", name: "повторить", hint: "сколько раз подряд сделать движения после него" },
];

export const REPEAT_WHEN = [
  { id: "once", name: "один раз" },
  { id: "now", name: "сразу, без ожидания" },
  { id: "approved", name: "после утверждения отчёта" },
  { id: "every", name: "раз в период" },
];

/* Срок движения = период попыток у стрелки модели. Одно и то же число не
   должно жить в двух полях: «за сколько сделать» и «как часто пробовать» —
   это один параметр, названный с двух сторон. */
export const ARROW_DEFAULTS = {
  gives: 0, per: "мес", sign: 1,
  start: "", end: "",
  report: false,          // следующий элемент получает отчёт от предыдущего
  repeat: "once",         // когда можно повторять
  everyPer: "мес",        // период, если repeat === "every"
  threads: 1,             // сколько раз задача дублируется в списке
};

export function newToken(kind, patch = {}) {
  if (kind === "arrow") return { id: uid("a"), kind, ...ARROW_DEFAULTS, ...patch };
  if (kind === "op") return { id: uid("o"), kind, op: "if", times: 2, ...patch };
  if (kind === "res") return { id: uid("r"), kind, trait: "", ...patch };
  return { id: uid("t"), kind: "text", text: "", ...patch };
}

/* ─────── чтение выражения ─────── */

/** Ближайший ресурс слева и справа от стрелки — это и есть её концы. */
export function arrowEnds(tokens, i) {
  let from = null, to = null;
  for (let k = i - 1; k >= 0; k--) {
    if (tokens[k].kind === "arrow") break;          // чужая стрелка — не наш конец
    if (tokens[k].kind === "res" && tokens[k].trait) { from = tokens[k].trait; break; }
  }
  for (let k = i + 1; k < tokens.length; k++) {
    if (tokens[k].kind === "arrow") break;
    if (tokens[k].kind === "res" && tokens[k].trait) { to = tokens[k].trait; break; }
  }
  return { from, to };
}

/** Условие в форме хранения: ссылки на ресурсы как {id}. */
function condText(tokens) {
  return tokens.map((t) => {
    if (t.kind === "res") return t.trait ? `{${t.trait}}` : "";
    if (t.kind === "text") return t.text || "";
    return "";
  }).join(" ").replace(/\s+/g, " ").trim();
}

/* Отрицание сравнения — переворотом знака, а не обёрткой в «не(…)»:
   разбор выражений отрицания не знает, а «иначе» без него бессмысленно. */
const FLIP = { ">": "<=", "<": ">=", ">=": "<", "<=": ">", "=": "≠", "≠": "=" };
export function negate(expr) {
  const parts = splitComparison(expr);
  if (!parts || !FLIP[parts.op]) return "";
  return `${parts.left} ${FLIP[parts.op]} ${parts.right}`;
}

/**
 * Разбирает выражение в куски: каждый оператор открывает свой участок, а
 * условие участка — это то, что стоит между оператором и его первой стрелкой.
 */
export function readExpr(tokens) {
  const list = tokens || [];
  const parts = [];
  let cur = { op: null, cond: "", condTokens: [], arrows: [], times: 1 };
  let lastCond = "";
  const push = () => { if (cur.arrows.length || cur.op) parts.push(cur); };

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind === "op") {
      push();
      cur = { op: t.op, cond: "", condTokens: [], arrows: [], times: 1, token: t };
      if (t.op === "else") cur.cond = negate(lastCond);
      if (t.op === "for") cur.times = Math.max(1, Math.round(Number(t.times) || 1));
      continue;
    }
    if (t.kind === "arrow") {
      const ends = arrowEnds(list, i);
      // Ресурс прямо перед стрелкой — её источник, а не часть условия:
      // «если деньги > 100, время → заявки» не должно читаться как
      // «если деньги > 100 время».
      const last = cur.condTokens[cur.condTokens.length - 1];
      if (last && last.kind === "res" && last.trait && last.trait === ends.from) {
        cur.condTokens.pop();
      }
      if (!cur.arrows.length && cur.op && cur.op !== "else" && cur.op !== "for") {
        cur.cond = condText(cur.condTokens);
        lastCond = cur.cond || lastCond;
      }
      cur.arrows.push({ token: t, index: i, ...ends });
      continue;
    }
    if (!cur.arrows.length) cur.condTokens.push(t);
  }
  push();
  return parts;
}

/** Чего не хватает, чтобы выражение стало движениями. Пусто — можно раскладывать. */
export function exprGaps(tokens, traits = []) {
  const list = tokens || [];
  const gaps = [];
  const arrows = list.filter((t) => t.kind === "arrow");
  if (!arrows.length) gaps.push("нет ни одной стрелки — движения не описаны");

  list.forEach((t, i) => {
    if (t.kind !== "arrow") return;
    const { from, to } = arrowEnds(list, i);
    if (!to) gaps.push("у стрелки не указан ресурс справа — некуда переносить");
    if (from && to && from === to) gaps.push("стрелка ведёт ресурс сам в себя");
    if (!(Math.abs(Number(t.gives)) > 0)) gaps.push("у стрелки не указано, сколько переносится");
  });
  if (list.some((t) => t.kind === "res" && !t.trait)) gaps.push("ресурс не выбран");

  readExpr(list).forEach((p) => {
    if ((p.op === "if" || p.op === "while") && !p.cond) {
      gaps.push(`после «${p.op === "if" ? "если" : "пока"}» не написано условие`);
    }
    if (p.op === "else" && !p.cond) {
      gaps.push("«иначе» не к чему отнести: выше нет условия со сравнением");
    }
  });
  // Ресурс мог исчезнуть из модели после того, как гипотезу отложили.
  const known = new Set(traits.map((t) => t.id));
  if (traits.length && list.some((t) => t.kind === "res" && t.trait && !known.has(t.trait))) {
    gaps.push("выражение ссылается на удалённый ресурс");
  }
  return [...new Set(gaps)];
}

/**
 * Раскладывает выражение в стрелки модели. Условие участка становится
 * условием стрелки, «пока» — попытками на каждом шаге, «повторить N» —
 * потоками (столько же задач в списке).
 */
export function exprToEdges(tokens, traits = []) {
  const list = tokens || [];
  const traitOf = (id) => traits.find((t) => t.id === id) || null;
  const out = [];
  readExpr(list).forEach((part) => {
    part.arrows.forEach((a) => {
      const t = a.token;
      const to = traitOf(a.to);
      if (!to) return;
      const threads = Math.max(1, Math.round(Number(t.threads) || 1)) * (part.times || 1);
      out.push({
        id: uid("e"),
        // Актив-источник берётся у ресурса слева: стрелка в модели идёт от
        // актива, а тратит конкретный ресурс этого актива.
        from: traitOf(a.from)?.e || to.e,
        fromTrait: a.from || null,
        to: a.to,
        carrier: t.carrier || "",
        gives: Math.abs(Number(t.gives)) || 0,
        per: t.per || "мес",
        sign: Number(t.sign) < 0 ? -1 : 1,
        conds: part.cond ? [{ expr: part.cond }] : [],
        note: "",
        basis: "hypo",
        start: t.start || "", end: t.end || "",
        // Параметры исполнения: модель их не считает, но по ним заводятся
        // задачи и напоминания.
        report: !!t.report,
        repeat: t.repeat || "once",
        everyPer: t.everyPer || "мес",
        threads,
      });
    });
  });
  return out;
}

/** Выражение словами — той же фразой и в поле, и в списке отложенных. */
export function exprText(tokens, traits = []) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l || "?";
  return (tokens || []).map((t) => {
    if (t.kind === "res") return t.trait ? `[${nameOf(t.trait)}]` : "[ресурс]";
    if (t.kind === "text") return t.text || "";
    if (t.kind === "op") {
      const op = OPS.find((o) => o.id === t.op);
      return t.op === "for" ? `повторить ${t.times} раз` : (op?.name || t.op);
    }
    if (t.kind === "arrow") return "→";
    return "";
  }).filter(Boolean).join(" ");
}

/** Условие участка человеку — по именам ресурсов, а не по id. */
export const condShown = (cond, traits = []) =>
  toDisplay(cond, (id) => traits.find((t) => t.id === id)?.l || id);
