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

   ─── что такое раздел ───

   Не «фильтр по сделанному», а ПРОСЛЕЖИВАНИЕ. У раздела две вещи, которые
   называет человек:

   · `trait` — ресурс, с которого всё начинается, и `file` — он сам,
     загруженный: вот это техническое задание, вот этот договор;
   · `upto` — до какого ЗВЕНА прослеживать: до готового сайта, до вёрстки,
     до конца.

   Всё остальное считается: как изменятся ресурсы, сколько это займёт, какие
   шаги будут сделаны и какие факторы на это повлияют (`lib/chain.js`).
   Спрашивать это у человека значило бы просить его пересчитать модель
   руками — и разойтись с ней на первой же правке.

   ─── никакого технического задания полем ───

   Само задание — не текст в поле, а загруженный файл ресурса, с которого
   раздел и начинается. Пересказ заказа своими словами расходится с делом в
   первый же день; файл — не расходится.
   ════════════════════════════════════════════════════════════════ */

import { unitsOf } from "./units.js";
import { actualOf, chainOf } from "./chain.js";

let seq = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;
const str = (v) => (v == null ? "" : String(v));

/** Проект — корень карты: у него нет родителя. */
export const newProject = (name = "новый проект") => ({
  id: nextId("rp"), parent: null, name, trait: "", units: [], file: null,
  upto: "", qty: 1, tweaks: {},
});

/** Раздел — тот же блок, только внутри другого. */
export const newSection = (parent, name = "новый раздел") => ({
  id: nextId("rs"), parent: parent ?? null, name,
  trait: "", units: [], file: null, upto: "", qty: 1, tweaks: {},
});

/* Поля `brief` и `picks` не читаются и не сохраняются. Пересказ заказа
   расходится с делом, а список пар «функция + ресурс» отвечал на вопрос
   «что показать», когда спросить надо было другое: с чего начинаем и до
   какого звена ведём. */
export const normalizeReport = (n = {}) => {
  /* Единиц может быть несколько: прослеживают не только одну вещь, но и
     «вот эти три договора». Прежняя запись с одной единицей читается как
     список из одного — модели, собранные до этого, ничего не теряют. */
  const units = [...new Set([
    ...(Array.isArray(n.units) ? n.units : []),
    ...(n.unit ? [n.unit] : []),
  ].map(str).filter(Boolean))];
  return {
    id: n.id ?? nextId("rp"),
    parent: n.parent ?? null,
    name: str(n.name),
    // Ресурс, с которого раздел начинается, и он сам — файлом.
    trait: str(n.trait),
    units,
    file: n.file && typeof n.file === "object" ? n.file : null,
    // Звено, до которого прослеживаем: ресурс или функция. Пусто — до конца.
    upto: str(n.upto),
    /* Сколько единиц пускаем в цепочку. Выбраны конкретные — их и столько:
       спрашивать число отдельно значило бы позволить сказать «три
       договора» и перечислить пять. */
    qty: units.length || (Number(n.qty) > 0 ? Number(n.qty) : 1),
    /* Правки вилок в шагах ЭТОГО раздела: `{функция: {dur, durHi, durUnit,
       takes: {ресурс: {lo, hi}}, gives: {…}}}`. Отчёт — место для
       прикидки: «а если дизайн займёт не день, а три?». Менять ради этого
       саму модель нельзя — прикидка одного раздела стала бы правдой для
       всей схемы. */
    tweaks: n.tweaks && typeof n.tweaks === "object" ? n.tweaks : {},
  };
};

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
 * Созданные в разделе ресурсы — единицы с номерами.
 *
 * Не «все результаты вообще», а те, что родились в цепочке этого раздела:
 * их выдали её функции. Раздел про эту работу — и показывать он должен то,
 * что сделано ею.
 */
export function madeIn(model = {}, chain = {}) {
  const ids = new Set((chain.steps || []).map((f) => f.id));
  return unitsOf(model).filter((u) => ids.has(u.func)).reverse();
}

/** Сводка по блоку и всему, что под ним: сделано, принято, часы. */
export function summaryOf(model, node, nodes = []) {
  const rows = subtree(nodes, node?.id).flatMap((n) => {
    const chain = chainOf(model, { from: n.trait, upto: n.upto });
    return actualOf(model, chain).tasks;
  });
  const seen = new Set();
  const uniq = rows.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  const done = uniq.filter((t) => t.status === "done");
  const hours = done.reduce((s, t) => {
    const subs = t.submissions || [];
    return s + (subs.length ? Number(subs[subs.length - 1].hours) || 0 : 0);
  }, 0);
  return {
    rows: uniq.length,
    accepted: done.length,
    hours: Math.round(hours * 10) / 10,
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
