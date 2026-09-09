import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, nm } from "./ui.jsx";
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

/* Оценка — списком «величина → значение», каждая своей строкой. Одной
   строкой через точки её прочесть нельзя: непонятно, где кончается одно
   число и начинается другое, и что за величина названа. */
function Facts({ rows = [] }) {
  const shown = rows.filter((r) => r && r.value != null && r.value !== "");
  if (!shown.length) return null;
  return (
    <div style={{ marginTop: 3 }}>
      {shown.map((r) => (
        <div key={r.label} className="flex flex-wrap gap-2"
          style={{ alignItems: "baseline", lineHeight: 1.6 }}>
          <span style={{ fontSize: 10.5, color: C.muted, flex: "1 1 175px" }}>
            {r.label}</span>
          <span style={{ fontSize: 11, color: r.color || C.text,
            fontWeight: 600, flex: "1 1 90px" }}>{r.value}</span>
        </div>))}
    </div>);
}

/* Одна строка прогноза ресурсов. Вещи, которые по ресурсу уже вышли, стоят
   ПОД ней: отдельного списка «созданные ресурсы» нет ни здесь, ни внутри —
   он отвечал бы на тот же вопрос второй раз и в другом порядке. */
function ChangeRow({ c, made = [] }) {
  const [open, setOpen] = useState(false);
  const head = (
    <div className="flex flex-wrap gap-2"
      style={{ alignItems: "center", fontSize: 11, marginTop: 3 }}>
      <span style={{ flex: "1 1 110px" }}>{c.trait}</span>
      <span style={{ color: WARN }}>
        прогноз {nm(Math.min(c.lo, c.hi))}…{nm(Math.max(c.lo, c.hi))}</span>
      <span style={{ color: c.fact == null ? C.muted : OK }}>
        {c.fact == null ? "факта нет" : `факт ${nm(c.fact)}`}</span>
      {!!made.length && (
        <span style={{ color: ACC }}>
          {open ? "▾" : "▸"} {nm(made.length)} шт. — показать</span>)}
    </div>);
  return (
    <div>
      {made.length
        ? (<div role="button" tabIndex={0} style={{ cursor: "pointer" }}
            aria-label={`созданные единицы: ${c.trait}`}
            onClick={() => setOpen(!open)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault(); setOpen(!open);
              }
            }}>{head}</div>)
        : head}
      {open && made.map((r, i) => (
        <Made key={`${r.title}-${r.at}-${i}`} r={r} />))}
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
        <span style={{ fontSize: 10.5,
          color: t.canceled ? BAD : t.status === "done" ? OK : WARN }}>
          {t.canceled ? "отменена" : t.status === "done" ? "принято" : t.status}</span>
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
      {/* Определённая вещь не выбрана — это ПРОГНОЗ, а не отчёт о
          сделанном. Сказать это надо прямо: иначе прогноз прочитается как
          обещание по конкретной вещи. */}
      {block.hypothetical && !!block.from && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          Определённая единица не выбрана: это прогноз — что произойдёт, когда
          она появится в системе. Работы по ней пока нет.</div>)}

      {/* ═══ 1. ПРОГНОЗ РЕСУРСОВ ═══

          Отдельного списка «созданные ресурсы» нет: вещи открываются
          нажатием на строку своего ресурса. Второй список отвечал бы на тот
          же вопрос второй раз и в другом порядке. */}
      <div style={{ ...S.lbl, marginTop: 10 }}>1. прогноз ресурсов</div>
      <Facts rows={[
        { label: "Работы (человеко-часов)", color: WARN,
          value: `${nm(plan.workHours[0])}–${nm(plan.workHours[1])} ч` },
        { label: "Задач принято", color: act.done ? OK : C.muted,
          value: act.done ? `${nm(act.done)} из ${nm(act.total)}` : "ни одной" },
        { label: "Фактически ушло часов", color: act.done ? OK : C.muted,
          value: act.done ? `${nm(act.hours)} ч` : "факта пока нет" },
      ]} />
      {changes.map((c) => (
        <ChangeRow key={c.trait} c={c}
          made={(block.made || []).filter((r) => r.trait === c.trait)} />))}
      {!!changes.length && !!(block.made || []).length && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          Нажмите на ресурс — откроются сами вещи, которые по нему вышли.</div>)}

      {/* ═══ 2. ЗАДАЧИ ═══ */}
      <div style={{ ...S.lbl, marginTop: 10 }}>2. задачи</div>
      <Facts rows={[
        { label: "Шагов в цепочке", value: nm(plan.steps.length), color: WARN },
      ]} />
      {!!(block.before || []).length && (<>
        <div style={{ ...S.lbl, marginTop: 8 }}>как эти вещи появились</div>
        {block.before.map((t, k) => (<Task key={`${t.title}-b${k}`} t={t} />))}
      </>)}

      {/* ─── разделы отчёта: по одному на выполняемую функцию ─── */}
      {!!plan.steps.length && (
        <div style={{ ...S.lbl, marginTop: 10 }}>
          разделы отчёта — по одному на функцию</div>)}
      {plan.steps.map((s2, i) => (
        <section key={`${s2.name}-${i}`} id={s2.anchor || undefined}
          style={{ borderTop: `1px solid ${C.line}`, padding: "7px 0" }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            {i + 1}. {s2.name}{s2.factor ? " · фактор" : ""}</div>
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
            <Facts rows={[
              { label: "Кол-во выполнений ожидается", value: nm(s2.runs), color: WARN },
              s2.factor ? null
                : { label: "Работы (человеко-часов)", color: WARN,
                  value: `${nm(s2.workLo)}–${nm(s2.workHi)} ч` },
              s2.factor ? null
                : { label: "Выполнений принято", color: s2.doneCount ? OK : C.muted,
                  value: s2.doneCount
                    ? `${nm(s2.doneCount)} из ${nm((s2.tasks || []).length)}`
                    : "ни одного" },
              s2.factor ? null
                : { label: "Фактически ушло часов", color: s2.doneCount ? OK : C.muted,
                  value: s2.doneCount ? `${nm(s2.factHours)} ч` : "факта пока нет" },
            ]} />)}
          {/* Тот же набор данных, что и у отчёта целиком: свой прогноз
              ресурсов, и вещи открываются из него же. */}
          {!!(s2.changes || []).length && (<>
            <div style={{ ...S.lbl, marginTop: 6 }}>прогноз ресурсов</div>
            {s2.changes.map((c) => (
              <ChangeRow key={c.trait} c={c}
                made={(s2.made || []).filter((r) => r.trait === c.trait)} />))}
          </>)}
          <div style={{ ...S.lbl, marginTop: 6 }}>задачи</div>
          {s2.factor
            ? (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                Задач тут не бывает: фактор случается сам.</div>)
            : (s2.tasks || []).length
              ? s2.tasks.map((t, k) => (<Task key={`${t.title}-${k}`} t={t} />))
              : (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                  Задач на этот шаг ещё не заведено.</div>)}
        </section>))}

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
