/* ════════════════════════════════════════════════════════════════
   ЛИНИИ СО СКРУГЛЁННЫМИ УГЛАМИ

   Владелец (2026-09-19): «на схеме должны быть стрелки строго
   вертикальные и горизонтальные с закруглениями; в майнд-карте тоже».

   Косая линия идёт «примерно туда», и на плотной схеме такие линии
   пересекаются под случайными углами. Ортогональная говорит точно: вниз,
   потом вправо, — а скруглённый угол показывает, что это один путь, а не
   две встретившиеся черты.
   ════════════════════════════════════════════════════════════════ */

const n = (v) => Math.round(Number(v) * 10) / 10;
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * Путь по точкам ломаной со скруглением на каждом углу.
 *
 * Радиус прижимается к половине короткой стороны угла: на коротком колене
 * полный радиус съел бы само колено, и линия поехала бы мимо точки.
 */
export function orthPath(points = [], r = 10) {
  const p = (points || []).filter((x) => Array.isArray(x) && x.length === 2);
  if (p.length < 2) return "";
  let d = `M${n(p[0][0])},${n(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i += 1) {
    const [x0, y0] = p[i - 1];
    const [x, y] = p[i];
    const [x1, y1] = p[i + 1];
    const rr = Math.min(r, Math.hypot(x - x0, y - y0) / 2, Math.hypot(x1 - x, y1 - y) / 2);
    if (rr <= 0.5) { d += ` L${n(x)},${n(y)}`; continue; }
    const ax = x - sign(x - x0) * rr, ay = y - sign(y - y0) * rr;
    const bx = x + sign(x1 - x) * rr, by = y + sign(y1 - y) * rr;
    d += ` L${n(ax)},${n(ay)} Q${n(x)},${n(y)} ${n(bx)},${n(by)}`;
  }
  const last = p[p.length - 1];
  return `${d} L${n(last[0])},${n(last[1])}`;
}

/**
 * Ортогональный путь между двумя блоками: выходит из стороны, обращённой
 * к другому блоку, и входит в его встречную сторону.
 *
 * `lane` разводит несколько передач между одной парой: средняя линия
 * смещается, а не ложится поверх соседней.
 */
export function elbow(a, b, { w = 0, h = 0, lane = 0, r = 10 } = {}) {
  const ax = a.x + w / 2, ay = a.y + h / 2;
  const bx = b.x + w / 2, by = b.y + h / 2;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = sign(dx) || 1;
    const x1 = ax + s * (w / 2), x2 = bx - s * (w / 2);
    const mx = (x1 + x2) / 2 + lane;
    const pts = [[x1, ay], [mx, ay], [mx, by], [x2, by]];
    return { d: orthPath(pts, r), mid: [mx, (ay + by) / 2], pts };
  }
  const s = sign(dy) || 1;
  const y1 = ay + s * (h / 2), y2 = by - s * (h / 2);
  const my = (y1 + y2) / 2 + lane;
  const pts = [[ax, y1], [ax, my], [bx, my], [bx, y2]];
  return { d: orthPath(pts, r), mid: [(ax + bx) / 2, my], pts };
}
