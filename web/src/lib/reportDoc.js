/* ════════════════════════════════════════════════════════════════
   ОТЧЁТ РАЗДЕЛА · один расчёт на экран и на скачивание

   Раздел показывает четыре вещи, и всегда одни и те же — и проект, и любой
   раздел внутри него устроены одинаково:

     1. предварительная оценка: как изменятся ресурсы и сколько это займёт;
     2. что и когда будет сделано — задачи во времени;
     3. созданные ресурсы: единицы с номерами;
     4. фактическая оценка: что и правда сделано и чего это стоило.

   Считается это ЗДЕСЬ, а не в разметке. Иначе скачанный отчёт пришлось бы
   собирать вторым кодом по тем же правилам, и в первый же день он разошёлся
   бы с тем, что человек видит на экране: два ответа на один вопрос, и
   неизвестно, какой настоящий.
   ════════════════════════════════════════════════════════════════ */

import { actualOf, chainOf, estimateRange, factorsIn } from "./chain.js";
import { childrenOf, madeIn, pathOf } from "./reports.js";
import { fromHours } from "./funcs.js";

const num = (v) => Number(v) || 0;

/** Время по-человечески: не «730 ч», а «1 мес». */
export const timeText = (h) => {
  if (!(num(h) > 0)) return "мгновенно";
  const { dur, durUnit } = fromHours(num(h));
  return `${dur} ${durUnit}`;
};

/** Вилка времени: одинаковые границы говорятся один раз, а не дважды. */
export const rangeTimeText = (lo, hi) => (Math.abs(num(lo) - num(hi)) < 1e-9
  ? timeText(lo) : `${timeText(Math.min(lo, hi))} — ${timeText(Math.max(lo, hi))}`);

/**
 * Всё, что раздел знает о себе.
 *
 * `deep` собирает и вложенные разделы: карта показывается целиком, а
 * скачанный отчёт должен быть тем же самым, что и на экране.
 */
export function reportOf(model = {}, node, nodes = [], { runsOf, deep = true } = {}) {
  if (!node) return null;
  const chain = chainOf(model, { from: node.trait, upto: node.upto });
  const plan = estimateRange(model, chain, { runsOf, qty: node.qty || 1 });
  const actual = actualOf(model, chain);
  const made = madeIn(model, chain);
  const factors = factorsIn(model, chain);

  /* Ресурсы, о которых в разделе вообще есть что сказать: те, что цепочка
     меняет по плану, и те, что она изменила на деле. Показывать ресурс, с
     которым ничего не происходит, значит рисовать пустую строку. */
  const ids = [...new Set([
    ...Object.keys(plan.hi.delta || {}),
    ...Object.keys(plan.lo.delta || {}),
    ...Object.keys(actual.delta || {}),
  ])];
  const changes = ids.map((id) => ({
    trait: id,
    lo: num(plan.lo.delta?.[id]),
    hi: num(plan.hi.delta?.[id]),
    fact: actual.any ? num(actual.delta?.[id]) : null,
  })).sort((a, b) => Math.abs(b.hi) - Math.abs(a.hi));

  return {
    node,
    path: pathOf(nodes, node.id).map((n) => n.name || "без названия"),
    chain,
    plan,
    actual,
    made,
    factors,
    changes,
    /* Цепочка не дошла до звена — значит между ними разрыв: ни одна функция
       не берёт то, что выдаёт предыдущая. Молчать об этом нельзя: отчёт
       выглядел бы полным, а в нём дыра. */
    broken: !!node.trait && !!node.upto && !chain.ok,
    sections: deep
      ? childrenOf(nodes, node.id).map((k) => reportOf(model, k, nodes, { runsOf, deep }))
      : [],
  };
}

/* ─────── скачиваемый отчёт ─────── */

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const nm = (v) => {
  const n = num(v);
  return Math.abs(n) >= 1000 ? n.toLocaleString("ru-RU")
    : String(Math.round(n * 100) / 100);
};

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit" });
};

/**
 * Отчёт одним файлом.
 *
 * HTML, а не PDF и не таблица: он открывается везде, печатается в PDF одним
 * нажатием и остаётся читаемым текстом, если открыть его чем угодно.
 * Картинок внутри нет — числа сказаны словами и таблицами, поэтому файл
 * ничего не тянет из сети и не ломается через год.
 */
