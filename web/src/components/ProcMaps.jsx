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

/** Строки «берёт/отдаёт» задачи — одни и те же в обеих картах. */
export function taskLines(t) {
  const out = [];
  const side = (p, kind) => {
    const party = (p.party || []).map((x) => x.person || x.hand || x.name).filter(Boolean).join(", ");
    const head = kind === "take" ? (p.or ? "или берёт" : "берёт") : (p.or ? "или отдаёт" : "отдаёт");
    const tail = party ? (kind === "take" ? ` от ${party}` : ` → ${party}`) : "";
    out.push({ kind, text: `${head}: ${portText(p)}${tail}` });
  };
  (t.takes || []).forEach((p) => side(p, "take"));
  (t.gives || []).forEach((p) => side(p, "give"));
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
  /* Жест, начатый на ручке блока, карту не двигает (владелец, 2026-09-18:
     «перемещение объекта и перемещение всей карты происходит одновременно»):
     блок ловит его сам, а окно к нему не прикасается. */
  const onHandle = (e) => !!(e.target?.closest?.("[data-drag-handle]"));
  const start = (x, y) => { drag.current = { x, y, ax: at.x, ay: at.y }; };
  const move = (x, y) => { if (drag.current) setAt({ x: drag.current.ax + (x - drag.current.x), y: drag.current.ay + (y - drag.current.y) }); };
  const stop = () => { drag.current = null; };
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div aria-label={label} data-pannable=""
        onPointerDown={(e) => { if (onHandle(e)) return; e.currentTarget.setPointerCapture?.(e.pointerId); start(e.clientX, e.clientY); }}
        onPointerMove={(e) => move(e.clientX, e.clientY)} onPointerUp={stop} onPointerCancel={stop}
        onTouchStart={(e) => { if (onHandle(e)) return; const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }}
        onTouchMove={(e) => { if (!drag.current) return; const t = e.touches[0]; if (t) { e.preventDefault(); move(t.clientX, t.clientY); } }}
        onTouchEnd={stop} onTouchCancel={stop}
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
    return { ...t, x, w, gapW, lines: taskLines(t) };
  });
  /* Нажатие раскрывает задачу целиком (владелец, 2026-09-18): в полосе имя
     не помещается — её ширина означает срок, поэтому полный текст с
     переносом показывается карточкой под полосой. */
  const [open, setOpen] = useState({});
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const cardH = (t) => 26 + (t.lines.length + t.who.length + (t.checks.length ? t.checks.length + 1 : 0) + 2) * 16;
  const width = Math.max(600, rows.length ? rows[rows.length - 1].x + rows[rows.length - 1].w + rows[rows.length - 1].gapW + 40 : 600);
  const tall = Math.max(320, rows.length * 54 + 60 + rows.reduce((n, t) => n + (open[t.key] ? cardH(t) : 0), 0));
  const marks = [];
  for (let i = 0; i * HOURS[u] <= total + HOURS[u]; i += 1) marks.push(i);
  const dur = (t) => `${inUnit(t.lo, u) === inUnit(t.hi, u) ? `${nm(inUnit(t.hi, u))} ${u}` : `${nm(inUnit(t.lo, u))}–${nm(inUnit(t.hi, u))} ${u}`}`
    + `${t.gapHi > 0 ? ` · пауза ${nm(inUnit(t.gapHi, u))} ${u}` : ""}${t.par > 1 ? ` · по ${t.par} разом` : ""}`;
  return (
    <Pannable label="таймлайн процесса" wide={width} tall={tall}>
      <div style={{ position: "relative", width, minHeight: tall, fontSize: 11 }}>
        {marks.map((i) => (
          <div key={i} style={{ position: "absolute", left: i * PX + 8, top: 0, bottom: 0, borderLeft: `1px solid ${C.line}66` }}>
            <span style={{ position: "absolute", top: 2, left: 3, color: C.muted, fontSize: 10, whiteSpace: "nowrap" }}>{i} {u}</span>
          </div>))}
        <div style={{ position: "relative", paddingTop: 26 }}>
          {rows.map((t) => (
            <div key={t.key} style={{ position: "relative", marginLeft: t.x + 8, marginBottom: 14, width: Math.max(t.w, 260) }}>
              {/* Полоса — кнопка: жест на ней раскрывает задачу, а не двигает карту. */}
              <button type="button" data-drag-handle="" aria-label={`задача ${t.name}`} aria-expanded={!!open[t.key]}
                title={`${t.func} · ${t.name}`} onClick={() => toggle(t.key)}
                style={{ width: t.w, height: 20, background: `${ACC}${open[t.key] ? "55" : "33"}`, border: `1px solid ${ACC}`,
                  borderRadius: 5, color: C.text, padding: "1px 6px", whiteSpace: "nowrap", overflow: "hidden",
                  textOverflow: "ellipsis", boxSizing: "border-box", lineHeight: "17px", textAlign: "left",
                  font: "inherit", cursor: "pointer", display: "block" }}>
                {t.name}</button>
              <div style={{ color: C.muted, fontSize: 9.5, marginTop: 1, whiteSpace: "nowrap" }}>{dur(t)}</div>
              {open[t.key] && (
                <div aria-label={`задача ${t.name} целиком`}
                  style={{ marginTop: 4, maxWidth: 320, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
                    padding: "8px 10px", whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                  <div style={{ color: C.muted, fontSize: 9.5 }}>{t.func}</div>
                  <div style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{t.name}</div>
                  {t.cond && <div style={{ color: WARN, fontSize: 10 }}>{t.isElse ? "иначе" : `если ${t.cond}`}</div>}
                  {t.who.map((w, j) => (
                    <div key={`w${j}`} style={{ color: C.text, fontSize: 10.5, marginTop: 2 }}>
                      кто: {w.person || w.hand || w.name || "не назван"}{w.asset ? ` · ${w.asset}` : ""}
                      {w.roles.length ? ` · ${w.roles.join(", ")}` : ""}</div>))}
                  {t.lines.map((r, j) => (
                    <div key={`r${j}`} style={{ color: r.kind === "take" ? OK : WARN, fontSize: 10.5, marginTop: 2 }}>{r.text}</div>))}
                  {!t.lines.length && <div style={{ color: C.muted, fontSize: 10.5, marginTop: 2 }}>ресурсы не названы</div>}
                  {t.checks.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ color: C.muted, fontSize: 9.5 }}>критерии проверки</div>
                      {t.checks.map((c, j) => (
                        <div key={`c${j}`} style={{ color: C.text, fontSize: 10.5 }}>• {c}</div>))}
                    </div>)}
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>{dur(t)}</div>
                </div>)}
              {t.gapW > 1 && (
                <div style={{ position: "absolute", left: t.w, top: 4, width: t.gapW, height: 12,
                  borderTop: `1px dashed ${C.line}`, borderBottom: `1px dashed ${C.line}` }} />)}
            </div>))}
        </div>
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
  const W = 280, GAPX = 110, GAPY = 50;   // GAPY — поверх места под именем исполнителя
  /* Строки блока — что берёт и что отдаёт, с количеством, закреплённым
     именем и второй стороной. Пустых разделов нет (владелец, 2026-09-18). */
  /* Перенос по словам: текст в блоке не обрезается многоточием, а
     переносится (владелец, 2026-09-18), блок растёт под него. Слово длиннее
     строки рвётся по месту — иначе оно вылезет за рамку. */
  const wrap = (s0, max = 40) => {
    const out = [];
    let cur = "";
    const put = () => { if (cur) { out.push(cur); cur = ""; } };
    String(s0).split(" ").filter(Boolean).forEach((w0) => {
      let w = w0;
      while (w.length > max) { put(); out.push(`${w.slice(0, max - 1)}-`); w = w.slice(max - 1); }
      if (!cur) cur = w;
      else if (`${cur} ${w}`.length <= max) cur += ` ${w}`;
      else { put(); cur = w; }
    });
    put();
    return out;
  };
  const withRows = plan.map((t) => {
    const rows = [];
    taskLines(t).forEach(({ kind, text }) => wrap(text).forEach((s1, i) => (
      rows.push({ c: kind === "take" ? OK : WARN, s: s1, sub: i > 0 }))));
    const nameLines = wrap(t.name || "задача", 30);
    const condLines = t.cond ? wrap(t.isElse ? "иначе" : `если ${t.cond}`, 42) : [];
    const d = doerOf(t);
    const doerLines = d ? wrap(d.person || d.hand || d.name || "не назван", 30) : [];
    const doerSub = d && d.hand && d.name ? wrap(d.name, 32) : [];
    const head = 24 + (nameLines.length - 1) * 14 + condLines.length * 13;
    const h = Math.max(72, head + rows.length * 15 + (t.checks.length ? 16 : 0) + 14);
    const below = 40 + (doerLines.length - 1) * 11 + doerSub.length * 11;   // человечек с именем под блоком
    return { ...t, rows, nameLines, condLines, doerLines, doerSub, head, h, below };
  });
  let y0 = 24;
  const base = withRows.map((t, i) => {
    const col = i % 2;
    const node = { ...t, x: 20 + col * (W + GAPX), y: y0 };
    if (col === 1 || i === withRows.length - 1) {
      const prev = withRows[i - 1];
      y0 += Math.max(t.h + t.below, col === 1 && prev ? prev.h + prev.below : 0) + GAPY;
    }
    return node;
  });
  /* Блоки двигаются перетаскиванием (владелец, 2026-09-18); положение
     помнится, пока открыто окно. */
  const [moved, setMoved] = useState({});
  const drag = useRef(null);
  const nodes = base.map((n) => ({ ...n, x: moved[n.key]?.x ?? n.x, y: moved[n.key]?.y ?? n.y }));
  const at = (k) => nodes.find((n) => n.key === k);
  /* Тянут блок — тянется только он: жест гасится, чтобы окно карты его не
     подхватило (владелец, 2026-09-18). Положение считается от начала жеста,
     поэтому пришедшее и касанием, и указателем движение даёт одно и то же. */
  const grab = (key, x, y, n) => { drag.current = { key, x, y, ox: n.x, oy: n.y }; };
  const drift = (x, y) => {
    const d = drag.current;
    if (!d) return;
    setMoved((m) => ({ ...m, [d.key]: { x: Math.max(0, d.ox + (x - d.x)), y: Math.max(0, d.oy + (y - d.y)) } }));
  };
  const down = (e, n) => {
    e.stopPropagation();
    grab(n.key, e.clientX, e.clientY, n);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag.current) return;
    e.stopPropagation();
    drift(e.clientX, e.clientY);
  };
  const touchDown = (e, n) => {
    const t = e.touches[0];
    if (!t) return;
    e.stopPropagation();
    grab(n.key, t.clientX, t.clientY, n);
  };
  const touchMove = (e) => {
    if (!drag.current) return;
    e.stopPropagation();
    const t = e.touches[0];
    if (t) drift(t.clientX, t.clientY);
  };
  const up = () => { drag.current = null; };
  const width = Math.max(600, Math.max(...nodes.map((n) => n.x + W), 0) + 40, 40 + people0(plan).length * 170);
  const height = Math.max(300, Math.max(...nodes.map((n) => n.y + n.h + n.below + 12), 0) + 20);

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

  const arrowColors = [...new Set(links.map((l) => l.color))];
  const arrowId = (c) => `pm-arrow-${Math.max(0, arrowColors.indexOf(c))}`;
  /* Полоса людей тоже растёт под перенесённые имена. */
  const laneTall = 46 + Math.max(0, ...people.map((p) => (wrap(p.name, 20).length - 1) * 11 + wrap(p.post || "", 22).length * 10));
  return (
    <Pannable label="майнд-карта процесса" wide={width} tall={laneY + laneTall}>
      <svg width={width} height={laneY + laneTall} style={{ display: "block" }}
        onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <defs>
          {/* Наконечник — цветом своей линии, чтобы не выглядел чужим. */}
          {arrowColors.map((c, i) => (
            <marker key={c} id={`pm-arrow-${i}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 z" fill={c} /></marker>))}
          <marker id="pm-arrow2" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill={C.muted} /></marker></defs>

        {/* Ресурсы между задачами */}
        {links.map((l, i) => {
          const a = at(l.from.key), b = at(l.to.key);
          /* Стрелка подходит к БЛИЖНЕЙ стороне блока (владелец, 2026-09-18:
             «непонятно, почему у одних линий есть стрелки, у других нет»):
             раньше линия всегда шла в левый край, и у задачи, стоящей левее
             или прямо над источником, наконечник оказывался под самим блоком
             — стрелка пропадала. Блоки в одном столбце связываются сверху
             вниз, в разных — сбоку. */
        const acx = a.x + W / 2, bcx = b.x + W / 2;
          const upright = Math.abs(bcx - acx) < W * 0.6;
          const down = b.y + b.h / 2 >= a.y + a.h / 2, back = bcx < acx;
          const x1 = upright ? acx : back ? a.x : a.x + W;
          const y1 = upright ? (down ? a.y + a.h : a.y) : a.y + a.h / 2;
          const x2 = upright ? bcx : back ? b.x + W : b.x;
          const y2 = upright ? (down ? b.y : b.y + b.h) : b.y + b.h / 2;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const curve = upright
            ? `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
            : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
          return (
            <g key={`l${i}`}>
              <path d={curve} fill="none" stroke={l.color}
                strokeWidth="1.6" strokeDasharray={l.or ? "5 4" : undefined} markerEnd={`url(#${arrowId(l.color)})`} />
              {wrap(`${l.or ? "или · " : ""}${l.text}`, 34).map((s1, j, all) => (
                <text key={j} x={upright ? mx + 8 : mx} y={my - 5 - (all.length - 1 - j) * 11}
                  textAnchor={upright ? "start" : "middle"} fill={C.text} fontSize="10">{s1}</text>))}
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
              <rect x={t.x + 5} y={t.y} width={W - 5} height={26 + (t.nameLines.length - 1) * 14} rx="8" fill="transparent" data-drag-handle=""
                style={{ cursor: "grab", touchAction: "none" }} onPointerDown={(e) => down(e, t)}
                onTouchStart={(e) => touchDown(e, t)} onTouchMove={touchMove} onTouchEnd={up} onTouchCancel={up} />
              {t.nameLines.map((s1, i) => (
                <text key={`n${i}`} x={t.x + 14} y={t.y + 18 + i * 14} fill={C.text} fontSize="12" fontWeight="700"
                  style={{ pointerEvents: "none" }}>{s1}</text>))}
              {t.condLines.map((s1, i) => (
                <text key={`c${i}`} x={t.x + 14} y={t.y + 18 + (t.nameLines.length - 1) * 14 + 14 + i * 12}
                  fill={WARN} fontSize="9.5">{s1}</text>))}
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
                  {t.doerLines.map((s1, i) => (
                    <text key={`d${i}`} x={t.x + 34} y={t.y + t.h + 22 + i * 11} fill={C.text} fontSize="10.5">{s1}</text>))}
                  {t.doerSub.map((s1, i) => (
                    <text key={`ds${i}`} x={t.x + 34} y={t.y + t.h + 22 + t.doerLines.length * 11 + i * 11}
                      fill={C.muted} fontSize="9">{s1}</text>))}
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
                {wrap(p.name, 20).map((s1, j) => (
                  <text key={`p${j}`} x={px(i) + 24} y={laneY + 2 + j * 11} fill={C.text} fontSize="10.5">{s1}</text>))}
                {wrap(p.post || "", 22).map((s1, j) => (
                  <text key={`q${j}`} x={px(i) + 24} y={laneY + 2 + wrap(p.name, 20).length * 11 + j * 10}
                    fill={C.muted} fontSize="9">{s1}</text>))}
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
        {/* Что означают линии — словами, чтобы не гадать (владелец, 2026-09-18). */}
        <div style={{ fontSize: 10.5, color: C.muted }}>
          {mode === "timeline"
            ? "Прогноз по описанию: сколько идёт каждая задача и сколько ждать следующую попытку. Нажмите на полосу — задача раскроется целиком."
            : "Что куда уходит: задачи и ресурсы между ними. Сплошная стрелка — выданный ресурс, взятый другой задачей (цвет — закреплённого имени); пунктирная — «или», иной исход; серая дуга внизу — кто с кем взаимодействует. Стрелка всегда подходит к ближней стороне блока."}
        </div>
        {mode === "timeline" ? <Timeline plan={plan} /> : <MindMap plan={plan} />}
      </div>
    </div>);
}
