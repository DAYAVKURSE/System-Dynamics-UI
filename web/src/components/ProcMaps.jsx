import React, { useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm } from "./ui.jsx";
import { parseText, ROLE_KINDS } from "../lib/proc2.js";
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
    let alt = false;   // есть ли у выхода «Или:» — иной исход
    t.branches.forEach((b) => {
      b.who.forEach((w) => who.push({
        name: w.name || (w.hand ? w.hand : w.person || ""), asset: w.asset?.name || "",
        hand: w.hand || "", person: w.person || "",
        roles: ROLE_KINDS.filter((r) => w.roles?.[r]),
      }));
      b.steps.forEach((s) => {
        const side = s.kind === "take" ? "take" : "give";
        const others = (s.kind === "take" ? s.froms : s.tos) || [];
        const party = others.map((x) => ({ name: x.name, hand: x.hand || "", person: x.person || "" }));
        if (s.or.length) alt = true;
        [...s.items.map((it) => ({ it, or: false })), ...s.or.map((it) => ({ it, or: true }))].forEach(({ it, or }) => {
          const port = {
            name: it.ref ? "" : it.name, varName: it.var || "", ref: !!it.ref,
            qty: it.qty, qtyHi: it.qtyHi, expr: it.expr || "", or,
            party,   // кому отдаёт / от кого берёт
          };
          (side === "take" ? takes : gives).push(port);
        });
      });
    });
    out.push({
      key: `${fi}:${ti}`, func: f.name || `функция ${fi + 1}`, name: t.name || `задача ${ti + 1}`,
      cond: t.cond || null, isElse: !!t.isElse, alt,
      lo, hi, gap: gap.lo, gapHi: gap.hi, par: time.par ?? 1,
      checks: (t.checks || []).map((c) => c.text), who, takes, gives,
    });
  }));
  /* Имя ресурса для ссылки «(X)» — берём там, где переменную объявили. */
  const declared = new Map();
  out.forEach((t) => t.gives.forEach((p) => { if (p.varName && p.name && !declared.has(p.varName)) declared.set(p.varName, { name: p.name, qty: p.qty }); }));
  out.forEach((t) => [...t.takes, ...t.gives].forEach((p) => {
    if (!p.name && p.varName && declared.has(p.varName)) { p.of = declared.get(p.varName).name; if (p.qty == null) p.qty = declared.get(p.varName).qty; }
  }));
  return out;
}

