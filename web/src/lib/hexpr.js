import { splitComparison, toDisplay } from "./expr.js";

/* ════════════════════════════════════════════════════════════════
   ГИПОТЕЗА — ПОСТРОЧНАЯ ЗАПИСЬ

   Каждая строка начинается с оператора и дальше представляет собой
   выражение. Строк столько, сколько шагов в рассуждении:

       если   [деньги] > 100
       то     [время] → [заявки]
       иначе  [время] → [обучение]

       для    element в «Клиенты»
       пока   [значение element] > 0
       повторять
       то     [время] → [значение element]
       break

   Почему строки, а не одно поле: рассуждение с ветвлением и циклом в одну
   строку не укладывается — «если … то … иначе …» приходится читать справа
   налево, а где кончается тело цикла, не видно вовсе. Оператор в начале
   строки отвечает на вопрос «что здесь происходит» до того, как читаешь
   остальное.

   ─── Что во что превращается ───

   Движок модели циклов не знает: он считает стрелки с условиями, и условие
   проверяется на каждой попытке. Поэтому раскладка статическая и честная:

   · «если C» + «то …»   — условие C у стрелок этой строки;
   · «иначе …»           — то же условие с перевёрнутым знаком (не обёрткой
                           «не(…)»: разбор выражений отрицания не знает);
   · «пока C» + «повторять» — условие C у всего тела цикла; оно и так
                           проверяется на каждой попытке — это ровно то,
                           что делает движок;
   · «для e в «Актив»»   — тело разворачивается по одной копии на каждый
                           ресурс актива, и «значение e» в этой копии
                           указывает на свой ресурс. Разворот статический,
                           поэтому в модели не остаётся ничего, чего в ней
                           нельзя посчитать;
   · «break»             — конец тела цикла: то, что после него, уже вне
                           цикла;
   · «continue»          — остаток тела не выполняется, и движения оттуда в
                           модель не попадают; о них сказано вслух, а не
                           выброшено молча.
   ════════════════════════════════════════════════════════════════ */

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const OPS = [
  { id: "if", name: "если", arg: "cond",
    hint: "условие для следующей строки «то»" },
  { id: "then", name: "то", arg: "body",
    hint: "что происходит: движения и выражения. Без «если» — происходит всегда" },
  { id: "else", name: "иначе", arg: "body",
    hint: "что происходит, когда условие последнего «если» неверно" },
  { id: "while", name: "пока", arg: "cond",
    hint: "условие цикла: его проверяет следующее «повторять»" },
  { id: "repeat", name: "повторять", arg: "none",
    hint: "выполняет то, что после него, до break — пока держится условие «пока»" },
  { id: "for", name: "для", arg: "for",
    hint: "по одному разу на каждый ресурс актива; «значение …» подставляет текущий" },
  { id: "break", name: "break", arg: "none",
    hint: "выходит из цикла: тело цикла на нём заканчивается" },
  { id: "continue", name: "continue", arg: "none",
    hint: "начинает следующее выполнение цикла; остаток тела пропускается" },
];

export const opName = (id) => OPS.find((o) => o.id === id)?.name || id;
const argOf = (id) => OPS.find((o) => o.id === id)?.arg || "body";
const LOOPS = new Set(["repeat", "for"]);

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
  if (kind === "res") return { id: uid("r"), kind, trait: "", ...patch };
  if (kind === "ent") return { id: uid("n"), kind, entity: "", ...patch };
  if (kind === "elem") return { id: uid("v"), kind, ...patch };
  return { id: uid("t"), kind: "text", text: "", ...patch };
}

/** Строка: оператор и выражение после него. */
export function newLine(op = "then", patch = {}) {
  return { id: uid("l"), op, elem: op === "for" ? "element" : "", tokens: [], ...patch };
}

/* ─────── чтение строки ─────── */

/** Ближайший ресурс слева и справа от стрелки — это и есть её концы. */
export function arrowEnds(tokens, i) {
  let from = null, to = null;
  const end = (t) => (t.kind === "res" ? t.trait : (t.kind === "elem" ? "@elem" : null));
  for (let k = i - 1; k >= 0; k--) {
    if (tokens[k].kind === "arrow") break;
    const v = end(tokens[k]);
    if (v) { from = v; break; }
  }
  for (let k = i + 1; k < tokens.length; k++) {
    if (tokens[k].kind === "arrow") break;
    const v = end(tokens[k]);
    if (v) { to = v; break; }
  }
  return { from, to };
}

