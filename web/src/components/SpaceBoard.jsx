import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, TxtField } from "./ui.jsx";
import { funcLabel, statusName } from "./TasksBoard.jsx";
import { putReportFile, reportSrc } from "../storage.js";
import { BLOCK_W, addArrow, addNote, addQa, blocksOf, derivedKeys, dropBlock, dropPoint,
  edgePoint, fitView, moveBlock, movePoint, newNote, normalizeSpace, pathFrom, placeNew,
  rectOf, routeOf, toWorld, updateNote, zoomView } from "../lib/space.js";

/* ════════════════════════════════════════════════════════════════
   ПРОСТРАНСТВО · блоки, стрелки, вопросы помощнику

   Что здесь лежит и почему оно так устроено — в lib/space.js. Этот файл
   только рисует и переводит касания в правки записи `space`.

   ─── касание и правка — не одно и то же ───

   Перетаскивание блока, точки или всего холста живёт в местном состоянии
   и в запись попадает ОДИН раз — когда палец отпустили. История правок
   (lib/history.js) записывает каждое изменение документа; писать туда
   каждый сдвиг на пиксель значило бы, что «отменить» откатывает
   перетаскивание по миллиметру.

   ─── цвета ───

   Цвет отвечает на вопрос «что это»: заметка — нейтральная, файл —
   бирюзовый, память помощника — фиолетовый. Задача красится по статусу,
   и оттенки тёплые, чтобы задача не путалась ни с одним из трёх. Где
   палитра приложения уже отвечает на этот вопрос — берём её: дедлайн
   красный (BAD), проверка янтарная (WARN), а «готово» зелёное (OK):
   зелёный по всему приложению значит «факт, принято», и красить принятую
   работу иначе значило бы спорить со схемой и таймлайном. Остальные три
   оттенка свои, в общей палитре их нет.
   ════════════════════════════════════════════════════════════════ */

/* Память помощника — фиолетовый: до пространства в приложении не было
   ничего фиолетового, и это единственный цвет, свободный от смысла. */
const MEM = "#B48CFF";
const SAND = "#C4A67A";   // ожидает — ещё не время, спокойный песочный
const CLAY = "#E0885A";   // отложено — время пришло, а работа нет: глина
const FIRE = "#FF8A3D";   // в работе — горит
export const TASK_TONE = { backlog: SAND, deferred: CLAY, deadline: BAD, progress: FIRE,
  review: WARN, done: OK };
export const KIND_TONE = { note: NEU, file: ACC, memory: MEM };
const KIND_WORD = { note: "заметка", task: "задача", file: "файл", memory: "память помощника" };

