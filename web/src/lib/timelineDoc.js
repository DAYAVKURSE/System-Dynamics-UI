/* ════════════════════════════════════════════════════════════════
   ТАЙМЛАЙН ФАЙЛОМ · чтобы работу можно было проследить потом

   Таймлайн на экране показывает то, что есть в модели СЕЙЧАС. Но вопрос,
   ради которого его открывают, звучит иначе: «а как оно шло». Ответить на
   него по живой модели нельзя — она меняется: задачу переименовали, срок
   передвинули, статус уехал дальше, — и вчерашняя картина исчезает
   бесследно.

   Поэтому таймлайн, как и отчёт, ложится ФАЙЛОМ: HTML, который открывается
   везде, печатается в PDF одним нажатием и через год читается тем же
   текстом. Внутри — вся работа, а не то, что сейчас отфильтровано на
   экране: файл заводят, чтобы проследить, и обрезанная выборка отвечала бы
   на другой вопрос.

   Собирается ЗДЕСЬ, а не в разметке: иначе файл пришлось бы строить вторым
   кодом по тем же правилам, и в первый же день он разошёлся бы с тем, что
   человек видит на экране.
   ════════════════════════════════════════════════════════════════ */

import { hoursOf } from "./funcs.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const DAY = 86400000;
const num = (v) => Number(v) || 0;
const ms = (v) => {
  if (v == null || v === "") return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};
