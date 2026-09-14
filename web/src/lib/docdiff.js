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
