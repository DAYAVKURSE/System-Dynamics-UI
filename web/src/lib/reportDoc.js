/* ════════════════════════════════════════════════════════════════
   ОТЧЁТ РАЗДЕЛА · один расчёт на экран и на скачивание

   Раздел показывает три вещи, и всегда одни и те же — и проект, и любой
   раздел внутри него устроены одинаково:

     1. созданные ресурсы: единицы с номерами и файлами;
     2. как изменятся ресурсы: прогноз по модели рядом с фактом;
     3. работа по шагам — и каждый шаг тоже раздел, со своим якорем.

   Созданное стоит первым: ради него работу и заказывают, и спрашивают
   сперва «что уже есть», а не «что обещали».

   Считается это ЗДЕСЬ, а не в разметке. Иначе скачанный отчёт пришлось бы
   собирать вторым кодом по тем же правилам, и в первый же день он разошёлся
   бы с тем, что человек видит на экране: два ответа на один вопрос, и
   неизвестно, какой настоящий.
   ════════════════════════════════════════════════════════════════ */

import { actualOf, chainOf, estimateRange, factorsIn } from "./chain.js";
import { childrenOf, pathOf, pickedOf, stepAnchor } from "./reports.js";
import { descendantsOf, hasLineage, parentsOf, unitsOf } from "./units.js";
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
  const picked = pickedOf(node);
  const plan = estimateRange(model, chain, { runsOf,
    // Выбраны конкретные единицы — считаем на них; иначе на заданное число.
    qty: picked.length || node.qty || 1 });

  /* ─── отчёт про ОДНУ единицу ───

     Выбрана определённая единица — раздел показывает не всё, что делала
     цепочка, а то, что выросло ИЗ НЕЁ: её саму, её потомков и задачи,
     которые их сделали. Родословная берётся из сдач (`took`), где
     исполнитель назвал взятое.

     Связь не записана — так и сказано. Достроить её по количествам и датам
     было бы догадкой с видом знания: рядом идёт чужая работа, и время у
     неё то же самое. */
  const all = unitsOf(model);
  /* Единиц может быть несколько: прослеживают и «вот этот договор», и «вот
     эти три». Родословная считается по каждой и складывается — вместе они
     и есть та работа, о которой спрашивают. */
  const chosen = picked.map((id) => all.find((u) => u.id === id)).filter(Boolean);
  const seen = new Set();
  const family = chosen.length
    ? chosen.flatMap((u) => descendantsOf(all, u.id))
      .filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)))
    : null;
  /* ─── чужая работа в отчёт не попадает ───

     Раздел прослеживает ЕДИНИЦЫ: вот этот договор, вот эти три. Задача,
     сделанная над другой вещью, к этому вопросу отношения не имеет, даже
     если её делала та же функция. Показывать её рядом — значит отвечать не
     на заданный вопрос: человек спрашивал про один договор, а видел восемь
     чужих задач и справедливо не понимал, откуда они.

     Единица не выбрана — прослеживается ГИПОТЕТИЧЕСКАЯ: «что изменится,
     если завести её в систему». У неё нет и не может быть ни задач, ни
     созданного, ни факта — она ещё не существует. Это не пустота от
     нехватки данных, а прямой ответ: работы по ней пока не было.

     Прежде здесь стояло `only ? … : все задачи функций цепочки`, и вот
     этот «иначе» и подмешивал в отчёт весь поток по функциям. */
  const onlyTasks = new Set((family || []).map((u) => u.task).filter(Boolean));
  const traced = !chosen.length
    || family.length > chosen.length
    || chosen.some((u) => hasLineage(all, u.id));

  /* ─── единицы не выбраны — раздел про ВСЮ работу этой цепочки ───

     Выбраны конкретные вещи — отбор по ним: вопрос был про них, и чужая
     работа к нему отношения не имеет. Не выбрано ничего — вопрос другой:
     «что вообще делается по этой цепочке». Отвечать на него пустотой
     нельзя: задачи есть, вещи из них вышли, часы посчитаны — и всё это
     молча пропадало, а на их месте стояла надпись «задач тут нет и не
     должно быть». Прогноз при этом никуда не девается: он считается на
     заданное число единиц и стоит рядом с фактом, подписанный. */
  const actual = actualOf(model, chain, chosen.length ? { only: onlyTasks } : {});
  /* Созданное по выбранным единицам — это их родословная, а не пересечение
     с цепочкой: сами они сделаны функцией, которая лежит ДО цепочки, и
     отсеивать их значило бы выбросить из отчёта о вещи саму вещь. */
  /* Новое сверху: у списка созданного порядок «свежее — выше», и таким же
     его показывает снимок на сервере. Разный порядок в двух местах читался
     бы как разные списки. */
  const inActual = new Set(actual.tasks.map((t) => t.id));
  const made = [...(family || all.filter((u) => inActual.has(u.task)))]
    .sort((a, b) => (b.no || 0) - (a.no || 0));
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

  /* ─── шаг и его работа — одно место, а не два списка ───

     Шаг и задача это не разные разделы отчёта, а одно и то же дело с двух
     сторон: шаг — что должно случиться, задача — что случилось. Пока они
     стояли отдельными списками, человеку приходилось сводить их глазами,
     и первый же вопрос был «почему шаг один, а задач четыре».

     Поэтому у каждого шага здесь сразу лежит его работа: задачи по вещам
     раздела, что каждая взяла и что сделала, сколько на неё ушло часов —
     рядом с тем, сколько по плану. Фактор задач не имеет вовсе: с погоды
     не спрашивают, и на его месте так и сказано. */
  /* Взятое ищется по ВСЕМ единицам, а не только по показанным: задача,
     сделавшая прослеживаемую вещь, взяла то, что лежит до цепочки, — и
     назвать это по имени можно, а промолчать значило бы потерять ответ на
     «из чего». */
  const byId = Object.fromEntries(all.map((u) => [u.id, u]));
  const madeBy = {};
  (made || []).forEach((u) => { (madeBy[u.task] = madeBy[u.task] || []).push(u); });
  const lastSub = (t) => {
    const subs = t.submissions || [];
    return subs.length ? subs[subs.length - 1] : null;
  };
  const taskView = (t) => {
    const sb = lastSub(t);
    return {
      id: t.id,
      title: t.title || "без названия",
      funcId: t.funcId,
      status: t.status,
      assignee: t.assignee,
      start: t.start,
      end: t.end,
      // Часы факта — только у принятой работы: непринятая ещё не измерена.
      hours: t.status === "done" && sb ? num(sb.hours) : null,
      took: [...new Set(Object.values(sb?.took || {}).flat().filter(Boolean))]
        .map((id) => byId[id]).filter(Boolean),
      made: madeBy[t.id] || [],
    };
  };
  const steps = plan.hi.steps.map((s) => {
    const low = plan.lo.steps.find((x) => x.func === s.func);
    const mine = actual.tasks.filter((t) => t.funcId === s.func).map(taskView);
    const done = mine.filter((t) => t.hours != null);
    return {
      ...s,
      // Вилка плана: время и работа считаются с обеих сторон, и обе нужны.
      workLo: num(low?.workHours),
      workHi: num(s.workHours),
      runsLo: num(low?.runs),
      tasks: mine,
      /* Что этот шаг создал. Стоит у шага, потому что шаг — это раздел, а
         созданные ресурсы в разделе идут первыми: ради них он и делается. */
      made: mine.flatMap((t) => t.made),
      doneCount: done.length,
      factHours: done.reduce((x, t) => x + num(t.hours), 0),
    };
  });
  /* Работа, которой в цепочке нет: та, в которой выбранные вещи и родились.
     Она лежит ДО первого шага, и выбросить её значило бы не ответить на
     вопрос «откуда это взялось». */
  const inSteps = new Set(steps.flatMap((s) => s.tasks.map((t) => t.id)));
  const before = actual.tasks.filter((t) => !inSteps.has(t.id)).map(taskView);

  return {
    node,
    path: pathOf(nodes, node.id).map((n) => n.name || "без названия"),
    chain,
    plan,
    actual,
    steps,
    before,
    made,
    factors,
    changes,
    // Выбранные единицы: они сами, из чего сделаны и что из них выросло.
    units: chosen,
    unit: chosen[0] || null,
    /* Прослеживается вещь, которой ещё нет в системе: конкретные единицы
       не выбраны, и раздел считает прогноз на гипотетические. Работа по
       цепочке при этом показывается вся — она есть, и прятать её незачем. */
    hypothetical: !chosen.length,
    parents: chosen.flatMap((u) => parentsOf(all, u.id)),
    family: family || [],
    /* Записана ли у единицы родословная. Не записана — числа по ней
       считать не из чего, и это сказано словами, а не пустотой. */
    traced,
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

/* Одна строка «как изменится ресурс»: своя шкала, общий ноль, план вилкой и
   факт под ним. Числа стоят текстом рядом с названием — подписи внутри
   картинки при больших значениях вылезали за край. */
const barRow = (c, tn) => {
  const lo = Math.min(num(c.lo), num(c.hi));
  const hi = Math.max(num(c.lo), num(c.hi));
  const vals = [0, lo, hi, ...(c.fact == null ? [] : [num(c.fact)])];
  /* Поля по краям — чтобы нулевая линия не упиралась в самый край: «убавится
     на 1» иначе рисуется полосой во всю ширину и читается как рост. */
  const raw = Math.max(...vals) - Math.min(...vals) || 1;
  const min = Math.min(...vals) - raw * 0.08;
  const max = Math.max(...vals) + raw * 0.08;
  const span = max - min || 1;
  const at = (v) => (((v - min) / span) * 100).toFixed(2);
  /* Полоса растёт ОТ НУЛЯ: «убавится на 3» — это длина от нуля до −3, а не
     невидимая точка. Верная часть вилки плотная, «а может и больше» —
     полупрозрачная: обещано первое, возможно второе. */
  const bar = (a, b, cls, dim) => (a === b ? "" : `<i class="${cls}" style="left:${
    Math.min(at(a), at(b))}%;width:${Math.max(Math.abs(at(b) - at(a)), 0.6)
    }%${dim ? ";opacity:.45" : ""}"></i>`);
  const planText = lo === hi ? nm(hi) : `${nm(lo)} … ${nm(hi)}`;
  return `
  <div class="r"><b style="flex:1">${tn(c.trait)}</b>
    <span>план ${planText}</span>
    <span>${c.fact == null ? "факта нет" : `факт ${nm(c.fact)}`}</span></div>
  <div class="t"><span class="z" style="left:${at(0)}%"></span>${bar(0, lo, "p")}${
    lo === hi ? "" : bar(lo, hi, "p", true)}</div>
  ${c.fact == null || num(c.fact) === 0 ? "" : `<div class="t"><span class="z" style="left:${
    at(0)}%"></span>${bar(0, num(c.fact), "f")}</div>`}`;
};