const toneOf = (b) => (b.kind === "task" ? (TASK_TONE[b.task?.status] || SAND) : KIND_TONE[b.kind]);
const nameOfBlock = (b) => {
  if (b.kind === "note") return b.note.title || "заметка без названия";
  if (b.kind === "task") return b.task.title || "без названия";
  if (b.kind === "file") return b.file.name || "без названия";
  return b.item.title || "без названия";
};
const fmtAt = (v) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU",
    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sameView = (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

// Сдвиг меньше этого — нажатие, а не перетаскивание.
const DRAG_MIN = 3;
// Второе нажатие по точке не позже этого — двойное.
const DOUBLE_MS = 350;
const CANVAS_H = 520;

export default function SpaceBoard({ space, setSpace, tasks = [], funcs = [], entities = [],
  files = [], memory = [], ask, nameOf, onOpenTask }) {
  const sp = useMemo(() => normalizeSpace(space), [space]);
  /* Правка всегда идёт через достройку: запись могла прийти чужой или
     старой, а функции из lib/space.js рассчитывают на полную. */
  const update = (fn) => setSpace((s) => fn(normalizeSpace(s)));

  const model = useMemo(() => ({ tasks, files, memory }), [tasks, files, memory]);
  const keys = useMemo(() => derivedKeys(model), [model]);
  /* Новые производные блоки получают место сеткой, и оно записывается
     сразу: иначе они прыгали бы при каждой правке соседей (см. placeNew). */
  useEffect(() => {
    if (keys.some((k) => !sp.pos[k] && !sp.hidden.includes(k))) update((s) => placeNew(s, keys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, sp]);

  /* Настоящие размеры блоков — из браузера. Стрелка должна входить в
     границу блока, а высота у него зависит от текста; в тестах измерять
     нечем, и остаются размеры по умолчанию. */
  const [sizes, setSizes] = useState({});
  const els = useRef({});
  useLayoutEffect(() => {
    let next = null;
    Object.entries(els.current).forEach(([k, el]) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      const cur = sizes[k];
      if (!cur || cur.w !== w || cur.h !== h) { next = next || { ...sizes }; next[k] = { w, h }; }
    });
    if (next) setSizes(next);
  });

  const [view, setView] = useState(sp.view);
  /* Вид записывается с задержкой: колесо мыши шлёт десятки событий в
     секунду, и каждое стало бы шагом истории. */
  useEffect(() => {
    if (sameView(view, sp.view)) return undefined;
    const id = setTimeout(() => update((s) => (sameView(s.view, view) ? s : { ...s, view })), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const [drag, setDrag] = useState(null);
  const [linking, setLinking] = useState(null);   // { from, points }
  const [asking, setAsking] = useState(null);     // { key, q, busy, err }
  const [confirming, setConfirming] = useState(null);
  const [noteFile, setNoteFile] = useState({});   // key → { busy, err }
  const lastTap = useRef(null);                   // { id, at } — для двойного нажатия
  const box = useRef(null);

  const blocks = useMemo(() => blocksOf(sp, model).map((b) => ({ ...b, ...(sizes[b.key] || {}) })),
    [sp, model, sizes]);
  const shown = blocks.map((b) => (drag?.kind === "block" && drag.key === b.key
    ? { ...b, x: drag.x, y: drag.y } : b));
  const arrows = sp.arrows.map((a) => (drag?.kind === "point" && drag.arrowId === a.id
    ? { ...a, points: a.points.map((p, i) => (i === drag.index ? { x: drag.x, y: drag.y } : p)) }
    : a));

  const boxSize = () => ({
    width: box.current?.clientWidth || 800,
    height: box.current?.clientHeight || CANVAS_H,
  });
  const screenOf = (e) => {
    const r = box.current?.getBoundingClientRect?.() || { left: 0, top: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const worldOf = (e) => toWorld(view, screenOf(e));

  // ─── колесо: масштаб вокруг курсора ───
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    /* Слушатель свой, а не React-овский: React вешает wheel пассивным, и
       preventDefault там не работает — страница уезжала бы вместе с холстом. */
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect?.() || { left: 0, top: 0 };
      setView((v) => zoomView(v, Math.exp(-e.deltaY * 0.0015),
        { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f) => {
    const { width, height } = boxSize();
    setView((v) => zoomView(v, f, { x: width / 2, y: height / 2 }));
  };
  const fit = () => setView(fitView(blocks, boxSize()));

  // ─── касания ───
  const bgDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false });
  };
  const blockDown = (e, b) => {
    e.stopPropagation();
    if (!linking) return;
    /* В режиме стрелки касание блока — это конец стрелки (или отмена,
       если ткнули в тот же блок). */
    e.preventDefault();
    const w = worldOf(e);
    const { from, points } = linking;
    setLinking(null);
    if (from === b.key) return;
    update((s) => addArrow(s, from, b.key, w, points));
  };
  const headDown = (e, b) => {
    if (linking) return;   // блок сам решит: это конец стрелки
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ kind: "block", key: b.key, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y,
      x: b.x, y: b.y, moved: false });
  };
  const pointDown = (e, a, i) => {
    e.stopPropagation();
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = a.points[i];
    setDrag({ kind: "point", arrowId: a.id, index: i, sx: e.clientX, sy: e.clientY,
      ox: p.x, oy: p.y, x: p.x, y: p.y, moved: false });
  };
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_MIN;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, x: drag.ox + dx, y: drag.oy + dy }));
      if (moved !== drag.moved) setDrag({ ...drag, moved });
      return;
    }
    setDrag({ ...drag, moved, x: drag.ox + dx / view.zoom, y: drag.oy + dy / view.zoom });
  };
  const up = (e) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.kind === "pan") {
      // Нажатие по пустому месту в режиме стрелки — точка перегиба.
      if (!d.moved && linking) {
        const w = worldOf(e);
        setLinking((l) => (l ? { ...l, points: [...l.points, w] } : l));
      }
      return;
    }
    if (d.kind === "block") {
      if (d.moved) update((s) => moveBlock(s, d.key, { x: d.x, y: d.y }));
      return;
    }
    if (d.moved) { update((s) => movePoint(s, d.arrowId, d.index, { x: d.x, y: d.y })); return; }
    /* Своё распознавание двойного нажатия: dblclick после касания пальцем
       приходит не во всех браузерах, а точку надо снимать одинаково везде. */
    const id = `${d.arrowId}:${d.index}`;
    const now = Date.now();
    if (lastTap.current && lastTap.current.id === id && now - lastTap.current.at < DOUBLE_MS) {
      lastTap.current = null;
      update((s) => dropPoint(s, d.arrowId, d.index));
      return;
    }
    lastTap.current = { id, at: now };
  };

  // ─── действия на блоке ───
  const addNoteHere = () => {
    const { width, height } = boxSize();
    const c = toWorld(view, { x: width / 2 - BLOCK_W / 2, y: height / 2 - 40 });
    /* Заметки, добавленные подряд, ложатся лесенкой: две одинаковые
       пустые заметки в одной точке выглядели бы как одна. */
    const n = sp.notes.length % 6;
    update((s) => addNote(s, newNote(c.x + n * 24, c.y + n * 24)));
  };
  const contextOf = (b) => {
    if (b.kind === "note") return `Заметка «${b.note.title || "без названия"}». ${b.note.text}`.trim();
    if (b.kind === "task") {
      const t = b.task;
      const who = t.assignee != null ? (nameOf ? nameOf(t.assignee) : t.assignee) : "не назначен";
      return `Задача «${t.title || "без названия"}», статус: ${statusName(t.status)}, `
        + `исполнитель: ${who}. ${t.body || ""}`.trim();
    }
    if (b.kind === "file") return `Файл «${b.file.name || "без названия"}».`;
    return `Память помощника «${b.item.title || "без названия"}». ${b.item.text || ""}`.trim();
  };
  const askNow = async (b) => {
    const q = (asking?.q || "").trim();
    if (!q) { setAsking((a) => ({ ...a, err: "вопрос пустой" })); return; }
    if (typeof ask !== "function") { setAsking((a) => ({ ...a, err: "помощник не подключён" })); return; }
    setAsking((a) => ({ ...a, busy: true, err: "" }));
    try {
      const a = await ask(q, contextOf(b));
      update((s) => addQa(s, b.key, { q, a: String(a ?? ""), at: new Date().toISOString() }));
      setAsking(null);
    } catch (e) {
      setAsking((a) => (a && a.key === b.key
        ? { ...a, busy: false, err: `не удалось спросить: ${e?.message || "помощник не ответил"}` }
        : a));
    }
  };
  const drop = (b) => {
    update((s) => dropBlock(s, b.key));
    setConfirming(null);
    if (linking?.from === b.key) setLinking(null);
    if (asking?.key === b.key) setAsking(null);
  };
  const pickNoteFile = async (b, f) => {
    if (!f) return;
    setNoteFile((m) => ({ ...m, [b.key]: { busy: true, err: "" } }));
    try {
      const file = await putReportFile(f);
      update((s) => updateNote(s, b.id, { file }));
      setNoteFile((m) => ({ ...m, [b.key]: { busy: false, err: "" } }));
    } catch (e) {
      setNoteFile((m) => ({ ...m, [b.key]: { busy: false, err: e?.message || "не удалось сохранить файл" } }));
    }
  };

  const fromBlock = linking ? blocks.find((b) => b.key === linking.from) : null;
  /* Пунктир недостроенной стрелки: от блока через уже поставленные точки. */
  const pending = (() => {
    if (!fromBlock || !linking.points.length) return "";
    const r = rectOf(shown.find((b) => b.key === fromBlock.key) || fromBlock);
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    return pathFrom([edgePoint(r, c, linking.points[0]), ...linking.points]);
  })();

  return (
    <div style={S.card}>
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <button style={btn(false)} onClick={addNoteHere}>+ заметка</button>
        <span style={{ flex: 1 }} />
        <button style={btn(false)} aria-label="крупнее" onClick={() => zoomBy(1.25)}>+</button>
        <button style={btn(false)} aria-label="мельче" onClick={() => zoomBy(0.8)}>−</button>
        <button style={btn(false)} onClick={fit}>по размеру</button>
      </div>
      {linking && (
        <div className="flex items-center gap-2" style={{ marginBottom: 8, fontSize: 11.5, color: ACC }}>
          <span style={{ flex: 1 }}>
            стрелка от «{fromBlock ? nameOfBlock(fromBlock) : "блока"}»: коснитесь второго блока
            — или пустого места, чтобы поставить точку перегиба
            {linking.points.length ? ` (точек: ${linking.points.length})` : ""}
          </span>
          <button style={btn(false)} onClick={() => setLinking(null)}>отменить</button>
        </div>)}

      <div ref={box} aria-label="пространство"
        onPointerDown={bgDown} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ position: "relative", overflow: "hidden", height: CANVAS_H,
          background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
          touchAction: "none", cursor: linking ? "crosshair" : (drag?.kind === "pan" ? "grabbing" : "grab"),
          userSelect: drag ? "none" : "auto" }}>
        {!blocks.length && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", color: C.muted, fontSize: 12, textAlign: "center",
            padding: 24, pointerEvents: "none" }}>
            пусто: заметок нет, а задачи, файлы и память помощника появятся здесь сами
          </div>)}
        <div style={{ position: "absolute", left: 0, top: 0,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0" }}>
          {/* Стрелки — под блоками: линия, проходящая поверх текста,
              делала бы его нечитаемым. */}
          <svg width="1" height="1" aria-hidden="true"
            style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
            <defs>
              <marker id="space-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4"
                orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L8,4 L0,8 z" fill={C.muted} />
              </marker>
            </defs>
            {arrows.map((a) => {
              const d = pathFrom(routeOf(a, shown) || []);
              return d ? <path key={a.id} data-arrow={a.id} d={d} fill="none" stroke={C.muted}
                strokeWidth="1.6" markerEnd="url(#space-arrow)" /> : null;
            })}
            {pending && <path d={pending} fill="none" stroke={ACC} strokeWidth="1.4"
              strokeDasharray="4 3" />}
          </svg>

          {shown.map((b) => (
            <Block key={b.key} b={b} tone={toneOf(b)} nameOf={nameOf} onOpenTask={onOpenTask}
              funcs={funcs} entities={entities}
              linking={!!linking} isFrom={linking?.from === b.key}
              setEl={(el) => { if (el) els.current[b.key] = el; else delete els.current[b.key]; }}
              onDown={(e) => blockDown(e, b)} onHeadDown={(e) => headDown(e, b)}
              onLink={() => setLinking((l) => (l?.from === b.key ? null : { from: b.key, points: [] }))}
              asking={asking?.key === b.key ? asking : null}
              onAsk={() => setAsking((a) => (a?.key === b.key ? null : { key: b.key, q: "", busy: false, err: "" }))}
              onQ={(q) => setAsking((a) => (a ? { ...a, q } : a))}
              onSend={() => askNow(b)}
              confirming={confirming === b.key}
              onTrash={() => setConfirming((c) => (c === b.key ? null : b.key))}
              onDrop={() => drop(b)}
              noteFile={noteFile[b.key]} onPickFile={(f) => pickNoteFile(b, f)}
              onNote={(patch) => update((s) => updateNote(s, b.id, patch))} />))}

          {/* Ручки точек — над блоками, иначе точку под блоком не взять. */}
          {arrows.map((a) => a.points.map((p, i) => (
            <div key={`${a.id}:${i}`} role="button" tabIndex={0}
              aria-label={`точка перегиба ${i + 1}`}
              onPointerDown={(e) => pointDown(e, a, i)}
              style={{ position: "absolute", left: p.x - 7, top: p.y - 7, width: 14, height: 14,
                borderRadius: 7, background: C.panel, border: `2px solid ${ACC}`,
                cursor: "grab", touchAction: "none", boxSizing: "border-box" }} />)))}
          {linking?.points.map((p, i) => (
            <div key={`pending:${i}`} aria-hidden="true"
              style={{ position: "absolute", left: p.x - 5, top: p.y - 5, width: 10, height: 10,
                borderRadius: 5, background: ACC, opacity: 0.7, pointerEvents: "none" }} />))}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        блок тянется за заголовок, холст — за пустое место; колесо и «+»/«−» — масштаб.
        Точка перегиба снимается двойным нажатием.
      </div>
    </div>);
}

