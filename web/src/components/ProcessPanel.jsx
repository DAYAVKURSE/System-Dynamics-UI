import React, { useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm } from "./ui.jsx";
import { Section } from "./AssetPanel.jsx";
import { normalizeFunc } from "../lib/funcs.js";
import { PROC_STATUS, assetAt, canAcceptProc, dropHypo, hintAt, newProc, procIssues,
  procLabel, replaceName, resolveProc, stateOf, suggestNames, syncProcFuncs }
  from "../lib/process.js";

/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · раздел под схемой

   Владелец просил одно: «я буквально должен вводить текст, а он должен
   выдавать подсказки». Поэтому здесь не форма из полей, а текст — строка
   на шаг, — и подсказки под курсором: активы в начале строки, ресурсы
   после «берёт», «отдаёт» и запятой. Разбор (lib/process.js) стоит под
   полем построчно: найденное — чипами, ненайденное — пунктиром, и по
   нажатию на пунктир человек решает, принять это как новую сущность или
   отклонить.

   Все правки идут через одну дверь (`commit`): процесс, его функции и
   заведённые им сущности меняются одним заходом — в историю правок ложится
   один шаг, и «отменить» возвращает всё разом, а не по частям.
   ════════════════════════════════════════════════════════════════ */

const WORD = { asset: "актив", trait: "ресурс" };
const STATUS_TONE = { off: null, hypo: WARN, on: OK };

/* ─── текст с подсказками ───
   По образцу поля выражения (ExprField): список под полем, стрелки и
   Enter выбирают, Escape закрывает, `onMouseDown` с `preventDefault`
   держит фокус в поле — выбор из списка это часть набора, не его конец. */
function ProcText({ value = "", entities, traits, onCommit, label }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  const [pick, setPick] = useState(null);   // { kind, start, query, at } — список открыт
  const [cursor, setCursor] = useState(0);
  const inp = useRef(null);
  // Снаружи поменяли (загрузили модель, поставили замену) — а мы не в
  // фокусе: показываем новое.
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);

  const items = pick
    ? suggestNames(pick, { entities, traits }, assetAt(text, pick.at, { entities }))
    : [];
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const at = e.target.selectionStart ?? v.length;
    const h = hintAt(v, at);
    setPick(h ? { ...h, at } : null);
    setCursor(0);
  };
  /* Подсказка вставляет имя и то, что после него идёт всегда: у актива —
     «: берёт », у ресурса — пробел под число. Иначе выбор из списка
     заканчивался бы ровно там, где человеку снова надо набирать. */
  const choose = (name) => {
    if (!pick) return;
    const suffix = pick.kind === "asset" ? ": берёт " : " ";
    const next = `${text.slice(0, pick.start)}${name}${suffix}${text.slice(pick.at)}`;
    const caret = pick.start + name.length + suffix.length;
    setText(next);
    setPick(null);
    setTimeout(() => {
      inp.current?.focus();
      inp.current?.setSelectionRange(caret, caret);
    }, 0);
  };
  const onKey = (e) => {
    if (!pick || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(items[cursor]); }
    else if (e.key === "Escape") setPick(null);
  };
  return (
    <div style={{ position: "relative" }}>
      <textarea ref={inp} value={text} aria-label={label} rows={Math.max(3, text.split("\n").length + 1)}
        placeholder={"Актив: берёт Ресурс 2, Ресурс 1 → отдаёт Ресурс 3"}
        style={{ ...S.inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
          resize: "vertical", lineHeight: 1.5 }}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); setPick(null); if (text !== value) onCommit(text); }}
        onChange={onChange} onKeyDown={onKey} />
      {pick && !!items.length && (
        <div role="listbox" aria-label="подсказки процесса"
          style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 20,
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6,
            maxHeight: 160, overflowY: "auto", marginTop: 2 }}>
          {items.map((n, i) => (
            <div key={n} role="option" aria-selected={i === cursor}
              onMouseDown={(e) => { e.preventDefault(); choose(n); }}
              style={{ padding: "5px 8px", fontSize: 12, cursor: "pointer",
                background: i === cursor ? ACC + "22" : "transparent" }}>
              <span style={{ color: C.muted }}>{WORD[pick.kind]} </span>{n}</div>))}
        </div>)}
    </div>);
}

