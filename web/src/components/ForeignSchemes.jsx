import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C, OK, S, btn } from "./ui.jsx";
import { getWorkspaceIn } from "../identity.js";
import { transfers } from "../lib/plan.js";

/* ════════════════════════════════════════════════════════════════
   ЧУЖИЕ СХЕМЫ · плакарды в окне схемы (владелец, 2026-09-21)

   «Если у пользователя есть доступ к схемам других пользователей, в
   окне схемы он видит и их — на специальных больших плакардах с именем
   владельца в заголовке; справа в заголовке кнопка «свернуть»; свёрнутые
   полосы схем остаются внизу окна схемы с кнопкой «развернуть»».

   Чужая схема — срез, который сервер даёт участнику: его активы,
   функции и ресурсы. Она только показывается: правят её у владельца.
   Свёрнутость помнится на этом устройстве.
   ════════════════════════════════════════════════════════════════ */
const KEY = "sd_foreign_closed";
const readClosed = () => {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
};
const keepClosed = (set) => {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* приватный режим */ }
};

/** Чужие хранилища с их схемами; что свёрнуто — и как переключить. */
export function useForeignSchemes(me, { normalize } = {}) {
  const foreign = useMemo(() => (me?.solo ? [] : (me?.storages || []).filter((s) => !s.own)), [me]);
  const [models, setModels] = useState({});
  const [closed, setClosed] = useState(readClosed);
  useEffect(() => {
    let live = true;
    foreign.forEach((s) => {
      getWorkspaceIn(s.id).then((w) => {
        if (!live) return;
        setModels((m) => ({ ...m, [s.id]: normalize ? normalize(w) : w }));
      }).catch(() => {});
    });
    return () => { live = false; };
  }, [foreign, normalize]);
  const toggle = useCallback((id) => setClosed((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    keepClosed(next);
    return next;
  }), []);
  const items = foreign.map((s) => ({ ...s, model: models[s.id] || null, closed: closed.has(s.id) }));
  return { open: items.filter((x) => !x.closed), closed: items.filter((x) => x.closed), toggle };
}

const none = () => {};
const zero = () => ({ lo: 0, hi: 0, fact: null });

/* Плакард: имя владельца, «свернуть» справа, схема под ними. */
export function ForeignPlacards({ items, Scheme, onToggle }) {
  if (!items.length) return null;
  return items.map((s) => {
    const m = s.model || {};
    const moves = m.funcs ? transfers({ funcs: m.funcs, traits: m.traits || [], procs: m.procs || [],
      hypoOn: false }) : [];
    return (
      <div key={s.id} style={{ ...S.card, marginTop: "var(--space-8)" }}
        aria-label={`схема ${s.owner || s.id}`}>
        <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-8)" }}>
          <span style={{ fontSize: "var(--fs-title)", fontWeight: 700, flex: 1 }}>{s.owner || s.id}</span>
          <button type="button" style={btn(false)} onClick={() => onToggle(s.id)}>свернуть</button>
        </div>
        {m.entities ? (
          <Scheme entities={m.entities} traits={m.traits || []} funcs={m.funcs || []} moves={moves}
            sel={null} valuesFor={zero} onSelectEntity={none} onMoveEntity={none}
            assetOk={() => true} onWhy={none} onOpenFunc={none} />
        ) : <div style={{ color: C.muted }}>Загружаю…</div>}
      </div>);
  });
}

/* Полосы свёрнутых — внизу окна схемы. */
export function ForeignStrips({ items, onToggle }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: "var(--space-8)" }} aria-label="свёрнутые схемы">
      {items.map((s) => (
        <div key={s.id} className="flex items-center gap-2"
          style={{ ...S.card, padding: "var(--space-8) var(--inset)", marginTop: "var(--space-4)" }}
          aria-label={`схема ${s.owner || s.id}`}>
          <span style={{ fontSize: "var(--fs-body)", fontWeight: 700, flex: 1 }}>{s.owner || s.id}</span>
          <button type="button" style={btn(true, OK)} onClick={() => onToggle(s.id)}>развернуть</button>
        </div>))}
    </div>);
}
