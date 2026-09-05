/* ════════════════════════════════════════════════════════════════
   ОТЧЁТЫ · проекты, разделы и то, что в них попадает

   Модель отвечает на вопрос «что происходит». Отчёт — на другой: «что мы
   сделали и где это лежит». Ответ на него собирается не заново, а из уже
   сделанного: каждая принятая сдача — это часы, числа по ресурсам и
   приложенный файл. Просить человека пересобрать всё это руками значило
   бы просить его переписать то, что уже записано.

   ─── одинаковые блоки, вложенные друг в друга ───

   Проект и раздел — ОДНА и та же запись, отличается только тем, есть ли у
   неё родитель. Поэтому карта складывается фрактально: в раздел кладётся
   раздел, в него — ещё один, и на каждом уровне это тот же самый блок с
   тем же набором возможностей. Отдельный тип «подраздел» пришлось бы
   заводить на каждую глубину, а глубина заранее неизвестна.

   ─── что такое «результат» ───

   ОПРЕДЕЛЁННАЯ ЕДИНИЦА ресурса, по номеру. Не «результаты функции вообще»
   и не количество: работают не с количеством, а с конкретной вещью — вот
   это техническое задание, пришедшее от того заказчика, вот дизайн,
   который к нему относится. Номер единице даёт сдача задачи (см.
   `lib/units.js`), и он же стоит в ссылке.

   Функция и ресурс остались, но теперь они — способ найти нужную единицу,
   а не сам ответ. Не выбрана ни одна единица — в раздел попадают все, что
   выдала эта функция по этому ресурсу: так удобно заводить раздел, пока
   работ ещё нет.

   ─── никакого технического задания полем ───

   Его тут нет и не будет. В проекте только разделы и ссылки на конкретные
   результаты: заказ, описанный в поле, — это пересказ, а пересказ
   расходится с тем, что и правда сделано, в первый же день. Само задание
   — такой же результат чьей-то работы, со своим номером: его и кладут в
   раздел, а не переписывают в поле.
   ════════════════════════════════════════════════════════════════ */

import { unitsOf } from "./units.js";

let seq = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;
const str = (v) => (v == null ? "" : String(v));

/** Проект — корень карты: у него нет родителя. */
export const newProject = (name = "новый проект") => ({
  id: nextId("rp"), parent: null, name, picks: [],
});

/** Раздел — тот же блок, только внутри другого. */
export const newSection = (parent, name = "новый раздел") => ({
  id: nextId("rs"), parent: parent ?? null, name, picks: [],
});

/**
 * Что попадает в блок: определённая единица ресурса, по номеру.
 *
 * `unit` пуст — попадают все результаты этой функции по этому ресурсу.
 * Так раздел заводят заранее, когда работ ещё не было и выбирать не из
 * чего.
 */
export const newPick = (func = "", trait = "", unit = "") =>
  ({ id: nextId("pk"), func, trait, unit });

export const normalizePick = (p = {}) => ({
  id: p.id ?? nextId("pk"), func: str(p.func), trait: str(p.trait), unit: str(p.unit),
});

/* Поле `brief` не читается и не сохраняется: технического задания полем в
   проекте нет. Что было в нём написано, осталось пересказом, а в карте
   должны лежать сами результаты. */
export const normalizeReport = (n = {}) => ({
  id: n.id ?? nextId("rp"),
  parent: n.parent ?? null,
  name: str(n.name),
  picks: Array.isArray(n.picks) ? n.picks.map(normalizePick) : [],
});

export const normalizeReports = (list) =>
  (Array.isArray(list) ? list.map(normalizeReport) : []);

/** Блоки первого уровня. Потерявший родителя всплывает наверх, а не пропадает. */
export const rootsOf = (nodes = []) => nodes.filter((n) =>
  !n.parent || !nodes.some((x) => x.id === n.parent));

/** Что лежит внутри блока — в том порядке, в каком заведено. */
export const childrenOf = (nodes = [], id) => nodes.filter((n) => n.parent === id);

