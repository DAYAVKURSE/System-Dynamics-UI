import React, { useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm, TxtField } from "./ui.jsx";
import { funcLabel } from "./TasksBoard.jsx";
import { putReportFile, reportSrc } from "../storage.js";
import { putShare } from "../identity.js";
import {
  childrenOf, dropNode, linkTo, newProject, newSection,
  pathOf, rootsOf, shareLink, summaryOf,
} from "../lib/reports.js";
import { reportHtml, reportOf, rangeTimeText, saveFile, timeText } from "../lib/reportDoc.js";
import { chainOf } from "../lib/chain.js";
import { unitsOfTrait } from "../lib/units.js";

/* ════════════════════════════════════════════════════════════════
   ОТЧЁТЫ · карта проектов

   Раздел не показывает «что выбрали показать» — он ПРОСЛЕЖИВАЕТ. Человек
   называет две вещи: с какого ресурса начинается работа (и прикладывает его
   самого — вот это техническое задание) и до какого звена вести. Всё
   остальное приложение считает само по модели: как изменятся ресурсы,
   сколько это займёт, какие шаги будут сделаны и какие факторы на это
   повлияют.

   Четыре блока, и в каждом разделе одни и те же — включая корневой проект,
   потому что проект и раздел это одна и та же запись:

     1. графики количественных изменений в ресурсах;
     2. задачи во времени;
     3. созданные ресурсы — единицы с номерами;
     4. фактическая оценка: что сделано и чего это стоило.

   Порядок не случаен: сперва что должно случиться, потом когда, потом что
   из этого уже родилось, и лишь затем — чего это стоило на самом деле.
   Начать с факта значило бы спрашивать «сошлось ли» раньше, чем сказано, с
   чем сходиться.
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/* ─────── 1. график изменений ───────

   Столбики, а не линии: вопрос здесь не «как менялось во времени», а
   «насколько изменится каждый ресурс» — сравнение величин, и сравнивают их
   длиной от общего нуля.

   Ноль посередине, потому что величины знаковые: одно прибавляется, другое
   расходуется, и рисовать убыль вверх значило бы врать формой. У каждого
   ресурса две полосы: план вилкой и факт. Число подписано у каждой полосы,
   и рядом стоит легенда — так пара «план/факт» читается и без цвета. */
export function ChangeChart({ rows = [], traitName }) {
  if (!rows.length) return null;
  const top = Math.max(1, ...rows.flatMap((r) => [
    Math.abs(r.lo), Math.abs(r.hi), Math.abs(r.fact || 0)]));
  const W = 320;
  const mid = W / 2;
  const len = (v) => (Math.abs(v) / top) * (mid - 4);
  const bar = (v, color, label) => {
    const w = len(v);
    const x = v >= 0 ? mid : mid - w;
    return (<>
      <rect x={x} y={0} width={Math.max(w, 1)} height={9} rx={2} fill={color} />
      <text x={v >= 0 ? mid + w + 5 : mid - w - 5} y={8}
        textAnchor={v >= 0 ? "start" : "end"} fontSize="9.5" fill={C.muted}
        fontFamily="ui-monospace, monospace">{label}</text>
    </>);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 10.5, color: C.muted }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: WARN }} />
          план (от и до)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 10.5, color: C.muted }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: OK }} />
          факт</span>
      </div>
      {rows.map((r) => {
        const lo = Math.min(r.lo, r.hi);
        const hi = Math.max(r.lo, r.hi);
        return (
          <div key={r.trait} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, marginBottom: 2 }}>{traitName(r.trait)}</div>
            <svg viewBox={`0 0 ${W} ${r.fact == null ? 11 : 22}`} width="100%"
              style={{ display: "block", overflow: "visible" }}
              role="img"
              aria-label={`${traitName(r.trait)}: план от ${nm(lo)} до ${nm(hi)}`
                + (r.fact == null ? "" : `, факт ${nm(r.fact)}`)}>
              <line x1={mid} y1={0} x2={mid} y2={r.fact == null ? 11 : 22}
                stroke={C.line} strokeWidth="1" />
              <g transform="translate(0,1)">
                {bar(hi, WARN, lo === hi ? nm(hi) : `${nm(lo)}…${nm(hi)}`)}
              </g>
              {r.fact != null && (
                <g transform="translate(0,13)">{bar(r.fact, OK, nm(r.fact))}</g>)}
            </svg>
          </div>);
      })}
    </div>);
}