/* ─────── блок ─────── */

function Block({ b, tone, nameOf, onOpenTask, funcs, entities, linking, isFrom, setEl, onDown,
  onHeadDown, onLink, asking, onAsk, onQ, onSend, confirming, onTrash, onDrop, noteFile,
  onPickFile, onNote }) {
  const small = { ...btn(false), padding: "1px 6px", fontSize: 11, lineHeight: "16px" };
  const round = (on, col) => ({ ...btn(on, col), padding: 0, width: 20, height: 20,
    borderRadius: 10, fontSize: 11, lineHeight: "18px", textAlign: "center" });
  const stop = (e) => e.stopPropagation();
  const derived = b.kind !== "note";
  return (
    <div ref={setEl} data-block={b.key} onPointerDown={onDown}
      style={{ position: "absolute", left: b.x, top: b.y, width: BLOCK_W, boxSizing: "border-box",
        background: C.panel, border: `1px solid ${isFrom ? ACC : tone}`, borderLeft: `4px solid ${tone}`,
        borderRadius: 8, padding: "6px 8px 8px", fontSize: 12, color: C.text,
        boxShadow: isFrom ? `0 0 0 2px ${ACC}55` : "none",
        cursor: linking ? "crosshair" : "default" }}>
      {/* Заголовок — за него блок и тянут; кнопки в нём касание не отдают. */}
      <div className="flex items-center gap-1" onPointerDown={onHeadDown}
        style={{ cursor: linking ? "crosshair" : "grab", touchAction: "none", marginBottom: 4 }}>
        <span style={{ ...S.lbl, color: tone, flex: 1 }}>{KIND_WORD[b.kind]}</span>
        <button style={round(isFrom, ACC)} aria-label="стрелка от блока" title="стрелка от блока"
          onPointerDown={stop} onClick={onLink}>→</button>
        <button style={round(!!asking)} aria-label="спросить помощника" title="спросить помощника"
          onPointerDown={stop} onClick={onAsk}>?</button>
        <button style={round(confirming, BAD)} aria-label="убрать блок" title="убрать блок"
          onPointerDown={stop} onClick={onTrash}>🗑</button>
      </div>

      <div onPointerDown={linking ? undefined : stop}>
        {b.kind === "note" && <NoteBody b={b} onNote={onNote} noteFile={noteFile} onPickFile={onPickFile} />}
        {b.kind === "task" && <TaskBody t={b.task} tone={tone} nameOf={nameOf} onOpenTask={onOpenTask}
          func={funcs.find((f) => f.id === b.task.funcId)} entities={entities} />}
        {b.kind === "file" && <FileBody f={b.file} />}
        {b.kind === "memory" && <MemoryBody m={b.item} />}

        {b.qa.length > 0 && (
          <div style={{ marginTop: 6, borderTop: `1px solid ${C.line}`, paddingTop: 4 }}>
            {b.qa.map((x, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <div style={{ color: C.muted, fontSize: 11 }}>? {x.q}</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{x.a}</div>
                {x.at && <div style={{ fontSize: 9.5, color: C.muted }}>{fmtAt(x.at)}</div>}
              </div>))}
          </div>)}

        {asking && (
          <div style={{ marginTop: 6, background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 6, padding: 6 }}>
            <textarea aria-label="вопрос помощнику" value={asking.q} rows={2}
              onChange={(e) => onQ(e.target.value)} disabled={asking.busy}
              style={{ ...S.inp, fontSize: 12, touchAction: "auto" }} />
            <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
              <span style={{ flex: 1, fontSize: 11, color: asking.err ? BAD : C.muted }}>
                {asking.busy ? "думаю…" : asking.err}
              </span>
              <button style={small} onClick={onSend} disabled={asking.busy}>Спросить</button>
            </div>
          </div>)}

        {confirming && (
          <div style={{ marginTop: 6, background: C.panel2, border: `1px solid ${BAD}`,
            borderRadius: 6, padding: 6, fontSize: 11.5, lineHeight: 1.45 }}>
            {derived
              ? `Убрать с пространства? ${b.kind === "task" ? "Задача" : b.kind === "file" ? "Файл" : "Память"} останется в модели — исчезнет только этот блок и его стрелки.`
              : "Удалить заметку? Она пропадёт вместе со своими стрелками."}
            <div className="flex gap-2" style={{ marginTop: 6 }}>
              <button style={{ ...small, color: BAD, borderColor: BAD }} onClick={onDrop}>Убрать</button>
              <button style={small} onClick={onTrash}>Оставить</button>
            </div>
          </div>)}
      </div>
    </div>);
}

