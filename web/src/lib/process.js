/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · что за чем следует

   Владелец описывает процесс шагами — строка на шаг. Шаг собирается из
   выборов, каждый со своей подсказкой слева и выпадающим списком (2026-09-13):

     актив → должность воркера → берёт: из какого актива, что берёт (сколько
     угодно) → отдаёт: в какой актив, что выдаёт (сколько угодно) → новая строка.

   Никаких двоеточий и стрелок руками: прежний текстовый ввод «Актив: берёт
   Ресурс 2 → отдаёт Ресурс 1» убран, разбора текста больше нет. Имя,
   которого в списке нет, заводится кнопкой «OK» под полем — сразу, с
   пометкой `hypo`, — и в списках стоит первым, новое к старому.

   ШАГИ — ЕДИНСТВЕННЫЙ ИСТОЧНИК. Из них строятся ФУНКЦИИ (по одной на
   шаг, в активе шага), и они кладутся в `funcs` наравне с остальными:
   так схема их рисует, карточка актива показывает, а расчёт считает без
   отдельного пути «для процессов». Функция помечена `proc` — по этой
   пометке её пересобирают при правке шагов и убирают, когда процесс не
   принят. Текст (`text`) — производный, для списка и помощника.

   ─── три состояния ───

   `off`  — не принято: функций от процесса нет, гипотетические сущности
            убраны;
   `hypo` — принято гипотетически: функции есть, но расчёт берёт их только
            с галочкой «включить гипотезы» (`activeFuncs` в lib/funcs.js);
   `on`   — принято: считается всегда.

   ─── запись ───

   { id, name, text, status,
     steps: [{ id, asset:{id,name}, role:{id,name}|null,
               takes: [{ asset:{id,name}, trait:{id,name}, qty }],
               gives: [{ asset:{id,name}, trait:{id,name}, qty }] }],
     hypo: { entities:[id], traits:[id], roles:[id] },
     missing: { rejected:[имя] } }

   Вход берётся из ресурса названного актива, выход кладётся в ресурс
   названного актива: ресурс принадлежит активу (`traits[].e`), и передача
   между активами на схеме читается именно по этому. Имя рядом с id —
   память: переименованное на схеме остаётся своим (id помнит, чего имя
   уже не знает), удалённое видно удалённым, а не никогда не бывшим, —
   ему выбирают замену в том же списке.

   Прежние записи (шаги из разбора текста: `line`, `takes[].name/id/qty`)
   читаются `normalizeProc` в нынешнюю форму; идентификатор такого шага —
   номер строки, чтобы функции `${proc}_${line}` и задачи на них не
   повисли.
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

export const newStep = () => ({ id: nextId("s"), asset: null, role: null, takes: [], gives: [] });
export const newPort = () => ({ asset: null, trait: null, qty: 1 });
export const newProc = () => ({
  id: nextId("pr"),
  name: "",
  text: "",
  status: "off",
  steps: [newStep()],
  hypo: { entities: [], traits: [], roles: [] },
  missing: { rejected: [] },
});

/* ─────── нормализация ─────── */

const item = (x) => {
  if (!x || typeof x !== "object") return null;
  const name = String(x.name ?? "");
  if (x.id == null && !name) return null;
  return { id: x.id ?? null, name };
};
const qtyOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
/* Порт: нынешний `{asset, trait, qty}` или прежний `{name, id, qty}` из
   разбора текста — у того ресурс лежал прямо в записи, актив не назывался. */
const normalizePort = (p = {}) => ({
  asset: item(p.asset),
  trait: "trait" in p ? item(p.trait) : item({ id: p.id, name: p.name }),
  qty: qtyOf(p.qty),
});
const normalizeStep = (s = {}) => ({
  id: s.id != null ? String(s.id) : (s.line != null ? String(s.line) : nextId("s")),
  asset: item(s.asset),
  role: item(s.role),
  takes: (Array.isArray(s.takes) ? s.takes : []).map(normalizePort),
  gives: (Array.isArray(s.gives) ? s.gives : []).map(normalizePort),
});

