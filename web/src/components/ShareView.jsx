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

/** Одна созданная вещь: номер, что это, кто и когда сделал, и сам файл. */
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
      {/* Сама вещь — её и скачивают. Файла нет — так и сказано: пустое
          место читалось бы как «ещё грузится». */}
      {r.file
        ? (/^image\//.test(r.file.type || "")
          ? <img src={reportSrc(r.file)} alt={r.file.name}
              style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6,
                border: `1px solid ${C.line}` }} />
          : <a href={reportSrc(r.file)} target="_blank" rel="noreferrer"
              download={r.file.name}
              style={{ fontSize: 10.5, color: ACC, display: "inline-block", marginTop: 4 }}>
              📎 скачать · {r.file.name}</a>)
        : (<div style={{ fontSize: 10.5, color: WARN, marginTop: 4 }}>
            файла нет — при сдаче не приложили</div>)}
    </div>);
}

/* Прогноз и факт — подписаны и всегда рядом: число без подписи не говорит,
   обещание это или измерение. */
function PlanFact({ plan, fact }) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.6, marginTop: 3 }}>
      <div style={{ color: WARN }}><b>прогноз по модели:</b> {plan}</div>
      <div style={{ color: fact ? OK : C.muted }}>
        <b>фактически:</b> {fact || "принятых работ пока нет"}</div>
    </div>);
}

/** Одна задача: срок, состояние, сколько вышло и что из неё родилось. */
function Task({ t }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "5px 0",
      marginLeft: 10 }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 11.5, flex: "1 1 120px" }}>{t.title}</span>
        {!!t.by && <span style={{ fontSize: 10.5, color: C.muted }}>{t.by}</span>}
        <span style={{ fontSize: 10.5, color: C.muted }}>{fmtDT(t.end)}</span>
        <span style={{ fontSize: 10.5, color: t.status === "done" ? OK : WARN }}>
          {t.status === "done" ? "принято" : t.status}</span>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
        {t.hours == null ? "факта пока нет" : `вышло ${nm(t.hours)} ч`}
      </div>
      {(t.made || []).map((r, i) => (<Made key={`${r.title}-${r.at}-${i}`} r={r} />))}
    </div>);
}

/* Блок и его разделы — теми же вложенными блоками, что и в самой карте, и с
   теми же тремя частями: созданные ресурсы, как изменятся ресурсы, работа
   по шагам. Заказчик должен видеть ровно то, что видит владелец, — иначе
   разговор пойдёт про разное. Созданное стоит первым: заказчик спрашивает
   «что уже готово», а не «что обещали». */
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
      {/* Определённые вещи не выбраны: прогноз считается на гипотетические,
          а работа показана вся, какая по цепочке есть. Сказать это надо
          прямо — иначе прогноз прочитается как обещание по конкретной
          вещи. */}
      {block.hypothetical && !!block.from && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          Определённые единицы не выбраны: прогноз посчитан на гипотетические,
          а работа показана вся, какая по этой цепочке есть.</div>)}

      {/* ═══ 1. СОЗДАННЫЕ РЕСУРСЫ ═══ */}
      <div style={{ ...S.lbl, marginTop: 8 }}>1. созданные ресурсы</div>
      {(block.made || []).length
        ? block.made.map((r, i) => (<Made key={`${r.title}-${r.at}-m${i}`} r={r} />))
        : (<div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
            Пока ничего не создано: принятых сдач с приложенным результатом
            нет.</div>)}

      {/* ═══ 2. КАК ИЗМЕНЯТСЯ РЕСУРСЫ ═══ */}
      <div style={{ ...S.lbl, marginTop: 10 }}>2. как изменятся ресурсы</div>
      <PlanFact
        plan={`работы ${nm(plan.workHours[0])}–${nm(plan.workHours[1])} ч`
          + ` · шагов ${plan.steps.length}`}
        fact={act.done
          ? `принято работ ${act.done} из ${act.total} · ушло ${nm(act.hours)} ч`
          : ""} />
      {changes.map((c) => (
        <div key={c.trait} className="flex flex-wrap gap-2"
          style={{ alignItems: "center", fontSize: 11, marginTop: 3 }}>
          <span style={{ flex: "1 1 110px" }}>{c.trait}</span>
          <span style={{ color: WARN }}>
            прогноз {nm(Math.min(c.lo, c.hi))}…{nm(Math.max(c.lo, c.hi))}</span>
          <span style={{ color: c.fact == null ? C.muted : OK }}>
            {c.fact == null ? "факта нет" : `факт ${nm(c.fact)}`}</span>
        </div>))}

      {/* ═══ 3. РАБОТА ПО ШАГАМ ═══ */}
      <div style={{ ...S.lbl, marginTop: 10 }}>3. работа по шагам</div>
      {plan.steps.map((s2, i) => (
        <section key={`${s2.name}-${i}`} id={s2.anchor || undefined}
          style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0" }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            {i + 1}. {s2.name}{s2.factor ? " · фактор" : ""}</div>
          {/* Созданное — первым и внутри шага: шаг такой же раздел. */}
          {(s2.made || []).length
            ? s2.made.map((r, k) => (<Made key={`${r.title}-${r.at}-s${k}`} r={r} />))
            : (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                {s2.factor
                  ? "Фактор ничего не выдаёт вещью: он случается сам."
                  : "Созданных ресурсов по этому шагу пока нет."}</div>)}
          {/* Шаг, который не выполнится, остаётся в снимке — но со словами
              вместо сроков: обещать заказчику работу, которая не начнётся,
              нельзя, а молчать о ней ещё хуже. */}
          {(s2.short || []).length ? (
            <div style={{ fontSize: 10.5, color: WARN, lineHeight: 1.5 }}>
              не выполнится: не хватает{" "}
              {s2.short.map((x) => `${x.trait}${x.spentBy
                ? ` (израсходовал шаг «${x.spentBy}»)` : ""}`).join(", ")}
            </div>
          ) : (
            <PlanFact
              plan={`выполнений ${nm(s2.runs)}${s2.factor ? ""
                : ` · работы ${nm(s2.workLo)}–${nm(s2.workHi)} ч`}`}
              fact={s2.doneCount
                ? `принято выполнений ${nm(s2.doneCount)} из ${
                  nm((s2.tasks || []).length)} · ушло ${nm(s2.factHours)} ч`
                : ""} />)}
          {s2.factor
            ? (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                Задач тут не бывает: фактор случается сам.</div>)
            : (s2.tasks || []).length
              ? s2.tasks.map((t, k) => (<Task key={`${t.title}-${k}`} t={t} />))
              : (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                  Задач на этот шаг ещё не заведено.</div>)}
        </section>))}
      {!!(block.before || []).length && (<>
        <div style={{ ...S.lbl, marginTop: 8 }}>как эти вещи появились</div>
        {block.before.map((t, k) => (<Task key={`${t.title}-b${k}`} t={t} />))}
      </>)}

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