/* Таймлайн: шаги на одной шкале времени от «сейчас». Сдвиг полосы вправо —
   ответ на «что за чем», её длина — на «как долго». Ради этого отчёт и
   заводят: сперва спланировать работы, и только потом сверять. */
const timelineHtml = (steps = [], before = []) => {
  const now = Date.now();
  const hrs = (v) => {
    if (!v) return null;
    const ms = new Date(v).getTime();
    return Number.isNaN(ms) ? null : (ms - now) / 3600000;
  };
  const rows = [];
  steps.forEach((s) => {
    // Шаг, который не выполнится, полосы не получает: обещать срок работе,
    // которая не начнётся, нельзя.
    const stuck = (s.short || []).length > 0;
    rows.push({ name: s.name, kind: "step", factor: s.factor, stuck,
      from: stuck ? null : num(s.startHours),
      to: stuck ? null : num(s.startHours) + Math.max(num(s.calendarHours), 0.01) });
    (s.tasks || []).forEach((t) => {
      rows.push({ name: t.title, kind: "task", done: t.hours != null,
        from: hrs(t.start), to: hrs(t.end) });
    });
  });
  before.forEach((t) => {
    rows.unshift({ name: `${t.title} · до цепочки`, kind: "task",
      done: t.hours != null, from: hrs(t.start), to: hrs(t.end) });
  });
  const placed = rows.filter((r) => r.from != null && r.to != null);
  if (!placed.length) return "";
  const from0 = Math.min(0, ...placed.map((r) => r.from));
  const to1 = Math.max(...placed.map((r) => r.to), from0 + 1);
  const span = to1 - from0 || 1;
  const at = (v) => (((v - from0) / span) * 100).toFixed(2);
  return `<p class="m">Слева «сейчас», весь срок — ${esc(timeText(to1))}.</p>`
    + rows.map((r) => {
      const label = `<div class="${r.kind === "task" ? "sub m" : "m"}">${
        r.kind === "task" ? "↳ " : ""}${esc(r.name)}${r.factor ? " · фактор" : ""}</div>`;
      if (r.from == null || r.to == null) {
        return `${label}<div class="${r.kind === "task" ? "sub" : ""} m">${r.stuck
          ? "на шкале его нет: он не начнётся"
          : "срок не поставлен — на шкале её нет"}</div>`;
      }
      const cls = r.kind === "step" ? "p" : (r.done ? "f" : "n");
      return `${label}<div class="t${r.kind === "task" ? " sub" : ""}"><i class="${cls}" style="left:${
        at(r.from)}%;width:${Math.max(at(r.to) - at(r.from), 0.6)}%"></i></div>`;
    }).join("");
};