/** Путь от корня до блока — им и подписывается место в карте. */
export function pathOf(nodes = [], id) {
  const out = [];
  const seen = new Set();
  let cur = nodes.find((n) => n.id === id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = nodes.find((n) => n.id === cur.parent);
  }
  return out;
}

/** Весь блок целиком: он сам и всё, что под ним. */
export function subtree(nodes = [], id) {
  const out = [];
  const walk = (pid) => childrenOf(nodes, pid).forEach((n) => { out.push(n); walk(n.id); });
  const self = nodes.find((n) => n.id === id);
  if (self) out.push(self);
  walk(id);
  return out;
}

/** Удаление блока уносит и всё, что внутри: осиротевший раздел — мусор. */
export function dropNode(nodes = [], id) {
  const gone = new Set(subtree(nodes, id).map((n) => n.id));
  return nodes.filter((n) => !gone.has(n.id));
}

/**
 * Что уже сделано по выбранным парам «функция + ресурс».
 *
 * Строка — одна сдача: когда, кто, сколько часов ушло, сколько ресурса
 * вышло и какой файл приложен. Принятые сдачи и непринятые различены:
 * непринятая — это заявление исполнителя, а не результат, и путать их
 * нельзя, но и прятать файл, который человек уже сдал, незачем.
 */
export function resultsOf(model = {}, picks = []) {
  const { tasks = [], funcs = [] } = model;
  // Номера единиц считаются один раз на всю модель: номер должен быть тем
  // же самым, в каком бы разделе единицу ни показывали.
  const no = {};
  unitsOf(model).forEach((u) => { no[u.id] = u.no; });
  const rows = [];
  picks.forEach((p) => {
    const func = funcs.find((f) => f.id === p.func) || null;
    tasks.filter((t) => t.funcId === p.func).forEach((t) => {
      (t.submissions || []).forEach((sb) => {
        const gave = Number(sb.gives?.[p.trait]) || 0;
        const took = Number(sb.takes?.[p.trait]) || 0;
        // Ресурс не тронут вовсе — эта сдача не про него.
        if (!gave && !took && p.trait) return;
        const unit = `${sb.id}~${p.trait}`;
        /* Выбрана определённая единица — показываем только её. Это и есть
           «результат по номеру»: не всё, что функция когда-либо выдала, а
           вот это техническое задание и вот этот дизайн к нему. */
        if (p.unit && p.unit !== unit) return;
        rows.push({
          id: `${t.id}-${sb.id}-${p.id}`,
          pick: p.id,
          unit,
          no: no[unit] ?? null,
          task: t.id,
          title: t.title,
          func: p.func,
          funcName: func?.name || "",
          trait: p.trait,
          at: sb.at,
          by: t.assignee ?? null,
          hours: Number(sb.hours) || 0,
          qty: gave || -took,
          text: str(sb.text),
          file: sb.file || null,
          accepted: t.status === "done",
        });
      });
    });
  });
  return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

/** Сводка по блоку: сколько сдач, сколько принято, сколько файлов. */
export function summaryOf(model, node, nodes = []) {
  const all = subtree(nodes, node?.id).flatMap((n) => n.picks || []);
  const rows = resultsOf(model, all);
  return {
    rows: rows.length,
    accepted: rows.filter((r) => r.accepted).length,
    files: rows.filter((r) => r.file).length,
    hours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10,
  };
}

/**
 * Ссылка на блок карты.
 *
 * Ссылка — на БЛОК, а не на приложение: человек, которому её дали, должен
 * открыть тот раздел, о котором речь, а не начало карты и поиск в ней.
 */
export function linkTo(id, origin = "") {
  const base = origin || (typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`);
  return `${base}?report=${encodeURIComponent(id)}`;
}

/**
 * Ссылка наружу — на СНИМОК блока, а не на приложение.
 *
 * Тот, кому её дали, не участник модели: пускать его в приложение значило бы
 * открывать ссылкой на один раздел всё, что в модели есть.
 */
export function shareLink(token, origin = "") {
  const base = origin || (typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`);
  return `${base}?share=${encodeURIComponent(token)}`;
}

/** Какой блок просят открыть — из адреса страницы. */
export function reportFromLocation(search = "") {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return q.get("report") || null;
}
