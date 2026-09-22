/* ─────── ОКНО ЗАГРУЗКИ: ЛОГОТИП В ДВИЖЕНИИ (владелец, 2026-09-22) ───────

   Генератор `web/public/loader.svg` — анимированного логотипа для окна
   загрузки (components/Splash.jsx). Запуск: `node scripts/logo-loader.mjs`.

   Куб и дерево внутри него — одно тело: делают полный оборот вокруг
   вертикали, потом четыре яблока падают с веток на пол куба, подскакивают
   и остаются лежать; цикл повторяется. Всё — SMIL, без скриптов, поэтому
   файл работает и в <img>.

   Куб — настоящий: восемь вершин ±1 поворачиваются вокруг вертикали и
   проецируются так, что при 45° получается ровно шестигранник логотипа.
   Дерево тоже объёмное: ствол на оси вращения, четыре ветви в четыре
   стороны под прямыми углами (верхняя пара назад, нижняя вперёд) — в
   покое ложатся как на плоском логотипе. Ближние рёбра и ветви рисуются
   поверх ствола и дальних, для этого у каждой детали две копии в двух
   слоях, а видна та, чья очередь (opacity дискретно). Рёбра к середине
   в покое — черенками, как на логотипе, на время оборота дорастают. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const COLOR = "#6ee7b7";
const CX = 50, CY = 50;
const A = 37 / Math.SQRT2, B = 22, D = 22 / Math.SQRT2;
const REST = Math.PI / 4;

// хронометраж, мс
const HOLD = 300, TURN = 1600, FALL_AT = HOLD + TURN + 100, STAGGER = 160;
const G = 170 / 1e6;                 // ускорение, ед./мс²
const REST_ON_FLOOR = 900, XFADE = 250;

/* ─── Проекция ───
   Точка (x,y,z) куба [−1,1]³, поворот на theta вокруг вертикали:
   X = x cos − z sin, Z = x sin + z cos; экран: sx = 50 + X·A,
   sy = 50 − y·B + Z·D. При 45° получается ровно логотип. */
function project([x, y, z], theta) {
  const X = x * Math.cos(theta) - z * Math.sin(theta);
  const Z = x * Math.sin(theta) + z * Math.cos(theta);
  return { x: CX + X * A, y: CY - y * B + Z * D, z: Z };
}
/* Обратно: по экранной точке логотипа (при 45°) и выбранной глубине Z —
   точка в кубе. Так дерево из плоского рисунка становится объёмным. */
function unproject(sx, sy, Z) {
  const X = (sx - CX) / A;
  const y = (CY - sy + Z * D) / B;
  return [(X + Z) / Math.SQRT2, y, (Z - X) / Math.SQRT2];
}

/* ─── Дерево в кубе ───
   Ствол — на оси вращения, от пола до верхушки. Ветви: верхняя пара
   уходит назад (Z<0), нижняя — вперёд (Z>0); в кубе они смотрят в
   четыре стороны под прямыми углами, а при 45° ложатся как на логотипе. */
const TRUNK = [[0, -1, 0], [0, (CY - 27) / B, 0]];
const TOP_APPLE = [0, (CY - 25) / B, 0];
const BRANCHES = [
  { base: [0, (CY - 37) / B, 0], tip: unproject(39, 30.5, -0.3), apple: [-2, -2.5] },
  { base: [0, (CY - 37) / B, 0], tip: unproject(61, 30.5, -0.3), apple: [-2, -2.5].map((v, i) => (i ? v : -v)) },
  { base: [0, (CY - 60) / B, 0], tip: unproject(28, 48.5, 0.4), apple: [-4, -1.5] },
  { base: [0, (CY - 60) / B, 0], tip: unproject(72, 48.5, 0.4), apple: [4, -1.5] },
];
const lerp3 = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);

/* Четыре падающих яблока: висят на черенке в точке ветви `at` (доля
   длины), на полу лежат на глубине floorZ (|X|+|Z| ≤ √2 — внутри ромба). */
const APPLES = [
  { branch: 0, at: 0.64, floorZ: 1.1, delay: 0 },
  { branch: 2, at: 0.637, floorZ: 0.8, delay: STAGGER },
  { branch: 1, at: 0.64, floorZ: 1.1, delay: STAGGER * 2 },
  { branch: 3, at: 0.637, floorZ: 0.8, delay: STAGGER * 3 },
].map((a) => {
  const br = BRANCHES[a.branch];
  const p = project(lerp3(br.base, br.tip, a.at), REST);
  const x = p.x, y = p.y + 9;                    // центр яблока в покое
  const floorY = CY + B + a.floorZ * D;         // экранный y нижней вершины на полу
  const dy = floorY - (y + 6.4);
  const t1 = Math.sqrt(2 * dy / G);
  const hb = dy * 0.12, tb = 2 * Math.sqrt(2 * hb / G);
  return { ...a, x, y, dy, t1, hb, tb, end: a.delay + t1 + tb };
});
const FALL_END = FALL_AT + Math.max(...APPLES.map((a) => a.end));
const PERIOD = Math.ceil((FALL_END + REST_ON_FLOOR) / 10) * 10;

