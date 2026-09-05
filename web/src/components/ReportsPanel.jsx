import React, { useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm, TxtField } from "./ui.jsx";
import { funcLabel } from "./TasksBoard.jsx";
import { reportSrc } from "../storage.js";
import { putShare } from "../identity.js";
import {
  briefOf, childrenOf, dropNode, linkTo, newPick, newProject, newSection,
  pathOf, resultsOf, rootsOf, shareLink, summaryOf,
} from "../lib/reports.js";

/* ════════════════════════════════════════════════════════════════
   ОТЧЁТЫ · карта проектов

   Проект и раздел — один и тот же блок, и вкладываются они друг в друга
   без предела: раздел внутри раздела внутри проекта. Поэтому карта здесь
   не рисуется отдельной картинкой, а СОБИРАЕТСЯ ИЗ ОДИНАКОВЫХ БЛОКОВ —
   вложенных, как они и заданы. На телефоне это и есть самая честная карта:
   ветку видно целиком, и никуда не надо тащить холст.

   Внутри блока говорится, что в него попадает: результаты какой функции и
   по какому ресурсу. Дальше приложение собирает их само — из сдач, которые
   уже сделаны: дата, кто, сколько часов, сколько ресурса и приложенный
   файл. Ничего не переписывается руками: переписанное разошлось бы с тем,
   что было на самом деле.
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Строка результата: одна сдача — то, что и правда было сделано. */
function Row({ r, traitName, nameOf }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, flex: "1 1 130px" }}>{r.title}</span>
        <span style={{ fontSize: 11, color: r.qty >= 0 ? OK : WARN }}>
          {r.qty >= 0 ? "+" : "−"}{nm(Math.abs(r.qty))} {traitName(r.trait)}</span>
        <span style={{ fontSize: 10.5, color: r.accepted ? OK : WARN }}>
          {r.accepted ? "принято" : "не принято"}</span>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.6 }}>
        {fmtDT(r.at)} · {r.by == null ? "исполнитель не назначен"
          : (nameOf ? nameOf(r.by) : r.by)} · {nm(r.hours)} ч
      </div>
      {r.text && (
        <div style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5,
          whiteSpace: "pre-wrap" }}>{r.text}</div>)}
      {r.file && (/^image\//.test(r.file.type || "")
        ? <img src={reportSrc(r.file)} alt={r.file.name}
            style={{ maxWidth: "100%", borderRadius: 6, marginTop: 5,
              border: `1px solid ${C.line}` }} />
        : <a href={reportSrc(r.file)} target="_blank" rel="noreferrer"
            style={{ fontSize: 10.5, color: ACC, display: "inline-block", marginTop: 4 }}>
            📎 {r.file.name}</a>)}
    </div>);
}

