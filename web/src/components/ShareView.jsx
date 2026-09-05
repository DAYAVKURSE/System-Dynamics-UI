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

/** Одна созданная вещь: номер, что это, кто и когда сделал. */
function Made({ r }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "7px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        {/* Номер — то же самое, что и внутри: заказчик и исполнитель должны
            звать вещь одинаково. */}
        {r.no != null && (
          <span style={{ fontSize: 11, color: ACC, fontWeight: 700 }}>№{r.no}</span>)}
        <span style={{ fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>{r.title}</span>
        {!!r.trait && (
          <span style={{ fontSize: 11, color: OK }}>{nm(r.qty)} {r.trait}</span>)}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.6 }}>
        {fmtDT(r.at)}{r.by ? ` · ${r.by}` : ""}
      </div>
      {r.file && (/^image\//.test(r.file.type || "")
        ? <img src={reportSrc(r.file)} alt={r.file.name}
            style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6,
              border: `1px solid ${C.line}` }} />
        : <a href={reportSrc(r.file)} target="_blank" rel="noreferrer"
            style={{ fontSize: 10.5, color: ACC, display: "inline-block", marginTop: 4 }}>
            📎 {r.file.name}</a>)}
    </div>);
}

/* Блок и его разделы — теми же вложенными блоками, что и в самой карте, и с
   теми же четырьмя частями: оценка, шаги, созданное, факт. Заказчик должен
   видеть ровно то, что видит владелец, — иначе разговор пойдёт про разное. */
function Block({ block, depth = 0 }) {
  const plan = block.plan || { workHours: [0, 0], calendarHours: [0, 0], steps: [] };
  const act = block.actual || { done: 0, total: 0, hours: 0 };
  const changes = block.changes || [];
  return (
    <div style={{ ...S.card, marginBottom: 10, marginLeft: depth ? 8 : 0,
      borderLeft: depth ? `2px solid ${C.line}` : undefined }}>
      <div style={{ fontSize: depth ? 13 : 15, fontWeight: 700 }}>
        {block.name || "без названия"}</div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
        {block.from ? `с ресурса «${block.from}»` : "ресурс не выбран"}
        {block.upto ? ` · до звена «${block.upto}»` : " · до конца цепочки"}
      </div>
      {block.file && (
        <a href={reportSrc(block.file)} target="_blank" rel="noreferrer"
          style={{ fontSize: 10.5, color: ACC, display: "inline-block", marginTop: 4 }}>
          📎 {block.file.name}</a>)}
      {block.broken && (
        <div style={{ fontSize: 11, color: WARN, marginTop: 5, lineHeight: 1.5 }}>
          До этого звена цепочка не доходит: между ним и ресурсом разрыв.</div>)}
      {/* Вещь ещё не заведена: это прогноз, а не отчёт о сделанном. Сказать
          это надо прямо — иначе пустые «созданные ресурсы» и «факта нет»
          читаются как «работа встала», а работы и не начиналось. */}
      {block.hypothetical && !!block.from && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          Это прогноз: прослеживается вещь, которой ещё нет в системе, — что
          произойдёт, если её завести. Работы по ней пока не было.</div>)}

      {!!plan.steps.length && (<>
        <div style={{ ...S.lbl, marginTop: 8 }}>предварительная оценка</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
          работы {nm(plan.workHours[0])}–{nm(plan.workHours[1])} ч ·
          шагов {plan.steps.length}
        </div>
        {changes.map((c) => (
          <div key={c.trait} className="flex flex-wrap gap-2"
            style={{ alignItems: "center", fontSize: 11, marginTop: 3 }}>
            <span style={{ flex: "1 1 110px" }}>{c.trait}</span>
            <span style={{ color: WARN }}>
              план {nm(Math.min(c.lo, c.hi))}…{nm(Math.max(c.lo, c.hi))}</span>
            {c.fact != null && <span style={{ color: OK }}>факт {nm(c.fact)}</span>}
          </div>))}

        <div style={{ ...S.lbl, marginTop: 8 }}>шаги</div>
        {plan.steps.map((s2, i) => (
          <div key={`${s2.name}-${i}`} style={{ fontSize: 11, color: C.muted,
            marginTop: 3, lineHeight: 1.5 }}>
            {i + 1}. {s2.name}{s2.factor ? " · фактор" : ""} — выполнений {nm(s2.runs)}
          </div>))}
      </>)}

      <div style={{ ...S.lbl, marginTop: 8 }}>созданные ресурсы</div>
      {!(block.made || []).length
        ? <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
            {block.hypothetical
              ? "Ничего и не могло появиться: вещь пока гипотетическая."
              : "Здесь пока ничего не создано."}</div>
        : block.made.map((r, i) => (<Made key={`${r.title}-${r.at}-${i}`} r={r} />))}

      <div style={{ ...S.lbl, marginTop: 8 }}>фактическая оценка</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
        {act.done
          ? `принято работ: ${act.done} из ${act.total} · ушло ${nm(act.hours)} ч`
          : block.hypothetical
            ? "Факта нет: работы по этой вещи ещё не было."
            : "Принятых сдач ещё нет — факта пока не существует."}
      </div>

      {(block.sections || []).map((s2, i) => (
        <Block key={`${s2.name}-${i}`} block={s2} depth={depth + 1} />))}
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
