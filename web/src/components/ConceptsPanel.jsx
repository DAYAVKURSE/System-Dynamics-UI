import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACC, BAD, C, OK, S, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import BoardView, { STICKER_STATUS } from "./BoardView.jsx";
import { createBoard, getBoard, listBoards, setBoardApplied } from "../boards.js";
import { inkOn } from "../boardColors.js";
import { appliedBoards, childrenOf, dropBlock, newBlockId } from "../lib/concepts.js";

/* ════════════════════════════════════════════════════════════════
   ВКЛАДКА «КОНЦЕПТЫ» (владелец, 2026-09-26)

   «Слева должно быть меню, в котором должны быть все доски, как сейчас,
   а справа от неё — древовидная система блоков. Нужно, чтобы я мог
   открыть доску по нажатию на неё, и должна быть кнопка переключения на
   блок-схему вместо доски. Должна быть возможность в каждый блок
   добавить доску перетягиванием… при нажатии на доску на схеме она
   должна открываться в модальном окне и показывать только подходящие и
   принятые идеи. В каждом блоке слева должна быть таблица, а справа
   добавляться технологический процесс… со всем тем же функционалом.»

   · Меню досок — как было на «Брейншторме»: «+ новая» и список. Нажатие
     открывает доску справа; «Блок-схема» — назад к блокам. Доску из
     меню тянут на блок: мышью — сразу, пальцем — после долгого нажатия
     (иначе палец не смог бы прокручивать список).
   · Блок: название, доска (нажатие — окно с подходящими и применёнными
     идеями), таблица этих идей и техпроцессы блока — то же поле, что было
     на «Схеме» (ProcessPanel), только процессы этого блока.
   · Доске сообщается, есть ли у её блока техпроцесс: её стикеры
     «подходит» тогда показываются «применена» (у всех, и в чате).
   ════════════════════════════════════════════════════════════════ */

const KEY_SEL = "sd_board_sel";
const KEY_MODE = "sd_concepts_mode";
const KEY_MENU = "sd_concepts_menu";
const REFRESH_MS = 30000;
const IDEAS_MS = 10000;
const LONG_PRESS_MS = 380;
const MOVE_PX = 7;
const TEXT_LIGHT = "#F4F7F8";
const LINE = "rgba(255,255,255,.22)";
const INDENT = 18;
const SHOWN = ["fit", "applied"];
const raw = (s) => React.createElement(React.Fragment, null, s);

const read = (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k, v) => {
  try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); }
  catch { /* приватный режим — просто не запомним */ }
};

/* ─────── идеи доски для таблицы блока ───────
   Не длинный опрос: блоков с досками может быть много, а окно
   браузера держит к одному серверу лишь несколько соединений. Раз в
   десять секунд и при возврате на страницу — таблице этого хватает. */