/** Один блок карты — и проект, и раздел: они устроены одинаково. */
function Node({ node, nodes, model, depth = 0, focus, onFocus, setNodes,
  traitName, nameOf, entities }) {
  const [open, setOpen] = useState(depth < 1);
  const [link, setLink] = useState(null);
  const [linkErr, setLinkErr] = useState("");
  const [busy, setBusy] = useState(false);
  const kids = childrenOf(nodes, node.id);
  const up = (patch) => setNodes((p) => p.map((n) => (n.id === node.id ? { ...n, ...patch } : n)));
  const picks = node.picks || [];
  const rows = resultsOf(model, picks);
  const sum = summaryOf(model, node, nodes);
  const brief = briefOf(nodes, node.id);
  const own = brief && brief.node.id === node.id;
  const root = !node.parent;

  /* Ссылка наружу — это снимок блока на сервере, а не адрес приложения:
     тот, кому её дали, не участник модели, и пускать его в неё нельзя. Тот
     же вызов обновляет снимок у уже созданной ссылки: адрес остаётся, а
     показанное в нём становится сегодняшним. */
  const makeLink = async () => {
    setBusy(true); setLinkErr("");
    try {
      const saved = await putShare(node.id);
      const url = shareLink(saved.token);
      setLink(url);
      try { await navigator.clipboard.writeText(url); } catch { /* покажем адрес */ }
    } catch (e) {
      // Без сервера снимка нет: тогда честнее дать ссылку внутрь приложения
      // и сказать, что она откроется только у своих.
      setLink(linkTo(node.id));
      setLinkErr(e.message || "снимок не сохранился");
    }
    setBusy(false);
  };

  return (
    <div style={{ background: depth ? "transparent" : C.panel2,
      border: `1px solid ${focus === node.id ? ACC : C.line}`, borderRadius: 10,
      padding: 9, marginTop: 8,
      // Вложенность видно слева: у ветки должна быть видимая ветка.
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
        сдач: {sum.rows} · принято: {sum.accepted} · файлов: {sum.files} · {nm(sum.hours)} ч
      </div>

      {open && (<>
        {/* Задание. У проекта — своё; раздел показывает ближайшее сверху,
            пока не заведёт собственное. */}
        <div style={{ ...S.lbl, marginTop: 8 }}>
          {root ? "техническое задание" : "задание раздела"}</div>
        <TxtField area value={node.brief}
          aria-label={root ? "техническое задание" : `задание раздела ${node.name}`}
          placeholder={own || root ? "что заказано: своими словами или текстом заказчика"
            : "своё задание — если у раздела оно отдельное"}
          style={{ minHeight: 52, margin: "4px 0", lineHeight: 1.5 }}
          onCommit={(v) => up({ brief: v })} />
        {brief && !own && (
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
            Действует задание «{brief.node.name}»: всё, что здесь лежит,
            относится к нему.
          </div>)}

        {/* Что сюда попадает: результаты функции по конкретному ресурсу. */}
        <div style={{ ...S.lbl, marginTop: 8 }}>что сюда попадает</div>
        {!picks.length && (
          <div style={{ fontSize: 11, color: C.muted, margin: "4px 0", lineHeight: 1.5 }}>
            Пока ничего. Выберите функцию и ресурс: сюда попадут её сдачи по
            этому ресурсу — с числами и приложенными файлами.
          </div>)}
        {picks.map((p) => (
          <div key={p.id} className="flex flex-wrap gap-2"
            style={{ alignItems: "center", marginTop: 4 }}>
            <select style={{ ...S.inp, flex: "1 1 130px", minWidth: 0, fontSize: 11.5,
              padding: "4px 6px" }}
              aria-label="функция результата" value={p.func}
              onChange={(e) => up({ picks: picks.map((x) => (x.id === p.id
                ? { ...x, func: e.target.value } : x)) })}>
              <option value="">— функция —</option>
              {(model.funcs || []).map((f) => (
                <option key={f.id} value={f.id}>{funcLabel(f, entities)}</option>))}
            </select>
            <select style={{ ...S.inp, flex: "1 1 110px", minWidth: 0, fontSize: 11.5,
              padding: "4px 6px" }}
              aria-label="ресурс результата" value={p.trait}
              onChange={(e) => up({ picks: picks.map((x) => (x.id === p.id
                ? { ...x, trait: e.target.value } : x)) })}>
              <option value="">— ресурс —</option>
              {(model.traits || []).map((t) => (
                <option key={t.id} value={t.id}>{t.l}</option>))}
            </select>
            <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
              aria-label="убрать результат"
              onClick={() => up({ picks: picks.filter((x) => x.id !== p.id) })}>×</button>
          </div>))}
        <button style={{ ...btn(false), fontSize: 11, marginTop: 6 }}
          onClick={() => up({ picks: [...picks, newPick()] })}>+ результат</button>

        {!!rows.length && (<>
          <div style={{ ...S.lbl, marginTop: 10 }}>сделано</div>
          {rows.map((r) => (
            <Row key={r.id} r={r} traitName={traitName} nameOf={nameOf} />))}
        </>)}

        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          <button style={{ ...btn(false), fontSize: 11 }}
            onClick={() => setNodes((p) => [...p, newSection(node.id)])}>
            + раздел внутри</button>
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
                : "Открывается у кого угодно и без входа: там снимок этого блока — задание, разделы и принятые работы, и ничего сверх. Нажмите «обновить ссылку», чтобы показать сегодняшнее; чтобы закрыть доступ — удалите ссылку в списке."}
            </div>
          </div>)}

        {kids.map((k) => (
          <Node key={k.id} node={k} nodes={nodes} model={model} depth={depth + 1}
            focus={focus} onFocus={onFocus} setNodes={setNodes}
            traitName={traitName} nameOf={nameOf} entities={entities} />))}
      </>)}
    </div>);
}

export default function ReportsPanel({ nodes = [], setNodes, model = {},
  entities = [], nameOf, focus, onFocus }) {
  const traitName = (id) => (model.traits || []).find((t) => t.id === id)?.l
    || (id ? "(ресурс удалён)" : "");
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
          Проект и раздел — один и тот же блок, вложенный в другой: карта
          собирается из одинаковых блоков без предела глубины. В блоке
          говорится, результаты какой функции и по какому ресурсу в него
          попадают, — остальное приложение соберёт из уже сделанных сдач.
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
          Проектов пока нет. Проект — это заказ или направление работы: у него
          есть техническое задание, и всё, что в нём лежит, относится к нему.
        </div>)}

      {focus && !path.length && (
        <div style={{ ...S.card, fontSize: 11.5, color: WARN, lineHeight: 1.6 }}>
          Такого блока в этой модели нет. Возможно, ссылка ведёт в другую
          рабочую область или блок удалили.
        </div>)}

      {shown.map((n) => (
        <Node key={n.id} node={n} nodes={nodes} model={model} focus={focus}
          onFocus={onFocus} setNodes={setNodes} traitName={traitName}
          nameOf={nameOf} entities={entities} />))}
    </div>);
}