/* Название без подсказки: подсказка в поле читается как уже написанное, и
   человек не понимает, чьи это слова. Пустое место с чертой под ним
   говорит само: сюда пишут. */
function NoteBody({ b, onNote, noteFile, onPickFile }) {
  const n = b.note;
  return (
    <div>
      <TxtField aria-label="название заметки" value={n.title} onCommit={(v) => onNote({ title: v })}
        style={{ background: "transparent", border: "none", borderBottom: `1px solid ${C.line}`,
          borderRadius: 0, padding: "4px 0", fontWeight: 600, fontSize: 13, minHeight: 28,
          touchAction: "auto" }} />
      <div style={{ ...S.lbl, marginTop: 6 }}>описание</div>
      <TxtField area rows={3} aria-label="описание заметки" value={n.text}
        onCommit={(v) => onNote({ text: v })}
        style={{ fontSize: 12, marginTop: 2, resize: "vertical", touchAction: "auto" }} />
      <div className="flex items-center gap-2" style={{ marginTop: 4, flexWrap: "wrap" }}>
        {n.file
          ? <>
            <a href={reportSrc(n.file)} target="_blank" rel="noreferrer" download={n.file.name}
              style={{ color: ACC, fontSize: 11.5 }}>📎 скачать · {n.file.name}</a>
            <button style={{ ...btn(false), padding: "1px 6px", fontSize: 10.5 }}
              aria-label="убрать файл" onClick={() => onNote({ file: null })}>✕</button>
          </>
          : <label style={{ ...btn(false), padding: "2px 8px", fontSize: 11, display: "inline-block" }}>
            {noteFile?.busy ? "сохраняю…" : "файл"}
            <input type="file" aria-label="файл заметки" style={{ display: "none" }}
              disabled={!!noteFile?.busy}
              onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>}
        {noteFile?.err && <span style={{ fontSize: 11, color: BAD }}>{noteFile.err}</span>}
      </div>
    </div>);
}

