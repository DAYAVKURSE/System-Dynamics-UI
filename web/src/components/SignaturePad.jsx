import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, S, btn, ACC, BAD } from "./ui.jsx";
import { newSignature, addPoint, isEnough, signatureRecord } from "../lib/signature.js";

/* ════════════════════════════════════════════════════════════════
   ПОЛЕ ПОДПИСИ

   Окно на весь экран, а не поле в форме. Причина простая: расписываются
   пальцем, и палец крупный — на полоске в 40 точек выходит не подпись, а
   каракуля, которую сам подписавший не признаёт своей. Поэтому подпись
   ставят на отдельном экране во всю ширину и почти в полэкрана высотой,
   как расписываются в планшете курьера.

   Что здесь записывается — см. lib/signature.js: не картинка, а траектория
   со временем и нажимом. Этот файл отвечает только за то, чтобы рука
   рисовала то, что хотела: события указателя (один код на палец, стилус и
   мышь), захват указателя (палец ушёл за край холста — линия не обрывается
   на полуслове), touch-action: none (иначе браузер примет росчерк за
   прокрутку и уведёт страницу из-под руки).

   Про холст в тестах. jsdom холст не рисует: getContext отдаёт либо null,
   либо заглушку без методов рисования, а toDataURL кидает «not
   implemented». Поэтому каждое обращение к контексту проходит через ctx2d()
   и картинка снимается в try/catch: тест проверяет ПРАВИЛА подписи —
   собрались ли точки, разблокировалась ли кнопка, — и падать на отсутствии
   графики он не должен.
   ════════════════════════════════════════════════════════════════ */

/* Контекст берём, только если он умеет рисовать линию. Проверка «ctx &&»
   сама по себе не спасает: заглушка холста в тестах — объект, у которого
   beginPath просто нет, и вызов упал бы на первом же движении пальца. */
function ctx2d(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") return null;
  let ctx = null;
  try { ctx = canvas.getContext("2d"); } catch { return null; }
  if (!ctx || typeof ctx.beginPath !== "function" || typeof ctx.stroke !== "function") return null;
  return ctx;
}

const HINT = "Распишитесь пальцем или стилусом, как на бумаге. " +
  "Подпись записывается с темпом и нажимом";

