import React, { useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm } from "./ui.jsx";
import { parseText } from "../lib/proc2.js";
import { hoursRange, everyRange } from "../lib/funcs.js";
import { handColor } from "../lib/hands.js";

/* ─────── две карты техпроцесса (владелец, 2026-09-18) ───────

   «Таймлайн» отвечает на вопрос «когда»: задачи процесса по порядку, с
   их сроком и паузой до следующей попытки. «Майнд-карта» — на вопрос
   «что куда»: задачи и ресурсы между ними.

   Обе — прогноз по тексту процесса, а не история: они читают тот же
   разбор, что и поле, поэтому показывают процесс таким, каким он описан
   сейчас, даже если он ещё не принят. Внутри окна можно двигаться:
   перетаскивание пальцем и мышью, «+»/«−» — масштаб. */

const HOURS = { ч: 1, дн: 24, нед: 168, мес: 730 };
const unitOf = (h) => (h >= 730 ? "мес" : h >= 168 ? "нед" : h >= 24 ? "дн" : "ч");
const inUnit = (h, u) => Math.round((h / HOURS[u]) * 10) / 10;

/** Задачи процесса по порядку с их временем — общий разбор для обеих карт. */
export function procPlan(text = "", model = {}, proc = {}) {
  const { funcs } = parseText(text, model, proc);
  const out = [];
  funcs.forEach((f, fi) => f.tasks.forEach((t, ti) => {
    const time = t.time || {};
    const { lo, hi } = hoursRange({ dur: time.dur ?? 1, durHi: time.durHi ?? time.dur ?? 1, durUnit: time.durUnit || "дн" });
    const gap = everyRange({ every: time.every ?? 0, everyHi: time.everyHi ?? 0, everyUnit: time.everyUnit || "дн" });
    const who = [];
    const takes = [];
    const gives = [];
    t.branches.forEach((b) => {
      b.who.forEach((w) => who.push(w));
      b.steps.forEach((s) => {
        [...s.items, ...s.or].forEach((it) => {
          const port = { name: it.ref ? `(${it.var})` : it.name, qty: it.qty, qtyHi: it.qtyHi, varName: it.var || "", ref: !!it.ref,
            asset: (s.kind === "take" ? s.from : s.to)?.name || s.asset?.name || "" };
          (s.kind === "take" ? takes : gives).push(port);
        });
      });
    });
    out.push({ key: `${fi}:${ti}`, func: f.name || `функция ${fi + 1}`, name: t.name || `задача ${ti + 1}`,
      lo, hi, gap: gap.lo, gapHi: gap.hi, par: time.par ?? 1, checks: (t.checks || []).map((c) => c.text),
      who: who.map((w) => ({ name: w.name, asset: w.asset?.name || "", hand: w.hand || "" })), takes, gives });
  }));
  return out;
}

