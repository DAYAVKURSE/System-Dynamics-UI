import React, { useEffect, useRef, useState } from "react";
import { orthPath } from "../lib/paths.js";
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
        /* `name` — ТОЛЬКО должность: подстановка сюда руки прятала должность
           («wise oyster · wise oyster» вместо «wise oyster · Системный
           аналитик», владелец 2026-09-18). Кто это на самом деле, собирает
           `postMap` по всему процессу. */
        name: w.name || "", asset: w.asset?.name || "",
        hand: w.hand || "", person: w.person || "",
        roles: ROLE_KINDS.filter((r) => w.roles?.[r]),
      }));
      b.steps.forEach((s) => {
        const side = s.kind === "take" ? "take" : "give";
        const others = (s.kind === "take" ? s.froms : s.tos) || [];
        const named = (x) => ({ name: x.name, hand: x.hand || "", person: x.person || "" });
        /* «Кому:» после «Или:» — получатель ВАРИАНТА, а не основного
           ресурса (владелец, 2026-09-19). Своего получателя у варианта нет
           — читается общий. */
        const mainParty = others.filter((x) => !x.alt).map(named);
        const altParty = others.filter((x) => x.alt).map(named);
        if (s.or.length) alt = true;
        [...s.items.map((it) => ({ it, or: false })), ...s.or.map((it) => ({ it, or: true }))].forEach(({ it, or }) => {
          const party = or ? (altParty.length ? altParty : mainParty) : mainParty;
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

const doerOf = (t) => t.who.find((w) => w.roles.includes("doer")) || t.who[0] || null;
const keyOf = (w) => (w ? (w.person || w.hand || w.name || "") : "");
/* Цвет человека — по его ключу: один и тот же на карте и в форме
   взаимодействия, иначе одного человека читали бы за двоих. */
const colorOf = (k) => handColor(String(k || "").toLowerCase());

export const whoKey = (x) => String(x?.hand || x?.person || x?.name || "").trim().toLowerCase();

/** Должность участника, названная ГДЕ-НИБУДЬ в процессе: в одной строке её
    могли не написать («Кто: {wise oyster}»), а карта всё равно должна знать,
    что это системный аналитик (владелец, 2026-09-18). */
export function postMap(plan = []) {
  const by = new Map();
  const add = (x) => { const k = whoKey(x); if (k && x?.name && !by.has(k)) by.set(k, x.name); };
  plan.forEach((t) => {
    (t.who || []).forEach(add);
    [...(t.takes || []), ...(t.gives || [])].forEach((p) => (p.party || []).forEach(add));
  });
  return (x) => by.get(whoKey(x)) || "";
}

/** Кто это: ДОЛЖНОСТЬ, а закреплённое имя — в скобках (владелец, 2026-09-18). */
export const whoText = (w, postOf) => {
  const post = w?.name || (postOf ? postOf(w) : "") || "";
  const pin = w?.person || w?.hand || "";
  if (post && pin) return `${post} (${pin})`;
  return post || (pin ? `(${pin})` : "должность не названа");
};

/** Строки «берёт/отдаёт» задачи — одни и те же в обеих картах. */
export function taskLines(t, postOf) {
  const out = [];
  const side = (p, kind) => {
    const party = (p.party || []).map((x) => whoText(x, postOf)).filter(Boolean).join(", ");
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

/* ─── Раскладка майнд-карты помнится (владелец, 2026-09-18) ───

   Где разложены блоки и какой у карты масштаб — это НЕ описание процесса, а
   то, как владелец смотрит на него сейчас. Поэтому раскладка живёт в памяти
   браузера (`localStorage`), а не в модели: попав в модель, она уезжала бы на
   сервер и вставала бы шагом в «Отменить» — нажатие «Отменить» после
   раскладывания карты откатывало бы перетаскивание вместо настоящей правки.
   Плата за это — раскладка своя на каждом устройстве.

   Блоки помнятся по имени («функция»задача»), а не по месту в тексте: тогда
   добавленная выше задача не сдвигает всю раскладку. Две задачи с одним
   именем внутри одной функции делят место — редкий случай, и он безобиден. */
const layoutKey = (procId) => `sdui:procmap:${procId || "нет"}`;
export function loadLayout(procId) {
  try {
    const raw = window.localStorage.getItem(layoutKey(procId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
export function saveLayout(procId, layout) {
  try { window.localStorage.setItem(layoutKey(procId), JSON.stringify(layout || {})); } catch { /* память могла быть закрыта */ }
}

/* Окно, внутри которого можно двигаться пальцем и мышью. */
function Pannable({ label, children, wide = 1200, tall = 700, view, onView, onReset, lockAxis = false }) {
  const [at, setAt] = useState(() => ({ x: view?.x || 0, y: view?.y || 0 }));
  const [k, setK] = useState(() => view?.k || 1);
  const drag = useRef(null);
  const pinch = useRef(null);
  const box = useRef(null);
  const atRef = useRef(at), kRef = useRef(k), viewRef = useRef(onView);
  atRef.current = at; kRef.current = k; viewRef.current = onView;
  const fit = (z) => Math.min(2, Math.max(0.4, z));
  const zoom = (d) => { const n = fit(Math.round((k + d) * 10) / 10); setK(n); onView?.({ ...at, k: n }); };
  /* Жест, начатый на ручке блока, карту не двигает (владелец, 2026-09-18:
     «перемещение объекта и перемещение всей карты происходит одновременно»):
     блок ловит его сам, а окно к нему не прикасается. */
  const onHandle = (e) => !!(e.target?.closest?.("[data-drag-handle]"));
  const start = (x, y) => { drag.current = { x, y, ax: at.x, ay: at.y, axis: null }; };
  /* Таймлайн водят по одной оси (владелец, 2026-09-18: «нельзя его водить во
     все стороны»): по первым 6 пикселям решаем, это движение вдоль шкалы или
     поперёк, и дальше держим только его — иначе шкала уезжает под пальцем. */
  const move = (x, y) => {
    const d = drag.current;
    if (!d || pinch.current) return;
    let dx = x - d.x, dy = y - d.y;
    if (lockAxis) {
      if (!d.axis) {
        if (Math.hypot(dx, dy) < 6) return;
        d.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      }
      if (d.axis === "x") dy = 0; else dx = 0;
    }
    setAt({ x: d.ax + dx, y: d.ay + dy });
  };
  const stop = () => { if (!drag.current) return; drag.current = null; onView?.({ ...at, k }); };

  /* Щипок двумя пальцами — как на схеме активов (владелец, 2026-09-18).
     Слушаем сами, а не через React: нужен `passive: false`, иначе браузер не
     отдаёт жест. Точка листа под серединой пальцев остаётся на месте. */
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const mid = (t) => {
      const r = el.getBoundingClientRect();
      return [(t[0].clientX + t[1].clientX) / 2 - r.left, (t[0].clientY + t[1].clientY) / 2 - r.top];
    };
    const begin = (ev) => {
      if (ev.touches.length !== 2) return;
      drag.current = null;                       // второй палец отменяет прокрутку
      const [mx, my] = mid(ev.touches);
      const k0 = kRef.current, a0 = atRef.current;
      pinch.current = { d0: dist(ev.touches), k0, y0: a0.y, cx: (mx - a0.x) / k0, cy: (my - a0.y) / k0 };
      ev.preventDefault();
    };
    const spread = (ev) => {
      const pz = pinch.current;
      if (!pz || ev.touches.length !== 2) return;
      ev.preventDefault();
      const [mx, my] = mid(ev.touches);
      const k1 = fit(pz.k0 * (dist(ev.touches) / pz.d0));
      setK(k1);
      /* На таймлайне щипок только приближает: по вертикали лист не уводим,
         иначе шкала уезжает, а её водят отдельным движением. */
      setAt({ x: mx - pz.cx * k1, y: lockAxis ? pz.y0 : my - pz.cy * k1 });
    };
    const done = (ev) => {
      if (!pinch.current || ev.touches.length >= 2) return;
      pinch.current = null;
      viewRef.current?.({ ...atRef.current, k: kRef.current });
    };
    el.addEventListener("touchstart", begin, { passive: false });
    el.addEventListener("touchmove", spread, { passive: false });
    el.addEventListener("touchend", done);
    el.addEventListener("touchcancel", done);
    return () => {
      el.removeEventListener("touchstart", begin);
      el.removeEventListener("touchmove", spread);
      el.removeEventListener("touchend", done);
      el.removeEventListener("touchcancel", done);
    };
  }, [lockAxis]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div aria-label={label} data-pannable="" ref={box}
        onPointerDown={(e) => { if (onHandle(e) || pinch.current) return; e.currentTarget.setPointerCapture?.(e.pointerId); start(e.clientX, e.clientY); }}
        onPointerMove={(e) => move(e.clientX, e.clientY)} onPointerUp={stop} onPointerCancel={stop}
        onTouchStart={(e) => { if (onHandle(e) || e.touches.length > 1) { drag.current = null; return; } const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }}
        onTouchMove={(e) => { if (!drag.current || e.touches.length > 1) return; const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }}
        onTouchEnd={stop} onTouchCancel={stop}
        style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none",
          background: C.ink, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)", cursor: drag.current ? "grabbing" : "grab" }}>
        <div style={{ position: "absolute", left: at.x, top: at.y, width: wide, height: tall,
          transform: `scale(${k})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
      <div className="flex items-center gap-2" style={{ position: "absolute", right: 6, bottom: 6, zIndex: 2 }}>
        <button type="button" aria-label="мельче" onClick={() => zoom(-0.2)}
          style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}>−</button>
        <button type="button" aria-label="крупнее" onClick={() => zoom(0.2)}
          style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}>+</button>
        <button type="button" aria-label="в начало" onClick={() => { setAt({ x: 0, y: 0 }); setK(1); onView?.({ x: 0, y: 0, k: 1 }); onReset?.(); }}
          style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}>сброс</button>
      </div>
    </div>);
}

/* ─── Что с чем идёт одновременно (владелец, 2026-09-18) ───

   Раньше таймлайн просто складывал сроки в цепочку: каждая следующая задача
   начиналась после предыдущей, даже если она не ждёт от неё ничего и делает
   её другой человек. Это врало о сроке процесса.

   Задача ждёт ДВУХ вещей: ресурса («Берёт:» того, что другая задача
   «Отдаёт:» — по закреплённому имени или по имени ресурса) и своего
   исполнителя (один человек не делает два дела разом). Всё остальное идёт
   одновременно. Ветки одного условия — «Если:» и «Иначе:» — друг друга не
   ждут даже у одного исполнителя: случится только одна из них. */
function withGroups(plan) {
  let gid = 0, open = false, cur = null;
  return plan.map((t) => {
    const branch = t.cond != null || t.isElse;
    if (!branch) { open = false; cur = null; return { ...t, group: null, side: null }; }
    if (!open || (t.cond != null && cur != null && t.cond !== cur)) { gid += 1; open = true; cur = t.cond ?? cur; }
    if (t.cond != null) cur = t.cond;
    return { ...t, group: gid, side: t.isElse ? "else" : "if" };
  });
}
export function schedulePlan(plan) {
  const rows = withGroups(plan);
  const feeds = (p, t) => (p.gives || []).some((g) => (t.takes || []).some((k) => (
    (g.varName && k.varName === g.varName) || (!g.varName && !k.varName && g.name && g.name === k.name))));
  const alt = (a, b) => a.group != null && a.group === b.group && a.side !== b.side;
  const sameDoer = (a, b) => { const x = keyOf(doerOf(a)), y = keyOf(doerOf(b)); return !!x && x === y; };
  const start = [], end = [];
  rows.forEach((t, i) => {
    let s = 0;
    rows.forEach((p, j) => {
      if (j >= i) return;
      if (feeds(p, t)) s = Math.max(s, end[j] + p.gapHi);          // ждём выданный ресурс
      else if (sameDoer(p, t) && !alt(p, t)) s = Math.max(s, end[j]);   // тот же человек — по очереди
    });
    start[i] = s; end[i] = s + t.hi;
  });
  return rows.map((t, i) => ({
    ...t, start: start[i], end: end[i],
    along: rows.filter((o, j) => j !== i && start[j] < end[i] && start[i] < end[j]).map((o) => o.name),
  }));
}

/** Таймлайн: полосы задач по времени, паузы между попытками. */
function Timeline({ plan }) {
  const postOf = postMap(plan);
  const timed = schedulePlan(plan);
  const total = timed.reduce((n, t) => Math.max(n, t.end + t.gapHi), 0) || 1;   // сколько идёт процесс целиком
  const u = unitOf(total);
  const PX = Math.min(90, Math.max(16, 900 / (total / HOURS[u] || 1)));   // пикселей на единицу
  const rows = timed.map((t) => ({
    ...t,
    x: (t.start / HOURS[u]) * PX,
    w: Math.max(96, (t.hi / HOURS[u]) * PX),   // имя задачи должно читаться
    gapW: (t.gapHi / HOURS[u]) * PX,
    lines: taskLines(t, postOf),
  }));
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
  /* Видно, что идёт разом и что — ветка условия (владелец, 2026-09-18). */
  const note = (t) => [t.start > 0 ? `с ${nm(inUnit(t.start, u))} ${u}` : "с начала",
    t.along.length ? `разом с: ${t.along.join(", ")}` : "",
    t.cond != null ? `ветка «если ${t.cond}»` : t.isElse ? "ветка «иначе»" : ""].filter(Boolean).join(" · ");
  return (
    <Pannable label="таймлайн процесса" wide={width} tall={tall} lockAxis>
      <div style={{ position: "relative", width, minHeight: tall, fontSize: "var(--fs-hint)" }}>
        {marks.map((i) => (
          <div key={i} style={{ position: "absolute", left: i * PX + 8, top: 0, bottom: 0, borderLeft: `1px solid ${C.line}66` }}>
            <span style={{ position: "absolute", top: 2, left: 3, color: C.muted, fontSize: "var(--fs-hint)", whiteSpace: "nowrap" }}>{i} {u}</span>
          </div>))}
        <div style={{ position: "relative", paddingTop: "var(--space-24)" }}>
          {rows.map((t) => (
            <div key={t.key} style={{ position: "relative", marginLeft: t.x + 8, marginBottom: "var(--space-12)", width: Math.max(t.w, 260) }}>
              {/* Полоса — кнопка: жест на ней раскрывает задачу, а не двигает карту. */}
              <button type="button" data-drag-handle="" aria-label={`задача ${t.name}`} aria-expanded={!!open[t.key]}
                title={`${t.func} · ${t.name}`} onClick={() => toggle(t.key)}
                style={{ width: t.w, height: 20, background: `${ACC}${open[t.key] ? "55" : "33"}`, border: `1px solid ${ACC}`,
                  borderRadius: "var(--radius-sm)", color: C.text, padding: "0 var(--space-4)", whiteSpace: "nowrap", overflow: "hidden",
                  textOverflow: "ellipsis", boxSizing: "border-box", lineHeight: "17px", textAlign: "left",
                  font: "inherit", cursor: "pointer", display: "block" }}>
                {t.name}</button>
              <div style={{ color: C.muted, fontSize: "var(--fs-hint)", marginTop: 0, whiteSpace: "nowrap" }}>
                {dur(t)}{t.along.length ? " · ∥ разом" : ""}
                {t.cond != null ? ` · если ${t.cond}` : t.isElse ? " · иначе" : ""}</div>
              {open[t.key] && (
                <div aria-label={`задача ${t.name} целиком`}
                  style={{ marginTop: "var(--space-4)", maxWidth: 320, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
                    padding: "var(--space-8) var(--space-8)", whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                  <div style={{ color: C.muted, fontSize: "var(--fs-hint)" }}>{t.func}</div>
                  <div style={{ color: C.text, fontWeight: 700, fontSize: "var(--fs-hint)" }}>{t.name}</div>
                  {t.cond && <div style={{ color: WARN, fontSize: "var(--fs-hint)" }}>{t.isElse ? "иначе" : `если ${t.cond}`}</div>}
                  {t.who.map((w, j) => (
                    <div key={`w${j}`} style={{ color: C.text, fontSize: "var(--fs-hint)", marginTop: 0 }}>кто: {whoText(w, postOf)}</div>))}
                  {t.lines.map((r, j) => (
                    <div key={`r${j}`} style={{ color: r.kind === "take" ? OK : WARN, fontSize: "var(--fs-hint)", marginTop: 0 }}>{r.text}</div>))}
                  {!t.lines.length && <div style={{ color: C.muted, fontSize: "var(--fs-hint)", marginTop: 0 }}>ресурсы не названы</div>}
                  {t.checks.length > 0 && (
                    <div style={{ marginTop: "var(--space-4)" }}>
                      <div style={{ color: C.muted, fontSize: "var(--fs-hint)" }}>критерии проверки</div>
                      {t.checks.map((c, j) => (
                        <div key={`c${j}`} style={{ color: C.text, fontSize: "var(--fs-hint)" }}>• {c}</div>))}
                    </div>)}
                  <div style={{ color: C.muted, fontSize: "var(--fs-hint)", marginTop: "var(--space-4)" }}>{dur(t)}</div>
                  <div style={{ color: C.muted, fontSize: "var(--fs-hint)" }}>{note(t)}</div>
                </div>)}
              {t.gapW > 1 && (
                <div style={{ position: "absolute", left: t.w, top: 4, width: t.gapW, height: 12,
                  borderTop: `1px dashed ${C.line}`, borderBottom: `1px dashed ${C.line}` }} />)}
            </div>))}
        </div>
        {!rows.length && <div style={{ padding: "var(--space-16)", color: C.muted }}>В процессе ещё нет задач.</div>}
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

/* ─────── КТО С КЕМ ВЗАИМОДЕЙСТВУЕТ ───────

   Своя форма под картой (владелец, 2026-09-20): движение ресурсов — одно,
   взаимодействие людей — другое, и мешать их в одном полотне незачем.
   Здесь считается, кто кому передаёт напрямую и кто до кого достаёт
   только через кого-то ещё. */
export function crewGraph(nodes, { doerOf, postOf }) {
  /* Один человек — одна фигурка: ключ по закреплённому имени или по
     сотруднику, иначе по должности; регистр и пробелы не различаем. */
  const people = [];
  const addPerson = (x) => {
    const key = String(x.hand || x.person || x.name || "").trim().toLowerCase();
    if (!key) return "";
    const was = people.find((p) => p.key === key);
    const nm0 = x.person || x.hand || x.name;
    const post = postOf(x);
    if (!was) people.push({ key, name: nm0, post: post && post !== nm0 ? post : "" });
    else if (!was.post && post && post !== was.name) was.post = post;
    return key;
  };
  nodes.forEach((t) => {
    const d = doerOf(t);
    if (d) addPerson(d);
    [...t.takes, ...t.gives].forEach((p) => (p.party || []).forEach(addPerson));
  });
  const pkey = (x) => String(x?.hand || x?.person || x?.name || "").trim().toLowerCase();
  const talks = [];
  nodes.forEach((t) => {
    const from = pkey(doerOf(t));
    t.gives.forEach((p) => (p.party || []).forEach((x) => {
      const to = pkey(x);
      if (from && to && from !== to && !talks.some((z) => z.from === from && z.to === to)) talks.push({ from, to, task: t.name });
    }));
  });
  /* Кто до кого достаёт НЕ НАПРЯМУЮ (владелец, 2026-09-18: «между
     аналитиком и партнёром-фрилансером напрямую никакого ресурса не
     проходит, он проходит через владельца; чтобы такие места были видны»):
     работа доходит по цепочке передач через кого-то ещё. Такие дуги рисуем
     штрих-пунктиром — это места, где двое зависят друг от друга, но не
     разговаривают. */
  const direct = new Set(talks.map((z) => `${z.from}>${z.to}`));
  const next = new Map();
  talks.forEach((z) => { if (!next.has(z.from)) next.set(z.from, []); next.get(z.from).push(z.to); });
  const far = [];
  people.forEach((a) => {
    const seen = new Set();
    const queue = [...(next.get(a.key) || [])];
    while (queue.length) {
      const k = queue.shift();
      if (k === a.key || seen.has(k)) continue;
      seen.add(k);
      (next.get(k) || []).forEach((n) => { if (!seen.has(n)) queue.push(n); });
    }
    seen.forEach((b) => { if (!direct.has(`${a.key}>${b}`)) far.push({ from: a.key, to: b }); });
  });
  return { people, talks, far };
}

/** Взаимодействие сотрудников: фигурки по кругу, связи — дугами. */
export function CrewMap({ plan }) {
  const nodes = Array.isArray(plan) ? plan : (plan?.nodes || []);
  const postOf = postMap(nodes);
  const { people, talks, far } = crewGraph(nodes, { doerOf, postOf });
  /* Перенос по словам — свой: имена и должности тут короткие. */
  const wrap = (s0, max = 16) => {
    const out = [];
    let cur = "";
    String(s0 || "").split(" ").filter(Boolean).forEach((w) => {
      if (!cur) cur = w;
      else if ((`${cur} ${w}`).length <= max) cur = `${cur} ${w}`;
      else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    return out;
  };
  if (people.length < 2) {
    return (
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
        В процессе назван один человек или ни одного.</div>);
  }
  /* ПО КРУГУ, а не в строку (владелец, 2026-09-20): в строке связи
     наслаивались друг на друга, и кто с кем работает, приходилось
     угадывать. На круге каждая пара соединяется прямой. */
  const n = people.length;
  const r = Math.max(90, Math.min(190, 26 * n + 60));
  const pad = 96;
  const size = (r + pad) * 2;
  const cx = size / 2;
  const cy = size / 2;
  const at = (i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a };
  };
  const spot = (k) => at(people.findIndex((p) => p.key === k));
  return (
    <Pannable label="взаимодействие сотрудников" wide={size} tall={size}>
      <svg width={size} height={size} style={{ display: "block" }}>
        <defs>
          <marker id="cm-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill={C.muted} /></marker>
        </defs>
        {[...talks.map((z) => ({ ...z, far: false })), ...far.map((z) => ({ ...z, far: true }))]
          .map((z, i) => {
            const a = spot(z.from);
            const b = spot(z.to);
            if (!a || !b || a.x == null || b.x == null) return null;
            // Наконечник не должен уткнуться в фигурку: линию укорачиваем.
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const k = 14 / len;
            return (
              <line key={`t${i}`} data-talk={z.far ? "через" : "напрямую"}
                x1={a.x + dx * k} y1={a.y + dy * k}
                x2={b.x - dx * k} y2={b.y - dy * k}
                stroke={C.muted} strokeWidth="1.2"
                strokeDasharray={z.far ? "7 3 1.5 3" : undefined}
                markerEnd="url(#cm-arrow)" />);
          })}
        {people.map((p, i) => {
          const s = at(i);
          const right = Math.cos(s.a) >= -0.2;
          const name = wrap(p.name, 16);
          return (
            <g key={p.key} aria-label={`человек ${p.name}`}>
              <circle cx={s.x} cy={s.y - 4} r="8" fill={colorOf(p.key)} />
              <path d={`M${s.x - 10},${s.y + 16} a10,10 0 0 1 20,0`}
                fill={colorOf(p.key)} opacity="0.75" />
              {name.map((s1, j) => (
                <text key={`p${j}`} x={s.x} y={s.y + 32 + j * 11} textAnchor="middle"
                  fill={C.text} fontSize="10.5">{s1}</text>))}
              {wrap(p.post || "", 18).map((s1, j) => (
                <text key={`q${j}`} x={s.x} y={s.y + 32 + name.length * 11 + j * 10}
                  textAnchor="middle" fill={C.muted} fontSize="9">{s1}</text>))}
              {right ? null : null}
            </g>);
        })}
      </svg>
    </Pannable>);
}

/** Майнд-карта: блоки задач, люди под ними, ресурсы и взаимодействия стрелками. */
function MindMap({ plan, layout = {}, onLayout }) {
  const postOf = postMap(plan);
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
    taskLines(t, postOf).forEach(({ kind, text }) => wrap(text).forEach((s1, i) => (
      rows.push({ c: kind === "take" ? OK : WARN, s: s1, sub: i > 0 }))));
    const nameLines = wrap(t.name || "задача", 30);
    const condLines = t.cond ? wrap(t.isElse ? "иначе" : `если ${t.cond}`, 42) : [];
    const d = doerOf(t);
    const dName = d ? (d.person || d.hand || d.name || "не назван") : "";
    const dPost = d ? (d.name || postOf(d)) : "";
    const doerLines = d ? wrap(dName, 30) : [];
    const doerSub = dPost && dPost !== dName ? wrap(dPost, 32) : [];
    const head = 24 + (nameLines.length - 1) * 14 + condLines.length * 13;
    const h = Math.max(72, head + rows.length * 15 + (t.checks.length ? 16 : 0) + 14);
    const below = 40 + (doerLines.length - 1) * 11 + doerSub.length * 11;   // человечек с именем под блоком
    return { ...t, rows, nameLines, condLines, doerLines, doerSub, head, h, below };
  });
  /* Задачи лежат НА ПЛАШКЕ СВОЕЙ ФУНКЦИИ (владелец, 2026-09-19): задачи
     одной функции кладём вместе, а под ними рисуем полупрозрачную подложку с
     её именем. Плашка считается по нынешним местам блоков, поэтому она едет
     и растягивается вслед за перетаскиванием, а не живёт отдельной жизнью. */
  const PAD = 14, TOP = 22;
  const funcs = [];
  withRows.forEach((t) => {
    const was = funcs.find((f) => f.name === t.func);
    if (was) was.tasks.push(t); else funcs.push({ name: t.func, tasks: [t] });
  });
  let y0 = 24;
  const base = [];
  funcs.forEach((f, gi) => {
    let top = y0 + TOP;
    f.tasks.forEach((t, i) => {
      const col = i % 2;
      base.push({ ...t, gi, x: 20 + PAD + col * (W + GAPX), y: top });
      if (col === 1 || i === f.tasks.length - 1) {
        const prev = f.tasks[i - 1];
        top += Math.max(t.h + t.below, col === 1 && prev ? prev.h + prev.below : 0) + GAPY;
      }
    });
    y0 = top - GAPY + PAD + 18;   // после плашки — воздух до следующей функции
  });
  /* Блоки двигаются перетаскиванием (владелец, 2026-09-18); положение
     помнится и после закрытия окна — по имени задачи. */
  const idOf = (t) => `${t.func}»${t.name}`;
  const [moved, setMoved] = useState(() => {
    const was = layout.moved || {}, out = {};
    withRows.forEach((t) => { const p0 = was[idOf(t)]; if (p0 && typeof p0.x === "number") out[t.key] = p0; });
    return out;
  });
  const keep = (m) => {
    const out = {};
    withRows.forEach((t) => { if (m[t.key]) out[idOf(t)] = m[t.key]; });
    onLayout?.({ moved: out });
  };
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
    if (e.touches.length > 1) { drag.current = null; return; }   // два пальца — это масштаб
    e.stopPropagation();
    const t = e.touches[0];
    if (t) drift(t.clientX, t.clientY);
  };
  const up = () => { if (!drag.current) return; drag.current = null; keep(moved); };
  const plates = funcs.map((f, gi) => {
    const ns = nodes.filter((n) => n.gi === gi);
    if (!ns.length) return null;
    const x = Math.min(...ns.map((n) => n.x)) - PAD;
    const y = Math.min(...ns.map((n) => n.y)) - TOP;
    return { name: f.name, x, y,
      w: Math.max(...ns.map((n) => n.x + W)) + PAD - x,
      h: Math.max(...ns.map((n) => n.y + n.h + n.below)) + PAD - y };
  }).filter(Boolean);
  const width = Math.max(600, Math.max(...nodes.map((n) => n.x + W), 0) + 40, 40 + people0(plan).length * 170);
  const height = Math.max(300,
    Math.max(...nodes.map((n) => n.y + n.h + n.below + 12), 0) + 20,
    Math.max(...plates.map((f) => f.y + f.h), 0) + 16);   // полоса людей не залезает на плашку

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

  const arrowColors = [...new Set(links.map((l) => l.color))];
  const arrowId = (c) => `pm-arrow-${Math.max(0, arrowColors.indexOf(c))}`;
  return (
    <Pannable label="майнд-карта процесса" wide={width} tall={height + 24}
      view={layout.view} onView={(v) => onLayout?.({ view: v })}
      onReset={() => { setMoved({}); onLayout?.({ moved: {} }); }}>
      <svg width={width} height={height + 24} style={{ display: "block" }}
        onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <defs>
          {/* Наконечник — цветом своей линии, чтобы не выглядел чужим. */}
          {arrowColors.map((c, i) => (
            <marker key={c} id={`pm-arrow-${i}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 z" fill={c} /></marker>))}
          <marker id="pm-arrow2" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill={C.muted} /></marker></defs>

        {/* Плашка функции — под её задачами: тонкая и полупрозрачная. */}
        {plates.map((f, i) => (
          <g key={`f${i}`} aria-label={`функция ${f.name}`} data-func="">
            <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="14" fill={ACC} fillOpacity="0.05"
              stroke={ACC} strokeOpacity="0.28" />
            <text x={f.x + 14} y={f.y + 15} fill={C.muted} fontSize="10" letterSpacing="0.6">{f.name}</text>
          </g>))}

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
          /* Строго по вертикали и горизонтали, со скруглёнными углами
             (владелец, 2026-09-19): косая линия идёт «примерно туда», а
             колено говорит точно — вниз, потом вбок. */
          const curve = orthPath(upright
            ? [[x1, y1], [x1, my], [x2, my], [x2, y2]]
            : [[x1, y1], [mx, y1], [mx, y2], [x2, y2]], 12);
          return (
            <g key={`l${i}`}>
              <path d={curve} fill="none" stroke={l.color} strokeLinejoin="round"
                strokeWidth="1.6" strokeDasharray={l.or ? "5 4" : undefined} markerEnd={`url(#${arrowId(l.color)})`} />
              {/* Подпись стрелки — НА ПЛАШКЕ (владелец, 2026-09-20): без
                  подложки слова тонули в линиях и блоках. */}
              {(() => {
                const lines = wrap(`${l.or ? "или · " : ""}${l.text}`, 34);
                const wide = Math.max(...lines.map((s1) => s1.length)) * 5.6 + 12;
                const tall = lines.length * 11 + 6;
                const lx = upright ? mx + 8 : mx - wide / 2;
                const ly = my - 5 - (lines.length - 1) * 11 - 11;
                return (<>
                  <rect x={lx - 5} y={ly} width={wide} height={tall} rx="6"
                    fill={C.panel} stroke={l.color} strokeOpacity="0.5" />
                  {lines.map((s1, j) => (
                    <text key={j} x={lx + 1} y={ly + 13 + j * 11}
                      fill={C.text} fontSize="10">{s1}</text>))}
                </>);
              })()}
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

        {!nodes.length && <text x="16" y="30" fill={C.muted} fontSize="12">В процессе ещё нет задач.</text>}
      </svg>
    </Pannable>);
}

/** Модальное окно с картой процесса. */
export default function ProcMaps({ mode, proc, model, onClose }) {
  const plan = procPlan(proc?.text || "", model, proc || {});
  /* Раскладка майнд-карты помнится между открытиями: читаем при открытии,
     дописываем по концу жеста (владелец, 2026-09-18). */
  const saved = useRef(null);
  if (saved.current === null) saved.current = loadLayout(proc?.id);
  const [layout, setLayout] = useState(saved.current);
  const putLayout = (patch) => setLayout((L) => {
    const next = { ...L, ...patch };
    saveLayout(proc?.id, next);
    return next;
  });
  const title = mode === "timeline" ? "Таймлайн процесса" : "Майнд-карта процесса";
  return (
    <div role="dialog" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "#0008", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "var(--space-8)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, width: "min(760px, 100%)", height: "min(76vh, 620px)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>{mode === "timeline" ? "таймлайн" : "майнд-карта"}</span>
          <span style={{ flex: 1, fontSize: "var(--fs-body)", fontWeight: 700 }}>{proc?.name || "процесс"}</span>
          <button type="button" style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }} aria-label="закрыть карту" onClick={onClose}>✕</button>
        </div>
        {/* Две формы одна под другой (владелец, 2026-09-20): движение
            ресурсов — одно, взаимодействие сотрудников — другое. */}
        {mode === "timeline"
          ? <Timeline plan={plan} />
          : (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto",
              display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <div>
                <div style={S.lbl}>движение ресурсов</div>
                <MindMap plan={plan} layout={layout} onLayout={putLayout} />
              </div>
              <div>
                <div style={S.lbl}>взаимодействие сотрудников</div>
                <CrewMap plan={plan} />
              </div>
            </div>)}
      </div>
    </div>);
}
