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

/** Чьё задание действует в блоке: своё или ближайшего предка. */
function briefOf(nodes, id) {
  const path = pathOf(nodes, id);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (str(path[i].brief).trim()) return { name: str(path[i].name), text: str(path[i].brief) };
  }
  return null;
}

/**
 * Сделанное по выбранным парам «функция + ресурс».
 *
 * Только принятые сдачи: непринятая — это заявление исполнителя, а не
 * результат, и показывать её заказчику как сделанное нельзя.
 */
function resultsOf(model, picks = []) {
  const { tasks = [], funcs = [], traits = [], people = [] } = model;
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "";
  const personName = (id) => people.find((p) => String(p.id) === String(id))?.name || "";
  const rows = [];
  picks.forEach((p) => {
    const func = funcs.find((f) => f.id === p.func) || null;
    tasks.filter((t) => t.funcId === p.func && t.status === "done").forEach((t) => {
      (t.submissions || []).forEach((sb) => {
        const gave = num(sb.gives?.[p.trait]);
        const took = num(sb.takes?.[p.trait]);
        if (p.trait && !gave && !took) return;
        rows.push({
          title: str(t.title),
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

  const block = (n) => ({
    name: str(n.name),
    brief: str(n.brief),
    results: resultsOf(model, n.picks || []),
    sections: childrenOf(nodes, n.id).map(block),
  });

  return {
    at: new Date().toISOString(),
    path: pathOf(nodes, nodeId).map((n) => str(n.name)),
    // Задание действует и на разделе, который взяли из середины карты:
    // без него результаты — это список без вопроса, на который он отвечает.
    brief: briefOf(nodes, nodeId),
    block: block(root),
  };
}
