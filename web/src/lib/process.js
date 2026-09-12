/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · что за чем следует

   Владелец описывает процесс текстом, строка за строкой: какой актив
   какой ресурс берёт в каком количестве и что отдаёт. Строка одного вида:

     <Актив>: берёт <Ресурс> <число>[, <Ресурс> <число>…] → отдаёт <Ресурс> <число>[, …]

   «даёт» и «выдаёт» читаются как «отдаёт», «->» — как «→». Имена
   сравниваются без регистра, лишних пробелов и разницы «е/ё»: человек
   пишет как говорит, и «Заявки» с «заявки» — одно и то же.

   Текст — единственный источник. Из него строятся ФУНКЦИИ (по одной на
   строку, в активе строки), и они кладутся в `funcs` наравне с остальными:
   так схема их рисует, карточка актива показывает, а расчёт считает без
   отдельного пути «для процессов». Функция помечена `proc` — по этой
   пометке её пересобирают при правке текста и убирают, когда процесс
   не принят.

   ─── три состояния ───

   `off`  — не принято: функций от процесса нет, гипотетические сущности
            убраны;
   `hypo` — принято гипотетически: функции есть, но расчёт берёт их только
            с галочкой «включить гипотезы» (`activeFuncs` в lib/funcs.js);
   `on`   — принято: считается всегда.

   ─── неизвестные имена ───

   Актив или ресурс, которого на схеме нет, — не ошибка: так процесс
   и придумывают. Такое имя показано пунктиром, и человек либо принимает
   его (сущность заводится с пометкой `hypo`, её id — в `hypo` процесса),
   либо отклоняет (имя — в `missing.rejected`). Пока в тексте есть
   неизвестное, отклонённое или удалённое со схемы — принять процесс
   нельзя: функция без ресурса ничего не преобразует.

   ─── запись ───

   { id, text, status, steps, hypo:{entities:[id], traits:[id]},
     missing:{rejected:[имя]} }

   `steps` — разбор текста с найденными id на момент последней правки.
   Хранится ради двух вещей: переименованная на схеме сущность остаётся
   найденной (id помнит, чего имя уже не знает), а удалённая — видна как
   удалённая, а не как никогда не существовавшая: ей просят замену.
   ════════════════════════════════════════════════════════════════ */

let seq = 0;
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
  text: "",
  status: "off",
  steps: [],
  hypo: { entities: [], traits: [] },
  missing: { rejected: [] },
});

/** Достраивает запись до нынешней; молчание прежних записей — «не принято». */
export const normalizeProc = (p = {}) => ({
  ...p,
  id: p.id ?? nextId("pr"),
  text: p.text == null ? "" : String(p.text),
  status: STATUSES.includes(p.status) ? p.status : "off",
  steps: Array.isArray(p.steps) ? p.steps : [],
  hypo: { entities: ids(p.hypo?.entities), traits: ids(p.hypo?.traits) },
  missing: { rejected: (Array.isArray(p.missing?.rejected) ? p.missing.rejected : [])
    .map(String) },
});
export const normalizeProcs = (list) =>
  (Array.isArray(list) ? list.map(normalizeProc) : []);

/** Имя для сравнения: без регистра, лишних пробелов и разницы «е/ё». */
export const nameKey = (s) => String(s ?? "").trim().toLowerCase()
  .replace(/ё/g, "е").replace(/\s+/g, " ");

/** Первая строка текста — так процесс зовут в списке и в именах функций. */
export const procLabel = (p = {}) => (String(p.text || "").split("\n")
  .map((l) => l.trim()).find(Boolean) || "процесс");

/* ─────── разбор ─────── */

// Не `\b`: граница слова в JS знает только латиницу, и после «т» её нет.
const TAKE = /^бер[её]т(?=\s|$)/i;
const GIVE = /^(?:отда|выда|да)[её]т(?=\s|$)/i;
const ARROW = /\s*(?:→|->)\s*/;
const num = (s) => Number(String(s).replace(",", "."));