/** Достраивает запись до нынешней; молчание прежних записей — «не принято». */
export const normalizeProc = (p = {}) => ({
  ...p,
  id: p.id ?? nextId("pr"),
  name: p.name == null ? "" : String(p.name),
  text: p.text == null ? "" : String(p.text),
  status: STATUSES.includes(p.status) ? p.status : "off",
  steps: (Array.isArray(p.steps) ? p.steps : [])
    // Строка, которую прежний разбор счёл ошибочной, шага не несла.
    .filter((s) => s && !s.error).map(normalizeStep),
  hypo: { entities: ids(p.hypo?.entities), traits: ids(p.hypo?.traits), roles: ids(p.hypo?.roles) },
  missing: { rejected: (Array.isArray(p.missing?.rejected) ? p.missing.rejected : [])
    .map(String) },
});
export const normalizeProcs = (list) =>
  (Array.isArray(list) ? list.map(normalizeProc) : []);

/** Имя для сравнения: без регистра, лишних пробелов и разницы «е/ё». */
export const nameKey = (s) => String(s ?? "").trim().toLowerCase()
  .replace(/ё/g, "е").replace(/\s+/g, " ");

/* ─────── текст ─────── */

const portText = (p, word) => `${p.trait?.name || "?"}${p.qty !== 1 ? ` ×${p.qty}` : ""}`
  + `${p.asset?.name ? ` ${word} ${p.asset.name}` : ""}`;
/** Шаг словами — для списка, помощника и имён функций. */
export const stepText = (s = {}) => {
  const head = `${s.asset?.name || "?"}${s.role?.name ? ` (${s.role.name})` : ""}`;
  const takes = (s.takes || []).map((p) => portText(p, "из")).join(", ");
  const gives = (s.gives || []).map((p) => portText(p, "в")).join(", ");
  return `${head}: берёт ${takes || "—"} → отдаёт ${gives || "—"}`;
};
export const procText = (p = {}) => (p.steps || []).map(stepText).join("\n");
/** Имя процесса: своё, иначе первый шаг словами. */
export const procLabel = (p = {}) => String(p.name || "").trim()
  || (p.steps || []).map(stepText).find(Boolean) || "процесс";

/* ─────── состояние выбора ─────── */

/**
 * Что с выбранным: `empty` — не выбрано, `ok` — есть на схеме, `deleted` —
 * было и удалено (просит замену), `unknown` — имя без id (прежняя запись,
 * где имя так и не приняли). Четыре состояния — четыре подсказки.
 */
export function stateOf(it, kind, { entities = [], traits = [], positions = [] } = {}) {
  if (!it) return "empty";
  const list = kind === "asset" ? entities : kind === "role" ? positions : traits;
  if (it.id != null) return list.some((x) => String(x.id) === String(it.id)) ? "ok" : "deleted";
  return "unknown";
}
const okIn = (it, kind, model) => stateOf(it, kind, model) === "ok";

/**
 * Почему процесс нельзя принять — словами, по пунктам. Пусто — можно.
 * Один список на кнопки и подсказку: они не должны спорить.
 */
export function procIssues(proc = {}, model = {}) {
  const out = [];
  const steps = proc.steps || [];
  steps.forEach((s, i) => {
    const n = i + 1;
    const say = (m) => out.push(`строка ${n}: ${m}`);
    const st = stateOf(s.asset, "asset", model);
    if (st === "empty") say("не выбран актив");
    else if (st === "deleted") say(`актив «${s.asset.name}» удалён — выберите замену`);
    else if (st === "unknown") say(`актив «${s.asset.name}» не найден — выберите или нажмите OK`);
    if (s.role && stateOf(s.role, "role", model) === "deleted") {
      say(`должность «${s.role.name}» удалена — выберите другую`);
    }
    if (!s.takes.length && !s.gives.length) say("ничего не берёт и не отдаёт");
    const ports = (list, word) => list.forEach((p) => {
      const a = stateOf(p.asset, "asset", model);
      if (a === "empty") return say(`${word}: не выбран актив`);
      if (a === "deleted") return say(`${word}: актив «${p.asset.name}» удалён — выберите замену`);
      const t = stateOf(p.trait, "trait", model);
      if (t === "empty") return say(`${word}: не выбран ресурс`);
      if (t === "deleted") return say(`${word}: ресурс «${p.trait.name}» удалён — выберите замену`);
      if (t === "unknown") return say(`${word}: ресурс «${p.trait.name}» не найден — выберите или нажмите OK`);
      return undefined;
    });
    ports(s.takes, "берёт");
    ports(s.gives, "отдаёт");
  });
  if (!steps.length) out.push("процесс пуст");
  return out;
}
export const canAcceptProc = (proc, model) => procIssues(proc, model).length === 0;

