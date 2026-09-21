import React, { useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn } from "./ui.jsx";

/* ════════════════════════════════════════════════════════════════
   УЧАСТНИКИ БЕЗ АКТИВА · подложка над схемой

   Человек вступил в модель, подписал договор, получил роль — и не попал
   ни в один актив. Работы у него при этом нет вовсе: задачи живут у
   функций, функции — у активов, и воркер, не отмеченный нигде, просто
   ждёт, пока о нём вспомнят. Заметить это можно было только обойдя все
   активы по очереди.

   Поэтому подложка: она появляется, КОГДА такие люди есть, и исчезает,
   когда не осталось ни одного. Пустой блок «участников без актива: 0» —
   это мебель, и её здесь нет.

   Нажатие раскрывает облако: по мини-блоку на человека, в блоке имя и
   роли. Оттуда его ПЕРЕТАСКИВАЮТ на нужный актив — это тот же жест,
   которым на схеме двигают сами активы, и он работает пальцем: HTML5
   drag-and-drop на телефоне не работает вовсе, поэтому здесь указатель
   (`pointer*`), как и у перетаскивания блоков.

   Роль решает, куда можно. Актив берёт человека, только если хоть одна
   его роль названа у какой-нибудь функции этого актива: иначе работы
   для него там нет, и отметка в воркерах была бы обещанием, которого
   актив не выполнит. Не сходится — говорим словами, что именно не
   сошлось, а не отменяем жест молча.
   ════════════════════════════════════════════════════════════════ */

/** Роли, которые актив вообще спрашивает: названные у его функций. */
export function rolesOfAsset(funcs = [], entityId) {
  const out = new Set();
  funcs.filter((f) => f && f.e === entityId).forEach((f) => {
    const posts = f.posts && typeof f.posts === "object" ? f.posts : {};
    ["setters", "owners", "reviewers"].forEach((k) => {
      (Array.isArray(posts[k]) ? posts[k] : []).forEach((r) => {
        if (r) out.add(String(r));
      });
    });
  });
  return [...out];
}

/** Кто в модели есть, но ни в одном активе не отмечен. */
export function looseOf(people = [], entities = []) {
  const inAsset = new Set();
  entities.forEach((e) => {
    ["crew", "setters", "owners", "reviewers"].forEach((k) => {
      (Array.isArray(e?.[k]) ? e[k] : []).forEach((id) => {
        if (id != null && id !== "") inAsset.add(String(id));
      });
    });
  });
  return people.filter((p) => (p.roles || []).length && !inAsset.has(String(p.id)));
}

export default function LooseCrew({ people = [], entities = [], funcs = [],
  roleName = (id) => String(id), onAdd, onOpen }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(null);    // {id, name, x, y} — кого ведут
  const held = useRef(null);

  const loose = looseOf(people, entities);
  // Никого без актива — подложки нет: пустой блок это мебель.
  useEffect(() => { if (!loose.length) { setOpen(false); setMsg(""); } }, [loose.length]);

  useEffect(() => {
    if (!held.current) return undefined;
    const move = (ev) => {
      const h = held.current;
      if (!h) return;
      if (Math.hypot(ev.clientX - h.sx, ev.clientY - h.sy) >= 6) h.moved = true;
      setDrag((p) => (p ? { ...p, x: ev.clientX, y: ev.clientY } : p));
    };
    const up = (ev) => {
      const d = held.current;
      if (!d) return;
      held.current = null;
      setDrag(null);
      /* Отпустили, не сдвинув, — это нажатие: открываем страницу человека
         окном (2026-09-13), как у воркера в карточке актива. */
      if (!d.moved) { setMsg(""); onOpen?.(d.id); return; }
      /* Куда отпустили: у блока актива на схеме стоит `data-entity`, и
         спрашиваем мы именно то, что под пальцем, — не ближайший блок и
         не последний, над которым проходили. */
      const el = document.elementFromPoint?.(ev.clientX, ev.clientY);
      const box = el && el.closest ? el.closest("[data-entity]") : null;
      const eid = box?.getAttribute("data-entity") || "";
      if (!eid) { setMsg(""); return; }
      const ent = entities.find((e) => e.id === eid);
      const want = rolesOfAsset(funcs, eid);
      const mine = (d.roles || []).map(String);
      const fit = mine.filter((r) => want.includes(r));
      if (!fit.length) {
        setMsg(want.length
          ? `«${ent?.name || "актив"}» спрашивает роли: ${want.map(roleName).join(", ")}. `
            + `У ${d.name} их нет — ${mine.map(roleName).join(", ") || "ролей нет"}.`
          : `У «${ent?.name || "актив"}» ни одна функция не называет роль — `
            + "работы для этого человека там пока нет.");
        return;
      }
      setMsg("");
      onAdd?.(d.id, eid);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag?.id, entities, funcs, onAdd, onOpen, roleName]);

  const grab = (ev, p) => {
    held.current = { id: String(p.id), name: p.name || String(p.id), roles: p.roles || [],
      sx: ev.clientX, sy: ev.clientY, moved: false };
    setDrag({ id: String(p.id), name: p.name || String(p.id),
      x: ev.clientX, y: ev.clientY });
    setMsg("");
  };

  if (!loose.length) return null;
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)", borderColor: WARN,
      /* Подложка по ширине своего текста, рамка в 2–3 мм от него, а не
         форма на всю ширину (владелец, 2026-09-21). */
      width: "fit-content", maxWidth: "100%", padding: "10px" }}>
      <button style={{ background: "none", border: "none", padding: 0, width: "100%",
        textAlign: "left", cursor: "pointer", color: C.text }}
        aria-label={`не добавленные участники: ${loose.length}`}
        onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2" style={{ whiteSpace: "nowrap" }}>
          <span style={{ ...S.lbl, color: WARN }}>не добавленные участники</span>
          <span style={{ fontSize: "var(--fs-body)", fontWeight: 700 }}>{loose.length}</span>
          <span style={{ fontSize: "var(--fs-hint)", color: C.muted, marginLeft: "var(--space-4)" }}>{open ? "свернуть" : "показать"}</span>
        </div>
      </button>
      {open && (<>
        <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)", maxWidth: 320 }}>
          {loose.map((p) => (
            <div key={p.id} role="button" tabIndex={0}
              aria-label={`не добавленный участник: ${p.name}`}
              data-person={String(p.id)}
              onPointerDown={(ev) => grab(ev, p)}
              onKeyDown={(ev) => { if (ev.key === "Enter") onOpen?.(String(p.id)); }}
              style={{ background: C.panel2, border: `1px solid ${C.line}`,
                borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)", cursor: "grab", touchAction: "none",
                opacity: drag?.id === String(p.id) ? 0.4 : 1 }}>
              <div style={{ fontSize: "var(--fs-hint)", fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: "var(--fs-hint)", color: ACC }}>
                {(p.roles || []).map(roleName).filter(Boolean).join(", ") || "без роли"}</div>
            </div>))}
        </div>
      </>)}
      {msg && (
        <div style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-8)", lineHeight: 1.5 }}>{msg}</div>)}
      {/* Пока ведут — под пальцем едет сам человек: без этого жест
          выглядит как ничего не происходящее нажатие. */}
      {drag && (
        <div style={{ position: "fixed", left: drag.x + 8, top: drag.y + 8, zIndex: 50,
          pointerEvents: "none", background: C.panel, border: `1px solid ${ACC}`,
          borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)", fontSize: "var(--fs-hint)", color: C.text }}>
          {drag.name}</div>)}
    </div>);
}
