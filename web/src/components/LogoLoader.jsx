import React, { useEffect, useRef } from "react";
import { C, Logo, OK } from "./ui.jsx";

/* ─────── ОКНО ЗАГРУЗКИ: ЛОГОТИП В ДВИЖЕНИИ (владелец, 2026-09-21) ───────

   Тот же рисунок, что `Logo` в ui.jsx, но живой: каркас-куб делает
   полный оборот вокруг дерева, затем четыре яблока, которые на логотипе
   висят на черенках сами по себе, падают. В начале цикла они висят на
   ветках вместе с остальными.

   Куб — настоящий: восемь вершин ±1 крутятся вокруг вертикальной оси и
   проецируются так, что при 45° получается ровно шестигранник логотипа
   (`A`, `B`, `D` подобраны под точки 50,6 · 87,27.5 · 50,94). В покое
   рёбра к середине нарисованы не целиком — как на логотипе, черенками;
   на время оборота они дорастают до полных, потом снова укорачиваются.
   Ближние рёбра ложатся поверх дерева, дальние — под него: так куб
   читается объёмным, а не плоской рамкой.

   Кадры считаются в requestAnimationFrame и пишутся в атрибуты напрямую,
   без перерисовки React: 60 раз в секунду менять состояние ради четырёх
   чисел незачем. Настройка «меньше движения» в системе — показываем
   неподвижный логотип. */

const CX = 50, CY = 50;
const A = 37 / Math.SQRT2;   // ширина: боковые вершины на 13 и 87
const B = 22;                // высота: верх на 6, низ на 94
const D = 22 / Math.SQRT2;   // глубина в высоту: ближняя вершина — в середине
const REST = Math.PI / 4;    // угол, при котором куб — шестигранник логотипа

/* Хронометраж цикла, мс. */
export const HOLD = 300;         // яблоки на ветках, куб на месте
export const TURN = 1600;        // полный оборот
export const FALL_AT = HOLD + TURN + 100;
export const FALL = 800;         // падение одного яблока
export const STAGGER = 160;      // разбег между яблоками
export const PERIOD = FALL_AT + STAGGER * 3 + FALL + 500;

/* Четыре яблока: где висят в начале (черенок касается ветки) —
   верхняя пара на верхних ветвях, нижняя — на нижних. */
export const APPLES = [
  { x: 43, y: 41.9, delay: 0 },
  { x: 57, y: 41.9, delay: STAGGER * 2 },
  { x: 36, y: 61.7, delay: STAGGER },
  { x: 64, y: 61.7, delay: STAGGER * 3 },
];

const corner = (i) => [(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1];
/* Рёбра куба: пары индексов вершин, отличающихся одним битом. Для каждого
   — с какого конца и какой долей его рисуют в покое (`from` — вершина,
   от которой идёт черенок; `rest` — доля длины; 1 — целиком). */
const EDGES = [];
for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
  const j = i | bit;
  if (j !== i) EDGES.push([i, j]);
}
/* В покое (45°) середину занимают ближняя верхняя вершина (x=1,z=1 → 7)
   и дальняя нижняя (x=−1,y=−1,z=−1 → 0). Рёбра к ним — черенки логотипа:
   от боковых вершин к ближней верхней — на 18/37, к дальней нижней — на
   13/37; вертикаль от дальней верхней вниз — не видна вовсе (её место
   занимает ствол); ближняя вертикаль совпадает со стволом — целиком. */
const NEAR_TOP = 7, FAR_BOTTOM = 0;
function restOf(i, j) {
  if (j === NEAR_TOP && i !== (NEAR_TOP & ~2)) return { from: i, rest: 18 / 37 };
  if (i === FAR_BOTTOM && j !== (FAR_BOTTOM | 2)) return { from: j, rest: 13 / 37 };
  if (i === FAR_BOTTOM && j === (FAR_BOTTOM | 2)) return { from: j, rest: 0 };
  return null;
}

/** Точка куба на экране при повороте `theta` вокруг вертикали. */
export function project([x, y, z], theta) {
  const X = x * Math.cos(theta) - z * Math.sin(theta);
  const Z = x * Math.sin(theta) + z * Math.cos(theta);
  return { x: CX + X * A, y: CY - y * B + Z * D, z: Z };
}

const f1 = (n) => (Math.round(n * 100) / 100).toString();

/** Рёбра куба при угле `theta` и доле «дорастания» `grow` (0 — как на
    логотипе, 1 — все рёбра целиком): два контура — под деревом и над. */
