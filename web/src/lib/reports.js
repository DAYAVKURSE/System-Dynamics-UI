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

   Пара «функция + ресурс»: результаты какой функции и по какому ресурсу
   сюда попадают. Не задача и не человек: задача — один случай, человек
   меняется, а вопрос отчёта — «что у нас получается вот с этим», и
   отвечает на него функция. Одна функция разбирает техническое задание и
   выдаёт свой результат, другая берёт этот результат и делает следующий —
   в разделе видно ровно то, что выбрано.

   ─── техническое задание ───

   Заказ приходит бумагой, а не мыслью: у проекта есть текст задания, и
   всё, что лежит внутри, относится к нему. Наследуется вниз — раздел без
   своего задания показывает задание ближайшего предка: иначе пришлось бы
   копировать его в каждый раздел и следить, чтобы копии не разошлись.
   ════════════════════════════════════════════════════════════════ */

let seq = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;
const str = (v) => (v == null ? "" : String(v));

/** Проект — корень карты: у него нет родителя, зато есть задание. */
export const newProject = (name = "новый проект") => ({
  id: nextId("rp"), parent: null, name, brief: "", picks: [],
});

/** Раздел — тот же блок, только внутри другого. */
export const newSection = (parent, name = "новый раздел") => ({
  id: nextId("rs"), parent: parent ?? null, name, brief: "", picks: [],
});

/** Что попадает в блок: результаты функции по конкретному ресурсу. */
export const newPick = (func = "", trait = "") => ({ id: nextId("pk"), func, trait });

export const normalizePick = (p = {}) => ({
  id: p.id ?? nextId("pk"), func: str(p.func), trait: str(p.trait),
});

export const normalizeReport = (n = {}) => ({
  id: n.id ?? nextId("rp"),
  parent: n.parent ?? null,
  name: str(n.name),
  brief: str(n.brief),
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
 * Чьё задание действует в этом блоке.
 *
 * Своё, а если своего нет — ближайшего предка. Копировать задание в каждый
 * раздел значило бы завести столько его версий, сколько разделов, и следить,
 * чтобы они не разошлись.
 */
export function briefOf(nodes = [], id) {
  const path = pathOf(nodes, id);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (String(path[i].brief || "").trim()) return { node: path[i], brief: path[i].brief };
  }
  return null;
}

/**
 * Что уже сделано по выбранным парам «функция + ресурс».
 *
 * Строка — одна сдача: когда, кто, сколько часов ушло, сколько ресурса
 * вышло и какой файл приложен. Принятые сдачи и непринятые различены:
 * непринятая — это заявление исполнителя, а не результат, и путать их
 * нельзя, но и прятать файл, который человек уже сдал, незачем.
 */
export function resultsOf({ tasks = [], funcs = [] } = {}, picks = []) {
  const rows = [];
  picks.forEach((p) => {
    const func = funcs.find((f) => f.id === p.func) || null;
    tasks.filter((t) => t.funcId === p.func).forEach((t) => {
      (t.submissions || []).forEach((sb) => {
        const gave = Number(sb.gives?.[p.trait]) || 0;
        const took = Number(sb.takes?.[p.trait]) || 0;
        // Ресурс не тронут вовсе — эта сдача не про него.
        if (!gave && !took && p.trait) return;
        rows.push({
          id: `${t.id}-${sb.id}-${p.id}`,
          pick: p.id,
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
