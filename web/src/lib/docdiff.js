/* ════════════════════════════════════════════════════════════════
   РАЗНИЦА МЕЖДУ ВЕРСИЯМИ ДОКУМЕНТА · как в git, по абзацам

   Владелец (2026-09-14): «для гита должно быть не описание изменений, а
   документ должен открываться прямо в веб-апп; описание изменений — двумя
   формами: одна с зелёной рамкой, другая с красной; в левом верхнем углу
   — что это за изменение (+, −)».

   Единица сравнения — абзац: договор правят по пунктам, и «пункт 3
   заменён» читается лучше, чем разница по буквам. Абзацы берутся из
   HTML, который сервер делает из .docx (`<p>`, ячейки `<td>`), теги
   снимаются. Сравнение — по наибольшей общей подпоследовательности
   (LCS): что не вошло в неё из старого — убрано, из нового — добавлено.
   Документы небольшие, квадратная таблица им по силам.
   ════════════════════════════════════════════════════════════════ */

const decode = (s) => String(s)
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Абзацы документа из HTML: без тегов, без пустых. */
export function linesOf(html = "") {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/<\/(?:p|td|th|li|div|h[1-6])>/i)
    .map((chunk) => decode(chunk.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Что добавлено и что убрано между двумя списками абзацев. */
export function diffLines(a = [], b = []) {
  const n = a.length, m = b.length;
  // dp[i][j] — длина LCS хвостов a[i:], b[j:].
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = [], removed = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { removed.push(a[i]); i += 1; }
    else { added.push(b[j]); j += 1; }
  }
  while (i < n) { removed.push(a[i]); i += 1; }
  while (j < m) { added.push(b[j]); j += 1; }
  return { added, removed };
}

/** Разница между двумя HTML документа. */
export const diffHtml = (fromHtml, toHtml) => diffLines(linesOf(fromHtml), linesOf(toHtml));

/** «+3 ±2 −1» — коротко, для строки версии; «±» только когда есть замены. */
export const diffText = ({ added = [], removed = [], changed = [] } = {}) =>
  (!added.length && !removed.length && !changed.length ? "без изменений"
    : `+${added.length} ${changed.length ? `±${changed.length} ` : ""}−${removed.length}`);

/* ─────── замена — не «убрали и добавили» ───────

   Владелец (2026-09-20): «добавь жёлтую плашку между зелёной и красной,
   которая будет показывать конфликтующие изменения, наложенные поверх
   старых: добавлен текст — зелёная, убран — красная, заменён — жёлтая».

   Замена — одна правка одного места, и читать её надо рядом, «было →
   стало». Раньше она разъезжалась по двум плашкам, и человек собирал её
   обратно глазами: в зелёной новая строка, в красной старая, а что одна
   встала на место другой — нигде не сказано.

   Парой считаем убранное и добавленное, про которые `isPair` говорит, что
   одно — правка другого; по умолчанию это `similar` (общих слов не меньше
   половины). Что пары не нашло — осталось добавленным или убранным. */
export function pairChanges(removed = [], added = [], isPair = null) {
  const pair = isPair || similar;
  const usedAdded = new Set();
  const restRemoved = [];
  const changed = [];
  removed.forEach((from) => {
    const k = added.findIndex((to, i) => !usedAdded.has(i) && pair(from, to));
    if (k < 0) { restRemoved.push(from); return; }
    usedAdded.add(k);
    changed.push({ from, to: added[k] });
  });
  return { added: added.filter((x, i) => !usedAdded.has(i)), removed: restRemoved, changed };
}

/* ─────── изменения по словам: одна форма — одно место ───────

   Владелец (2026-09-15): «форм + и − может быть сколько угодно, но в них
   должны быть конкретные изменения: добавилось одно слово — одна зелёная
   форма, в ней только то предложение, в которое оно добавилось, и слово
   выделено зелёным; так же с красными». Абзацы, изменившиеся друг в
   друга (общих слов не меньше половины), сравниваются по словам; каждый
   непрерывный кусок добавленных слов — своя зелёная форма с предложением
   новой версии, каждый кусок убранных — красная с предложением старой.
   Абзац без пары — одна форма целиком. */

const wordsOf = (line) => String(line || "").split(/\s+/).filter(Boolean);
/* Конец предложения — знак в конце слова; «п.», «г.», «т.» — сокращения,
   а не концы, иначе «п. 3» рвало бы предложение пополам. */
const END_RE = /[.!?;:]$/;
const END = { test: (w) => END_RE.test(w) && w.replace(/[.!?;:]+$/, "").length > 2 };

/** Похожи ли абзацы настолько, чтобы считать один правкой другого. */
export function similar(a, b) {
  const wa = wordsOf(a), wb = wordsOf(b);
  if (!wa.length || !wb.length) return false;
  const set = new Set(wa);
  const common = wb.filter((w) => set.has(w)).length;
  return common / Math.max(wa.length, wb.length) >= 0.5;
}

/** Слова с пометкой: `same`, `add`, `del` — по наибольшей общей подпоследовательности. */
export function diffWords(a, b) {
  const wa = wordsOf(a), wb = wordsOf(b);
  const n = wa.length, m = wb.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = wa[i] === wb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (wa[i] === wb[j]) { out.push({ w: wa[i], t: "same", i, j }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ w: wa[i], t: "del", i }); i += 1; }
    else { out.push({ w: wb[j], t: "add", j }); j += 1; }
  }
  while (i < n) { out.push({ w: wa[i], t: "del", i }); i += 1; }
  while (j < m) { out.push({ w: wb[j], t: "add", j }); j += 1; }
  return out;
}