export function cubePaths(theta, grow) {
  const pts = Array.from({ length: 8 }, (_, i) => project(corner(i), theta));
  const back = [], front = [];
  for (const [i, j] of EDGES) {
    const r = restOf(i, j);
    let a = pts[i], b = pts[j];
    if (r) {
      const k = r.rest + (1 - r.rest) * grow;
      if (k <= 0) continue;
      const o = r.from === i ? pts[i] : pts[j];
      const e = r.from === i ? pts[j] : pts[i];
      a = o; b = { x: o.x + (e.x - o.x) * k, y: o.y + (e.y - o.y) * k, z: o.z + (e.z - o.z) * k };
    }
    (a.z + b.z > 0 ? front : back).push(`M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}`);
  }
  return { back: back.join(""), front: front.join("") };
}

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** Состояние кадра в момент `t` мс от начала цикла. */
export function frameAt(t) {
  const u = ((t % PERIOD) + PERIOD) % PERIOD;
  let theta = REST, grow = 0;
  if (u >= HOLD && u < HOLD + TURN) {
    const k = (u - HOLD) / TURN;
    theta = REST + easeInOut(k) * Math.PI * 2;
    grow = Math.min(1, k / 0.08, (1 - k) / 0.08);
  }
  const apples = APPLES.map((a) => {
    const s = u - FALL_AT - a.delay;
    if (s <= 0) return { dy: 0, opacity: u < 250 ? u / 250 : 1 };
    const k = Math.min(1, s / FALL);
    const dy = (112 - a.y) * k * k;
    const y = a.y + dy;
    return { dy, opacity: y < 84 ? 1 : Math.max(0, (104 - y) / 20) };
  });
  return { theta, grow, apples };
}

const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LogoLoader({ size = 128, color = OK }) {
  const backRef = useRef(null), frontRef = useRef(null);
  const appleRefs = useRef([]);
  const still = reduced();

  useEffect(() => {
    if (still || typeof requestAnimationFrame !== "function") return undefined;
    let id = 0;
    const t0 = performance.now();
    const step = (now) => {
      const f = frameAt(now - t0);
      const p = cubePaths(f.theta, f.grow);
      if (backRef.current) backRef.current.setAttribute("d", p.back);
      if (frontRef.current) frontRef.current.setAttribute("d", p.front);
      f.apples.forEach((a, i) => {
        const g = appleRefs.current[i];
        if (!g) return;
        g.setAttribute("transform", `translate(0 ${f1(a.dy)})`);
        g.setAttribute("opacity", f1(a.opacity));
      });
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [still]);

  if (still) return <Logo size={size} color={color} />;

  const line = { stroke: color, strokeWidth: 3.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
  const cube = (cx, cy, s = 6.4) => {
    const w = 0.87 * s, h = s / 2;
    return (<>
      <polygon points={`${cx},${cy - s} ${cx + w},${cy - h} ${cx},${cy} ${cx - w},${cy - h}`} fill={color} />
      <polygon points={`${cx - w},${cy - h} ${cx},${cy} ${cx},${cy + s} ${cx - w},${cy + h}`} fill={color} opacity=".72" />
      <polygon points={`${cx + w},${cy - h} ${cx},${cy} ${cx},${cy + s} ${cx + w},${cy + h}`} fill={color} opacity=".5" />
    </>);
  };
  const first = cubePaths(REST, 0);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" data-testid="logo-loader"
      style={{ display: "block", flex: "0 0 auto" }}>
      <path ref={backRef} d={first.back} {...line} />
      {/* дерево: ствол, ветви, плоды на ветках */}
      <path d="M50 94V27" {...line} />
      <path d="M50 37 39 30.5M50 37 61 30.5M50 60 28 48.5M50 60 72 48.5" {...line} />
      <g>{cube(50, 25)}</g>
      <g>{cube(37, 28)}</g><g>{cube(63, 28)}</g>
      <g>{cube(24, 47)}</g><g>{cube(76, 47)}</g>
      {/* четыре яблока на черенках: в начале — на ветках, потом падают */}
      {APPLES.map((a, i) => (
        <g key={i} ref={(el) => { appleRefs.current[i] = el; }} data-apple={i}>
          <path d={`M${a.x} ${f1(a.y - 9)}v4`} {...line} strokeWidth={2.8} />
          {cube(a.x, a.y)}
        </g>))}
      <path ref={frontRef} d={first.front} {...line} />
    </svg>);
}

/** Окно загрузки: тёмный экран и логотип в движении посередине. */
export default function Splash() {
  return (
    <div aria-label="загрузка" role="status"
      style={{ background: C.ink, minHeight: "100%", height: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center" }}>
      <LogoLoader />
    </div>);
}
