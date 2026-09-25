import React, { useCallback, useEffect, useRef, useState } from "react";
import { OK, S, btn } from "./ui.jsx";
import BoardView from "./BoardView.jsx";
import { createBoard, listBoards } from "../boards.js";

/* ════════════════════════════════════════════════════════════════
   ВКЛАДКА «БРЕЙНШТОРМ» (владелец, 2026-09-25)

   «При нажатии я должен видеть те же самые доски со стикерами, но слева
   под участниками у меня должно быть меню доски, в котором я должен
   списком видеть все созданные доски и кнопку "+ новая" над ними.»

   Доска — та же, что в мини-приложении из чата (BoardView), меню — её
   левая колонка. Список — доски текущего хранилища; черновики, заведённые
   инлайн-запросом и ни разу не открытые, сервер не отдаёт. Выбранная
   доска помнится в сеансе вкладки: вернулся на вкладку — она же.
   ════════════════════════════════════════════════════════════════ */

const KEY = "sd_board_sel";
const REFRESH_MS = 30000;
const TEXT_LIGHT = "#F4F7F8";
const raw = (s) => React.createElement(React.Fragment, null, s);

const kept = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
const keep = (id) => {
  try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); }
  catch { /* приватный режим — просто не запомним */ }
};

export default function BrainstormPanel() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(kept);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [addErr, setAddErr] = useState("");
  const [busy, setBusy] = useState(false);
  /* Создание в пути — второе не начинается: двойной Enter, двойное нажатие
     «Готово» на телефоне или автоповтор клавиши иначе завели бы две доски
     с одним именем, а удалить доску нельзя. Состояние `busy` — лишь вид
     кнопки: оно меняется со следующим рендером, а ref — сразу. */
  const busyRef = useRef(false);
  const input = useRef(null);

  const pick = useCallback((id) => setSel(id), []);
  useEffect(() => { keep(sel); }, [sel]);

  /* Доски появляются и из чата (инлайн-режим бота), поэтому список
     перечитывается раз в полминуты и при возврате на страницу. */
  const load = useCallback(async () => {
    try {
      const out = await listBoards();
      const boards = Array.isArray(out?.boards) ? out.boards : [];
      setList(boards);
      setErr("");
      setSel((cur) => (boards.some((b) => b.id === cur) ? cur : (boards[0]?.id || "")));
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
        pick(b.id);
      }
      setName(""); setAdding(false);
    } catch (e) {
      setAddErr(e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

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
            style={{ ...btn(true, OK), width: "100%", opacity: busy ? 0.6 : 1 }}>
            Создать</button>
          {addErr && <div role="alert" style={{ fontSize: "var(--fs-hint)", lineHeight: "15px",
            color: "var(--chip-coral-text)" }}>{addErr}</div>}
        </div>)}
      {err && <div role="alert" style={{ fontSize: "var(--fs-hint)", lineHeight: "15px",
        color: "var(--chip-coral-text)" }}>{err}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
        {(list || []).map((b) => {
          const on = b.id === sel;
          return (
            <button key={b.id} type="button" aria-current={on ? "true" : undefined}
              aria-label={`доска: ${b.name}`} onClick={() => pick(b.id)}
              style={{ display: "flex", alignItems: "flex-start", gap: 6, width: "100%",
                textAlign: "left", cursor: "pointer", boxSizing: "border-box",
                padding: "6px 6px", borderRadius: "var(--radius-sm)",
                background: on ? "rgba(255,255,255,.13)" : "transparent",
                border: `1px solid ${on ? "rgba(255,255,255,.28)" : "transparent"}`,
                color: TEXT_LIGHT, fontSize: "var(--fs-body)", lineHeight: "17px",
                /* Выбранная — подложкой, а не жирным: жирное шире, и в узкой
                   колонке длинное слово рвалось бы посередине. */
                fontWeight: 500, transition: "background .15s ease, border-color .15s ease" }}>
              {/* Точка цвета доски; светлое кольцо — потому что сами цвета
                  досок тёмные и на тёмном фоне без него пропадают. */}
              <span aria-hidden="true" style={{ width: 10, height: 10, flex: "0 0 10px", marginTop: 4,
                borderRadius: "50%", background: b.color,
                boxShadow: "0 0 0 1.5px rgba(255,255,255,.6)" }} />
              {/* Перенос — по слогам, а не посреди слова: колонка узкая. */}
              <span style={{ minWidth: 0, overflowWrap: "break-word", hyphens: "auto",
                WebkitHyphens: "auto" }}>{raw(b.name)}</span>
            </button>);
        })}
      </div>
    </nav>);

  return <BoardView boardId={sel || null} side={menu} />;
}