/* Окно, внутри которого можно двигаться пальцем и мышью. */
function Pannable({ label, children, wide = 1200, tall = 700 }) {
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [k, setK] = useState(1);
  const drag = useRef(null);
  const start = (x, y) => { drag.current = { x, y, ax: at.x, ay: at.y }; };
  const move = (x, y) => { if (drag.current) setAt({ x: drag.current.ax + (x - drag.current.x), y: drag.current.ay + (y - drag.current.y) }); };
  const stop = () => { drag.current = null; };
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div aria-label={label} data-pannable=""
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); start(e.clientX, e.clientY); }}
        onPointerMove={(e) => move(e.clientX, e.clientY)} onPointerUp={stop} onPointerCancel={stop}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }}
        onTouchMove={(e) => { const t = e.touches[0]; if (t) { e.preventDefault(); move(t.clientX, t.clientY); } }}
        onTouchEnd={stop}
        style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none",
          background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, cursor: drag.current ? "grabbing" : "grab" }}>
        <div style={{ position: "absolute", left: at.x, top: at.y, width: wide, height: tall,
          transform: `scale(${k})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
      <div className="flex items-center gap-2" style={{ position: "absolute", right: 6, bottom: 6, zIndex: 2 }}>
        <button type="button" aria-label="мельче" onClick={() => setK((v) => Math.max(0.4, Math.round((v - 0.2) * 10) / 10))}
          style={{ ...btn(false), fontSize: 12, padding: "2px 8px" }}>−</button>
        <button type="button" aria-label="крупнее" onClick={() => setK((v) => Math.min(2, Math.round((v + 0.2) * 10) / 10))}
          style={{ ...btn(false), fontSize: 12, padding: "2px 8px" }}>+</button>
        <button type="button" aria-label="в начало" onClick={() => { setAt({ x: 0, y: 0 }); setK(1); }}
          style={{ ...btn(false), fontSize: 11, padding: "2px 8px" }}>сброс</button>
      </div>
    </div>);
}

/** Таймлайн: полосы задач по времени, паузы между попытками. */
function Timeline({ plan }) {
  const total = plan.reduce((n, t) => n + t.hi + t.gapHi, 0) || 1;
  const u = unitOf(total);
  const PX = Math.min(90, Math.max(16, 900 / (total / HOURS[u] || 1)));   // пикселей на единицу
  let at = 0;
  const rows = plan.map((t) => {
    const x = (at / HOURS[u]) * PX;
    const w = Math.max(96, (t.hi / HOURS[u]) * PX);   // имя задачи должно читаться
    const gapW = (t.gapHi / HOURS[u]) * PX;
    at += t.hi + t.gapHi;
    return { ...t, x, w, gapW };
  });
  const width = Math.max(600, rows.length ? rows[rows.length - 1].x + rows[rows.length - 1].w + rows[rows.length - 1].gapW + 40 : 600);
  const marks = [];
  for (let i = 0; i * HOURS[u] <= total + HOURS[u]; i += 1) marks.push(i);
  return (
    <Pannable label="таймлайн процесса" wide={width} tall={Math.max(320, rows.length * 44 + 60)}>
      <div style={{ position: "relative", width, height: rows.length * 44 + 60, fontSize: 11 }}>
        {marks.map((i) => (
          <div key={i} style={{ position: "absolute", left: i * PX + 8, top: 0, bottom: 0, borderLeft: `1px solid ${C.line}66` }}>
            <span style={{ position: "absolute", top: 2, left: 3, color: C.muted, fontSize: 10, whiteSpace: "nowrap" }}>{i} {u}</span>
          </div>))}
        {rows.map((t, i) => (
          <div key={t.key} style={{ position: "absolute", left: t.x + 8, top: 26 + i * 44, height: 34 }}>
            <div aria-label={`задача ${t.name}`} title={`${t.func} · ${t.name}`}
              style={{ width: t.w, height: 20, background: `${ACC}33`, border: `1px solid ${ACC}`, borderRadius: 5,
                color: C.text, padding: "1px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                boxSizing: "border-box", lineHeight: "17px" }}>
              {t.name}</div>
            <div style={{ color: C.muted, fontSize: 9.5, marginTop: 1, whiteSpace: "nowrap" }}>
              {inUnit(t.lo, u) === inUnit(t.hi, u) ? `${nm(inUnit(t.hi, u))} ${u}` : `${nm(inUnit(t.lo, u))}–${nm(inUnit(t.hi, u))} ${u}`}
              {t.gapHi > 0 ? ` · пауза ${nm(inUnit(t.gapHi, u))} ${u}` : ""}
              {t.par > 1 ? ` · по ${t.par} разом` : ""}
            </div>
            {t.gapW > 1 && (
              <div style={{ position: "absolute", left: t.w, top: 4, width: t.gapW, height: 12,
                borderTop: `1px dashed ${C.line}`, borderBottom: `1px dashed ${C.line}` }} />)}
          </div>))}
        {!rows.length && <div style={{ padding: 16, color: C.muted }}>В процессе ещё нет задач.</div>}
      </div>
    </Pannable>);
}

/** Майнд-карта: задачи столбиками, ресурсы стрелками между ними. */
function MindMap({ plan }) {
  const W = 230, H = 108, GAPX = 90, GAPY = 30;
  const nodes = plan.map((t, i) => ({ ...t, x: 20 + i * (W + GAPX), y: 30 + (i % 2) * (H + GAPY) }));
  const width = Math.max(560, nodes.length ? nodes[nodes.length - 1].x + W + 40 : 560);
  const height = 30 + 2 * (H + GAPY) + 40;
  /* Линия между задачами: ресурс, выданный одной, взят другой — по имени
     или по закреплённому имени в скобках. */
  const links = [];
  nodes.forEach((a, i) => a.gives.forEach((g) => {
    nodes.forEach((b, j) => {
      if (j <= i) return;
      const hit = b.takes.find((k) => (g.varName && k.ref && k.name === `(${g.varName})`) || (!k.ref && k.name && k.name === g.name));
      if (hit) links.push({ a, b, name: g.varName ? g.varName : g.name, qty: g.qty, varName: g.varName });
    });
  }));
  return (
    <Pannable label="майнд-карта процесса" wide={width} tall={height}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs><marker id="pm-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 z" fill={ACC} /></marker></defs>
        {links.map((l, i) => {
          const x1 = l.a.x + W, y1 = l.a.y + H / 2, x2 = l.b.x, y2 = l.b.y + H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={`${l.a.key}-${l.b.key}-${i}`}>
              <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none"
                stroke={l.varName ? handColor(l.varName) : ACC} strokeWidth="1.5" markerEnd="url(#pm-arrow)" />
              <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" fill={C.muted} fontSize="10">
                {l.name}{l.qty != null && l.qty !== 1 ? ` ${nm(l.qty)}` : ""}</text>
            </g>);
        })}
        {nodes.map((t) => (
          <g key={t.key} aria-label={`задача ${t.name}`}>
            <rect x={t.x} y={t.y} width={W} height={H} rx="10" fill={C.panel2} stroke={C.line} />
            <text x={t.x + 10} y={t.y + 18} fill={C.text} fontSize="12" fontWeight="700">{t.name}</text>
            <text x={t.x + 10} y={t.y + 34} fill={C.muted} fontSize="10">{t.who.map((w) => w.name).join(", ") || "кто не назван"}</text>
            <text x={t.x + 10} y={t.y + 52} fill={OK} fontSize="10">
              берёт: {t.takes.map((p) => p.name).join(", ") || "—"}</text>
            <text x={t.x + 10} y={t.y + 68} fill={WARN} fontSize="10">
              отдаёт: {t.gives.map((p) => p.name).join(", ") || "—"}</text>
            <text x={t.x + 10} y={t.y + 86} fill={C.muted} fontSize="9.5">
              {t.checks.length ? `критериев: ${t.checks.length}` : "критериев нет"}</text>
          </g>))}
        {!nodes.length && <text x="16" y="30" fill={C.muted} fontSize="12">В процессе ещё нет задач.</text>}
      </svg>
    </Pannable>);
}

/** Модальное окно с картой процесса. */
export default function ProcMaps({ mode, proc, model, onClose }) {
  const plan = procPlan(proc?.text || "", model, proc || {});
  const title = mode === "timeline" ? "Таймлайн процесса" : "Майнд-карта процесса";
  return (
    <div role="dialog" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "#0008", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 10 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, width: "min(760px, 100%)", height: "min(76vh, 620px)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>{mode === "timeline" ? "таймлайн" : "майнд-карта"}</span>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{proc?.name || "процесс"}</span>
          <button type="button" style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} aria-label="закрыть карту" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted }}>
          {mode === "timeline"
            ? "Прогноз по описанию: сколько идёт каждая задача и сколько ждать следующую попытку."
            : "Что куда уходит: задачи и ресурсы между ними. Стрелка — выданный ресурс, взятый следующей задачей."}
        </div>
        {mode === "timeline" ? <Timeline plan={plan} /> : <MindMap plan={plan} />}
      </div>
    </div>);
}