/* ─── одно имя из строки ───
   Четыре состояния — четыре вида. Найденное — обычный чип. Неизвестное —
   пунктир: это ещё не ошибка, а вопрос, и нажатие его задаёт. Отклонённое
   и удалённое — красные: первое ждёт правки строки, второе — замены. */
function Chip({ item, kind, state, qty, hypo, open, onOpen, onAccept, acceptWhy, onReject,
  onRestore, options = [], onReplace }) {
  const name = item?.name || "";
  const tail = qty != null ? ` ${nm(qty)}` : "";
  const base = { display: "inline-block", borderRadius: 6, padding: "1px 7px", fontSize: 12,
    lineHeight: 1.6, verticalAlign: "middle" };
  if (state === "ok") {
    return (
      <span style={{ ...base, border: `1px solid ${C.line}`, background: C.panel }}>
        {name}{tail}
        {hypo && <span style={{ fontSize: 10, color: WARN }}> · гипотеза</span>}
      </span>);
  }
  if (state === "deleted") {
    return (
      <span style={{ ...base, border: `1px solid ${BAD}`, color: BAD }}>
        {name}{tail} — удалён — выберите замену
        <select aria-label={`замена для «${name}»`} value=""
          onChange={(e) => e.target.value && onReplace(e.target.value)}
          style={{ ...S.inp, width: "auto", display: "inline-block", marginLeft: 6,
            padding: "1px 4px", fontSize: 11 }}>
          <option value="">— замена —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </span>);
  }
  const rejected = state === "rejected";
  return (
    <span style={{ display: "inline" }}>
      <button type="button" onClick={onOpen} aria-expanded={open}
        aria-label={`${rejected ? "отклонённый" : "неизвестный"} ${WORD[kind]} «${name}»`}
        style={{ ...base, cursor: "pointer",
          border: rejected ? `1px solid ${BAD}` : `1px dashed ${ACC}`,
          color: rejected ? BAD : ACC, background: "transparent" }}>
        {name}{tail}{rejected ? " — отклонено" : ""}</button>
      {open && (
        <span style={{ marginLeft: 4, whiteSpace: "nowrap" }}>
          <button type="button" aria-label={`принять ${WORD[kind]} «${name}»`}
            disabled={!!acceptWhy} title={acceptWhy || ""}
            style={{ ...btn(true, OK), fontSize: 11, padding: "2px 7px",
              opacity: acceptWhy ? 0.5 : 1 }}
            onClick={onAccept}>Принять</button>
          {" "}
          {rejected
            ? <button type="button" aria-label={`вернуть ${WORD[kind]} «${name}»`}
              style={{ ...btn(false), fontSize: 11, padding: "2px 7px" }}
              onClick={onRestore}>Вернуть</button>
            : <button type="button" aria-label={`отклонить ${WORD[kind]} «${name}»`}
              style={{ ...btn(true, BAD), fontSize: 11, padding: "2px 7px" }}
              onClick={onReject}>Отклонить</button>}
        </span>)}
    </span>);
}