/* Один пункт списка: «имя число». Число — в конце, имя — всё до него:
   имя ресурса само может быть из нескольких слов. */
const parseItem = (raw) => {
  const m = raw.trim().match(/^(.*\S)\s+(\d+(?:[.,]\d+)?)$/);
  return m ? { name: m[1].trim(), qty: num(m[2]) } : null;
};
const parseList = (raw, what) => {
  const items = [];
  // Запятая перед цифрой — десятичная («1,5»), остальные разделяют пункты.
  const parts = raw.split(/,(?!\d)/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { items, error: `не сказано, что ${what}` };
  for (const part of parts) {
    const it = parseItem(part);
    if (!it) return { items, error: `у «${part}» не указано число` };
    items.push(it);
  }
  return { items, error: null };
};

/**
 * Разбор текста по строкам. Пустые строки пропускаются; у каждой
 * непустой — свой шаг, даже с ошибкой: строку показывают там же, где
 * ошибка, а не отдельным списком в стороне.
 *
 * Имена ищутся среди активов и ресурсов: ресурс — сперва среди ресурсов
 * актива строки, потом среди всех. Ненайденное остаётся с `id: null`.
 */
export function parseProcess(text = "", { entities = [], traits = [] } = {}) {
  const findEntity = (name) => entities.find((e) => nameKey(e.name) === nameKey(name)) || null;
  const findTrait = (name, e) => {
    const same = traits.filter((t) => nameKey(t.l) === nameKey(name));
    return same.find((t) => e && t.e === e) || same[0] || null;
  };
  const steps = [];
  const errors = [];
  String(text || "").split("\n").forEach((raw, i) => {
    const line = i + 1;
    const src = raw.trim();
    if (!src) return;
    const step = { line, text: src, asset: null, takes: [], gives: [], error: null };
    const fail = (message) => { step.error = message; errors.push({ line, message }); steps.push(step); };
    const colon = src.indexOf(":");
    if (colon < 0) return fail("нет двоеточия после актива");
    const assetName = src.slice(0, colon).trim();
    if (!assetName) return fail("не назван актив");
    const ent = findEntity(assetName);
    step.asset = { name: assetName, id: ent ? ent.id : null };
    const sides = src.slice(colon + 1).trim().split(ARROW);
    if (sides.length < 2) return fail("нет стрелки «→» между «берёт» и «отдаёт»");
    if (sides.length > 2) return fail("стрелка «→» должна быть одна");
    const [left, right] = sides;
    if (!TAKE.test(left)) return fail("после двоеточия ожидается «берёт»");
    if (!GIVE.test(right)) return fail("после стрелки ожидается «отдаёт»");
    const takes = parseList(left.replace(TAKE, ""), "берёт");
    if (takes.error) return fail(takes.error);
    const gives = parseList(right.replace(GIVE, ""), "отдаёт");
    if (gives.error) return fail(gives.error);
    const resolve = (it) => {
      const t = findTrait(it.name, step.asset.id);
      return { name: it.name, id: t ? t.id : null, qty: it.qty };
    };
    step.takes = takes.items.map(resolve);
    step.gives = gives.items.map(resolve);
    steps.push(step);
    return undefined;
  });
  return { steps, errors };
}

/** Строка в каноническом виде — ею заменяют строку, где поменяли имя. */
export const formatStep = (s) => `${s.asset?.name || ""}: берёт ${s.takes
  .map((t) => `${t.name} ${t.qty}`).join(", ")} → отдаёт ${s.gives
  .map((t) => `${t.name} ${t.qty}`).join(", ")}`;

/* ─────── разбор с памятью записи ─────── */

/**
 * Разбор текста поверх прежних `steps` процесса: имя, которое сейчас не
 * находится, получает id из прежнего разбора. Так переименованная на схеме
 * сущность остаётся своей, а удалённая — видна удалённой (`stateOf`).
 */
export function resolveProc(proc = {}, model = {}) {
  const now = parseProcess(proc.text, model);
  const prev = { asset: new Map(), trait: new Map() };
  (proc.steps || []).forEach((s) => {
    if (s.asset?.id) prev.asset.set(nameKey(s.asset.name), s.asset.id);
    [...(s.takes || []), ...(s.gives || [])].forEach((t) => {
      if (t.id) prev.trait.set(nameKey(t.name), t.id);
    });
  });
  const fill = (it, kind) => (it && !it.id && prev[kind].has(nameKey(it.name))
    ? { ...it, id: prev[kind].get(nameKey(it.name)) } : it);
  const steps = now.steps.map((s) => ({
    ...s,
    asset: fill(s.asset, "asset"),
    takes: s.takes.map((t) => fill(t, "trait")),
    gives: s.gives.map((t) => fill(t, "trait")),
  }));
  return { steps, errors: now.errors };
}

/**
 * Что с именем: найдено, удалено со схемы, отклонено или неизвестно.
 * Четыре состояния — четыре разных действия у человека, и различать их
 * должен разбор, а не форма.
 */
export function stateOf(item, kind, { entities = [], traits = [] } = {}, proc = {}) {
  if (!item) return "unknown";
  const list = kind === "asset" ? entities : traits;
  if (item.id) return list.some((x) => x.id === item.id) ? "ok" : "deleted";
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
    s.takes.forEach((t) => put(t, "trait"));
    s.gives.forEach((t) => put(t, "trait"));
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
 * По функции на шаг, в активе шага. Идентификаторы выводятся из процесса
 * и номера строки: при каждой пересборке функция остаётся той же — и
 * задачи, поставленные на неё, не повисают.
 *
 * Строка, где чего-то нет (неизвестное, отклонённое, удалённое), функции
 * не даёт: у такого шага нечего брать или некуда отдавать.
 *
 * Количество точное — `lo = hi = число`: в процессе пишут число, а не
 * вилку. Время выполнения — как у любой новой функции (день): процесс
 * про то, что за чем следует, а не про сроки; сроки правят в карточке.
 */
export function procFuncs(proc = {}, model = {}) {
  if (proc.status === "off") return [];
  const { steps } = resolveProc(proc, model);
  const label = `процесс: ${procLabel(proc)}`;
  const ok = (it, kind) => stateOf(it, kind, model, proc) === "ok";
  return steps.filter((s) => !s.error && ok(s.asset, "asset")
    && s.takes.every((t) => ok(t, "trait")) && s.gives.every((t) => ok(t, "trait")))
    .map((s) => {
      const port = (t, j, side) => ({
        id: `p_${proc.id}_${s.line}_${side}${j}`, trait: t.id, lo: t.qty, hi: t.qty,
      });
      return {
        id: `${proc.id}_${s.line}`,
        e: s.asset.id,
        name: label,
        proc: proc.id,
        takes: s.takes.map((t, j) => port(t, j, "t")),
        gives: s.gives.map((t, j) => port(t, j, "g")),
        dur: 1, durHi: 1, durUnit: "дн",
        accepted: true,
      };
    });
}

/**
 * Функции процессов — заново по нынешним текстам.
 *
 * Свои поля у собранной прежде функции (положение на схеме, роли, люди)
 * остаются: их правили в карточке, и текст процесса про них ничего не
 * говорит. Рецепт — что берёт и что отдаёт — всегда из текста.
 */
export function syncProcFuncs(funcs = [], procs = [], model = {}, normalize = (f) => f) {
  const alive = new Set(procs.filter((p) => p.status !== "off").map((p) => p.id));
  const was = new Map(funcs.filter((f) => f.proc).map((f) => [f.id, f]));
  const rest = funcs.filter((f) => !f.proc);
  const built = procs.filter((p) => alive.has(p.id))
    .flatMap((p) => procFuncs(p, model))
    .map((f) => normalize({ ...(was.get(f.id) || {}), ...f }));
  return [...rest, ...built];
}

/**
 * Уборка гипотетических сущностей процесса — когда его сняли или удалили.
 *
 * Уходит только то, чем больше никто не пользуется: ресурс, который взяла
 * или выдаёт чужая функция, остаётся — он уже не гипотеза, а часть
 * схемы. Актив уходит, когда в нём не осталось ни функций, ни ресурсов.
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
      hypo: { entities: (proc.hypo?.entities || []).filter((id) => !goneE.has(id)),
        traits: (proc.hypo?.traits || []).filter((id) => !goneT.has(id)) } },
  };
}

/* ─────── подсказки при наборе ─────── */

const TOKEN = /(бер[её]т|отда[её]т|выда[её]т|да[её]т|,|→|->)\s*/gi;

/**
 * Что подсказывать у курсора: актив — пока в строке нет двоеточия; ресурс
 * — после «берёт», «отдаёт» и запятой, пока у пункта нет числа. Иначе
 * ничего: после стрелки ждут слово «отдаёт», а после числа — запятую.
 *
 * @returns {{kind:"asset"|"trait", start:number, query:string}|null}
 *   `start` — откуда набранное заменяется именем.
 */
export function hintAt(text = "", at = 0) {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const line = text.slice(lineStart, at);
  const colon = line.indexOf(":");
  if (colon < 0) {
    const lead = line.length - line.trimStart().length;
    return { kind: "asset", start: lineStart + lead, query: line.trim() };
  }
  const tail = line.slice(colon + 1);
  let last = null;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(tail); m; m = TOKEN.exec(tail)) last = m;
  if (!last) return null;
  if (/^(→|->)/.test(last[1])) return null;
  const after = tail.slice(last.index + last[0].length);
  // Имя уже с числом — пункт закончен, дальше ждут запятую, не имя.
  if (/\S\s+\d/.test(after)) return null;
  return { kind: "trait", start: lineStart + colon + 1 + last.index + last[0].length,
    query: after.trim() };
}

/**
 * Имена под подсказку: активы или ресурсы, начинающиеся с набранного.
 * Ресурсы актива строки — первыми: их и берут чаще всего.
 */
export function suggestNames(hint, { entities = [], traits = [] } = {}, assetId = null) {
  if (!hint) return [];
  const q = nameKey(hint.query);
  const fits = (n) => n && nameKey(n).startsWith(q);
  if (hint.kind === "asset") {
    return [...new Set(entities.map((e) => e.name).filter(fits))];
  }
  const own = traits.filter((t) => t.e === assetId).map((t) => t.l);
  const others = traits.filter((t) => t.e !== assetId).map((t) => t.l);
  const seen = new Set();
  return [...own, ...others].filter((n) => {
    if (!fits(n) || seen.has(nameKey(n))) return false;
    seen.add(nameKey(n));
    return true;
  });
}

/** Актив строки, где стоит курсор, — чтобы подсказать сперва его ресурсы. */
export function assetAt(text = "", at = 0, { entities = [] } = {}) {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const line = text.slice(lineStart, at);
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const name = nameKey(line.slice(0, colon));
  return entities.find((e) => nameKey(e.name) === name)?.id || null;
}

/**
 * Замена имени в тексте — в тех строках, где оно стоит, и только в роли,
 * в которой стояло: актив на актив, ресурс на ресурс. Строка с заменой
 * переписывается в каноническом виде; остальные не трогаются.
 */
export function replaceName(text = "", kind, oldName, newName) {
  const key = nameKey(oldName);
  const { steps } = parseProcess(text);
  const byLine = new Map(steps.map((s) => [s.line, s]));
  return String(text || "").split("\n").map((raw, i) => {
    const s = byLine.get(i + 1);
    if (!s || s.error) return raw;
    const hit = kind === "asset" ? nameKey(s.asset.name) === key
      : [...s.takes, ...s.gives].some((t) => nameKey(t.name) === key);
    if (!hit) return raw;
    const swap = (t) => (nameKey(t.name) === key ? { ...t, name: newName } : t);
    return formatStep(kind === "asset"
      ? { ...s, asset: { ...s.asset, name: newName } }
      : { ...s, takes: s.takes.map(swap), gives: s.gives.map(swap) });
  }).join("\n");
}