/* Предложение, в котором стоят слова [from, to] списка `words`: от
   предыдущего конца предложения до следующего. */
const sentenceAround = (words, from, to) => {
  let s = from;
  while (s > 0 && !END.test(words[s - 1])) s -= 1;
  let e = to;
  while (e < words.length - 1 && !END.test(words[e])) e += 1;
  return { s, e };
};

/* Куски подряд идущих слов одного вида в потоке `diffWords`. */
const runsOf = (d) => {
  const out = [];
  d.forEach((x, i) => {
    const last = out[out.length - 1];
    if (last && last.t === x.t && last.to === i - 1) last.to = i;
    else out.push({ t: x.t, from: i, to: i });
  });
  return out;
};

/* Форма одного изменения: предложение ТОЙ версии, про которую форма.
   Зелёная читается по новой версии (`keep` без убранных слов), красная —
   по старой, жёлтая — по обеим сразу: в ней и было, и стало. */
const formIn = (sign, d, from, to, keep) => {
  const view = d.map((x, i) => ({ ...x, i })).filter((x) => keep.includes(x.t));
  const p0 = view.findIndex((x) => x.i >= from);
  let p1 = -1;
  view.forEach((x, k) => { if (x.i <= to) p1 = k; });
  if (p0 < 0 || p1 < p0) return null;
  const { s, e } = sentenceAround(view.map((x) => x.w), p0, p1);
  return { sign,
    parts: view.slice(s, e + 1).map((x) => ({ text: x.w, hl: x.i >= from && x.i <= to, t: x.t })) };
};

const wholeForm = (sign, line, t) => ({ sign, parts: wordsOf(line).map((w) => ({ text: w, hl: true, t })) });

/** Формы изменений между двумя списками абзацев: «+», «−» и «±», по одному месту в каждой. */
export function changeForms(fromLines = [], toLines = []) {
  const { added, removed } = diffLines(fromLines, toLines);
  const forms = [];
  const usedAdded = new Set();
  removed.forEach((old) => {
    const k = added.findIndex((nw, idx) => !usedAdded.has(idx) && similar(old, nw));
    if (k < 0) { forms.push(wholeForm("-", old, "del")); return; }
    usedAdded.add(k);
    const d = diffWords(old, added[k]);
    const runs = runsOf(d).filter((r) => r.t !== "same");
    /* Убранное и добавленное ВПЛОТНУЮ друг к другу — это замена: новые
       слова встали на место старых, и разводить их по двум формам значило
       бы прятать саму правку. */
    for (let i = 0; i < runs.length; i += 1) {
      const r = runs[i], next = runs[i + 1];
      if (next && next.t !== r.t && next.from === r.to + 1) {
        forms.push(formIn("±", d, r.from, next.to, ["same", "del", "add"]));
        i += 1;
      } else if (r.t === "add") forms.push(formIn("+", d, r.from, r.to, ["same", "add"]));
      else forms.push(formIn("-", d, r.from, r.to, ["same", "del"]));
    }
  });
  added.forEach((nw, idx) => {
    if (!usedAdded.has(idx)) forms.push(wholeForm("+", nw, "add"));
  });
  return forms.filter(Boolean);
}

/** Формы изменений между двумя HTML документа. */
export const changeFormsHtml = (fromHtml, toHtml) => changeForms(linesOf(fromHtml), linesOf(toHtml));
