import React, { useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, NumField } from "./ui.jsx";
import { Section } from "./AssetPanel.jsx";
import { normalizeFunc } from "../lib/funcs.js";
import { PROC_STATUS, canAcceptProc, dropHypo, exactOption, filterOptions, newPort, newProc,
  newStep, orderOptions, procIssues, procLabel, procText, stateOf, syncProcFuncs }
  from "../lib/process.js";

/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · раздел под схемой

   Владелец (2026-09-13): «в поле ввода должно вводиться так: актив,
   должность воркера, из какого актива, что берёт, и/или что выдаёт, в
   какой актив, что выдаёт, перевод строки; для каждого выбора — подсказка
   слева и выпадающий список; никакого ручного ввода двоеточий и стрелок;
   новое имя — кнопка OK под полем; новое в списках первым, от новых к
   старым; список появляется до начала ввода; название процессу — по
   нажатию справа от слова «процесс»».

   Отсюда строение: строка — шаг (`StepRow`), в ней выборы (`Combo`) в
   том порядке, в каком владелец их назвал; входов и выходов сколько
   угодно (`PortRow`, «+ берёт», «+ отдаёт»); «+ строка» — перевод строки.
   Текстового поля нет: шаги — единственный источник (lib/process.js).

   Все правки идут через одну дверь (`commit`): процесс, его функции и
   заведённые им сущности меняются одним заходом — в историю правок ложится
   один шаг, и «отменить» возвращает всё разом, а не по частям.
   ════════════════════════════════════════════════════════════════ */

const STATUS_TONE = { off: null, hypo: WARN, on: OK };

/* ─── один выбор: подсказка слева, поле, список под полем ───
   Список открывается по фокусу — ДО набора; набранное его сужает. Имя,
   которого в списке нет, — кнопка «OK» под списком: она заводит сущность
   и ставит её сюда. `onMouseDown` с `preventDefault` на списке держит
   фокус в поле: выбор — часть набора, а не его конец. */
function Combo({ hint, word, label, value, state = "empty", options = [], onPick, onCreate,
  disabled = false, disabledWhy = "" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = filterOptions(options, text);
  const exact = exactOption(options, text);
  const fresh = !!text.trim() && !exact;
  const pick = (o) => { onPick(o); setOpen(false); setText(""); };
  const create = () => {
    if (!fresh || !onCreate) return;
    onCreate(text.trim());
    setOpen(false); setText("");
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault(); setCursor((c) => (list.length ? (c + 1) % list.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); setCursor((c) => (list.length ? (c - 1 + list.length) % list.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (exact) pick(exact);
      else if (fresh) create();
      else if (list.length) pick(list[cursor]);
    } else if (e.key === "Escape") { setOpen(false); setText(""); }
  };
  const bad = state === "deleted" || state === "unknown";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, verticalAlign: "middle" }}>
      <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{hint}</span>
      <span style={{ position: "relative", display: "inline-block" }}>
        <input value={open ? text : (value?.name || "")} aria-label={label}
          disabled={disabled} title={disabled ? disabledWhy : ""}
          placeholder={disabled ? disabledWhy : "выберите или введите"}
          onFocus={() => { setOpen(true); setText(""); setCursor(0); }}
          onBlur={() => { setOpen(false); setText(""); }}
          onChange={(e) => { setText(e.target.value); setCursor(0); }}
          onKeyDown={onKey}
          style={{ ...S.inp, width: 150, fontSize: 12, padding: "3px 6px",
            ...(bad ? { borderColor: BAD, color: BAD } : {}) }} />
        {open && (
          <div role="listbox" aria-label={`${label}: список`}
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: "absolute", left: 0, top: "100%", zIndex: 20, minWidth: "100%",
              background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6,
              maxHeight: 180, overflowY: "auto", marginTop: 2 }}>
            {list.map((o, i) => (
              <div key={o.id} role="option" aria-selected={i === cursor}
                onClick={() => pick(o)}
                style={{ padding: "5px 8px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
                  background: i === cursor ? ACC + "22" : "transparent" }}>
                {o.name}{o.fresh && <span style={{ fontSize: 10, color: WARN }}> · новое</span>}
              </div>))}
            {!list.length && !fresh && (
              <div style={{ padding: "5px 8px", fontSize: 11, color: C.muted }}>пусто</div>)}
            {fresh && (onCreate
              ? <div style={{ padding: 6, borderTop: list.length ? `1px solid ${C.line}` : "none",
                whiteSpace: "nowrap" }}>
                <button type="button" style={{ ...btn(true, OK), fontSize: 11, padding: "2px 10px" }}
                  aria-label={`OK: новый ${word} «${text.trim()}»`}
                  onMouseDown={(e) => { e.preventDefault(); create(); }}>OK</button>
                <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 6 }}>
                  завести {word} «{text.trim()}»</span>
              </div>
              : <div style={{ padding: "5px 8px", fontSize: 11, color: C.muted }}>
                такого нет в списке</div>)}
          </div>)}
      </span>
      {state === "deleted" && (
        <span style={{ fontSize: 10, color: BAD, whiteSpace: "nowrap" }}>удалён — выберите замену</span>)}
      {state === "unknown" && (
        <span style={{ fontSize: 10, color: BAD, whiteSpace: "nowrap" }}>не найден</span>)}
    </span>);
}

