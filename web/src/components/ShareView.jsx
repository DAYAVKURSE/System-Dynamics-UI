import React, { useEffect, useState } from "react";
import { C, OK, WARN, ACC, S, nm } from "./ui.jsx";
import { getShare } from "../identity.js";
import { reportSrc } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   СТРАНИЦА ПО ССЫЛКЕ · что сделано по заданию

   Сюда приходит тот, кому показали работу: заказчик, смежник, кто угодно.
   У него нет аккаунта, его не звали в модель, и требовать этого от него
   значило бы не показать работу, а попросить его завести отношения ради
   одного взгляда.

   Поэтому здесь нет ни вкладок, ни правки, ни модели: только снимок блока —
   задание, разделы и то, что по ним сделано. Всё, что не выбрано владельцем
   в этом блоке, сюда не попадает вовсе — не спрятано, а именно не попадает
   (см. server/src/lib/shareStore.js).
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function Result({ r }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "7px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>{r.title}</span>
        {!!r.trait && (
          <span style={{ fontSize: 11, color: OK }}>
            {r.qty >= 0 ? "+" : "−"}{nm(Math.abs(r.qty))} {r.trait}</span>)}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.6 }}>
        {fmtDT(r.at)}{r.by ? ` · ${r.by}` : ""}{r.func ? ` · ${r.func}` : ""}
        {r.hours ? ` · ${nm(r.hours)} ч` : ""}
      </div>
      {r.text && (
        <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.55,
          whiteSpace: "pre-wrap" }}>{r.text}</div>)}
      {r.file && (/^image\//.test(r.file.type || "")
        ? <img src={reportSrc(r.file)} alt={r.file.name}
            style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6,
              border: `1px solid ${C.line}` }} />
        : <a href={reportSrc(r.file)} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: ACC, display: "inline-block", marginTop: 5 }}>
            📎 {r.file.name}</a>)}
    </div>);
}

/** Блок и его разделы — теми же вложенными блоками, что и в самой карте. */
function Block({ block, depth = 0 }) {
  return (
    <div style={{ ...S.card, marginBottom: 10, marginLeft: depth ? 8 : 0,
      borderLeft: depth ? `2px solid ${C.line}` : undefined }}>
      <div style={{ fontSize: depth ? 13 : 15, fontWeight: 700 }}>
        {block.name || "без названия"}</div>
      {block.brief && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5, lineHeight: 1.6,
          whiteSpace: "pre-wrap" }}>{block.brief}</div>)}

      {!block.results?.length && !block.sections?.length && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
          Здесь пока ничего не сделано.</div>)}

      {!!block.results?.length && (
        <div style={{ marginTop: 6 }}>
          {block.results.map((r, i) => (<Result key={`${r.title}-${r.at}-${i}`} r={r} />))}
        </div>)}

      {(block.sections || []).map((s, i) => (
        <Block key={`${s.name}-${i}`} block={s} depth={depth + 1} />))}
    </div>);
}

export default function ShareView({ token }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let live = true;
    getShare(token)
      .then((d) => { if (live) setState({ data: d }); })
      .catch((e) => { if (live) setState({ error: e.message || "не открылось" }); });
    return () => { live = false; };
  }, [token]);

  return (
    <div style={{ background: C.ink, color: C.text, minHeight: "100vh",
      padding: 12, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {state.loading && (
          <div style={{ ...S.card, fontSize: 12, color: C.muted }}>Открываю…</div>)}

        {state.error && (
          <div style={{ ...S.card, fontSize: 12, color: WARN, lineHeight: 1.6 }}>
            {state.error}. Возможно, ссылку отозвали: доступ по ней
            прекращается сразу, как её убрали.
          </div>)}

        {state.data && (<>
          <div style={{ ...S.card, marginBottom: 10 }}>
            <div style={S.lbl}>что сделано</div>
            {!!state.data.snapshot?.path?.length && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>
                {state.data.snapshot.path.join(" → ")}</div>)}
            {state.data.snapshot?.brief && (
              <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
                <span style={{ color: C.muted }}>задание «{state.data.snapshot.brief.name}»: </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{state.data.snapshot.brief.text}</span>
              </div>)}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              Снимок на {fmtDT(state.data.snapshot?.at)}. Показано только то,
              что выбрано в этом блоке; принятые работы — и ничего больше.
            </div>
          </div>
          <Block block={state.data.snapshot.block} />
        </>)}
      </div>
    </div>);
}

/** Какую ссылку просят открыть — из адреса страницы. */
export function shareFromLocation(search = typeof window === "undefined"
  ? "" : window.location.search) {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const t = q.get("share") || "";
  return /^[a-f0-9]{64}$/.test(t) ? t : null;
}