/* Имя ресурса без экранирования — оно уходит внутрь строки, которую
   экранируют целиком. */
const tnRaw = (id, traitName) => (traitName ? traitName(id) : id);

/* Вилка часов: меньшее слева. «Щедрая» сторона оценки считается по быстрой
   работе, поэтому часов в ней меньше — без сортировки строка выходила задом
   наперёд: «674–505 ч». */
const hoursRange = (a, b) => {
  const lo = Math.min(num(a), num(b));
  const hi = Math.max(num(a), num(b));
  return lo === hi ? `${nm(hi)} ч` : `${nm(lo)}–${nm(hi)} ч`;
};

/* Что шаг берёт и что даёт — одной строкой; нули не пишутся, иначе строка
   заполняется тем, чего не происходит. */
const portText = (list, tn) => (list || [])
  .filter((x) => nm(x.qty) !== "0")
  .map((x) => `${tn(x.trait)} ${nm(x.qty)}`).join(", ");

/* Сколько по плану уходит на ОДНО выполнение: с этим числом и сравнивают
   потраченные часы задачи. Выполнений нет — сравнивать не с чем. */
const perRun = (s) => (s.runs > 0
  ? nm(Math.round((s.workHi / s.runs) * 10) / 10) : "—");

/* Над чем работала задача: взяла вот это, сделала вот это. Именно этим
   выполнения одной функции и отличаются друг от друга. */