function TaskBody({ t, tone, nameOf, onOpenTask, func, entities }) {
  const who = t.assignee != null ? (nameOf ? nameOf(t.assignee) : t.assignee) : "не назначен";
  return (
    <div>
      {/* Название — это ход к задаче: открыть её здесь негде, а на доске
          есть и сдача, и комментарии. */}
      <button onClick={() => onOpenTask?.(t.id)}
        style={{ background: "none", border: "none", padding: 0, color: C.text, fontWeight: 600,
          fontSize: 13, textAlign: "left", cursor: onOpenTask ? "pointer" : "default",
          lineHeight: 1.35, fontFamily: "inherit" }}>
        {t.title || "без названия"}
      </button>
      {/* Чья это работа — функция и актив, как на карточке доски: задача
          без функции здесь была бы просто строкой. */}
      {func && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{funcLabel(func, entities)}</div>}
      <div style={{ fontSize: 11, color: tone, marginTop: 2 }}>{statusName(t.status)}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>исполнитель: {who}</div>
    </div>);
}

function FileBody({ f }) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35, wordBreak: "break-word" }}>
        {f.name || "без названия"}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
        {f.from === "report" ? "файл раздела отчёта" : "из сдачи задачи"}
      </div>
      {reportSrc(f)
        ? <a href={reportSrc(f)} target="_blank" rel="noreferrer" download={f.name}
          style={{ color: ACC, fontSize: 11.5, display: "inline-block", marginTop: 3 }}>скачать</a>
        : <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>ссылки нет</div>}
    </div>);
}

function MemoryBody({ m }) {
  const text = String(m.text || "");
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{m.title || "без названия"}</div>
      {text
        ? <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{cut(text, 140)}</div>
        : <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>текста нет</div>}
      {m.file && (
        <a href={reportSrc(m.file)} target="_blank" rel="noreferrer" download={m.file.name}
          style={{ color: MEM, fontSize: 11.5, display: "inline-block", marginTop: 3 }}>
          📎 {m.file.name}</a>)}
    </div>);
}