/** Условие в форме хранения: ссылки на ресурсы как {id}. */
function condText(tokens, elemTrait) {
  return tokens.map((t) => {
    if (t.kind === "res") return t.trait ? `{${t.trait}}` : "";
    if (t.kind === "elem") return elemTrait ? `{${elemTrait}}` : "";
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
 * Разбор программы: во что превращается каждая строка и что с ней не так.
 * Возвращает { steps, problems }, где steps — исполняемые строки с уже
 * собранными условиями и повторами, а problems — человеческие замечания.
 */
export function readProgram(lines, { entities = [], traits = [] } = {}) {
  const list = lines || [];
  const steps = [];
  const problems = [];
  const say = (m) => { if (!problems.includes(m)) problems.push(m); };

  // Одна ветвь разбора на каждый разворот «для»: тело цикла по ресурсам
  // актива раскладывается статически, по копии на ресурс.
  const walk = (from, scopes, elemTrait, elemName) => {
    let pendingCond = null;   // условие от «если» — для следующей строки
    let lastIf = null;        // последнее «если» — для «иначе»
    let pendingWhile = null;  // условие от «пока» — для следующего «повторять»
    let i = from;

    const loopConds = () => scopes.map((s) => s.cond).filter(Boolean);
    const loopTimes = () => scopes.reduce((n, s) => n * (s.times || 1), 1);
    const dead = () => scopes.some((s) => s.dead);
    const innerLoop = () => [...scopes].reverse().find((s) => s.loop) || null;

    for (; i < list.length; i++) {
      const line = list[i];
      const op = line.op;

      if (op === "if") {
        pendingCond = condText(line.tokens, elemTrait);
        lastIf = pendingCond;
        if (!pendingCond) say("после «если» не написано условие");
        continue;
      }
      if (op === "while") {
        pendingWhile = condText(line.tokens, elemTrait);
        if (!pendingWhile) say("после «пока» не написано условие");
        continue;
      }
      if (op === "repeat") {
        scopes.push({ loop: true, cond: pendingWhile, times: 1, dead: false });
        pendingWhile = null;
        continue;
      }
      if (op === "for") {
        const tok = line.tokens.find((t) => t.kind === "ent");
        const ent = tok && entities.find((e) => e.id === tok.entity);
        if (!ent) { say("в «для» не выбран актив, по ресурсам которого идти"); continue; }
        const own = traits.filter((t) => t.e === ent.id);
        if (!own.length) { say(`у актива «${ent.name}» нет ресурсов — обходить нечего`); continue; }
        // Разворот: по копии тела на каждый ресурс актива.
        own.forEach((t) => {
          walk(i + 1, [...scopes, { loop: true, cond: null, times: 1, dead: false, for: true }],
            t.id, line.elem || "element");
        });
        return;   // хвост уже разобран внутри копий
      }
      if (op === "break") {
        const loop = innerLoop();
        if (!loop) { say("break стоит вне цикла — выходить неоткуда"); continue; }
        // Тело цикла на break заканчивается: дальше идёт то, что после цикла.
        scopes.splice(scopes.lastIndexOf(loop), 1);
        continue;
      }
      if (op === "continue") {
        const loop = innerLoop();
        if (!loop) { say("continue стоит вне цикла — продолжать нечего"); continue; }
        loop.dead = true;
        continue;
      }

      // «то» и «иначе» — единственные строки, которые что-то делают.
      const branch = op === "else" ? negate(lastIf || "") : pendingCond;
      if (op === "else" && !branch) {
        say(lastIf ? "«иначе» не к чему отнести: в «если» нет сравнения"
          : "«иначе» без «если» выше");
      }
      if (op === "then") pendingCond = null;

      const arrows = line.tokens
        .map((t, k) => (t.kind === "arrow" ? { token: t, ...arrowEnds(line.tokens, k) } : null))
        .filter(Boolean);
      if (line.tokens.some((t) => t.kind === "elem") && !elemTrait) {
        say(`«значение ${elemName || "element"}» вне цикла «для» — подставлять нечего`);
      }
      if (dead() && arrows.length) {
        say("после break или continue есть движения — они не выполнятся");
      }
      steps.push({
        line, index: i, op,
        conds: [...loopConds(), branch].filter(Boolean),
        times: loopTimes(),
        arrows, elemTrait, elemName, dead: dead(),
      });
    }
  };

  walk(0, [], null, null);
  return { steps, problems };
}

/** Чего не хватает, чтобы программу можно было разложить в движения. */
export function exprGaps(lines, traits = [], entities = []) {
  const list = lines || [];
  const gaps = [];
  const say = (m) => { if (!gaps.includes(m)) gaps.push(m); };
  if (!list.length) return ["строк пока нет"];

  const { steps, problems } = readProgram(list, { entities, traits });
  problems.forEach(say);

  const live = steps.filter((s) => !s.dead);
  if (!live.some((s) => s.arrows.length)) say("нет ни одной стрелки — движения не описаны");

  const known = new Set(traits.map((t) => t.id));
  live.forEach((s) => {
    s.arrows.forEach((a) => {
      const to = a.to === "@elem" ? s.elemTrait : a.to;
      const from = a.from === "@elem" ? s.elemTrait : a.from;
      if (!to) say("у стрелки не указан ресурс справа — некуда переносить");
      else if (!known.has(to)) say("выражение ссылается на удалённый ресурс");
      if (from && to && from === to) say("стрелка ведёт ресурс сам в себя");
      if (!(Math.abs(Number(a.token.gives)) > 0)) say("у стрелки не указано, сколько переносится");
    });
    s.line.tokens.forEach((t) => {
      if (t.kind === "res" && !t.trait) say("ресурс не выбран");
      if (t.kind === "res" && t.trait && !known.has(t.trait)) {
        say("выражение ссылается на удалённый ресурс");
      }
    });
  });
  return gaps;
}

/** Раскладывает программу в стрелки модели. */
export function exprToEdges(lines, traits = [], entities = []) {
  const traitOf = (id) => traits.find((t) => t.id === id) || null;
  const { steps } = readProgram(lines || [], { entities, traits });
  const out = [];
  steps.filter((s) => !s.dead).forEach((s) => {
    s.arrows.forEach((a) => {
      const toId = a.to === "@elem" ? s.elemTrait : a.to;
      const fromId = a.from === "@elem" ? s.elemTrait : a.from;
      const to = traitOf(toId);
      if (!to) return;
      const t = a.token;
      const threads = Math.max(1, Math.round(Number(t.threads) || 1)) * (s.times || 1);
      out.push({
        id: uid("e"),
        // Актив-источник берётся у ресурса слева: стрелка в модели идёт от
        // актива, а тратит конкретный ресурс этого актива.
        from: traitOf(fromId)?.e || to.e,
        fromTrait: fromId || null,
        to: toId,
        carrier: t.carrier || "",
        gives: Math.abs(Number(t.gives)) || 0,
        per: t.per || "мес",
        sign: Number(t.sign) < 0 ? -1 : 1,
        // Условия перемножаются движком — это и есть «и» между ними.
        conds: s.conds.map((expr) => ({ expr })),
        note: "",
        basis: "hypo",
        start: t.start || "", end: t.end || "",
        report: !!t.report,
        repeat: t.repeat || "once",
        everyPer: t.everyPer || "мес",
        threads,
      });
    });
  });
  return out;
}

/** Строка словами — та же фраза и в поле, и в списке отложенных. */
export function lineText(line, traits = [], entities = []) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l || "?";
  const entName = (id) => entities.find((e) => e.id === id)?.name || "?";
  const head = opName(line.op);
  if (line.op === "for") {
    const tok = line.tokens.find((t) => t.kind === "ent");
    return `для ${line.elem || "element"} в «${tok?.entity ? entName(tok.entity) : "актив"}»`;
  }
  const body = (line.tokens || []).map((t) => {
    if (t.kind === "res") return t.trait ? `[${nameOf(t.trait)}]` : "[ресурс]";
    if (t.kind === "elem") return "[значение element]";
    if (t.kind === "ent") return t.entity ? `«${entName(t.entity)}»` : "«актив»";
    if (t.kind === "text") return t.text || "";
    if (t.kind === "arrow") return "→";
    return "";
  }).filter(Boolean).join(" ");
  return body ? `${head} ${body}` : head;
}

export const exprText = (lines, traits = [], entities = []) =>
  (lines || []).map((l) => lineText(l, traits, entities)).join("\n");

/** Условие участка человеку — по именам ресурсов, а не по id. */
export const condShown = (cond, traits = []) =>
  toDisplay(cond, (id) => traits.find((t) => t.id === id)?.l || id);

export { LOOPS, argOf };
