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

/** «+3 −1» — коротко, для строки версии. */
export const diffText = ({ added = [], removed = [] } = {}) =>
  (!added.length && !removed.length ? "без изменений" : `+${added.length} −${removed.length}`);

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

/** Форма одного изменения: предложение словами, изменённые — с пометкой `hl`. */
const formOf = (sign, words, from, to) => {
  const { s, e } = sentenceAround(words, from, to);
  return { sign, parts: words.slice(s, e + 1).map((w, k) => ({ text: w, hl: s + k >= from && s + k <= to })) };
};

/** Формы изменений между двумя списками абзацев: «+» и «−», по одному месту в каждой. */
export function changeForms(fromLines = [], toLines = []) {
  const { added, removed } = diffLines(fromLines, toLines);
  const forms = [];
  const usedAdded = new Set();
  removed.forEach((old) => {
    const k = added.findIndex((nw, idx) => !usedAdded.has(idx) && similar(old, nw));
    if (k < 0) { forms.push({ sign: "-", parts: wordsOf(old).map((w) => ({ text: w, hl: true })) }); return; }
    usedAdded.add(k);
    const nw = added[k];
    const wa = wordsOf(old), wb = wordsOf(nw);
    const d = diffWords(old, nw);
    // Куски подряд идущих добавленных/убранных слов — по своей форме.
    const runs = (type, key) => {
      const out = [];
      let cur = null;
      d.forEach((x) => {
        if (x.t === type) { if (cur && x[key] === cur.to + 1) cur.to = x[key]; else { cur = { from: x[key], to: x[key] }; out.push(cur); } }
      });
      return out;
    };
    runs("add", "j").forEach((r) => forms.push(formOf("+", wb, r.from, r.to)));
    runs("del", "i").forEach((r) => forms.push(formOf("-", wa, r.from, r.to)));
  });
  added.forEach((nw, idx) => {
    if (!usedAdded.has(idx)) forms.push({ sign: "+", parts: wordsOf(nw).map((w) => ({ text: w, hl: true })) });
  });
  return forms;
}

/** Формы изменений между двумя HTML документа. */
export const changeFormsHtml = (fromHtml, toHtml) => changeForms(linesOf(fromHtml), linesOf(toHtml));
