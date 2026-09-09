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

import { descendantsOf, unitsOf } from "./units.js";
import { actualOf, chainOf } from "./chain.js";

let seq = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;
const str = (v) => (v == null ? "" : String(v));

/** Проект — корень карты: у него нет родителя. */
export const newProject = (name = "новый проект") => ({
  id: nextId("rp"), parent: null, name, trait: "", units: [], file: null,
  upto: "", qty: 1,
});

/** Раздел — тот же блок, только внутри другого. */
export const newSection = (parent, name = "новый раздел") => ({
  id: nextId("rs"), parent: parent ?? null, name,
  trait: "", units: [], file: null, upto: "", qty: 1,
});

/* Поля `brief`, `picks` и `tweaks` не читаются и не сохраняются. Пересказ
   заказа расходится с делом; список пар «функция + ресурс» отвечал на
   вопрос «что показать», когда спросить надо было другое — с чего начинаем
   и до какого звена ведём; а правка вилок прямо в отчёте оказалась лишней
   сущностью: числа функции живут в модели, и менять их надо там, иначе у
   одной функции появляется столько разных «сколько это займёт», сколько
   заведено разделов. */
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

/* Какие единицы выбраны в блоке. Прежняя запись с одной единицей читается
   как список из одного: отчёт не должен зависеть от того, прошла запись
   приведение или ещё нет. Разбор один на всё приложение — два разошлись бы
   в первый же день, и тогда экран и снимок отвечали бы по-разному. */
export const pickedOf = (node = {}) => [...new Set([
  ...(Array.isArray(node.units) ? node.units : []),
  ...(node.unit ? [node.unit] : []),
].filter(Boolean))];

/**
 * Единицы, которые прослеживает блок, и вся их родословная.
 *
 * Блок отвечает про ВЕЩИ: вот этот договор, вот эти три. Всё, что в нём
 * показано как работа, — работа НАД НИМИ. Ничего не выбрано — вещь
 * гипотетическая, её ещё нет в системе, и работы по ней нет тоже: список
 * пуст, и это ответ, а не нехватка данных.
 *
 * Прежде здесь стояло «всё, что выдали функции цепочки» (`madeIn`), и
 * из-за этого в отчёт про один договор попадала чужая работа над другими.
 */
export function familyOf(model = {}, node = {}) {
  const picked = pickedOf(node);
  if (!picked.length) return [];
  const all = unitsOf(model);
  const seen = new Set();
  return picked
    .flatMap((id) => descendantsOf(all, id))
    .filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

/** Сводка по блоку и всему, что под ним: сделано, принято, часы. */
export function summaryOf(model, node, nodes = []) {
  /* Сводка считает то же, что и раскрытый блок, — работу по его единицам.
     Иначе свёрнутая строка обещала бы восемь выполнений, а внутри не было
     бы ни одного: одно и то же место говорило бы две разные вещи. */
  const rows = subtree(nodes, node?.id).flatMap((n) => {
    const chain = chainOf(model, { from: n.trait, upto: n.upto });
    /* Считается ровно то же, что показывает раскрытый блок, — работа по его
       единицам. Иначе свёрнутая строка обещала бы восемь выполнений, а
       внутри не было бы ни одного: одно и то же место говорило бы две
       разные вещи. Единица не выбрана — работы нет: это прогноз. */
    const only = new Set(familyOf(model, n).map((u) => u.task).filter(Boolean));
    return actualOf(model, chain, { only }).tasks;
  });
  const seen = new Set();
  const uniq = rows.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  const done = uniq.filter((t) => t.status === "done" && t.canceled !== true);
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

/* ─────── шаг — тоже раздел ───────

   Разделы карты никто больше не размечает руками: шаг цепочки И ЕСТЬ
   раздел, и размечается он сам. Поэтому у каждого шага есть свой якорь —
   постоянный адрес внутри блока, по которому на этот шаг можно дать
   ссылку. Считается он из блока и функции, а не из порядкового номера:
   номер шага меняется от любой правки модели, и вчерашняя ссылка вела бы
   назавтра в другое место. */
export const stepAnchor = (nodeId, funcId) =>
  `shag-${String(nodeId || "")}-${String(funcId || "")}`;

/** Ссылка на шаг: тот же блок, но открытый на нужном месте. */
export const stepLink = (nodeId, funcId, origin = "") =>
  `${linkTo(nodeId, origin)}#${stepAnchor(nodeId, funcId)}`;

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
