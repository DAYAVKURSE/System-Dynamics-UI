/* ════════════════════════════════════════════════════════════════
   СНИМОК БЛОКА КАРТЫ ОТЧЁТОВ

   То, что уходит по общей ссылке. Собирается здесь, а не на клиенте:
   клиент можно попросить показать что угодно, а наружу должно уходить
   ровно то, что владелец выбрал в блоке, — и ничего сверх того.

   Поэтому имена здесь уже развёрнуты: ресурс назван словом, человек —
   именем, функция — своим названием. Идентификаторы модели наружу не
   уходят: по ним нечего смотреть, а лишним они быть могут.
   ════════════════════════════════════════════════════════════════ */

const str = (v) => (v == null ? "" : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const childrenOf = (nodes, id) => nodes.filter((n) => n.parent === id);

/** Путь от корня до блока — по нему человек понимает, куда попал. */
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

/* ─────── номера единиц ───────

   Единица ресурса рождается сдачей задачи, и номер у неё — порядковый
   внутри своего ресурса, от старых к новым. Считается тем же правилом, что
   и в приложении (`web/src/lib/units.js`): снимок обязан называть вещь тем
   же номером, каким её зовут внутри, — иначе заказчик и исполнитель будут
   говорить про «задание №3» о разных заданиях. */
function unitNumbers(model = {}) {
  const rows = [];
  (model.tasks || []).forEach((t) => {
    const subs = t.submissions || [];
    const sb = subs.length ? subs[subs.length - 1] : null;
    if (!sb) return;
    Object.entries(sb.gives || {}).forEach(([trait, v]) => {
      if (num(v) > 0) rows.push({ id: `${sb.id}~${trait}`, trait, at: str(sb.at) });
    });
  });
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const seq = {};
  const no = {};
  rows.forEach((r) => { seq[r.trait] = (seq[r.trait] || 0) + 1; no[r.id] = seq[r.trait]; });
  return no;
}

/**
 * Сделанное по выбранным результатам.
 *
 * Только принятые сдачи: непринятая — это заявление исполнителя, а не
 * результат, и показывать её заказчику как сделанное нельзя.
 *
 * Выбрана определённая единица — только она и уходит наружу: раздел
 * ссылается на вещь по номеру, а не на всё, что функция когда-либо выдала.
 */
function resultsOf(model, picks = []) {
  const { tasks = [], funcs = [], traits = [], people = [] } = model;
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "";
  const personName = (id) => people.find((p) => String(p.id) === String(id))?.name || "";
  const no = unitNumbers(model);
  const rows = [];
  picks.forEach((p) => {
    const func = funcs.find((f) => f.id === p.func) || null;
    tasks.filter((t) => t.funcId === p.func && t.status === "done").forEach((t) => {
      (t.submissions || []).forEach((sb) => {
        const gave = num(sb.gives?.[p.trait]);
        const took = num(sb.takes?.[p.trait]);
        if (p.trait && !gave && !took) return;
        const unit = `${sb.id}~${str(p.trait)}`;
        if (p.unit && str(p.unit) !== unit) return;
        rows.push({
          title: str(t.title),
          // Номер уходит наружу нарочно: по нему заказчик и называет вещь.
          no: no[unit] ?? null,
          func: str(func?.name || ""),
          trait: traitName(p.trait),
          at: str(sb.at),
          by: personName(t.assignee),
          hours: num(sb.hours),
          qty: gave || -took,
          text: str(sb.text),
          // Файл едет ссылкой: сами байты лежат там же, где и лежали, и
          // читаются по адресу — переносить их в снимок незачем.
          file: sb.file && sb.file.url
            ? { name: str(sb.file.name), type: str(sb.file.type), url: str(sb.file.url) }
            : null,
        });
      });
    });
  });
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Снимок блока и всего, что под ним.
 *
 * `null`, если блока нет: ссылку на несуществующее заводить не на что.
 */
export function snapshotOf(model = {}, nodeId) {
  const nodes = Array.isArray(model.reports) ? model.reports : [];
  const root = nodes.find((n) => n.id === nodeId);
  if (!root) return null;

  /* Технического задания в снимке нет, как нет его и в самой карте:
     в блоке — разделы и определённые результаты, а описанный полем заказ
     был бы пересказом, который расходится с делом. */
  const block = (n) => ({
    name: str(n.name),
    results: resultsOf(model, n.picks || []),
    sections: childrenOf(nodes, n.id).map(block),
  });

  return {
    at: new Date().toISOString(),
    path: pathOf(nodes, nodeId).map((n) => str(n.name)),
    block: block(root),
  };
}