function useBoardIdeas(boardId) {
  const [state, setState] = useState({ board: null, err: "" });
  useEffect(() => {
    if (!boardId) { setState({ board: null, err: "" }); return undefined; }
    let live = true;
    const ctl = new AbortController();
    const load = async () => {
      try {
        const out = await getBoard(boardId, undefined, ctl.signal);
        if (live) setState({ board: out?.board || null, err: "" });
      } catch (e) {
        if (live && e?.name !== "AbortError") setState((s) => ({ board: s.board, err: e.message || "" }));
      }
    };
    load();
    const t = setInterval(load, IDEAS_MS);
    const seen = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", seen);
    return () => {
      live = false; ctl.abort(); clearInterval(t);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [boardId]);
  return state;
}

function StatusDot({ status, compact = false }) {
  const st = STICKER_STATUS[status];
  if (!st) return null;
  return (
    <span title={st.label} aria-label={compact ? st.label : undefined}
      style={{ display: "inline-flex", alignItems: "flex-start", gap: 6 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: st.color,
        flex: "0 0 10px", marginTop: 3 }} />
      {!compact && st.label}
    </span>);
}

/* Таблица блока — идеи доски со статусом «подходит» или «применена». */
function IdeasTable({ boardId }) {
  const { board, err } = useBoardIdeas(boardId);
  const members = new Map((board?.members || []).map((m) => [String(m.id), m]));
  const rows = (board?.stickers || []).filter((s) => SHOWN.includes(s.status));

  /* Узкая таблица (блок на телефоне) — у статуса только точка его цвета,
     название — во всплывающей подсказке: иначе колонка идеи сжималась бы
     до слога в строке. */
  const box = useRef(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setCompact((el.clientWidth || 999) < 380);
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cell = { padding: compact ? "6px 4px" : "6px 8px", borderBottom: "1px solid var(--border-glass-soft)",
    verticalAlign: "top", textAlign: "left" };
  const head = { ...cell, fontSize: "var(--fs-hint)", color: C.muted, fontWeight: 600 };
  return (
    <div ref={box} style={{ minWidth: 0, overflowX: "auto" }}>
      <table aria-label="идеи блока" style={{ width: "100%", borderCollapse: "collapse",
        fontSize: "var(--fs-body)", lineHeight: "18px", color: C.text }}>
        <thead>
          <tr>
            <th style={head}>Идея</th>
            <th style={head}>Автор</th>
            <th style={{ ...head, width: compact ? 18 : undefined }}>{compact ? "" : "Статус"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const m = members.get(String(s.by));
            return (
              <tr key={s.id}>
                {/* Идея — главная колонка: не уже 55 % и переносится по словам,
                    а не по буквам; автор и статус — сколько останется. */}
                <td style={{ ...cell, width: "55%", minWidth: 110, whiteSpace: "pre-wrap",
                  overflowWrap: "break-word" }}>{raw(s.text || "—")}</td>
                <td style={{ ...cell, overflowWrap: "break-word" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2,
                      background: m?.color || "#6A7FB5" }} />
                    {raw(m?.name || "")}
                  </span>
                </td>
                <td style={{ ...cell, fontSize: "var(--fs-hint)" }}><StatusDot status={s.status} compact={compact} /></td>
              </tr>);
          })}
        </tbody>
      </table>
      {err && <div role="alert" style={{ fontSize: "var(--fs-hint)", color: "var(--chip-coral-text)",
        marginTop: 6 }}>{err}</div>}
    </div>);
}

/* ─────── выбор доски для блока (кроме перетаскивания) ─────── */
function BoardPicker({ anchor, boards, onPick, onClose }) {
  const box = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const W = 240;
  useEffect(() => {
    const r = anchor?.getBoundingClientRect?.();
    if (r) {
      const vw = window.innerWidth || 0;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, vw - W - 8)) });
    }
    const outside = (e) => {
      if (box.current?.contains(e.target) || anchor?.contains?.(e.target)) return;
      onClose();
    };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);
  const node = (
    <div ref={box} role="menu" aria-label="выбрать доску" data-noswipe=""
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 46, width: W, maxHeight: 320,
        overflowY: "auto", boxSizing: "border-box", background: "var(--bg-elevated)", color: C.text,
        border: "1px solid var(--border-glass)", borderRadius: "var(--radius-md)",
        boxShadow: "0 18px 40px rgba(0,0,0,.55)", padding: 6 }}>
      {boards.map((b) => (
        <button key={b.id} type="button" role="menuitem" onClick={() => onPick(b.id)}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 34,
            padding: "6px 8px", border: "none", borderRadius: "var(--radius-sm)",
            background: "transparent", color: C.text, textAlign: "left", cursor: "pointer",
            fontSize: "var(--fs-body)" }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, flex: "0 0 10px", borderRadius: "50%",
            background: b.color, boxShadow: "0 0 0 1.5px rgba(255,255,255,.6)" }} />
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{raw(b.name)}</span>
        </button>))}
    </div>);
  return createPortal(node, document.body);
}