/* ─── вход или выход шага: из какого / в какой актив, что, сколько ─── */
function PortRow({ port, side, idx, assets, traitsOf, model, onChange, onRemove,
  onCreateAsset, onCreateTrait }) {
  const verb = side === "takes" ? "берёт" : "отдаёт";
  const assetState = stateOf(port.asset, "asset", model);
  const traitState = stateOf(port.trait, "trait", model);
  return (
    <div className="flex flex-wrap items-center gap-2" style={{ marginLeft: 14, marginTop: 4 }}>
      <Combo hint={side === "takes" ? "из актива" : "в актив"} word="актив"
        label={`${verb} ${idx + 1}: актив`} value={port.asset} state={assetState}
        options={assets} onPick={(o) => onChange({ ...port, asset: o, trait: null })}
        onCreate={onCreateAsset ? (n) => onCreateAsset(n) : undefined} />
      <Combo hint="ресурс" word="ресурс" label={`${verb} ${idx + 1}: ресурс`}
        value={port.trait} state={traitState}
        options={assetState === "ok" ? traitsOf(port.asset.id) : []}
        disabled={assetState !== "ok"} disabledWhy="сначала актив"
        onPick={(o) => onChange({ ...port, trait: o })}
        onCreate={assetState === "ok" && onCreateTrait
          ? (n) => onCreateTrait(port.asset.id, n) : undefined} />
      <span style={{ fontSize: 10.5, color: C.muted }}>×</span>
      <NumField value={port.qty} aria-label={`${verb} ${idx + 1}: сколько`}
        style={{ width: 54, fontSize: 12, padding: "3px 6px" }}
        onCommit={(v) => onChange({ ...port, qty: v > 0 ? v : 1 })} />
      <button type="button" aria-label={`убрать: ${verb} ${idx + 1}`}
        style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD, borderColor: "#5A2436" }}
        onClick={onRemove}>✕</button>
    </div>);
}