/** Шаг собран целиком: актив на месте, у каждого входа и выхода — ресурс. */
export const stepComplete = (s, model) => okIn(s.asset, "asset", model)
  && (s.takes.length + s.gives.length > 0)
  && [...s.takes, ...s.gives].every((p) => okIn(p.trait, "trait", model));

/* ─────── функции из шагов ─────── */

/**
 * По функции на шаг, в активе шага. Идентификаторы выводятся из процесса
 * и шага: при каждой пересборке функция остаётся той же — и задачи,
 * поставленные на неё, не повисают.
 *
 * Незавершённый шаг (нет актива, ресурса, что-то удалено) функции не
 * даёт: у такого шага нечего брать или некуда отдавать.
 *
 * Количество точное — `lo = hi = число`. Должность — исполнителям
 * функции (`posts.owners`): кто ставит и кто принимает, процесс не
 * говорит, это правят в карточке. Время выполнения — как у любой новой
 * функции (день): процесс про то, что за чем следует, а не про сроки.
 */
export function procFuncs(proc = {}, model = {}) {
  if (proc.status === "off") return [];
  const label = `процесс: ${procLabel(proc)}`;
  return (proc.steps || []).filter((s) => stepComplete(s, model)).map((s) => {
    const port = (p, j, side) => ({
      id: `p_${proc.id}_${s.id}_${side}${j}`, trait: p.trait.id, lo: p.qty, hi: p.qty,
    });
    const role = s.role && okIn(s.role, "role", model) ? String(s.role.id) : null;
    return {
      id: `${proc.id}_${s.id}`,
      e: s.asset.id,
      name: label,
      proc: proc.id,
      takes: s.takes.map((p, j) => port(p, j, "t")),
      gives: s.gives.map((p, j) => port(p, j, "g")),
      dur: 1, durHi: 1, durUnit: "дн",
      accepted: true,
      ...(role ? { posts: { owners: [role] } } : {}),
    };
  });
}

/**
 * Функции процессов — заново по нынешним шагам.
 *
 * Свои поля у собранной прежде функции (положение на схеме, роли
 * постановщика и проверяющего, люди) остаются: их правили в карточке, и
 * шаги про них ничего не говорят. Рецепт — что берёт и что отдаёт — и
 * должность исполнителя всегда из шагов.
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

/* ─────── списки для выбора ─────── */

/**
 * Порядок в выпадающем списке: заведённое из этого процесса — первым,
 * новое к старому (владелец: «в первую очередь должны появляться они, в
 * порядке от более новых к старым»), остальное — как на схеме.
 */
export function orderOptions(options = [], hypoIds = []) {
  const fresh = [...hypoIds].reverse()
    .map((id) => options.find((o) => String(o.id) === String(id))).filter(Boolean);
  const seen = new Set(fresh.map((o) => String(o.id)));
  return [...fresh, ...options.filter((o) => !seen.has(String(o.id)))];
}

/** Что подставлять по набранному: по началу имени, потом по вхождению. */
export function filterOptions(options = [], query = "") {
  const q = nameKey(query);
  if (!q) return options;
  const starts = options.filter((o) => nameKey(o.name).startsWith(q));
  const inside = options.filter((o) => !nameKey(o.name).startsWith(q) && nameKey(o.name).includes(q));
  return [...starts, ...inside];
}
/** Есть ли в списке имя, набранное точно, — тогда «OK» не нужен. */
export const exactOption = (options = [], query = "") =>
  options.find((o) => nameKey(o.name) === nameKey(query)) || null;
