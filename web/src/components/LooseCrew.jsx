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
  roleName = (id) => String(id), onAdd }) {
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
      if (!held.current) return;
      setDrag((p) => (p ? { ...p, x: ev.clientX, y: ev.clientY } : p));
    };
    const up = (ev) => {
      const d = held.current;
      if (!d) return;
      held.current = null;
      setDrag(null);
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
  }, [drag?.id, entities, funcs, onAdd, roleName]);

  const grab = (ev, p) => {
    held.current = { id: String(p.id), name: p.name || String(p.id), roles: p.roles || [] };
    setDrag({ id: String(p.id), name: p.name || String(p.id),
      x: ev.clientX, y: ev.clientY });
    setMsg("");
  };

  if (!loose.length) return null;
  return (
    <div style={{ ...S.card, marginBottom: 10, borderColor: WARN }}>
      <button style={{ background: "none", border: "none", padding: 0, width: "100%",
        textAlign: "left", cursor: "pointer", color: C.text }}
        aria-label={`участники без актива: ${loose.length}`}
        onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          <span style={{ ...S.lbl, color: WARN }}>участники без актива</span>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{loose.length}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.muted }}>{open ? "свернуть" : "показать"}</span>
        </div>
      </button>
      {open && (<>
        <div style={{ fontSize: 10.5, color: C.muted, margin: "6px 0", lineHeight: 1.5 }}>
          Перетащите человека на актив. Возьмёт тот актив, у которого есть
          функция с его ролью.
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
          {loose.map((p) => (
            <div key={p.id} role="button" tabIndex={0}
              aria-label={`участник без актива: ${p.name}`}
              data-person={String(p.id)}
              onPointerDown={(ev) => grab(ev, p)}
              style={{ background: C.panel2, border: `1px solid ${C.line}`,
                borderRadius: 8, padding: "5px 8px", cursor: "grab", touchAction: "none",
                opacity: drag?.id === String(p.id) ? 0.4 : 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: ACC }}>
                {(p.roles || []).map(roleName).filter(Boolean).join(", ") || "без роли"}</div>
            </div>))}
        </div>
      </>)}
      {msg && (
        <div style={{ fontSize: 11, color: BAD, marginTop: 8, lineHeight: 1.5 }}>{msg}</div>)}
      {/* Пока ведут — под пальцем едет сам человек: без этого жест
          выглядит как ничего не происходящее нажатие. */}
      {drag && (
        <div style={{ position: "fixed", left: drag.x + 8, top: drag.y + 8, zIndex: 50,
          pointerEvents: "none", background: C.panel, border: `1px solid ${ACC}`,
          borderRadius: 8, padding: "4px 8px", fontSize: 11.5, color: C.text }}>
          {drag.name}</div>)}
    </div>);
}