export default function SignaturePad({ title = "Поставьте подпись", by, docHash,
  onDone, onCancel }) {
  const canvas = useRef(null);
  const [sig, setSig] = useState(newSignature);
  // Номер штриха под рукой; −1 — рука поднята. Держим в состоянии, а не в
  // ref, чтобы после отпускания следующий pointermove (мышь ездит по экрану
  // и без нажатой кнопки) не дорисовывал линию.
  const [stroke, setStroke] = useState(-1);
  const [busy, setBusy] = useState(false);
  const started = useRef(null);   // performance.now() первой точки
  const prev = useRef(null);      // предыдущая точка штриха — для отрезка
  // Высота поля: ~45% экрана, но не меньше 220 точек — на низком экране в
  // альбомной ориентации иначе остаётся щель, в которой не расписаться.
  const [tall, setTall] = useState(() => Math.max(220,
    Math.round((typeof window === "undefined" ? 640 : window.innerHeight || 640) * 0.45)));

  useEffect(() => {
    const fit = () => setTall(Math.max(220, Math.round((window.innerHeight || 640) * 0.45)));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /* Холст под размер элемента и под плотность экрана: если оставить
     width/height по умолчанию (300×150), браузер растянет картинку, и линия
     выйдет мыльной и толще, чем её вели. Координаты точек при этом
     остаются в CSS-точках — в них же меряется длина росчерка. */
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(el.clientWidth || 0));
    const h = Math.max(1, Math.round(tall));
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    setSig((s) => ({ ...s, w, h }));
    const ctx = ctx2d(el);
    if (ctx) {
      ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111";
    }
  }, [tall]);

  const at = (ev) => {
    const box = ev.currentTarget.getBoundingClientRect?.() || { left: 0, top: 0 };
    return { x: ev.clientX - (box.left || 0), y: ev.clientY - (box.top || 0) };
  };

  const push = useCallback((index, ev) => {
    const { x, y } = at(ev);
    if (started.current == null) started.current = performance.now();
    const t = Math.max(0, Math.round(performance.now() - started.current));
    // Нажим есть только у стилуса; у пальца и мыши браузер отдаёт 0 —
    // подстановкой 0.5 занимается сама библиотека, здесь только передаём.
    setSig((s) => addPoint(s, index, { x, y, t, p: ev.pressure || 0.5 }));
    const ctx = ctx2d(canvas.current);
    if (ctx && prev.current) {
      ctx.beginPath();
      ctx.moveTo(prev.current.x, prev.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev.current = { x, y };
  }, []);

  const down = (ev) => {
    ev.preventDefault?.();
    // Захват указателя: рука уходит за край холста — события всё равно
    // приходят сюда, и подпись не обрезается по границе поля.
    try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch { /* нет захвата */ }
    const index = sig.strokes.length;
    prev.current = null;
    setStroke(index);
    push(index, ev);
  };
  const move = (ev) => { if (stroke >= 0) push(stroke, ev); };
  const up = () => { setStroke(-1); prev.current = null; };

  // Хватает ли написанного на подпись — считается на каждом рендере: от
  // этого зависит и кнопка «Готово», и подпись под ней.
  const enough = isEnough(sig);

  const clear = () => {
    setSig(newSignature());
    setStroke(-1);
    started.current = null;
    prev.current = null;
    const el = canvas.current, ctx = ctx2d(el);
    // Отдельно clearRect, а не «сбросить width»: сброс ширины обнулил бы и
    // трансформацию под плотность экрана, и стиль линии.
    if (ctx && el) ctx.clearRect?.(0, 0, el.width, el.height);
  };

  const done = async () => {
    if (busy || !enough) return;
    setBusy(true);
    let png = "";
    // toDataURL в jsdom и в старых WebView кидает исключение. Картинка —
    // приложение к траектории, и терять из-за неё саму подпись нельзя.
    try { png = canvas.current?.toDataURL("image/png") || ""; } catch { png = ""; }
    try {
      const rec = await signatureRecord(sig, { by, docHash, png,
        ua: typeof navigator === "undefined" ? "" : navigator.userAgent });
      onDone?.(rec);
    } finally { setBusy(false); }
  };

  /* Порталом в body и без всплытия нажатий (владелец, 2026-09-22: в окне
     приглашения «Поставить подпись» не работала — нажатие по полю подписи
     всплывало до подложки окна и закрывало его). */
  const node = (
    <div role="dialog" aria-label="подпись" data-modal="" onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#000C",
        zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "center",
        gap: "var(--space-8)", padding: "var(--space-12)", boxSizing: "border-box", overflowY: "auto" }}>
      <div style={{ fontSize: "var(--fs-body)", fontWeight: 700, color: C.text }}>{title}</div>
      {/* Подсказка стоит НАД полем, а не под ним: под полем её закрывает
          рука, и человек узнаёт про запись темпа уже после подписи. */}
      <div style={{ fontSize: "var(--fs-hint)", lineHeight: 1.5, color: C.muted }}>{HINT}</div>
      <canvas ref={canvas} aria-label="поле подписи"
        onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerCancel={up} onPointerLeave={up}
        style={{ background: "#fff", borderRadius: "var(--radius-sm)", border: `1px solid ${C.line}`,
          width: "100%", height: tall, display: "block",
          // Без touch-action браузер считает росчерк прокруткой и уводит
          // страницу из-под пальца на втором же движении.
          touchAction: "none", cursor: "crosshair" }}/>
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={clear}>Очистить</button>
        {/* Пока не хватает — говорим, ЧЕГО не хватает, рядом с кнопкой:
            заблокированная кнопка без объяснения читается как поломка. */}
        {!enough && <span style={{ color: BAD }}>слишком коротко для подписи</span>}
        <span style={{ flex: 1 }}/>
        <button style={btn(false)} onClick={() => onCancel?.()}>Отмена</button>
        <button disabled={!enough || busy} onClick={done}
          style={{ ...btn(enough && !busy, ACC), opacity: enough && !busy ? 1 : 0.5,
            cursor: enough && !busy ? "pointer" : "not-allowed" }}>Готово</button>
      </div>
      <div style={{ ...S.lbl, fontSize: "var(--fs-hint)" }}>{by ? `подписывает: ${by}` : ""}</div>
    </div>);
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}