/* ─────── 2. задачи во времени ───────
   Не диаграмма Ганта: в разделе важен порядок и состояние, а не пиксельная
   длина полосы. Сперва запланированные шаги — то, что ещё предстоит, —
   потом заведённые задачи с их сроками. */
function Steps({ plan, tasks, funcName, personName }) {
  return (
    <div>
      {!plan.steps.length && (
        <div style={{ fontSize: 11, color: C.muted }}>
          Шагов нет: с этого ресурса цепочка никуда не ведёт.</div>)}
      {plan.steps.map((s, i) => (
        <div key={s.func} style={{ display: "flex", gap: 8, padding: "5px 0",
          borderTop: i ? `1px solid ${C.line}` : "none" }}>
          <span style={{ fontSize: 10.5, color: C.muted, minWidth: 18 }}>{i + 1}.</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12 }}>
              {s.name}
              {s.factor && <span style={{ color: ACC, fontSize: 10.5 }}> · фактор</span>}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
              выполнений {nm(s.runs)} · начнётся через {timeText(s.startHours)} ·
              займёт {timeText(s.calendarHours)}
            </div>
          </div>
        </div>))}

      {!!tasks.length && (<>
        <div style={{ ...S.lbl, margin: "10px 0 4px" }}>заведённые задачи</div>
        {tasks.map((t) => (
          <div key={t.id} className="flex flex-wrap gap-2"
            style={{ alignItems: "center", padding: "4px 0",
              borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 11.5, flex: "1 1 130px" }}>{t.title}</span>
            <span style={{ fontSize: 10.5, color: C.muted }}>
              {funcName(t.funcId)}</span>
            <span style={{ fontSize: 10.5, color: C.muted }}>
              {t.assignee == null ? "не назначен" : personName(t.assignee)}</span>
            <span style={{ fontSize: 10.5, color: C.muted }}>{fmtDT(t.end)}</span>
            <span style={{ fontSize: 10.5,
              color: t.status === "done" ? OK : t.status === "deadline" ? BAD : WARN }}>
              {t.status === "done" ? "принято" : t.status}</span>
          </div>))}
      </>)}
    </div>);
}

