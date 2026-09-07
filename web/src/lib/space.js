/* ════════════════════════════════════════════════════════════════
   ПРОСТРАНСТВО · та же вкладка задач, но облаком блоков

   Доска отвечает на вопрос «что с работой сейчас»: колонки — это статусы,
   и лежит в них только то, что поручено. Пространство отвечает на другой
   вопрос — «как это связано между собой»: задача, файл, который из неё
   вышел, кусок памяти помощника и своя заметка лежат рядом, и между ними
   тянутся стрелки. Это не второй список задач, а второй взгляд на ту же
   модель, поэтому задачи, файлы и память здесь ПРОИЗВОДНЫЕ: появляются
   сами, а пространство помнит про них только положение — и то, что
   человек у них спросил у помощника. Записывать сюда название задачи или
   имя файла значило бы завести вторую правду, которая разойдётся с
   моделью на первой же правке.

   Свои здесь только заметки: название, описание, файл. И стрелки: между
   любыми двумя блоками, с точками перегиба там, где коснулись.

   Всё в этом файле — чистые функции над записью `space`. Компонент
   (SpaceBoard) только рисует и переводит касания в вызовы отсюда.

   ─── запись ───

   space = {
     notes:  [{ id, x, y, title, text, file, qa }],   // свои блоки
     pos:    { [key]: { x, y } },                      // где лежат производные
     qa:     { [key]: [{ q, a, at }] },                // что у них спросили
     hidden: [key],                                    // убранные с пространства
     arrows: [{ id, from, to, points: [{ x, y }], at }],
     view:   { x, y, zoom },
   }

   key блока — `kind:id`: `note:n1`, `task:tk1`, `file:f1`, `memory:m1`.
   Стрелка знает блоки по ключам, а не по индексам: блоки приходят и
   уходят вместе с моделью, и индекс назавтра указывал бы на другой.
   ════════════════════════════════════════════════════════════════ */

import { reportSrc } from "../storage.js";

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 3;
/* Ширина блока одна на всех: колонка одинаковой ширины читается как
   список, а разнобой — как беспорядок. Высота по умолчанию нужна только
   пока браузер не измерил настоящую (и в тестах, где измерять нечем). */
export const BLOCK_W = 220;
export const BLOCK_H = 120;
/* Клетка автораскладки: блок плюс зазор, чтобы новые блоки не наезжали. */
export const CELL = { w: BLOCK_W + 28, h: BLOCK_H + 40 };
export const COLS = 4;
/* Радиус скругления угла в точке перегиба стрелки. */
export const CORNER = 18;