export function reportHtml(doc, { traitName, funcName, personName, title } = {}) {
  const tn = (id) => esc(traitName ? traitName(id) : id);
  const fn = (id) => esc(funcName ? funcName(id) : id);
  const pn = (id) => esc(personName ? personName(id) : (id ?? "не назначен"));

  const block = (d, depth = 0) => {
    if (!d) return "";
    const h = Math.min(6, depth + 2);
    const { plan, actual, chain, made, factors, changes, node } = d;
    return `
<section class="b" style="margin-left:${depth * 14}px">
  <h${h}>${esc(node.name || "без названия")}</h${h}>
  <p class="m">
    ${node.trait ? `с ресурса «${tn(node.trait)}»` : "ресурс не выбран"}
    ${node.upto ? ` · до звена «${tn(node.upto) !== node.upto ? tn(node.upto) : fn(node.upto)}»` : " · до конца цепочки"}
    ${node.file ? ` · приложено: ${esc(node.file.name || "файл")}` : ""}
  </p>
  ${d.broken ? '<p class="w">Цепочка не доходит до звена: между ними разрыв — ни одна функция не берёт то, что выдаёт предыдущая.</p>' : ""}

  <h${h + 1}>1. Предварительная оценка</h${h + 1}>
  <p class="m">работы ${nm(plan.lo.workHours)}–${nm(plan.hi.workHours)} ч ·
     займёт ${esc(rangeTimeText(plan.lo.calendarHours, plan.hi.calendarHours))} ·
     шагов ${plan.hi.steps.length}</p>
  ${changes.length ? `<table>
    <tr><th>ресурс</th><th>план</th><th>факт</th></tr>
    ${changes.map((c) => `<tr><td>${tn(c.trait)}</td>
      <td>${nm(Math.min(c.lo, c.hi))} … ${nm(Math.max(c.lo, c.hi))}</td>
      <td>${c.fact == null ? "—" : nm(c.fact)}</td></tr>`).join("")}
  </table>` : '<p class="m">Ресурсы по этой цепочке не меняются.</p>'}
  ${Object.keys(plan.hi.need || {}).length ? `<p class="m">нужно со стороны:
    ${Object.entries(plan.hi.need).map(([id, q]) => `${tn(id)} ${nm(q)}`).join(", ")}</p>` : ""}

  <h${h + 1}>2. Шаги и задачи</h${h + 1}>
  ${plan.hi.steps.length ? `<table>
    <tr><th>шаг</th><th>выполнений</th><th>начнётся через</th><th>займёт</th></tr>
    ${plan.hi.steps.map((s) => `<tr><td>${esc(s.name)}${s.factor ? " (фактор)" : ""}</td>
      <td>${nm(s.runs)}</td><td>${esc(timeText(s.startHours))}</td>
      <td>${esc(timeText(s.calendarHours))}</td></tr>`).join("")}
  </table>` : '<p class="m">Шагов нет: цепочка пуста.</p>'}
  ${actual.tasks.length ? `<table>
    <tr><th>задача</th><th>исполнитель</th><th>срок</th><th>состояние</th></tr>
    ${actual.tasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${pn(t.assignee)}</td>
      <td>${esc(fmtDT(t.end))}</td><td>${esc(t.status)}</td></tr>`).join("")}
  </table>` : '<p class="m">Задач по этой цепочке ещё нет.</p>'}

  <h${h + 1}>3. Созданные ресурсы</h${h + 1}>
  ${made.length ? `<table>
    <tr><th>№</th><th>что</th><th>ресурс</th><th>когда</th><th>кто</th><th>принято</th></tr>
    ${made.map((u) => `<tr><td>${u.no}</td><td>${esc(u.title || "без названия")}</td>
      <td>${tn(u.trait)}</td><td>${esc(fmtDT(u.at))}</td><td>${pn(u.by)}</td>
      <td>${u.accepted ? "да" : "нет"}</td></tr>`).join("")}
  </table>` : '<p class="m">Пока ничего не создано: единицы появляются из сдач.</p>'}

  <h${h + 1}>4. Фактическая оценка</h${h + 1}>
  ${actual.any ? `<p class="m">принято работ: ${actual.done} из ${actual.total} ·
    ушло ${nm(actual.hours)} ч (по плану ${nm(plan.lo.workHours)}–${nm(plan.hi.workHours)} ч)</p>
    <table><tr><th>ресурс</th><th>изменение по факту</th></tr>
    ${Object.entries(actual.delta).map(([id, q]) =>
    `<tr><td>${tn(id)}</td><td>${nm(q)}</td></tr>`).join("")}</table>`
    : '<p class="m">Принятых сдач ещё нет — факта пока не существует, и выдавать за него план нельзя.</p>'}

  ${(d.sections || []).map((k) => block(k, depth + 1)).join("")}
</section>`;
  };

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>${esc(title || doc?.node?.name || "Отчёт")}</title>
<style>
  body{font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;
    background:#fff;margin:0;padding:24px;max-width:900px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:18px} h3{font-size:16px}
  h4,h5,h6{font-size:14px}
  .b{border-left:2px solid #ddd;padding-left:12px;margin:18px 0}
  .m{color:#555;font-size:12.5px;margin:4px 0}
  .w{color:#a4501e;font-size:12.5px;margin:4px 0}
  table{border-collapse:collapse;margin:8px 0;font-size:12.5px;width:100%}
  th,td{border:1px solid #ddd;padding:4px 7px;text-align:left}
  th{background:#f5f5f5;font-weight:600}
  @media print{body{padding:0} .b{break-inside:avoid}}
</style></head><body>
<h1>${esc(title || doc?.node?.name || "Отчёт")}</h1>
<p class="m">${esc((doc?.path || []).join(" → "))} · собран ${esc(fmtDT(new Date().toISOString()))}</p>
${block(doc, 0)}
</body></html>`;
}

/**
 * Отдать файл человеку.
 *
 * Через ссылку с `download`, а не через переход по адресу: переход в
 * мини-приложении Telegram увёл бы человека со страницы, а вернуться назад
 * ему потом нечем.
 */
export function saveFile(name, text, type = "text/html;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Освобождаем не сразу: часть браузеров читает ссылку уже после нажатия.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return url;
}