/* ─── Куб ─── */
const corner = (i) => [(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1];
const EDGES = [];
for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) { const j = i | bit; if (j !== i) EDGES.push([i, j]); }
const NEAR_TOP = 7, FAR_BOTTOM = 0;
function restOf(i, j) {
  if (j === NEAR_TOP && i !== (NEAR_TOP & ~2)) return { from: i, rest: 18 / 37 };
  if (i === FAR_BOTTOM && j !== (FAR_BOTTOM | 2)) return { from: j, rest: 13 / 37 };
  if (i === FAR_BOTTOM && j === (FAR_BOTTOM | 2)) return { from: j, rest: 0 };
  return null;
}
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const f = (n) => String(Math.round(n * 100) / 100);

function poseAt(t) {
  if (t >= HOLD && t < HOLD + TURN) {
    const k = (t - HOLD) / TURN;
    return { theta: REST + easeInOut(k) * Math.PI * 2, grow: Math.min(1, k / 0.08, (1 - k) / 0.08) };
  }
  return { theta: REST, grow: 0 };
}
function edgesAt(t) {
  const { theta, grow } = poseAt(t);
  const pts = Array.from({ length: 8 }, (_, i) => project(corner(i), theta));
  return EDGES.map(([i, j]) => {
    const r = restOf(i, j);
    let a = pts[i], b = pts[j];
    if (r) {
      const k = r.rest + (1 - r.rest) * grow;
      const o = r.from === i ? pts[i] : pts[j];
      const e = r.from === i ? pts[j] : pts[i];
      a = o; b = { x: o.x + (e.x - o.x) * k, y: o.y + (e.y - o.y) * k, z: o.z + (e.z - o.z) * k };
    }
    return { a, b, near: a.z + b.z > 0 };
  });
}
function drop(a, s) {
  if (s <= 0) return 0;
  if (s < a.t1) return 0.5 * G * s * s;
  const u = (s - a.t1) / a.tb;
  if (u < 1) return a.dy - 4 * a.hb * u * (1 - u);
  return a.dy;
}

/* ─── Кадры ─── */
const rotT = [0, HOLD];
for (let i = 1; i <= 64; i++) rotT.push(HOLD + (TURN * i) / 64);
rotT.push(PERIOD);
const dur = `${f(PERIOD / 1000)}s`;
const kt = (ts) => ts.map((t) => f(t / PERIOD)).join(";");
const anim = (attr, ts, values, extra = "") =>
  `<animate attributeName="${attr}" values="${values}" keyTimes="${kt(ts)}" dur="${dur}" repeatCount="indefinite"${extra}/>`;
const move = (ts, values) =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${kt(ts)}" dur="${dur}" repeatCount="indefinite"/>`;
const layerOp = (ts, nears, nearLayer) => anim("opacity", ts, nears.map((n) => (n === nearLayer ? "1" : "0")).join(";"), ' calcMode="discrete"');

