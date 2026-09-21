/* ════════════════════════════════════════════════════════════════
   КОММЕНТАРИЙ К ПЕРЕВОДУ ИЗ BOC

   toncenter отдаёт тело сообщения и forward_payload jetton-перевода как
   BOC (base64). Текстовый комментарий — ячейка, у которой первые 32
   бита нули (op = 0), дальше UTF-8; длинный текст продолжается «змейкой»
   по первой ссылке. Разбираем ровно это и ничего больше: без разбора
   комментария платёж по цепочке не узнать.
   ════════════════════════════════════════════════════════════════ */
function readCells(buf) {
  if (buf.length < 6) return null;
  if (buf.readUInt32BE(0) !== 0xb5ee9c72) return null;
  const flags = buf[4];
  const hasIdx = !!(flags & 0x80);
  const refSize = flags & 7;
  const offSize = buf[5];
  let p = 6;
  const readN = (n) => { let v = 0; for (let i = 0; i < n; i += 1) v = v * 256 + buf[p + i]; p += n; return v; };
  const cellsNum = readN(refSize);
  const rootsNum = readN(refSize);
  readN(refSize);                    // absent
  readN(offSize);                    // total cells size
  const roots = [];
  for (let i = 0; i < rootsNum; i += 1) roots.push(readN(refSize));
  if (hasIdx) p += cellsNum * offSize;
  const cells = [];
  for (let i = 0; i < cellsNum; i += 1) {
    const d1 = buf[p]; const d2 = buf[p + 1]; p += 2;
    const refs = d1 & 7;
    const len = Math.ceil(d2 / 2);
    let data = buf.subarray(p, p + len); p += len;
    if (d2 % 2 === 1 && data.length) {
      // Неполный последний байт: после данных стоит бит 1 и нули — режем.
      let last = data[data.length - 1];
      let bits = 8;
      while (bits > 0 && (last & 1) === 0) { last >>= 1; bits -= 1; }
      data = bits <= 1 ? data.subarray(0, data.length - 1) : data;
    }
    const refIdx = [];
    for (let r = 0; r < refs; r += 1) refIdx.push(readN(refSize));
    cells.push({ data, refs: refIdx });
  }
  return { cells, roots };
}

/** Текст комментария из BOC или "" — если это не текстовый комментарий. */
export function decodeComment(b64) {
  try {
    if (!b64) return "";
    const parsed = readCells(Buffer.from(String(b64), "base64"));
    if (!parsed || !parsed.cells.length) return "";
    const root = parsed.cells[parsed.roots[0] || 0];
    if (!root || root.data.length < 4 || root.data.readUInt32BE(0) !== 0) return "";
    const parts = [root.data.subarray(4)];
    let cur = root;
    for (let guard = 0; guard < 64 && cur.refs.length; guard += 1) {
      cur = parsed.cells[cur.refs[0]];
      if (!cur) break;
      parts.push(cur.data);
    }
    return Buffer.concat(parts).toString("utf8").replace(/\0+$/, "").trim();
  } catch { return ""; }
}