export default function ProcessPanel({ procs = [], setProcs, entities = [], setEntities,
  traits = [], setTraits, funcs = [], setFuncs, onDropFuncs, makeEntity }) {
  // Какой пунктирный чип раскрыт: «процесс:строка:вид:имя».
  const [openChip, setOpenChip] = useState(null);

  /* Одна дверь на все правки. `steps` пересчитываются каждый раз — они
     память записи о найденных id, и устаревать им нельзя; функции
     процессов пересобираются по нынешним текстам и статусам. */
  const commit = ({ procs: next, entities: e2 = entities, traits: t2 = traits,
    funcs: f2 = funcs, dropped = [] }) => {
    const m = { entities: e2, traits: t2 };
    const withSteps = next.map((p) => ({ ...p, steps: resolveProc(p, m).steps }));
    setProcs(withSteps);
    if (e2 !== entities) setEntities(e2);
    if (t2 !== traits) setTraits(t2);
    setFuncs(syncProcFuncs(f2, withSteps, m, normalizeFunc));
    if (dropped.length && onDropFuncs) onDropFuncs(dropped);
  };
  const patch = (id, make) => procs.map((p) => (p.id === id ? make(p) : p));

  const add = () => commit({ procs: [...procs, newProc()] });
  const setText = (p, text) => commit({ procs: patch(p.id, (x) => ({ ...x, text })) });
  /* «Не принято» — функций от процесса нет, и его гипотезы уходят со
     схемы: без процесса они ничьи. Задачи по его функциям — тоже:
     выполнять больше нечего. */
  const turnOff = (p) => {
    const d = dropHypo(p, { entities, traits, funcs });
    return { d, dropped: funcs.filter((f) => f.proc === p.id).map((f) => f.id) };
  };
  const setStatus = (p, status) => {
    if (status === "off") {
      const { d, dropped } = turnOff(p);
      commit({ procs: patch(p.id, () => ({ ...d.proc, status })), entities: d.entities,
        traits: d.traits, funcs: d.funcs, dropped });
      return;
    }
    if (!canAcceptProc(p, { entities, traits })) return;
    commit({ procs: patch(p.id, (x) => ({ ...x, status })) });
  };
  const del = (p) => {
    const { d, dropped } = turnOff(p);
    commit({ procs: procs.filter((x) => x.id !== p.id), entities: d.entities,
      traits: d.traits, funcs: d.funcs, dropped });
  };
  /* Принять неизвестное — завести его: актив рядом с существующими,
     ресурс — в активе строки. Оба с пометкой `hypo`, ресурс к тому же не
     принят — принимает его человек в карточке, как любой другой. */
  const acceptName = (p, kind, item, assetId) => {
    setOpenChip(null);
    if (kind === "asset") {
      const e = { ...makeEntity(item.name), hypo: true };
      commit({ entities: [...entities, e],
        procs: patch(p.id, (x) => ({ ...x,
          hypo: { ...x.hypo, entities: [...x.hypo.entities, e.id] } })) });
      return;
    }
    const t = { id: `t${Date.now().toString(36)}${traits.length.toString(36)}`, e: assetId,
      ks: [], k: "", l: item.name, unit: "ед.", hypo: true, accepted: false };
    commit({ traits: [...traits, t],
      procs: patch(p.id, (x) => ({ ...x,
        hypo: { ...x.hypo, traits: [...x.hypo.traits, t.id] } })) });
  };
  const rejectName = (p, name) => {
    setOpenChip(null);
    commit({ procs: patch(p.id, (x) => ({ ...x,
      missing: { ...x.missing, rejected: [...x.missing.rejected, name] } })) });
  };
  const restoreName = (p, name) => {
    setOpenChip(null);
    commit({ procs: patch(p.id, (x) => ({ ...x,
      missing: { ...x.missing,
        rejected: x.missing.rejected.filter((r) => r.toLowerCase() !== name.toLowerCase()) } })) });
  };
  /* Замена удалённого — правка текста: имя в строке меняется на выбранное,
     и дальше всё идёт своим чередом. Текст — единственный источник, и
     подменять id мимо него значило бы завести второй. */
  const replace = (p, kind, oldName, id) => {
    const name = kind === "asset" ? entities.find((e) => e.id === id)?.name
      : traits.find((t) => t.id === id)?.l;
    if (!name) return;
    setText(p, replaceName(p.text, kind, oldName, name));
  };

  const model = { entities, traits };
  const assetOptions = entities.map((e) => ({ id: e.id, name: e.name }));
  const traitOptions = traits.map((t) => ({ id: t.id,
    name: `${t.l} (${entities.find((e) => e.id === t.e)?.name || "актив удалён"})` }));

  return (
    <div style={{ ...S.card, marginTop: 10 }}>
      <Section title="технологические процессы" addLabel="+ процесс" onAdd={add}
        hint="Строка на шаг: «Актив: берёт Ресурс 2, Ресурс 1 → отдаёт Ресурс 3». Подсказки — по мере набора."
        empty={procs.length ? null : "Процессов пока нет."}>
        {procs.map((p) => {
          const { steps } = resolveProc(p, model);
          const issues = procIssues(p, model);
          const can = issues.length === 0;
          const label = procLabel(p);
          const key = (s, kind, name) => `${p.id}:${s.line}:${kind}:${name}`;
          return (
            <div key={p.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
              borderRadius: 8, padding: 8, marginBottom: 8,
              borderLeft: `2px solid ${STATUS_TONE[p.status] || C.line}` }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <span style={S.lbl}>процесс</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}</span>
                <span style={{ fontSize: 10.5, color: STATUS_TONE[p.status] || C.muted,
                  whiteSpace: "nowrap" }}>
                  {PROC_STATUS.find(([id]) => id === p.status)?.[1].toLowerCase()}</span>
                <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                  fontSize: 11, padding: "2px 6px" }}
                  aria-label={`удалить процесс «${label}»`} onClick={() => del(p)}>удалить</button>
              </div>

              <ProcText value={p.text} entities={entities} traits={traits}
                label="текст процесса" onCommit={(t) => setText(p, t)} />

              {/* Разбор построчно — под полем, там же, где набирают. */}
              {steps.map((s) => {
                const assetState = stateOf(s.asset, "asset", model, p);
                const assetOk = assetState === "ok";
                const chip = (it, kind, qty) => {
                  const st = stateOf(it, kind, model, p);
                  const k = key(s, kind, it.name);
                  const hypo = kind === "asset" ? p.hypo.entities.includes(it.id)
                    : p.hypo.traits.includes(it.id);
                  return (
                    <Chip item={it} kind={kind} state={st} qty={qty} hypo={hypo}
                      open={openChip === k}
                      onOpen={() => setOpenChip(openChip === k ? null : k)}
                      onAccept={() => acceptName(p, kind, it, s.asset?.id)}
                      acceptWhy={kind === "trait" && !assetOk ? "сначала примите актив" : ""}
                      onReject={() => rejectName(p, it.name)}
                      onRestore={() => restoreName(p, it.name)}
                      options={kind === "asset" ? assetOptions : traitOptions}
                      onReplace={(id) => replace(p, kind, it.name, id)} />);
                };
                return (
                  <div key={s.line} style={{ marginTop: 6, fontSize: 12, lineHeight: 1.9 }}>
                    <span style={{ color: C.muted, marginRight: 6 }}>{s.line}.</span>
                    {s.error
                      ? <span style={{ color: BAD }}>{s.text} — {s.error}</span>
                      : <>
                        {chip(s.asset, "asset")}
                        <span style={{ color: C.muted }}> берёт </span>
                        {s.takes.map((t, j) => (
                          <React.Fragment key={j}>{j ? ", " : ""}{chip(t, "trait", t.qty)}</React.Fragment>))}
                        <span style={{ color: C.muted }}> → отдаёт </span>
                        {s.gives.map((t, j) => (
                          <React.Fragment key={j}>{j ? ", " : ""}{chip(t, "trait", t.qty)}</React.Fragment>))}
                      </>}
                  </div>);
              })}

              {!!issues.length && !!p.text.trim() && (
                <div style={{ fontSize: 10.5, color: BAD, marginTop: 6, lineHeight: 1.5 }}>
                  {issues.map((w, i) => <div key={i}>{w}</div>)}
                </div>)}

              {/* Три состояния, одно нажатие. Принять — гипотетически или
                  насовсем — нельзя, пока в строках есть неизвестное,
                  отклонённое или удалённое: подсказка говорит, что сперва. */}
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                {PROC_STATUS.map(([id, name]) => {
                  const on = p.status === id;
                  const locked = id !== "off" && !can;
                  return (
                    <button key={id} aria-pressed={on} disabled={locked}
                      title={locked ? issues[0] : ""}
                      style={{ ...btn(on, STATUS_TONE[id] || undefined), fontSize: 11,
                        opacity: locked ? 0.5 : 1, cursor: locked ? "default" : "pointer" }}
                      onClick={() => !on && setStatus(p, id)}>{name}</button>);
                })}
              </div>
            </div>);
        })}
      </Section>
    </div>);
}