/* ─────── блок ─────── */
function BlockCard({ block, board, boards, hasProcs, dropOn, onRename, onAddChild, onDelete,
  onAttach, onDetach, onOpenBoard, renderProcs }) {
  const [editing, setEditing] = useState(!block.name);
  const [name, setName] = useState(block.name);
  const [picking, setPicking] = useState(false);
  const pickBtn = useRef(null);
  useEffect(() => { setName(block.name); }, [block.name]);
  const save = () => {
    setEditing(false);
    const n = name.trim();
    if (n !== block.name) onRename(n);
  };
  const closePicker = useCallback(() => setPicking(false), []);
  return (
    <div data-block-id={block.id} aria-label={`блок: ${block.name || "без названия"}`}
      style={{ ...S.card, margin: 0, minWidth: 0, boxSizing: "border-box",
        outline: dropOn ? `2px solid ${ACC}` : "none", outlineOffset: 2,
        boxShadow: dropOn ? "0 0 0 6px rgba(73,225,255,.14)" : undefined,
        transition: "outline-color .12s ease, box-shadow .12s ease" }}>
      {/* шапка: название, доска, «+ блок», удалить */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {editing
          ? <input aria-label="название блока" value={name} maxLength={200} autoFocus
            onChange={(e) => setName(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { setName(block.name); setEditing(false); } }}
            style={{ ...S.inp, flex: "1 1 160px", minWidth: 0, boxSizing: "border-box" }} />
          : <button type="button" onClick={() => setEditing(true)} aria-label={`название блока: ${block.name}`}
            style={{ flex: "1 1 160px", minWidth: 0, textAlign: "left", background: "transparent", border: "none",
              padding: 0, cursor: "text", color: C.text, fontSize: "var(--fs-title)", lineHeight: "22px",
              fontWeight: 700, overflowWrap: "anywhere" }}>{raw(block.name || "—")}</button>}
        {board
          ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 0, maxWidth: "100%",
              borderRadius: "var(--radius-pill)", border: "1px solid rgba(255,255,255,.22)",
              background: board.color, color: TEXT_LIGHT, overflow: "hidden" }}>
              <button type="button" onClick={onOpenBoard} aria-label={`доска блока: ${board.name}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, border: "none",
                  background: "transparent", color: TEXT_LIGHT, cursor: "pointer", padding: "5px 6px 5px 10px",
                  fontSize: "var(--fs-hint)", fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h4v3H7zM13 9h4v3h-4z" /></svg>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: 180 }}>{raw(board.name)}</span>
              </button>
              <button type="button" aria-label="убрать доску из блока" onClick={onDetach}
                style={{ border: "none", borderLeft: "1px solid rgba(255,255,255,.22)", background: "transparent",
                  color: TEXT_LIGHT, cursor: "pointer", padding: "5px 8px", lineHeight: 0 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                  strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>)
          : (
            <button ref={pickBtn} type="button" aria-expanded={picking} disabled={!boards.length}
              onClick={() => setPicking((v) => !v)} style={{ ...btn(false, ACC) }}>+ доска</button>)}
        <button type="button" onClick={onAddChild} style={{ ...btn(false, OK) }}>+ блок</button>
        <button type="button" aria-label="удалить блок" onClick={onDelete}
          style={{ width: 30, height: 30, borderRadius: "var(--radius-pill)", flex: "0 0 auto", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            background: "var(--surface-glass)", border: "1px solid var(--border-glass)", color: BAD }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {picking && (
        <BoardPicker anchor={pickBtn.current} boards={boards} onClose={closePicker}
          onPick={(id) => { setPicking(false); onAttach(id); }} />)}
      {/* тело: слева таблица идей, справа техпроцессы блока */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <IdeasTable boardId={board ? block.boardId : null} />
        </div>
        <div data-block-procs={block.id} style={{ flex: "2 1 340px", minWidth: 0 }}
          aria-label={hasProcs ? "техпроцессы блока" : undefined}>
          {renderProcs(block.id)}
        </div>
      </div>
    </div>);
}

/* ─────── дерево: блок, под ним — его дети с линиями ─────── */
function Branch({ block, concepts, depth, render }) {
  const kids = childrenOf(concepts, block.id);
  return (
    <div role="treeitem" aria-level={depth + 1} aria-expanded={kids.length ? true : undefined}
      style={{ minWidth: 0 }}>
      {render(block)}
      {kids.length > 0 && (
        <div role="group" style={{ position: "relative", marginLeft: INDENT / 2, paddingLeft: INDENT,
          paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {kids.map((k, i) => (
            <div key={k.id} style={{ position: "relative", minWidth: 0 }}>
              {/* вертикаль от родителя — до этого ребёнка (у последнего — до его середины шапки) */}
              <span aria-hidden="true" style={{ position: "absolute", left: -INDENT, top: i ? -12 : -12,
                height: i === kids.length - 1 ? 38 : "calc(100% + 12px)", width: 2, background: LINE,
                borderRadius: 1 }} />
              <span aria-hidden="true" style={{ position: "absolute", left: -INDENT, top: 26, width: INDENT - 2,
                height: 2, background: LINE, borderRadius: 1 }} />
              <Branch block={k} concepts={concepts} depth={depth + 1} render={render} />
            </div>))}
        </div>)}
    </div>);
}

export default function ConceptsPanel({ concepts = [], setConcepts, procs = [], renderProcs,
  syncApplied = false }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(() => read(KEY_SEL));
  const [mode, setMode] = useState(() => (read(KEY_MODE) === "board" && read(KEY_SEL) ? "board" : "tree"));
  const [menuOpen, setMenuOpen] = useState(() => read(KEY_MENU) !== "shut");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [addErr, setAddErr] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef(null);
  const [modalBoard, setModalBoard] = useState(null);
  const [confirm, setConfirm] = useState(null);     // блок к удалению
  const [drag, setDrag] = useState(null);           // { id, name, color, x, y, over }
  const press = useRef(null);                       // нажатие на доску в меню

  useEffect(() => { write(KEY_SEL, sel); }, [sel]);
  useEffect(() => { write(KEY_MODE, mode); }, [mode]);
  useEffect(() => { write(KEY_MENU, menuOpen ? "" : "shut"); }, [menuOpen]);

  /* Доски появляются и из чата (инлайн-режим бота), поэтому список
     перечитывается раз в полминуты и при возврате на страницу. */
  const load = useCallback(async () => {
    try {
      const out = await listBoards();
      const boards = Array.isArray(out?.boards) ? out.boards : [];
      setList(boards);
      setErr("");
    } catch (e) {
      setErr(e.message);
      setList((l) => l || []);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const seen = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", seen);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", seen); };
  }, [load]);
  useEffect(() => { if (adding) input.current?.focus(); }, [adding]);

  const boards = useMemo(() => list || [], [list]);
  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  const openBoard = (id) => { setSel(id); setMode("board"); };

  const create = async () => {
    if (busyRef.current) return;
    const n = name.trim();
    if (!n) { setAddErr("Название доски не может быть пустым."); return; }
    busyRef.current = true;
    setBusy(true); setAddErr("");
    try {
      const out = await createBoard(n);
      const b = out?.board;
      if (b) {
        setList((l) => [b, ...(l || []).filter((x) => x.id !== b.id)]);
        openBoard(b.id);
      }
      setName(""); setAdding(false);
    } catch (e) {
      setAddErr(e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /* ═══ «у доски есть техпроцесс» — доске ═══
     Сообщаем только то, что разошлось с сервером, и один раз на значение:
     повтор того же не шлём, пока сервер не ответит иначе. */
  const applied = useMemo(() => appliedBoards(concepts, procs), [concepts, procs]);
  const sent = useRef(new Map());
  useEffect(() => {
    if (!syncApplied || !list) return;
    list.forEach((b) => {
      const want = applied.has(b.id);
      if (Boolean(b.applied) === want) { sent.current.delete(b.id); return; }
      if (sent.current.get(b.id) === want) return;
      sent.current.set(b.id, want);
      setBoardApplied(b.id, want)
        .then(() => setList((l) => (l || []).map((x) => (x.id === b.id ? { ...x, applied: want } : x))))
        .catch(() => { sent.current.delete(b.id); });
    });
  }, [applied, list, syncApplied]);

  /* ═══ правки блоков ═══ */
  const patchBlock = (id, patch) => setConcepts(concepts.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const addBlock = (parent = null) => setConcepts([...concepts,
    { id: newBlockId(), name: "", parent, boardId: null }]);
  const procsOf = (id) => procs.filter((p) => p.blockId === id);
  const askDelete = (b) => setConfirm(b);
  const doDelete = () => {
    const b = confirm;
    setConfirm(null);
    if (!b || procsOf(b.id).length) return;
    setConcepts(dropBlock(concepts, b.id));
  };

  /* ═══ перетаскивание доски из меню на блок ═══
     Мышь — как только сдвинули; палец — после долгого нажатия: иначе
     список нельзя было бы прокрутить. Пока тянем — страница не
     прокручивается, блок под пальцем подсвечен. Отпустили на блоке —
     доска в нём; отпустили мимо — ничего. Нажали и отпустили — открыть
     доску. */
  const overBlock = (x, y) => {
    const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
    return el?.closest?.("[data-block-id]")?.getAttribute("data-block-id") || null;
  };
  const endPress = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    press.current = null;
  };
  const onItemDown = (e, b) => {
    if (e.button != null && e.button !== 0) return;
    const p = { id: b.id, name: b.name, color: b.color, x: e.clientX, y: e.clientY,
      touch: e.pointerType === "touch", dragging: false, timer: null };
    if (p.touch) {
      p.timer = setTimeout(() => {
        if (press.current !== p) return;
        p.dragging = true;
        setDrag({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, over: null });
        try { navigator.vibrate?.(12); } catch { /* нет вибро — не беда */ }
      }, LONG_PRESS_MS);
    }
    press.current = p;
  };
  useEffect(() => {
    const move = (e) => {
      const p = press.current;
      if (!p) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_PX;
      if (!p.dragging) {
        if (!far) return;
        if (p.touch) { endPress(); return; }       // палец поехал до долгого нажатия — это прокрутка
        p.dragging = true;
      }
      setDrag({ id: p.id, name: p.name, color: p.color, x: e.clientX, y: e.clientY,
        over: overBlock(e.clientX, e.clientY) });
    };
    const up = (e) => {
      const p = press.current;
      if (!p) return;
      endPress();
      if (p.dragging) {
        const target = overBlock(e.clientX, e.clientY);
        setDrag(null);
        if (target) setConcepts((cur) => (Array.isArray(cur) ? cur : concepts)
          .map((b) => (b.id === target ? { ...b, boardId: p.id } : b)));
        return;
      }
      openBoard(p.id);
    };
    const cancel = () => { endPress(); setDrag(null); };
    // Пока тянем пальцем — страница стоит: иначе браузер начал бы прокрутку.
    const hold = (e) => { if (press.current?.dragging) e.preventDefault(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    document.addEventListener("touchmove", hold, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("touchmove", hold);
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  /* ═══ меню досок ═══ */
  const menu = (
    <nav aria-label="доски" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" aria-expanded={adding}
        onClick={() => { setAdding((v) => !v); setAddErr(""); }}
        style={{ ...btn(true, OK), width: "100%" }}>+ новая</button>
      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input ref={input} aria-label="название доски" value={name} maxLength={120}
            onChange={(e) => { setName(e.target.value); setAddErr(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); create(); }
              if (e.key === "Escape") { setAdding(false); setAddErr(""); }
            }}
            style={{ ...S.inp, boxSizing: "border-box", background: "rgba(0,0,0,.28)" }} />
          <button type="button" disabled={busy} onClick={create}
            style={{ ...btn(true, OK), width: "100%", opacity: busy ? 0.6 : 1 }}>Создать</button>
          {addErr && <div role="alert" style={{ fontSize: "var(--fs-hint)", lineHeight: "15px",
            color: "var(--chip-coral-text)" }}>{addErr}</div>}
        </div>)}
      {err && <div role="alert" style={{ fontSize: "var(--fs-hint)", lineHeight: "15px",
        color: "var(--chip-coral-text)" }}>{err}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
        {boards.map((b) => {
          const on = mode === "board" && b.id === sel;
          return (
            <button key={b.id} type="button" aria-current={on ? "true" : undefined}
              aria-label={`доска: ${b.name}`} data-board-item={b.id}
              onPointerDown={(e) => onItemDown(e, b)}
              onClick={(e) => { if (e.detail === 0) openBoard(b.id); }}
              onContextMenu={(e) => e.preventDefault()}
              style={{ display: "flex", alignItems: "flex-start", gap: 6, width: "100%",
                textAlign: "left", cursor: "grab", boxSizing: "border-box",
                padding: "6px 6px", borderRadius: "var(--radius-sm)", userSelect: "none",
                WebkitUserSelect: "none", WebkitTouchCallout: "none",
                background: on ? "rgba(255,255,255,.13)" : "transparent",
                border: `1px solid ${on ? "rgba(255,255,255,.28)" : "transparent"}`,
                color: TEXT_LIGHT, fontSize: "var(--fs-body)", lineHeight: "17px", fontWeight: 500,
                opacity: drag?.id === b.id ? 0.45 : 1,
                transition: "background .15s ease, border-color .15s ease" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, flex: "0 0 10px", marginTop: 4,
                borderRadius: "50%", background: b.color, boxShadow: "0 0 0 1.5px rgba(255,255,255,.6)" }} />
              <span style={{ minWidth: 0, overflowWrap: "break-word", hyphens: "auto",
                WebkitHyphens: "auto" }}>{raw(b.name)}</span>
            </button>);
        })}
      </div>
    </nav>);

  const roots = childrenOf(concepts, null);
  const renderBlock = (b) => (
    <BlockCard block={b} board={b.boardId ? boardById.get(b.boardId) || null : null} boards={boards}
      hasProcs={procsOf(b.id).length > 0} dropOn={drag?.over === b.id}
      onRename={(n) => patchBlock(b.id, { name: n })}
      onAddChild={() => addBlock(b.id)}
      onDelete={() => askDelete(b)}
      onAttach={(id) => patchBlock(b.id, { boardId: id })}
      onDetach={() => patchBlock(b.id, { boardId: null })}
      onOpenBoard={() => setModalBoard(b.boardId)}
      renderProcs={renderProcs} />);

  const tree = (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => addBlock(null)} style={{ ...btn(true, OK) }}>+ блок</button>
      </div>
      <div role="tree" aria-label="блоки" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {roots.map((b) => (
          <Branch key={b.id} block={b} concepts={concepts} depth={0} render={renderBlock} />))}
      </div>
    </div>);

  const boardPane = (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={() => setMode("tree")} style={{ ...btn(true, ACC) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" aria-hidden="true" style={{ marginRight: 6, verticalAlign: "-2px" }}>
            <rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" />
            <rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" />
          </svg>
          Блок-схема</button>
      </div>
      <BoardView boardId={sel || null} />
    </div>);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
      {/* Меню досок — слева; на узком экране его можно свернуть в полоску. */}
      <aside aria-label="меню досок" style={{ flex: menuOpen ? "0 0 clamp(112px, 26%, 172px)" : "0 0 34px",
        minWidth: 0, position: "sticky", top: 8, display: "flex", flexDirection: "column", gap: 6,
        ...S.card, margin: 0, padding: menuOpen ? 10 : 4, boxSizing: "border-box",
        transition: "flex-basis .2s ease" }}>
        <button type="button" aria-label={menuOpen ? "свернуть меню досок" : "развернуть меню досок"}
          aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}
          style={{ alignSelf: menuOpen ? "flex-end" : "center", width: 24, height: 24, padding: 0,
            border: "none", borderRadius: 6, background: "transparent", color: C.muted, cursor: "pointer",
            lineHeight: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={menuOpen ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
          </svg>
        </button>
        {menuOpen && menu}
      </aside>
      <section style={{ flex: "1 1 auto", minWidth: 0 }}>
        {mode === "board" && sel && boardById.has(sel) ? boardPane : tree}
      </section>

      {drag && createPortal(
        <div aria-hidden="true" style={{ position: "fixed", left: drag.x + 12, top: drag.y + 12, zIndex: 60,
          pointerEvents: "none", display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
          borderRadius: "var(--radius-pill)", background: drag.color, color: inkOn(drag.color),
          border: "1px solid rgba(255,255,255,.5)", boxShadow: "0 12px 28px rgba(0,0,0,.5)",
          fontSize: "var(--fs-body)", fontWeight: 600, maxWidth: 220, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis" }}>{raw(drag.name)}</div>, document.body)}

      {modalBoard && (
        <Modal wide title={boardById.get(modalBoard)?.name || "Доска"} onClose={() => setModalBoard(null)}>
          <BoardView boardId={modalBoard} only={SHOWN} readOnly />
        </Modal>)}

      {confirm && (
        <Modal title="Удалить блок?" onClose={() => setConfirm(null)}>
          {procsOf(confirm.id).length
            ? "Сначала удалите техпроцессы блока."
            : `Блок «${confirm.name || "без названия"}» будет удалён. Вложенные блоки встанут на его место.`}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-12)", marginTop: "var(--space-16)" }}>
            {!procsOf(confirm.id).length && (
              <button type="button" style={{ ...btn(true, BAD), flex: "1 1 120px" }} onClick={doDelete}>
                Согласиться</button>)}
            <button type="button" style={{ ...btn(false), flex: "1 1 120px" }}
              onClick={() => setConfirm(null)}>Отменить</button>
          </div>
        </Modal>)}
    </div>);
}