let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`
  + Math.random().toString(36).slice(2, 5);
const str = (v) => (v == null ? "" : String(v));
const num = (v, d = 0) => {
  if (v == null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const KINDS = ["note", "task", "file", "memory"];
export const keyOf = (kind, id) => `${kind}:${id}`;
export function parseKey(key) {
  const s = str(key);
  const i = s.indexOf(":");
  return i < 0 ? { kind: "", id: s } : { kind: s.slice(0, i), id: s.slice(i + 1) };
}

export const clampZoom = (z) => {
  const n = Number(z);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
};

/* ─────── нормализация ───────
   Чужая или старая запись достраивается до нынешней, а не отвергается:
   пространство — вспомогательный слой, и потерять из-за него модель
   нельзя. Битые стрелки (без концов или из блока в него же) выбрасываются:
   рисовать их нечем, а хранить незачем. */

const normQa = (q = {}) => ({ q: str(q.q), a: str(q.a), at: str(q.at) });
const normQaList = (l) => (Array.isArray(l) ? l.map(normQa).filter((x) => x.q || x.a) : []);
const normPoint = (p = {}) => ({ x: num(p.x), y: num(p.y) });

export const normalizeNote = (n = {}) => ({
  id: n.id ?? uid("n"),
  x: num(n.x), y: num(n.y),
  title: str(n.title), text: str(n.text),
  file: n.file && typeof n.file === "object" ? n.file : null,
  qa: normQaList(n.qa),
});

export const normalizeArrow = (a = {}) => ({
  id: a.id ?? uid("a"),
  from: str(a.from), to: str(a.to),
  points: Array.isArray(a.points) ? a.points.map(normPoint) : [],
  /* Куда именно на втором блоке ткнули — смещение внутри блока. Блок
     переедет — стрелка поедет с ним и войдёт в то же место. Нет — в центр. */
  at: a.at && typeof a.at === "object" ? { dx: num(a.at.dx), dy: num(a.at.dy) } : null,
});

export function normalizeSpace(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const notes = Array.isArray(r.notes) ? r.notes.map(normalizeNote) : [];
  const pos = {};
  Object.entries(r.pos && typeof r.pos === "object" ? r.pos : {}).forEach(([k, p]) => {
    if (k && p && typeof p === "object") pos[k] = { x: num(p.x), y: num(p.y) };
  });
  const qa = {};
  Object.entries(r.qa && typeof r.qa === "object" ? r.qa : {}).forEach(([k, l]) => {
    const list = normQaList(l);
    if (k && list.length) qa[k] = list;
  });
  const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).map(str).filter(Boolean))];
  const arrows = (Array.isArray(r.arrows) ? r.arrows : []).map(normalizeArrow)
    .filter((a) => a.from && a.to && a.from !== a.to);
  const v = r.view && typeof r.view === "object" ? r.view : {};
  return {
    notes, pos, qa, hidden, arrows,
    view: { x: num(v.x), y: num(v.y), zoom: clampZoom(v.zoom == null ? 1 : v.zoom) },
  };
}

/** Пустое пространство — то же, что достроенная пустая запись. */
export const emptySpace = () => normalizeSpace(null);

/* ─────── заметки ─────── */

/** Новая заметка: пустая. Название пишет человек, подсказки ему не надо. */
export const newNote = (x = 0, y = 0) =>
  ({ id: uid("n"), x: num(x), y: num(y), title: "", text: "", file: null, qa: [] });

export const addNote = (space, note) => ({ ...space, notes: [...space.notes, normalizeNote(note)] });

export const updateNote = (space, id, patch) => ({
  ...space,
  notes: space.notes.map((n) => (String(n.id) === String(id) ? { ...n, ...patch } : n)),
});

/* ─────── производные блоки ─────── */

/** Ключи блоков, которые даёт модель, — в устойчивом порядке. Непоставленные
 *  задачи сюда не попадают по той же причине, что и на доску: работу ещё
 *  никому не поручили, и связывать её стрелками не с чем. */
export function derivedKeys({ tasks = [], files = [], memory = [] } = {}) {
  return [
    ...tasks.filter((t) => t && t.id != null && t.status !== "wait").map((t) => keyOf("task", t.id)),
    ...files.filter((f) => f && f.id != null).map((f) => keyOf("file", f.id)),
    ...memory.filter((m) => m && m.id != null).map((m) => keyOf("memory", m.id)),
  ];
}

/** Где лежит блок — заметка сама знает, у производного спрашиваем `pos`. */
export function posOf(space, key) {
  const { kind, id } = parseKey(key);
  if (kind === "note") {
    const n = space.notes.find((x) => String(x.id) === id);
    return n ? { x: n.x, y: n.y } : null;
  }
  return space.pos[key] || null;
}

const cellOf = (x, y) => `${Math.floor(x / CELL.w)}:${Math.floor(y / CELL.h)}`;

/**
 * Новым производным блокам — место сеткой.
 *
 * Класть всё в одну точку нельзя: три задачи стопкой выглядят как одна.
 * Клетки, где уже что-то лежит, пропускаются, поэтому новое не наезжает
 * на расставленное руками. Положение ЗАПИСЫВАЕТСЯ, а не считается на
 * каждом показе: считалось бы — блоки прыгали бы всякий раз, когда
 * человек уносит соседа и освобождает клетку.
 *
 * Возвращает тот же объект, если класть нечего, — чтобы вызывающий код
 * мог не писать пустую правку.
 */
export function placeNew(space, keys = []) {
  const missing = keys.filter((k) => !space.pos[k] && !space.hidden.includes(k));
  if (!missing.length) return space;
  const taken = new Set([
    ...space.notes.map((n) => cellOf(n.x, n.y)),
    ...Object.values(space.pos).map((p) => cellOf(p.x, p.y)),
  ]);
  const pos = { ...space.pos };
  let i = 0;
  missing.forEach((k) => {
    for (;;) {
      const c = i % COLS, r = Math.floor(i / COLS);
      i += 1;
      const cell = `${c}:${r}`;
      if (taken.has(cell)) continue;
      taken.add(cell);
      pos[k] = { x: c * CELL.w, y: r * CELL.h };
      break;
    }
  });
  return { ...space, pos };
}

/**
 * Все блоки пространства с положением: заметки — свои, остальное — из
 * модели. Содержимое производного блока берётся из модели здесь и сейчас,
 * поэтому переименованная задача переименована и на пространстве.
 */
export function blocksOf(space, model = {}) {
  const { tasks = [], files = [], memory = [] } = model;
  const placed = placeNew(space, derivedKeys(model));
  const hidden = new Set(placed.hidden);
  const out = placed.notes.map((n) => ({
    key: keyOf("note", n.id), kind: "note", id: n.id, x: n.x, y: n.y, note: n, qa: n.qa,
  }));
  const push = (kind, id, extra) => {
    const key = keyOf(kind, id);
    if (hidden.has(key)) return;
    const p = placed.pos[key];
    if (!p) return;
    out.push({ key, kind, id, x: p.x, y: p.y, qa: placed.qa[key] || [], ...extra });
  };
  tasks.filter((t) => t && t.id != null && t.status !== "wait")
    .forEach((t) => push("task", t.id, { task: t }));
  files.filter((f) => f && f.id != null).forEach((f) => push("file", f.id, { file: f }));
  memory.filter((m) => m && m.id != null).forEach((m) => push("memory", m.id, { item: m }));
  return out;
}

export function moveBlock(space, key, { x, y }) {
  const { kind } = parseKey(key);
  if (kind === "note") return updateNote(space, parseKey(key).id, { x: num(x), y: num(y) });
  return { ...space, pos: { ...space.pos, [key]: { x: num(x), y: num(y) } } };
}

/**
 * Убрать блок. Заметка удаляется совсем — она своя. Производный блок
 * только прячется: задача, файл и память живут в модели, и пространство
 * не вправе их удалять — оно про связи, а не про существование. Стрелки
 * к блоку уходят вместе с ним: стрелка в никуда ничего не значит.
 */
export function dropBlock(space, key) {
  const { kind, id } = parseKey(key);
  const arrows = space.arrows.filter((a) => a.from !== key && a.to !== key);
  if (kind === "note") {
    return { ...space, arrows, notes: space.notes.filter((n) => String(n.id) !== id) };
  }
  const pos = { ...space.pos };
  delete pos[key];
  const qa = { ...space.qa };
  delete qa[key];
  return {
    ...space, arrows, pos, qa,
    hidden: space.hidden.includes(key) ? space.hidden : [...space.hidden, key],
  };
}

/** Записать вопрос и ответ помощника в блок. У заметки — в неё саму, у
 *  производного — рядом с положением: сам блок хранить нельзя, а разговор
 *  о нём — свой, его модель не знает. */
export function addQa(space, key, entry) {
  const item = normQa(entry);
  const { kind, id } = parseKey(key);
  if (kind === "note") {
    return {
      ...space,
      notes: space.notes.map((n) => (String(n.id) === id ? { ...n, qa: [...n.qa, item] } : n)),
    };
  }
  return { ...space, qa: { ...space.qa, [key]: [...(space.qa[key] || []), item] } };
}

/* ─────── стрелки ─────── */

/**
 * Стрелка от блока к блоку. `point` — куда ткнули на втором блоке, в
 * координатах пространства; хранится как смещение внутри блока, чтобы
 * ехать вместе с ним. `points` — перегибы, поставленные по дороге.
 */
export function addArrow(space, from, to, point = null, points = []) {
  if (!from || !to || from === to) return space;
  const p = posOf(space, to);
  const at = point && p ? { dx: num(point.x) - p.x, dy: num(point.y) - p.y } : null;
  return {
    ...space,
    arrows: [...space.arrows, { id: uid("a"), from, to, points: points.map(normPoint), at }],
  };
}

const withArrow = (space, id, fn) =>
  ({ ...space, arrows: space.arrows.map((a) => (a.id === id ? fn(a) : a)) });

export const addPoint = (space, arrowId, point) =>
  withArrow(space, arrowId, (a) => ({ ...a, points: [...a.points, normPoint(point)] }));

export const movePoint = (space, arrowId, index, point) =>
  withArrow(space, arrowId, (a) => ({
    ...a, points: a.points.map((p, i) => (i === index ? normPoint(point) : p)),
  }));

/** Точка снимается двойным нажатием — стрелка просто спрямляется. */
export const dropPoint = (space, arrowId, index) =>
  withArrow(space, arrowId, (a) => ({ ...a, points: a.points.filter((_, i) => i !== index) }));

export const dropArrow = (space, arrowId) =>
  ({ ...space, arrows: space.arrows.filter((a) => a.id !== arrowId) });

/* ─────── путь стрелки ───────
   Стрелка рисуется ПОД блоками, поэтому начинаться и кончаться она должна
   на их границе: конец внутри блока был бы не виден, а начало из центра
   торчало бы из-под блока с двух сторон. Точка на границе — там, где
   отрезок «центр → следующая точка» выходит из прямоугольника. */

export const rectOf = (b) => ({ x: b.x, y: b.y, w: b.w || BLOCK_W, h: b.h || BLOCK_H });
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Где отрезок из точки внутри прямоугольника наружу пересекает границу.
 *  Если вторая точка тоже внутри (блоки наехали), возвращается она. */
export function edgePoint(rect, inside, outside) {
  const dx = outside.x - inside.x, dy = outside.y - inside.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (rect.x + rect.w - inside.x) / dx);
  else if (dx < 0) t = Math.min(t, (rect.x - inside.x) / dx);
  if (dy > 0) t = Math.min(t, (rect.y + rect.h - inside.y) / dy);
  else if (dy < 0) t = Math.min(t, (rect.y - inside.y) / dy);
  t = Math.max(0, Math.min(1, t));
  return { x: inside.x + dx * t, y: inside.y + dy * t };
}

/** Вершины ломаной: выход из первого блока, перегибы, вход во второй. */
export function routeOf(arrow, blocks = []) {
  const a = blocks.find((b) => b.key === arrow.from);
  const b = blocks.find((x) => x.key === arrow.to);
  if (!a || !b) return null;
  const ra = rectOf(a), rb = rectOf(b);
  const ca = center(ra);
  const aim = arrow.at ? { x: rb.x + arrow.at.dx, y: rb.y + arrow.at.dy } : center(rb);
  const pts = arrow.points || [];
  const start = edgePoint(ra, ca, pts[0] || aim);
  const end = edgePoint(rb, aim, pts[pts.length - 1] || ca);
  return [start, ...pts, end];
}

/**
 * SVG-путь по вершинам: прямые между точками, а сами углы скруглены
 * квадратичной кривой. Острый угол на точке перегиба читается как
 * «сломано», скруглённый — как «повернуло». Радиус не больше половины
 * соседнего отрезка, иначе на коротком отрезке две дуги наехали бы
 * друг на друга.
 */
export function pathFrom(route = []) {
  if (route.length < 2) return "";
  const f = (n) => Math.round(n * 10) / 10;
  let d = `M ${f(route[0].x)} ${f(route[0].y)}`;
  for (let i = 1; i < route.length - 1; i += 1) {
    const p = route[i], prev = route[i - 1], next = route[i + 1];
    const din = dist(prev, p), dout = dist(p, next);
    const rad = Math.min(CORNER, din / 2, dout / 2);
    if (!(rad > 0)) { d += ` L ${f(p.x)} ${f(p.y)}`; continue; }
    const a = lerp(p, prev, rad / din), b = lerp(p, next, rad / dout);
    d += ` L ${f(a.x)} ${f(a.y)} Q ${f(p.x)} ${f(p.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const last = route[route.length - 1];
  d += ` L ${f(last.x)} ${f(last.y)}`;
  return d;
}

/** Путь стрелки между блоками; пусто, если одного из блоков нет. */
export function pathOf(arrow, blocks = []) {
  const r = routeOf(arrow, blocks);
  return r ? pathFrom(r) : "";
}

/* ─────── вид: сдвиг и масштаб ───────
   Экранная точка = точка пространства × zoom + сдвиг. Масштабировать надо
   вокруг пальца, а не вокруг угла: иначе то, на что смотрели, уезжает. */

export const toWorld = (view, screen) => ({
  x: (screen.x - view.x) / view.zoom,
  y: (screen.y - view.y) / view.zoom,
});

export function zoomView(view, factor, around = { x: 0, y: 0 }) {
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  return {
    x: around.x - (around.x - view.x) * k,
    y: around.y - (around.y - view.y) * k,
    zoom,
  };
}

/** Показать все блоки разом. Без блоков — начало координат в масштабе 1. */
export function fitView(blocks = [], size = { width: 800, height: 520 }, pad = 24) {
  if (!blocks.length) return { x: pad, y: pad, zoom: 1 };
  const rs = blocks.map(rectOf);
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const zoom = clampZoom(Math.min((size.width - pad * 2) / w, (size.height - pad * 2) / h, 1));
  return {
    x: (size.width - w * zoom) / 2 - x0 * zoom,
    y: (size.height - h * zoom) / 2 - y0 * zoom,
    zoom,
  };
}

/* ─────── файлы для пространства ───────
   Файл — это то, что вышло из работы: результат по каждому выданному
   ресурсу и отчёт о работе в сдаче, и файл, с которого начинается раздел
   карты отчётов. Собираются из модели, а не хранятся: пространство
   показывает файлы, которые есть, а не те, что были. */

export function filesOf({ tasks = [], reports = [] } = {}) {
  const out = [];
  const seen = new Set();
  const push = (f, fallbackId, extra) => {
    if (!f || typeof f !== "object") return;
    const id = str(f.id || fallbackId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name: str(f.name) || "без названия", type: str(f.type), url: reportSrc(f), ...extra });
  };
  tasks.forEach((t) => (t?.submissions || []).forEach((s) => {
    Object.entries(s?.files || {}).forEach(([trait, f]) =>
      push(f, `${s.id}~${trait}`, { from: "task", taskId: t.id }));
    push(s?.file, `${s?.id}~report`, { from: "task", taskId: t.id });
  }));
  reports.forEach((n) => push(n?.file, `${n?.id}~file`, { from: "report" }));
  return out;
}