const line = `stroke="${COLOR}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
const stem = line.replace("3.4", "2.8");
const cube = (cx, cy, s = 6.4) => {
  const w = 0.87 * s, h = s / 2;
  return `<polygon points="${f(cx)},${f(cy - s)} ${f(cx + w)},${f(cy - h)} ${f(cx)},${f(cy)} ${f(cx - w)},${f(cy - h)}" fill="${COLOR}"/>
    <polygon points="${f(cx - w)},${f(cy - h)} ${f(cx)},${f(cy)} ${f(cx)},${f(cy + s)} ${f(cx - w)},${f(cy + h)}" fill="${COLOR}" opacity=".72"/>
    <polygon points="${f(cx + w)},${f(cy - h)} ${f(cx)},${f(cy)} ${f(cx)},${f(cy + s)} ${f(cx + w)},${f(cy + h)}" fill="${COLOR}" opacity=".5"/>`;
};

// рёбра куба: слой «за деревом» и «перед деревом»
const edgeFrames = rotT.map((t) => edgesAt(Math.min(t, HOLD + TURN - 0.001)));
function edgeLines(nearLayer) {
  return EDGES.map((_, e) => {
    const v = (pick) => edgeFrames.map((fr) => f(pick(fr[e]))).join(";");
    const first = edgeFrames[0][e];
    return `  <line x1="${f(first.a.x)}" y1="${f(first.a.y)}" x2="${f(first.b.x)}" y2="${f(first.b.y)}" ${line} opacity="${first.near === nearLayer ? 1 : 0}">
    ${anim("x1", rotT, v((s) => s.a.x))}
    ${anim("y1", rotT, v((s) => s.a.y))}
    ${anim("x2", rotT, v((s) => s.b.x))}
    ${anim("y2", rotT, v((s) => s.b.y))}
    ${layerOp(rotT, edgeFrames.map((fr) => fr[e].near), nearLayer)}
  </line>`;
  }).join("\n");
}

// ветви с яблоками на концах: слой по глубине конца ветви
const tipFrames = rotT.map((t) => BRANCHES.map((b) => project(b.tip, poseAt(Math.min(t, HOLD + TURN - 0.001)).theta)));
function branchLines(nearLayer) {
  return BRANCHES.map((b, i) => {
    const base = project(b.base, REST);
    const tips = tipFrames.map((fr) => fr[i]);
    const nears = tips.map((p) => p.z > 0);
    const t0 = tips[0];
    const dx = tips.map((p) => `${f(p.x - t0.x)} ${f(p.y - t0.y)}`).join(";");
    return `  <line x1="${f(base.x)}" y1="${f(base.y)}" x2="${f(t0.x)}" y2="${f(t0.y)}" ${line} opacity="${nears[0] === nearLayer ? 1 : 0}">
    ${anim("x2", rotT, tips.map((p) => f(p.x)).join(";"))}
    ${anim("y2", rotT, tips.map((p) => f(p.y)).join(";"))}
    ${layerOp(rotT, nears, nearLayer)}
  </line>
  <g opacity="${nears[0] === nearLayer ? 1 : 0}">
    ${move(rotT, dx)}
    ${layerOp(rotT, nears, nearLayer)}
    ${cube(t0.x + b.apple[0], t0.y + b.apple[1])}
  </g>`;
  }).join("\n");
}

// падающие яблоки: на ветке во время оборота, потом вниз на пол
function fallingApples(nearLayer) {
  return APPLES.map((a) => {
    const br = BRANCHES[a.branch];
    const total = a.t1 + a.tb;
    const fallT = Array.from({ length: 41 }, (_, k) => FALL_AT + a.delay + (total * k) / 40);
    const ts = [...rotT.slice(0, -1), ...fallT, PERIOD];
    const pts = ts.map((t) => {
      const p = project(lerp3(br.base, br.tip, a.at), poseAt(Math.min(t, HOLD + TURN - 0.001)).theta);
      return { x: p.x, y: p.y + 9 + drop(a, t - FALL_AT - a.delay), z: p.z };
    });
    const nears = pts.map((p) => p.z > 0);
    const vals = pts.map((p) => `${f(p.x - a.x)} ${f(p.y - a.y)}`).join(";");
    return `  <g opacity="${nears[0] === nearLayer ? 1 : 0}">
    ${move(ts, vals)}
    ${layerOp(ts, nears, nearLayer)}
    <path d="M${f(a.x)} ${f(a.y - 9)}v4" ${stem}/>
    ${cube(a.x, a.y)}
  </g>`;
  }).join("\n");
}

const fadeT = kt([0, XFADE, PERIOD - XFADE, PERIOD]);
const trunk = TRUNK.map((p) => project(p, REST));
const top = project(TOP_APPLE, REST);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <!-- blockTree, окно загрузки: куб вместе с деревом делает полный оборот,
       затем четыре яблока падают с веток на пол куба и остаются там.
       Цикл ${f(PERIOD / 1000)} с, SMIL, без скриптов. -->
  <g>
${edgeLines(false)}
  </g>
  <g>
${branchLines(false)}
  </g>
  <g>
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="${fadeT}" dur="${dur}" repeatCount="indefinite"/>
${fallingApples(false)}
  </g>
  <path d="M${f(trunk[0].x)} ${f(trunk[0].y)}V${f(trunk[1].y)}" ${line}/>
  <g>${cube(top.x, top.y)}</g>
  <g>
${branchLines(true)}
  </g>
  <g>
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="${fadeT}" dur="${dur}" repeatCount="indefinite"/>
${fallingApples(true)}
  </g>
  <g>
${edgeLines(true)}
  </g>
</svg>
`;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "loader.svg");
writeFileSync(out, svg);
console.log(`loader.svg: цикл ${PERIOD} мс, ${svg.length} байт`);