/** Один блок карты — и проект, и раздел: они устроены одинаково. */
function Node({ node, nodes, model, doc, depth = 0, focus, onFocus, setNodes,
  traitName, funcName, nameOf, entities }) {
  const [open, setOpen] = useState(depth < 1);
  const [link, setLink] = useState(null);
  const [linkErr, setLinkErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileErr, setFileErr] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const kids = childrenOf(nodes, node.id);
  const up = (patch) => setNodes((p) => p.map((n) => (n.id === node.id ? { ...n, ...patch } : n)));
  const sum = summaryOf(model, node, nodes);
  const root = !node.parent;
  const { chain, plan, actual, made, factors, changes } = doc;

  const traits = model.traits || [];
  const funcs = model.funcs || [];
  /* Звеном может быть и ресурс, и функция: человек говорит «до готового
     сайта» или «до вёрстки», и запрещать одно из двух не за что.

     Предлагается то, до чего цепочка и правда доходит. Считается это по
     цепочке БЕЗ звена — иначе выбранное звено обрезало бы список, и
     передвинуть его дальше было бы уже нечем: человек заперся бы в первом
     же выборе. */
  // Единицы этого ресурса, которые уже родились из сдач: с ними работа
  // уже происходила, и о каждой можно спросить отдельно.
  const units = node.trait ? unitsOfTrait(model, node.trait) : [];
  const full = chainOf(model, { from: node.trait });
  const uptoTraits = traits.filter((t) => t.id !== node.trait
    && (full.traits || []).includes(t.id));
  const uptoFuncs = full.steps || [];

  const pickFile = async (f) => {
    setFileErr("");
    if (!f) return;
    setFileBusy(true);
    try { up({ file: await putReportFile(f) }); }
    catch (e) { setFileErr(e.message || "не удалось сохранить файл"); }
    setFileBusy(false);
  };

  const download = () => {
    const html = reportHtml(doc, { traitName, funcName,
      personName: (id) => (nameOf ? nameOf(id) : id),
      title: node.name || "Отчёт" });
    const safe = String(node.name || "otchet").replace(/[^\wа-яА-ЯёЁ -]+/g, "").trim();
    saveFile(`${safe || "otchet"}.html`, html);
  };

  const makeLink = async () => {
    setBusy(true); setLinkErr("");
    try {
      const saved = await putShare(node.id);
      const url = shareLink(saved.token);
      setLink(url);
      try { await navigator.clipboard.writeText(url); } catch { /* покажем адрес */ }
    } catch (e) {
      setLink(linkTo(node.id));
      setLinkErr(e.message || "снимок не сохранился");
    }
    setBusy(false);
  };

  const Part = ({ n, title, children }) => (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
      <div style={{ ...S.lbl, marginBottom: 6 }}>{n}. {title}</div>
      {children}
    </div>);

  return (
    <div style={{ background: depth ? "transparent" : C.panel2,
      border: `1px solid ${focus === node.id ? ACC : C.line}`, borderRadius: 10,
      padding: 9, marginTop: 8,
      borderLeft: depth ? `2px solid ${C.line}` : `1px solid ${C.line}`,
      marginLeft: depth ? 6 : 0 }}>
      <div className="flex items-center gap-2">
        <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px" }}
          aria-label={`${open ? "свернуть" : "развернуть"} ${node.name || "блок"}`}
          onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
        <TxtField value={node.name} aria-label={root ? "название проекта" : "название раздела"}
          style={{ flex: 1, padding: "4px 6px", fontSize: root ? 13 : 12.5,
            fontWeight: root ? 700 : 600 }}
          onCommit={(v) => up({ name: v })} />
        <span style={{ fontSize: 10, color: C.muted }}>{root ? "проект" : "раздел"}</span>
      </div>

      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
        шагов: {plan.hi.steps.length} · задач: {sum.rows} · принято: {sum.accepted} ·
        {" "}{nm(sum.hours)} ч
      </div>

      {open && (<>
        {/* ─── что прослеживаем ─── */}
        <div style={{ ...S.lbl, marginTop: 8 }}>что прослеживаем</div>
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
          <select style={{ ...S.inp, flex: "1 1 130px", minWidth: 0, fontSize: 11.5,
            padding: "4px 6px" }}
            aria-label={`с какого ресурса: ${node.name || "без названия"}`}
            value={node.trait}
            onChange={(e) => up({ trait: e.target.value, upto: "", unit: "" })}>
            <option value="">— с какого ресурса —</option>
            {traits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
          </select>
          <select style={{ ...S.inp, flex: "1 1 130px", minWidth: 0, fontSize: 11.5,
            padding: "4px 6px" }}
            aria-label={`до какого звена: ${node.name || "без названия"}`}
            value={node.upto} disabled={!node.trait}
            onChange={(e) => up({ upto: e.target.value })}>
            <option value="">
              {node.trait ? "до конца цепочки" : "— сначала выберите ресурс —"}</option>
            {!!uptoTraits.length && (
              <optgroup label="до ресурса">
                {uptoTraits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
              </optgroup>)}
            {!!uptoFuncs.length && (
              <optgroup label="до функции">
                {uptoFuncs.map((f) => (
                  <option key={f.id} value={f.id}>{funcLabel(f, entities)}</option>))}
              </optgroup>)}
          </select>
        </div>

        {/* ─── с чем именно работаем ───

            Две дороги, и обе нужны. НОВЫЙ ресурс — файлом: вот это
            техническое задание только что пришло от заказчика, работы по
            нему ещё не было. УЖЕ БЫВШИЙ В РАБОТЕ — выбором из единиц с
            номерами: тогда раздел показывает весь отчёт по нему, включая
            то, что из него уже выросло.

            Второе без первого оставило бы человека без входа в работу, а
            первое без второго — без возможности спросить о том, что уже
            идёт. */}
        {!!units.length && (
          <select style={{ ...S.inp, marginTop: 6, fontSize: 11.5, padding: "4px 6px" }}
            aria-label={`с какой единицей: ${node.name || "без названия"}`}
            value={node.unit || ""}
            onChange={(e) => up({ unit: e.target.value })}>
            <option value="">весь ресурс целиком — все единицы</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                №{u.no} · {u.title || "без названия"}
                {u.accepted ? "" : " (не принято)"}</option>))}
          </select>)}

        {/* Сам ресурс — файлом. Это и есть «техническое задание»: не пересказ
            своими словами, а то, что и правда пришло от заказчика. */}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 6 }}>
          <label style={{ ...btn(false), fontSize: 11,
            cursor: fileBusy ? "default" : "pointer", opacity: fileBusy ? 0.6 : 1 }}>
            {fileBusy ? "Загружаю…" : node.file ? "Заменить файл" : "Загрузить сам ресурс"}
            <input type="file" style={{ display: "none" }} disabled={fileBusy}
              aria-label={`файл ресурса: ${node.name || "без названия"}`}
              onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>
          {node.file && (
            <a href={reportSrc(node.file)} target="_blank" rel="noreferrer"
              style={{ fontSize: 10.5, color: ACC }}>📎 {node.file.name}</a>)}
          {node.file && (
            <button style={{ ...btn(false), fontSize: 11, color: BAD }}
              aria-label="убрать файл" onClick={() => up({ file: null })}>×</button>)}
          {fileErr && <span style={{ fontSize: 10.5, color: BAD }}>{fileErr}</span>}
        </div>

        {!node.trait && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Выберите ресурс, с которого начинается работа, и звено, до которого
            её прослеживать. Дальше приложение посчитает само: как изменятся
            ресурсы, сколько это займёт, какие шаги будут сделаны и что на них
            повлияет.
          </div>)}

        {doc.broken && (
          <div style={{ fontSize: 11, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
            До этого звена цепочка не доходит: между ним и выбранным ресурсом
            разрыв — ни одна функция не берёт то, что выдаёт предыдущая.
          </div>)}

        {!!doc.unit && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginTop: 8 }}>
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 11, color: ACC, fontWeight: 700 }}>
                №{doc.unit.no}</span>
              <span style={{ fontSize: 12, flex: "1 1 120px" }}>
                {doc.unit.title || "без названия"}</span>
              <span style={{ fontSize: 10.5, color: doc.unit.accepted ? OK : WARN }}>
                {doc.unit.accepted ? "принято" : "не принято"}</span>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
              {fmtDT(doc.unit.at)} · {doc.unit.by == null ? "исполнитель не назначен"
                : (nameOf ? nameOf(doc.unit.by) : doc.unit.by)}
              {" · сделано функцией "}{funcName(doc.unit.func)}
            </div>
            {!!doc.parents.length && (
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
                сделано из: {doc.parents.map((u) =>
                  `№${u.no} ${u.title || "без названия"}`).join(", ")}
              </div>)}
            {doc.unit.file && (
              <a href={reportSrc(doc.unit.file)} target="_blank" rel="noreferrer"
                style={{ fontSize: 10.5, color: ACC, display: "inline-block",
                  marginTop: 4 }}>📎 {doc.unit.file.name}</a>)}
            <div style={{ fontSize: 10.5, marginTop: 5, lineHeight: 1.5,
              color: doc.traced ? C.muted : WARN }}>
              {doc.traced
                ? `Дальше — только то, что выросло из неё: вещей в родословной ${doc.family.length}.`
                : "Что из чего сделано, по ней не записано: при сдаче не отметили взятое. Показана она одна — достраивать родословную по датам значило бы выдать догадку за знание."}
            </div>
          </div>)}

        {!!node.trait && (<>
          {/* ═══ 1. ГРАФИКИ ═══ */}
          <Part n={1} title="как изменятся ресурсы">
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>
              работы {nm(plan.lo.workHours)}–{nm(plan.hi.workHours)} ч ·
              займёт {rangeTimeText(plan.lo.calendarHours, plan.hi.calendarHours)}
            </div>
            {changes.length
              ? <ChangeChart rows={changes} traitName={traitName} />
              : <div style={{ fontSize: 11, color: C.muted }}>
                  Ресурсы по этой цепочке не меняются.</div>}
            {!!Object.keys(plan.hi.need || {}).length && (
              <div style={{ fontSize: 10.5, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
                нужно со стороны: {Object.entries(plan.hi.need)
                  .map(([id, q]) => `${traitName(id)} ${nm(q)}`).join(", ")}
              </div>)}
            {!!factors.length && (
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
                <span style={{ color: ACC }}>на это влияют факторы: </span>
                {factors.map((x) => `${x.name}${x.factors.length
                  ? ` (${x.factors.map((y) => `${y.name} ${y.chance}%`).join(", ")})` : ""}`)
                  .join("; ")}
              </div>)}
          </Part>

          {/* ═══ 2. TIMELINE ═══ */}
          <Part n={2} title="шаги и задачи во времени">
            <Steps plan={plan.hi} tasks={actual.tasks} funcName={funcName}
              personName={(id) => (nameOf ? nameOf(id) : id)} />
          </Part>

          {/* ═══ 3. СОЗДАННЫЕ РЕСУРСЫ ═══ */}
          <Part n={3} title="созданные ресурсы">
            {!made.length && (
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                Пока ничего: единица появляется, когда сдают задачу, — и у неё
                сразу есть номер, автор и файл.</div>)}
            {made.map((u) => (
              <div key={u.id} style={{ borderTop: `1px solid ${C.line}`, padding: "5px 0" }}>
                <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: ACC, fontWeight: 700 }}>№{u.no}</span>
                  <span style={{ fontSize: 12, flex: "1 1 120px" }}>
                    {u.title || "без названия"}</span>
                  <span style={{ fontSize: 10.5, color: C.muted }}>
                    {traitName(u.trait)} {nm(u.qty)}</span>
                  <span style={{ fontSize: 10.5, color: u.accepted ? OK : WARN }}>
                    {u.accepted ? "принято" : "не принято"}</span>
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                  {fmtDT(u.at)} · {u.by == null ? "исполнитель не назначен"
                    : (nameOf ? nameOf(u.by) : u.by)}
                </div>
                {u.file && (/^image\//.test(u.file.type || "")
                  ? <img src={reportSrc(u.file)} alt={u.file.name}
                      style={{ maxWidth: "100%", borderRadius: 6, marginTop: 5,
                        border: `1px solid ${C.line}` }} />
                  : <a href={reportSrc(u.file)} target="_blank" rel="noreferrer"
                      style={{ fontSize: 10.5, color: ACC, display: "inline-block",
                        marginTop: 3 }}>📎 {u.file.name}</a>)}
              </div>))}
          </Part>

          {/* ═══ 4. ФАКТ ═══ */}
          <Part n={4} title="фактическая оценка">
            {!actual.any
              ? <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                  Принятых сдач ещё нет — факта пока не существует. Выдать за
                  него план значило бы показать измерением то, что им не
                  является.</div>
              : (<>
                  <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                    принято работ: <b style={{ color: OK }}>{actual.done}</b> из {actual.total}
                    {" · "}ушло <b style={{ color: OK }}>{nm(actual.hours)} ч</b>
                    <span style={{ color: C.muted }}>
                      {" "}(по плану {nm(plan.lo.workHours)}–{nm(plan.hi.workHours)} ч)</span>
                  </div>
                  {Object.entries(actual.delta).map(([id, q]) => (
                    <div key={id} className="flex flex-wrap gap-2"
                      style={{ alignItems: "center", fontSize: 11, marginTop: 3 }}>
                      <span style={{ flex: "1 1 110px" }}>{traitName(id)}</span>
                      <span style={{ color: q >= 0 ? OK : WARN }}>
                        {q >= 0 ? "+" : "−"}{nm(Math.abs(q))}</span>
                    </div>))}
                </>)}
          </Part>
        </>)}

        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          <button style={{ ...btn(false), fontSize: 11 }}
            onClick={() => setNodes((p) => [...p, newSection(node.id)])}>
            + раздел внутри</button>
          <button style={{ ...btn(true, OK), fontSize: 11 }} onClick={download}>
            Скачать отчёт</button>
          <button style={{ ...btn(false), fontSize: 11 }} disabled={busy}
            onClick={makeLink}>
            {busy ? "Готовлю…" : link ? "обновить ссылку" : "ссылка на этот блок"}</button>
          <span style={{ flex: 1 }} />
          <button style={{ ...btn(false), fontSize: 11, color: BAD,
            borderColor: "#5A2436" }}
            onClick={() => setNodes((p) => dropNode(p, node.id))}>удалить</button>
        </div>
        {link && (
          <div style={{ fontSize: 10.5, color: ACC, marginTop: 5,
            wordBreak: "break-all", lineHeight: 1.5 }}>
            {link}
            <div style={{ color: linkErr ? WARN : C.muted }}>
              {linkErr
                ? `Снимок не сохранился (${linkErr}) — эта ссылка откроется только у тех, у кого модель уже есть.`
                : "Открывается у кого угодно и без входа: там снимок этого блока — оценка, шаги, созданные ресурсы и факт, и ничего сверх."}
            </div>
          </div>)}

        {kids.map((k, i) => (
          <Node key={k.id} node={k} nodes={nodes} model={model}
            doc={doc.sections[i]} depth={depth + 1}
            focus={focus} onFocus={onFocus} setNodes={setNodes}
            traitName={traitName} funcName={funcName} nameOf={nameOf} entities={entities} />))}
      </>)}
    </div>);
}