const linkText = (t, traitName) => {
  const tn2 = (id) => (traitName ? traitName(id) : id);
  const took = t.took.map((u) => `${tn2(u.trait)} №${u.no}`).join(", ");
  const made = t.made.map((u) => `${tn2(u.trait)} №${u.no}`).join(", ");
  return [took, made].filter(Boolean).join(" → ");
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
    const { plan, actual, chain, factors, changes, node } = d;
    return `
<section class="b" style="margin-left:${depth * 14}px">
  <h${h}>${esc(node.name || "без названия")}</h${h}>
  <p class="m">
    ${d.units.length
      ? `по единицам ${d.units.map((u) => `№${u.no} «${esc(u.title || "без названия")}»`).join(", ")} · `
      : ""}
    ${node.trait ? `с ресурса «${tn(node.trait)}»` : "ресурс не выбран"}
    ${node.upto ? ` · до звена «${tn(node.upto) !== node.upto ? tn(node.upto) : fn(node.upto)}»` : " · до конца цепочки"}
    ${node.file ? ` · приложено: ${esc(node.file.name || "файл")}` : ""}
  </p>
  ${d.hypothetical && node.trait ? `<p class="m">Определённые единицы не выбраны:
    прогноз посчитан на ${nm(plan.hi.qty)} гипотетическ${plan.hi.qty > 1 ? "их" : "ую"},
    а работа показана вся, какая по этой цепочке есть.</p>` : ""}
  ${d.broken ? '<p class="w">Цепочка не доходит до звена: между ними разрыв — ни одна функция не берёт то, что выдаёт предыдущая.</p>' : ""}
  ${d.unit && !d.traced ? '<p class="w">По этой единице не записано, что из чего сделано: при сдаче не отметили взятое. Ниже — только она сама.</p>' : ""}
  ${d.parents.length ? `<p class="m">сделано из: ${d.parents.map((u) => `№${u.no} ${esc(u.title || "без названия")}`).join(", ")}</p>` : ""}

  <h${h + 1}>1. Созданные ресурсы</h${h + 1}>
  ${d.made.length ? `<table>
    <tr><th>№</th><th>что это</th><th>из какой работы</th><th>состояние</th><th>файл</th></tr>
    ${d.made.map((u) => `<tr><td>${u.no}</td><td>${tn(u.trait)}</td>
      <td>${esc(u.title || "без названия")}</td>
      <td>${u.accepted ? "принято" : "не принято"}</td>
      <td>${u.file
        ? `<a href="${esc(u.file.url || u.file.data || "")}">${esc(u.file.name || "файл")}</a>`
        : "файла нет"}</td></tr>`).join("")}
  </table>` : '<p class="m">Пока ничего не создано: принятых сдач с приложенным результатом по этой цепочке нет.</p>'}

  <h${h + 1}>2. Как изменятся ресурсы</h${h + 1}>
  <p class="m"><b>прогноз по модели:</b>
     работы ${esc(hoursRange(plan.lo.workHours, plan.hi.workHours))} ·
     займёт ${esc(rangeTimeText(plan.lo.calendarHours, plan.hi.calendarHours))} ·
     шагов ${plan.hi.steps.length}</p>
  <p class="m"><b>фактически:</b> ${actual.any
    ? `принято ${actual.done} из ${actual.total} · ушло ${nm(actual.hours)} ч`
    : "принятых работ пока нет — измерять нечего"}</p>
  ${changes.length
    ? changes.map((c) => barRow(c, tn)).join("")
      + `<p class="m">Полоса плана — вилка «от и до», полоса факта — то, что
        вышло. У каждого ресурса своя шкала: доход в сотнях тысяч и договоры
        в штуках на общей шкале несравнимы, да их и не складывают. Сравнивают
        план с фактом — и это сравнение внутри строки честное.</p>`
    : '<p class="m">Ресурсы по этой цепочке не меняются.</p>'}
  ${Object.keys(plan.hi.need || {}).length ? `<p class="m">нужно со стороны:
    ${Object.entries(plan.hi.need).map(([id, q]) => `${tn(id)} ${nm(q)}`).join(", ")}</p>` : ""}

  <h${h + 1}>3. Работа по шагам</h${h + 1}>
  ${timelineHtml(d.steps, d.before)}
  ${d.steps.length ? d.steps.map((s2, i2) => `
    <h${Math.min(6, h + 2)} id="${esc(stepAnchor(node.id, s2.func))}">${
      i2 + 1}. ${esc(s2.name)}${s2.factor ? " · фактор" : ""}</h${Math.min(6, h + 2)}>
    ${(s2.made || []).length ? `<table>
      <tr><th>№</th><th>что это</th><th>из какой работы</th><th>состояние</th><th>файл</th></tr>
      ${s2.made.map((u) => `<tr><td>${u.no}</td><td>${tn(u.trait)}</td>
        <td>${esc(u.title || "без названия")}</td>
        <td>${u.accepted ? "принято" : "не принято"}</td>
        <td>${u.file
          ? `<a href="${esc(u.file.url || u.file.data || "")}">${esc(u.file.name || "файл")}</a>`
          : "файла нет"}</td></tr>`).join("")}
    </table>` : `<p class="m">${s2.factor
      ? "Фактор ничего не выдаёт вещью: он случается сам."
      : "Созданных ресурсов пока нет: принятых сдач по этому шагу не было."}</p>`}
    <p class="m">${(s2.short || []).length
      ? `<span class="w">не выполнится: не хватает ${esc((s2.short || [])
        .map((x) => `${tnRaw(x.trait, traitName)}${x.spentBy
          ? ` (израсходовал шаг «${x.spentBy}»)` : ""}`).join(", "))}</span>`
      : `<b>прогноз по модели:</b> выполнений ${nm(s2.runs)} ·
      начнётся через ${esc(timeText(s2.startHours))} ·
      займёт ${esc(timeText(s2.calendarHours))}${s2.factor ? ""
        : ` · работы ${esc(hoursRange(s2.workLo, s2.workHi))}`}${
      portText(s2.takes, tn) ? ` · берёт ${portText(s2.takes, tn)}` : ""}${
      portText(s2.gives, tn) ? ` · даёт ${portText(s2.gives, tn)}` : ""}`}</p>
    ${(s2.short || []).length ? "" : `<p class="m"><b>фактически:</b> ${s2.doneCount
      ? `принято выполнений ${nm(s2.doneCount)} из ${nm(s2.tasks.length)} · ушло ${
        nm(Math.round(num(s2.factHours) * 10) / 10)} ч`
      : "принятых работ по этому шагу пока нет"}</p>`}
    ${s2.factor
      ? '<p class="m">Задач тут не бывает: фактор случается сам, и спрашивать за него не с кого.</p>'
      : s2.tasks.length ? `<table>
        <tr><th>задача</th><th>исполнитель</th><th>срок</th><th>состояние</th>
          <th>прогноз, ч</th><th>факт, ч</th><th>взяла → вышло</th></tr>
        ${s2.tasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${pn(t.assignee)}</td>
          <td>${esc(fmtDT(t.end))}</td><td>${esc(t.status)}</td>
          <td>${perRun(s2)}</td><td>${t.hours == null ? "—" : nm(t.hours)}</td>
          <td>${esc(linkText(t, traitName))}</td></tr>`).join("")}
      </table>` : '<p class="m">Задач на этот шаг ещё не заведено.</p>'}
  `).join("") : '<p class="m">Шагов нет: цепочка пуста.</p>'}
  ${d.before.length ? `<p class="m">как эти вещи появились:</p><table>
    <tr><th>задача</th><th>исполнитель</th><th>срок</th><th>состояние</th><th>вышло</th></tr>
    ${d.before.map((t) => `<tr><td>${esc(t.title)}</td><td>${pn(t.assignee)}</td>
      <td>${esc(fmtDT(t.end))}</td><td>${esc(t.status)}</td>
      <td>${esc(linkText(t, traitName))}</td></tr>`).join("")}
  </table>` : ""}

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
  /* Полосы рисуются рамками, а не картинками: файл ничего не тянет из сети,
     печатается как есть и не рассыпается через год. */
  .t{position:relative;height:10px;background:#f1f1f1;border-radius:3px;
    overflow:hidden;margin:2px 0 6px}
  .t i{position:absolute;top:0;bottom:0;border-radius:3px;display:block}
  .p{background:#c07a10} .f{background:#1f8f5f} .n{background:#8a93a3}
  .z{position:absolute;top:0;bottom:0;width:1px;background:#999}
  .r{display:flex;gap:8px;align-items:baseline;font-size:12px;margin-top:6px}
  .r b{font-weight:600} .r span{font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
  .sub{padding-left:14px}
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
 * Скачать файл ссылкой — обычный способ, работающий в браузере.
 *
 * Возвращает адрес, чтобы вызывающий мог им распорядиться.
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

/**
 * Отдать отчёт человеку — там, где он его открыл.
 *
 * ─── почему одного способа мало ───
 *
 * В браузере файл отдаётся ссылкой с `download`, и это работает. А в
 * мини-приложении Telegram — НЕ работает: его WebView такие ссылки на
 * `blob:` просто игнорирует, ничего не скачивая и ничего не говоря. Кнопка
 * выглядела нажатой и не делала ровно ничего — молчаливый отказ, худший из
 * возможных: человек не знает, ждать ему или нажимать ещё раз.
 *
 * Поэтому внутри Telegram отчёт сперва кладётся на СВОЙ сервер (туда же,
 * куда и файлы сдач) и открывается обычной ссылкой наружу — её Telegram
 * отдаёт браузеру, и там уже и посмотреть, и сохранить. Не вышло и это —
 * говорим словами, а не молчим.
 *
 * Зависимости переданы снаружи (`telegram`, `putFile`), чтобы это можно
 * было проверить: иначе способ доставки проверялся бы только руками, а
 * именно он и сломался.
 */
export async function deliverReport(name, html, { telegram, putFile, origin = "" } = {}) {
  const tg = telegram;
  const canOpen = tg && typeof tg.openLink === "function";
  if (canOpen && typeof putFile === "function") {
    const type = "text/html;charset=utf-8";
    let file;
    try {
      file = new File([html], name, { type });
    } catch {
      // Старый WebView без конструктора File: имя кладём рядом с байтами.
      file = Object.assign(new Blob([html], { type }), { name });
    }
    const saved = await putFile(file);
    const url = saved?.url || saved?.data || "";
    if (!url) throw new Error("файл сохранён, но адреса у него нет");
    const base = origin || (typeof window === "undefined" ? "" : window.location.origin);
    tg.openLink(/^https?:/.test(url) ? url : `${base}${url}`);
    return { via: "link", url };
  }
  saveFile(name, html);
  return { via: "download" };
}