/** Подпись ресурса: имя, количество, закреплённое имя. */
export function portText(p) {
  const base = p.name || p.of || (p.varName ? p.varName : "ресурс");
  const qty = p.expr ? p.expr : p.qty != null && p.qty !== 1 ? nm(p.qty) : p.qty === 1 ? "1" : "";
  const tail = p.varName && (p.name || p.of) ? ` · ${p.varName}` : "";
  return `${base}${qty ? ` ${qty}` : ""}${tail}`;
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

/* Сколько людей в процессе — нужно, чтобы отвести им место по ширине. */
function people0(plan) {
  const set = new Set();
  plan.forEach((t) => {
    const d = t.who.find((w) => w.roles.includes("doer")) || t.who[0];
    const key = (x) => String(x?.hand || x?.person || x?.name || "").trim().toLowerCase();
    if (d && key(d)) set.add(key(d));
    [...t.takes, ...t.gives].forEach((p) => (p.party || []).forEach((x) => { if (key(x)) set.add(key(x)); }));
  });
  return [...set];
}

/* Кто ведёт задачу: первый исполнитель, иначе первый участник. */
const doerOf = (t) => t.who.find((w) => w.roles.includes("doer")) || t.who[0] || null;
const keyOf = (w) => (w ? (w.person || w.hand || w.name || "") : "");

/** Майнд-карта: блоки задач, люди под ними, ресурсы и взаимодействия стрелками. */
function MindMap({ plan }) {
  const W = 280, GAPX = 110, GAPY = 90;
  /* Строки блока — что берёт и что отдаёт, с количеством, закреплённым
     именем и второй стороной. Пустых разделов нет (владелец, 2026-09-18). */
  const wrap = (s0, max = 40) => {
    const words = String(s0).split(" ");
    const out = [];
    let cur = "";
    words.forEach((w) => {
      if (!cur) cur = w;
      else if (`${cur} ${w}`.length <= max) cur += ` ${w}`;
      else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    return out.slice(0, 2).map((x, i) => (i === 1 && out.length > 2 ? `${x}…` : x));
  };
  const withRows = plan.map((t) => {
    const rows = [];
    const side = (p, kind) => {
      const party = (p.party || []).map((x) => x.person || x.hand || x.name).filter(Boolean).join(", ");
      const head = kind === "take" ? (p.or ? "или берёт" : "берёт") : (p.or ? "или отдаёт" : "отдаёт");
      const tail = party ? (kind === "take" ? ` от ${party}` : ` → ${party}`) : "";
      wrap(`${head}: ${portText(p)}${tail}`).forEach((s1, i) => rows.push({ c: kind === "take" ? OK : WARN, s: s1, sub: i > 0 }));
    };
    t.takes.forEach((p) => side(p, "take"));
    t.gives.forEach((p) => side(p, "give"));
    const head = 24 + (t.cond ? 14 : 0);
    const h = Math.max(72, head + rows.length * 15 + (t.checks.length ? 16 : 0) + 14);
    return { ...t, rows, head, h };
  });
  let y0 = 24;
  const base = withRows.map((t, i) => {
    const col = i % 2;
    const node = { ...t, x: 20 + col * (W + GAPX), y: y0 };
    if (col === 1 || i === withRows.length - 1) y0 += Math.max(t.h, withRows[i - 1]?.h || 0) + GAPY;
    return node;
  });
  /* Блоки двигаются перетаскиванием (владелец, 2026-09-18); положение
     помнится, пока открыто окно. */
  const [moved, setMoved] = useState({});
  const drag = useRef(null);
  const nodes = base.map((n) => ({ ...n, x: moved[n.key]?.x ?? n.x, y: moved[n.key]?.y ?? n.y }));
  const at = (k) => nodes.find((n) => n.key === k);
  const down = (e, n) => {
    e.stopPropagation();
    drag.current = { key: n.key, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag.current) return;
    e.stopPropagation();
    const d = drag.current;
    setMoved((m) => ({ ...m, [d.key]: { x: Math.max(0, d.ox + (e.clientX - d.x)), y: Math.max(0, d.oy + (e.clientY - d.y)) } }));
  };
  const up = () => { drag.current = null; };
  const width = Math.max(600, Math.max(...nodes.map((n) => n.x + W), 0) + 40, 40 + people0(plan).length * 170);
  const height = Math.max(300, Math.max(...nodes.map((n) => n.y + n.h + 52), 0) + 20);

  /* Стрелки ресурсов: выданное одной задачей взято другой — по закреплённому
     имени или по имени ресурса. */
  const links = [];
  nodes.forEach((a) => a.gives.forEach((g) => {
    nodes.forEach((b) => {
      if (b.key === a.key) return;
      const hit = b.takes.find((k) => (g.varName && k.varName === g.varName) || (!k.varName && !g.varName && k.name && k.name === g.name));
      if (hit) links.push({ from: a, to: b, text: portText(g), or: g.or, color: g.varName ? handColor(g.varName) : ACC });
    });
  }));
  /* Кто с кем взаимодействует. Один человек — одна фигурка: ключ по
     закреплённому имени или по сотруднику, иначе по должности; регистр и
     пробелы не различаем. */
  const people = [];
  const addPerson = (x) => {
    const key = String(x.hand || x.person || x.name || "").trim().toLowerCase();
    if (!key) return "";
    const was = people.find((p) => p.key === key);
    if (!was) people.push({ key, name: x.person || x.hand || x.name, post: x.hand ? x.name : "" });
    else if (!was.post && x.hand && x.name && x.name !== was.name) was.post = x.name;
    return key;
  };
  nodes.forEach((t) => {
    const d = doerOf(t);
    if (d) addPerson(d);
    [...t.takes, ...t.gives].forEach((p) => (p.party || []).forEach(addPerson));
  });
  const colorOf = (k) => handColor(String(k || "").toLowerCase());
  const pkey = (x) => String(x?.hand || x?.person || x?.name || "").trim().toLowerCase();
  const talks = [];
  nodes.forEach((t) => {
    const from = pkey(doerOf(t));
    t.gives.forEach((p) => (p.party || []).forEach((x) => {
      const to = pkey(x);
      if (from && to && from !== to && !talks.some((z) => z.from === from && z.to === to)) talks.push({ from, to, task: t.name });
    }));
  });
  const laneY = height + 8;
  const px = (i) => 40 + i * 170;

  const line = (txt, max = 30) => (String(txt).length > max ? `${String(txt).slice(0, max - 1)}…` : String(txt));
  return (
    <Pannable label="майнд-карта процесса" wide={width} tall={laneY + 60}>
      <svg width={width} height={laneY + 60} style={{ display: "block" }}
        onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <defs><marker id="pm-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 z" fill={ACC} /></marker>
          <marker id="pm-arrow2" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill={C.muted} /></marker></defs>

        {/* Ресурсы между задачами */}
        {links.map((l, i) => {
          const a = at(l.from.key), b = at(l.to.key);
          const x1 = a.x + W, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={`l${i}`}>
              <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={l.color}
                strokeWidth="1.6" strokeDasharray={l.or ? "5 4" : undefined} markerEnd="url(#pm-arrow)" />
              <text x={mx} y={(y1 + y2) / 2 - 5} textAnchor="middle" fill={C.text} fontSize="10">
                {l.or ? "или · " : ""}{line(l.text, 34)}</text>
            </g>);
        })}

        {/* Задачи */}
        {nodes.map((t) => {
          const d = doerOf(t);
          const col = colorOf(keyOf(d));
          const rows = t.rows;
          return (
            <g key={t.key} aria-label={`задача ${t.name}`} data-task={t.key}>
              <rect x={t.x} y={t.y} width={W} height={t.h} rx="10" fill={C.panel2} stroke={C.line} />
              <rect x={t.x} y={t.y} width="5" height={t.h} rx="2" fill={col} />
              {/* Шапка — ручка для перетаскивания. */}
              <rect x={t.x + 5} y={t.y} width={W - 5} height="26" rx="8" fill="transparent"
                style={{ cursor: "grab", touchAction: "none" }} onPointerDown={(e) => down(e, t)} />
              <text x={t.x + 14} y={t.y + 18} fill={C.text} fontSize="12" fontWeight="700" style={{ pointerEvents: "none" }}>{line(t.name, 28)}</text>
              {t.cond && (<text x={t.x + 14} y={t.y + 34} fill={WARN} fontSize="9.5">{t.isElse ? "иначе" : `если ${line(t.cond, 26)}`}</text>)}
              {rows.map((r, i) => (
                <text key={i} x={t.x + (r.sub ? 24 : 14)} y={t.y + t.head + 14 + i * 15} fill={r.c} fontSize="10">{r.s}</text>))}
              {!rows.length && <text x={t.x + 14} y={t.y + t.head + 14} fill={C.muted} fontSize="10">ресурсы не названы</text>}
              {t.checks.length > 0 && (
                <text x={t.x + 14} y={t.y + t.h - 10} fill={C.muted} fontSize="9.5">критериев: {t.checks.length}</text>)}
              {/* Кто делает — человечек с именем под блоком. */}
              {d && (
                <g aria-label={`исполнитель ${keyOf(d) || "не назван"}`}>
                  <circle cx={t.x + 18} cy={t.y + t.h + 16} r="7" fill={col} />
                  <path d={`M${t.x + 8},${t.y + t.h + 34} a10,10 0 0 1 20,0`} fill={col} opacity="0.75" />
                  <text x={t.x + 34} y={t.y + t.h + 22} fill={C.text} fontSize="10.5">{line(d.person || d.hand || d.name || "не назван", 26)}</text>
                  {d.hand && d.name && (<text x={t.x + 34} y={t.y + t.h + 33} fill={C.muted} fontSize="9">{line(d.name, 28)}</text>)}
                </g>)}
            </g>);
        })}

        {/* Кто с кем взаимодействует */}
        {people.length > 1 && (
          <g aria-label="взаимодействие людей">
            <text x="12" y={laneY - 34} fill={C.muted} fontSize="10">кто с кем взаимодействует</text>
            {talks.map((z, i) => {
              const a = people.findIndex((p) => p.key === z.from);
              const b = people.findIndex((p) => p.key === z.to);
              if (a < 0 || b < 0) return null;
              const x1 = px(a) + 10, x2 = px(b) + 10;
              const dy = 16 + (i % 3) * 8;
              return (
                <path key={`t${i}`} d={`M${x1},${laneY - 10} C${x1},${laneY - 10 - dy} ${x2},${laneY - 10 - dy} ${x2},${laneY - 10}`}
                  fill="none" stroke={C.muted} strokeWidth="1.2" markerEnd="url(#pm-arrow2)" />);
            })}
            {people.map((p, i) => (
              <g key={p.key} aria-label={`человек ${p.name}`}>
                <circle cx={px(i) + 10} cy={laneY} r="8" fill={colorOf(p.key)} />
                <path d={`M${px(i)},${laneY + 20} a10,10 0 0 1 20,0`} fill={colorOf(p.key)} opacity="0.75" />
                <text x={px(i) + 24} y={laneY + 2} fill={C.text} fontSize="10.5">{line(p.name, 16)}</text>
                {p.post && <text x={px(i) + 24} y={laneY + 14} fill={C.muted} fontSize="9">{line(p.post, 18)}</text>}
              </g>))}
          </g>)}
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