const fmtD = (v) => {
  const t = ms(v);
  return t == null ? "—" : new Date(t).toLocaleDateString("ru-RU",
    { day: "2-digit", month: "2-digit", year: "2-digit" });
};
const fmtDT = (v) => {
  const t = ms(v);
  return t == null ? "—" : new Date(t).toLocaleString("ru-RU",
    { day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit" });
};

/**
 * Полоса задачи: от её начала (или первой сдачи) до последней сдачи, а если
 * сдач ещё нет — на время одного выполнения функции.
 *
 * Задача без начала и без сдач полосы не имеет: рисовать её «от сегодня до
 * сегодня» значило бы выдумать данные. Правило одно на экран и на файл —
 * два разошлись бы в первый же день.
 */
export function barOf(task, func) {
  // Сортировка числовая: обычная sort() сравнивает как строки, и «9…» шло
  // бы после «17…» — последняя сдача оказывалась не последней.
  const subs = (task.submissions || []).map((s) => ms(s.at)).filter(Boolean)
    .sort((a, b) => a - b);
  const from = ms(task.start) ?? subs[0] ?? null;
  if (from == null) return null;
  const planned = func ? hoursOf(func) * 3600000 : DAY;
  const to = subs[subs.length - 1] ?? (from + Math.max(DAY / 4, planned));
  return { from, to: Math.max(to, from + DAY / 4) };
}

/**
 * Что попадает в файл: каждая задача со своей полосой и своей историей.
 *
 * Задача без времени вовсе (ни начала, ни единой сдачи) полосы не имеет —
 * придумывать ей дату нельзя, — но из файла не выпадает: она в отдельном
 * списке, и там сказано, что срока ей не ставили.
 */
export function timelineRows(tasks = [], funcs = []) {
  const byId = Object.fromEntries(funcs.map((f) => [f.id, f]));
  const rows = (tasks || []).map((t) => {
    const func = byId[t.funcId] || null;
    return { task: t, func, bar: barOf(t, func) };
  });
  return {
    dated: rows.filter((r) => r.bar).sort((a, b) => a.bar.from - b.bar.from),
    undated: rows.filter((r) => !r.bar),
  };
}

/**
 * Таймлайн одним файлом.
 *
 * Полосы рисуются рамками, а не картинками: файл ничего не тянет из сети,
 * печатается как есть и не рассыпается через год. Ни одного скрипта внутри
 * — иначе через год он мог бы и не открыться.
 */
export function timelineHtml(tasks = [], funcs = [], {
  statusName = (id) => id, funcName = () => "", personName = (id) => String(id ?? ""),
  title = "Таймлайн", now = Date.now(),
  /* Чьими глазами собран файл. У владельца модель целиком, и без зрителя
     в файл ложились бы чужие скрытые слова всех проверяющих — а файл
     заводят, чтобы отдать наружу. */
  viewer = null,
} = {}) {
  const { dated, undated } = timelineRows(tasks, funcs);
  const A = Math.min(...dated.map((r) => r.bar.from), now);
  const B = Math.max(...dated.map((r) => r.bar.to), now);
  const pad = Math.max(DAY, (B - A) * 0.04);
  const from = A - pad;
  const span = (B + pad) - from || 1;
  const at = (v) => (((v - from) / span) * 100).toFixed(2);

  const TICKS = 7;
  const ruler = `<div class="ax">${Array.from({ length: TICKS }, (_, i) => {
    const t = from + (span * i) / (TICKS - 1);
    const shift = i === 0 ? "0" : (i === TICKS - 1 ? "-100%" : "-50%");
    return `<span style="left:${at(t)}%;transform:translateX(${shift})">${
      esc(fmtD(t))}</span>`;
  }).join("")}</div>`;

  const row = ({ task, func, bar }) => {
    const subs = (task.submissions || []).map((s) => ms(s.at)).filter(Boolean);
    return `
  <div class="r"><b>${esc(task.title || "без названия")}</b>
    <span>${esc(statusName(task.status))}</span>
    <span>${esc(funcName(task.funcId))}</span>
    <span>${esc(personName(task.assignee))}</span>
    <span>${esc(fmtD(bar.from))} — ${esc(fmtD(bar.to))}</span></div>
  <div class="t"><i style="left:${at(bar.from)}%;width:${
    Math.max(at(bar.to) - at(bar.from), 0.6)}%"></i>${
  subs.map((v) => `<u style="left:${at(v)}%"></u>`).join("")}<span class="now" style="left:${
  at(now)}%"></span></div>`;
  };

  /* История задачи — то, чего на полосе не видно: когда её отложили, когда
     взяли, что сдали и как приняли. Ради этого файл и заводят: полоса
     говорит «когда», а история — «что происходило».

     Чего в истории НЕТ — по тому же правилу, что режет сервер
     (`taskViewFor`) и повторяет доска (`canSeeComment`):
     · отметки — никогда: в файле она стоит без имени, но у задачи один
       проверяющий, и отметка называет его не хуже подписи; к тому же
       исполнитель своих оценок не видит, а файл он может открыть;
     · скрытые слова — только если зритель их автор или исполнитель, к
       которому они обращены. Остальным скрытого в файле нет вовсе. */
  const mine = (v) => viewer != null && v != null && String(v) === String(viewer);
  const canSeeWords = (t, rv) => !rv.hidden || mine(rv.by) || mine(t.assignee);
  const story = (t) => {
    const out = [];
    if (t.start) out.push(`начало ${fmtDT(t.start)}`);
    if (t.end) out.push(`срок ${fmtDT(t.end)}`);
    if (t.deferredAt) out.push(`отложена ${fmtDT(t.deferredAt)}`);
    (t.submissions || []).forEach((sb) => {
      out.push(`сдача ${fmtDT(sb.at)} · ${num(sb.hours)} ч`);
    });
    (t.reviews || []).forEach((rv) => {
      out.push(`${rv.accept ? "принято" : "возвращено"} ${fmtDT(rv.at)}`
        + (rv.comment && canSeeWords(t, rv) ? ` · ${rv.comment}` : ""));
    });
    return out;
  };

  const table = (list) => `<table>
    <tr><th>задача</th><th>состояние</th><th>функция</th><th>исполнитель</th>
      <th>что происходило</th></tr>
    ${list.map(({ task }) => `<tr><td>${esc(task.title || "без названия")}</td>
      <td>${esc(statusName(task.status))}</td><td>${esc(funcName(task.funcId))}</td>
      <td>${esc(personName(task.assignee))}</td>
      <td>${story(task).map(esc).join("<br>") || "—"}</td></tr>`).join("")}
  </table>`;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body{font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;
    background:#fff;margin:0;padding:24px;max-width:1000px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:18px 0 6px}
  .m{color:#555;font-size:12.5px;margin:4px 0}
  .r{display:flex;gap:10px;align-items:baseline;font-size:12px;margin-top:8px;
    flex-wrap:wrap}
  .r b{font-weight:600;flex:1 1 180px} .r span{color:#555;font-size:11.5px}
  .t{position:relative;height:12px;background:#f1f1f1;border-radius:3px;margin:3px 0}
  .t i{position:absolute;top:0;bottom:0;background:#c07a10;border-radius:3px;
    display:block;min-width:2px}
  /* Сдача — чёрточка на полосе: видно, что работу сдавали не один раз. */
  .t u{position:absolute;top:-2px;bottom:-2px;width:2px;background:#1f8f5f}
  .t .now{position:absolute;top:-3px;bottom:-3px;width:1px;background:#333}
  .ax{position:relative;height:16px;margin:6px 0 14px}
  .ax span{position:absolute;top:0;font-size:10px;color:#555;white-space:nowrap}
  table{border-collapse:collapse;margin:8px 0;font-size:12px;width:100%}
  th,td{border:1px solid #ddd;padding:4px 7px;text-align:left;vertical-align:top}
  th{background:#f5f5f5;font-weight:600}
  @media print{body{padding: 0}}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="m">Собран ${esc(fmtDT(new Date(now).toISOString()))} · задач ${
  dated.length + undated.length}. Полоса — время выполнения, зелёные чёрточки —
  сдачи, тёмная линия — «сегодня» на момент сборки.</p>
${dated.length ? dated.map(row).join("") + ruler
    : '<p class="m">Ни у одной задачи нет ни начала, ни сдач — ставить на ось нечего.</p>'}
<h2>Что происходило</h2>
${dated.length ? table(dated) : ""}
${undated.length ? `<h2>Без срока — на оси их нет</h2>
  <p class="m">Этим задачам не ставили ни начала, ни сдач. Придумать им дату
  нельзя, но и потерять их незачем.</p>${table(undated)}` : ""}
</body></html>`;
}