export default function ReportsPanel({ nodes = [], setNodes, model = {},
  entities = [], nameOf, focus, onFocus, runsOf }) {
  const traitName = (id) => (model.traits || []).find((t) => t.id === id)?.l
    || (id ? "(ресурс удалён)" : "");
  const funcName = (id) => {
    const f = (model.funcs || []).find((x) => x.id === id);
    return f ? funcLabel(f, entities) : "(функция удалена)";
  };
  const path = focus ? pathOf(nodes, focus) : [];
  const shown = focus && path.length ? [path[path.length - 1]] : rootsOf(nodes);

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>отчёты — карта проектов</span>
          <span style={{ flex: 1 }} />
          <button style={btn(true)}
            onClick={() => setNodes((p) => [...p, newProject()])}>+ проект</button>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          В разделе называют две вещи: ресурс, с которого начинается работа
          (и прикладывают его самого), и звено, до которого её прослеживать.
          Остальное приложение считает по модели — как изменятся ресурсы,
          сколько это займёт, какие шаги будут сделаны и что на них повлияет.
        </div>
        {!!path.length && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: 8, alignItems: "center" }}>
            <button style={{ ...btn(false), fontSize: 11 }}
              onClick={() => onFocus?.(null)}>← вся карта</button>
            <span style={{ fontSize: 11, color: C.muted }}>
              {path.map((n) => n.name || "без названия").join(" → ")}</span>
          </div>)}
      </div>

      {!nodes.length && (
        <div style={{ ...S.card, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          Проектов пока нет. Проект — это заказ или направление работы: с
          какого ресурса он начинается и до какого звена его вести.
        </div>)}

      {focus && !path.length && (
        <div style={{ ...S.card, fontSize: 11.5, color: WARN, lineHeight: 1.6 }}>
          Такого блока в этой модели нет. Возможно, ссылка ведёт в другую
          рабочую область или блок удалили.
        </div>)}

      {shown.map((n) => (
        <Node key={n.id} node={n} nodes={nodes} model={model}
          doc={reportOf(model, n, nodes, { runsOf })}
          focus={focus} onFocus={onFocus} setNodes={setNodes} traitName={traitName}
          funcName={funcName} nameOf={nameOf} entities={entities} />))}
    </div>);
}