export default function ProcessPanel({ procs = [], setProcs, entities = [], setEntities,
  traits = [], setTraits, funcs = [], setFuncs, onDropFuncs, makeEntity,
  positions = [], onAddPosition }) {
  const [naming, setNaming] = useState(null);   // какой процесс сейчас называют
  // Последние процессы — для правок, приходящих с сервера (новая должность).
  const procsRef = useRef(procs); procsRef.current = procs;

  /* Одна дверь на все правки. Текст каждого процесса пересчитывается из
     шагов; функции процессов пересобираются по нынешним шагам и статусам;
     задачи по функциям, которых больше нет, снимаются. */
  const commit = ({ procs: next, entities: e2 = entities, traits: t2 = traits,
    funcs: f2 = funcs }) => {
    const m = { entities: e2, traits: t2, positions };
    const withText = next.map((p) => ({ ...p, text: procText(p) }));
    const synced = syncProcFuncs(f2, withText, m, normalizeFunc);
    setProcs(withText);
    if (e2 !== entities) setEntities(e2);
    if (t2 !== traits) setTraits(t2);
    setFuncs(synced);
    const after = new Set(synced.filter((f) => f.proc).map((f) => f.id));
    const gone = funcs.filter((f) => f.proc && !after.has(f.id)).map((f) => f.id);
    if (gone.length && onDropFuncs) onDropFuncs(gone);
  };
  const patchIn = (list, id, make) => list.map((p) => (p.id === id ? make(p) : p));
  const patch = (id, make) => patchIn(procs, id, make);
  const withStep = (list, pid, sid, make) => patchIn(list, pid, (p) => ({ ...p,
    steps: p.steps.map((s) => (s.id === sid ? make(s) : s)) }));
  const withPort = (list, pid, sid, side, i, make) => withStep(list, pid, sid, (s) => ({ ...s,
    [side]: s[side].map((x, j) => (j === i ? make(x) : x)) }));

  const add = () => commit({ procs: [...procs, newProc()] });
  const rename = (p, name) => commit({ procs: patch(p.id, (x) => ({ ...x, name: name.trim() })) });
  const addStep = (p) => commit({ procs: patch(p.id, (x) => ({ ...x, steps: [...x.steps, newStep()] })) });
  const dropStep = (p, sid) => commit({ procs: patch(p.id, (x) => ({ ...x,
    steps: x.steps.filter((s) => s.id !== sid) })) });
  const setStep = (p, sid, make) => commit({ procs: withStep(procs, p.id, sid, make) });
  const addPort = (p, sid, side) => setStep(p, sid, (s) => ({ ...s, [side]: [...s[side], newPort()] }));
  const dropPort = (p, sid, side, i) => setStep(p, sid, (s) => ({ ...s,
    [side]: s[side].filter((_, j) => j !== i) }));
  const setPort = (p, sid, side, i, port) => commit({ procs: withPort(procs, p.id, sid, side, i, () => port) });

  /* «Не принято» — функций от процесса нет, и его гипотезы уходят со
     схемы: без процесса они ничьи. Задачи по его функциям — тоже. */
  const setStatus = (p, status) => {
    if (status === "off") {
      const d = dropHypo(p, { entities, traits, funcs });
      commit({ procs: patch(p.id, () => ({ ...d.proc, status })), entities: d.entities,
        traits: d.traits, funcs: d.funcs });
      return;
    }
    if (!canAcceptProc(p, { entities, traits, positions })) return;
    commit({ procs: patch(p.id, (x) => ({ ...x, status })) });
  };
  const del = (p) => {
    const d = dropHypo(p, { entities, traits, funcs });
    commit({ procs: procs.filter((x) => x.id !== p.id), entities: d.entities,
      traits: d.traits, funcs: d.funcs });
  };

  /* «OK» — завести сущность и поставить её в выбор одним заходом. Актив —
     рядом с существующими, ресурс — в названном активе, оба с пометкой
     `hypo` (ресурс к тому же не принят — принимает его человек в
     карточке). Должность — запись организации: уезжает на сервер, и
     выбор ставится, когда сервер ответил; в списке потом стоит первой. */
  const createAsset = (p, name, apply) => {
    const e = { ...makeEntity(name), hypo: true };
    const it = { id: e.id, name: e.name };
    commit({ entities: [...entities, e],
      procs: apply(patch(p.id, (x) => ({ ...x,
        hypo: { ...x.hypo, entities: [...x.hypo.entities, e.id] } })), it) });
  };
  const createTrait = (p, assetId, name, apply) => {
    const t = { id: `t${Date.now().toString(36)}${traits.length.toString(36)}`, e: assetId,
      ks: [], k: "", l: name, unit: "ед.", hypo: true, accepted: false };
    const it = { id: t.id, name: t.l };
    commit({ traits: [...traits, t],
      procs: apply(patch(p.id, (x) => ({ ...x,
        hypo: { ...x.hypo, traits: [...x.hypo.traits, t.id] } })), it) });
  };
  const createRole = (p, sid, name) => {
    if (!onAddPosition) return;
    Promise.resolve(onAddPosition(name)).then((r) => {
      if (!r || r.id == null) return;
      const it = { id: r.id, name: r.name || name };
      const list = procsRef.current;
      commit({ procs: withStep(patchIn(list, p.id, (x) => ({ ...x,
        hypo: { ...x.hypo, roles: [...x.hypo.roles, r.id] } })), p.id, sid,
      (s) => ({ ...s, role: it })) });
    }).catch(() => {});
  };

  const model = { entities, traits, positions };
  const optAssets = (p) => orderOptions(entities.map((e) => ({ id: e.id, name: e.name,
    fresh: p.hypo.entities.includes(e.id) })), p.hypo.entities);
  const optTraits = (p, assetId) => orderOptions(traits.filter((t) => t.e === assetId)
    .map((t) => ({ id: t.id, name: t.l, fresh: p.hypo.traits.includes(t.id) })), p.hypo.traits);
  const optRoles = (p) => orderOptions(positions.map((r) => ({ id: r.id, name: r.name,
    fresh: p.hypo.roles.includes(r.id) })), p.hypo.roles);

  return (
    <div style={{ ...S.card, marginTop: 10 }}>
      <Section title="технологические процессы" addLabel="+ процесс" onAdd={add}
        hint="Строка — шаг: актив, должность, что берёт и откуда, что отдаёт и куда. Всё выбирается из списков; новое имя заводится кнопкой OK."
        empty={procs.length ? null : "Процессов пока нет."}>
        {procs.map((p) => {
          const issues = procIssues(p, model);
          const can = issues.length === 0;
          const label = procLabel(p);
          const assets = optAssets(p);
          const roles = optRoles(p);
          return (
            <div key={p.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
              borderRadius: 8, padding: 8, marginBottom: 8,
              borderLeft: `2px solid ${STATUS_TONE[p.status] || C.line}` }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <span style={S.lbl}>процесс</span>
                {/* Название — по нажатию справа от слова «процесс»: поле
                    становится редактируемым, Enter или уход — записывает. */}
                {naming === p.id ? (
                  <input autoFocus aria-label="название процесса" defaultValue={p.name}
                    placeholder="название процесса"
                    style={{ ...S.inp, flex: 1, fontSize: 12.5, fontWeight: 600, padding: "3px 6px" }}
                    onBlur={(e) => { rename(p, e.target.value); setNaming(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setNaming(null);
                    }} />
                ) : (
                  <button type="button" aria-label={`назвать процесс «${label}»`}
                    title="нажмите, чтобы назвать процесс" onClick={() => setNaming(p.id)}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent",
                      border: "none", padding: 0, color: p.name ? C.text : C.muted, fontSize: 12.5,
                      fontWeight: 600, cursor: "text", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}</button>)}
                <span style={{ fontSize: 10.5, color: STATUS_TONE[p.status] || C.muted,
                  whiteSpace: "nowrap" }}>
                  {PROC_STATUS.find(([id]) => id === p.status)?.[1].toLowerCase()}</span>
                <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                  fontSize: 11, padding: "2px 6px" }}
                  aria-label={`удалить процесс «${label}»`} onClick={() => del(p)}>удалить</button>
              </div>

              {p.steps.map((s, i) => {
                const n = i + 1;
                const assetState = stateOf(s.asset, "asset", model);
                const roleState = stateOf(s.role, "role", model);
                const portRows = (side) => s[side].map((port, j) => (
                  <PortRow key={j} port={port} side={side} idx={j} assets={assets}
                    traitsOf={(id) => optTraits(p, id)} model={model}
                    onChange={(x) => setPort(p, s.id, side, j, x)}
                    onRemove={() => dropPort(p, s.id, side, j)}
                    onCreateAsset={(name) => createAsset(p, name, (list, it) =>
                      withPort(list, p.id, s.id, side, j, (x) => ({ ...x, asset: it, trait: null })))}
                    onCreateTrait={(assetId, name) => createTrait(p, assetId, name, (list, it) =>
                      withPort(list, p.id, s.id, side, j, (x) => ({ ...x, trait: it })))} />));
                return (
                  <div key={s.id} style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6,
                    border: `1px solid ${C.line}` }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ fontSize: 10.5, color: C.muted }}>{n}.</span>
                      <Combo hint="актив" word="актив" label={`строка ${n}: актив`}
                        value={s.asset} state={assetState} options={assets}
                        onPick={(o) => setStep(p, s.id, (x) => ({ ...x, asset: o }))}
                        onCreate={(name) => createAsset(p, name, (list, it) =>
                          withStep(list, p.id, s.id, (x) => ({ ...x, asset: it })))} />
                      <Combo hint="должность" word="должность" label={`строка ${n}: должность`}
                        value={s.role} state={roleState} options={roles}
                        disabled={!positions.length && !onAddPosition}
                        disabledWhy="должностей нет"
                        onPick={(o) => setStep(p, s.id, (x) => ({ ...x, role: o }))}
                        onCreate={onAddPosition ? (name) => createRole(p, s.id, name) : undefined} />
                      <span style={{ flex: 1 }} />
                      <button type="button" aria-label={`убрать строку ${n}`}
                        style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD,
                          borderColor: "#5A2436" }}
                        onClick={() => dropStep(p, s.id)}>✕ строка</button>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span style={{ fontSize: 10.5, color: C.muted }}>берёт:</span>
                      {!s.takes.length && (
                        <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 6 }}>ничего</span>)}
                      {portRows("takes")}
                      <button type="button" aria-label={`строка ${n}: + берёт`}
                        style={{ ...btn(false), fontSize: 11, padding: "2px 8px", marginLeft: 14,
                          marginTop: 4 }}
                        onClick={() => addPort(p, s.id, "takes")}>+ берёт</button>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span style={{ fontSize: 10.5, color: C.muted }}>отдаёт:</span>
                      {!s.gives.length && (
                        <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 6 }}>ничего</span>)}
                      {portRows("gives")}
                      <button type="button" aria-label={`строка ${n}: + отдаёт`}
                        style={{ ...btn(false), fontSize: 11, padding: "2px 8px", marginLeft: 14,
                          marginTop: 4 }}
                        onClick={() => addPort(p, s.id, "gives")}>+ отдаёт</button>
                    </div>
                  </div>);
              })}
              <button type="button" aria-label={`процесс «${label}»: + строка`}
                style={{ ...btn(false), fontSize: 11, padding: "3px 8px", marginTop: 6 }}
                onClick={() => addStep(p)}>+ строка</button>

              {!!issues.length && (
                <div style={{ fontSize: 10.5, color: BAD, marginTop: 6, lineHeight: 1.5 }}>
                  {issues.map((w, i) => <div key={i}>{w}</div>)}
                </div>)}

              {/* Три состояния, одно нажатие. Принять — гипотетически или
                  насовсем — нельзя, пока строки не собраны: подсказка
                  говорит, чего не хватает. */}
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
