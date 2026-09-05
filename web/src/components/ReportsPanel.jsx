import React, { useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm, TxtField } from "./ui.jsx";
import { funcLabel } from "./TasksBoard.jsx";
import { reportSrc } from "../storage.js";
import { putShare } from "../identity.js";
import {
  childrenOf, dropNode, linkTo, newPick, newProject, newSection,
  pathOf, resultsOf, rootsOf, shareLink, summaryOf,
} from "../lib/reports.js";
import { unitsOfTrait } from "../lib/units.js";

/* ════════════════════════════════════════════════════════════════
   ОТЧЁТЫ · карта проектов

   Проект и раздел — один и тот же блок, и вкладываются они друг в друга
   без предела: раздел внутри раздела внутри проекта. Поэтому карта здесь
   не рисуется отдельной картинкой, а СОБИРАЕТСЯ ИЗ ОДИНАКОВЫХ БЛОКОВ —
   вложенных, как они и заданы. На телефоне это и есть самая честная карта:
   ветку видно целиком, и никуда не надо тащить холст.

   Внутри блока — ссылки на ОПРЕДЕЛЁННЫЕ результаты: вот это техническое
   задание №3, вот дизайн №7, который к нему относится. Функция и ресурс
   тут — способ найти нужную единицу, а не сам ответ; сам результат
   приложение достаёт из сдачи, которая уже сделана: дата, кто, сколько
   часов и приложенный файл. Ничего не переписывается руками: переписанное
   разошлось бы с тем, что было на самом деле.

   Поля «техническое задание» здесь нет и не будет. Заказ, описанный полем,
   — это пересказ, а пересказ расходится с делом в первый же день. Само
   задание — такой же результат чьей-то работы, со своим номером: его и
   кладут в раздел.
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/* Что функция ВЫДАЁТ. Результат берётся с выхода, а не со входа: взятое
   функция получила от кого-то другого, а сделала она то, что выдала.
   Поэтому и ресурс в паре выбирается из её выходов. */
const madeBy = (f) => (f?.gives || []).map((g) => g.trait);

/** Строка результата: одна сдача — то, что и правда было сделано. */
function Row({ r, traitName, nameOf }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        {/* Номер единицы — то, чем результаты и различаются: «задание №3»
            можно назвать вслух и найти. */}
        {r.no != null && (
          <span style={{ fontSize: 11, color: ACC, fontWeight: 700 }}>№{r.no}</span>)}
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
  const allFuncs = model.funcs || [];
  const allTraits = model.traits || [];
  // Ресурсы, которые хоть кто-то выдаёт: только у них и бывают результаты.
  const made = allTraits.filter((t) => allFuncs.some((f) => madeBy(f).includes(t.id)));
  const rows = resultsOf(model, picks);
  const sum = summaryOf(model, node, nodes);
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
        {/* Что сюда попадает: определённая единица ресурса, по номеру. */}
        <div style={{ ...S.lbl, marginTop: 8 }}>что сюда попадает</div>
        {!picks.length && (
          <div style={{ fontSize: 11, color: C.muted, margin: "4px 0", lineHeight: 1.5 }}>
            {made.length
              ? "Пока ничего. Выберите функцию, потом — что из выданного ею сюда попадает, и наконец определённый результат по номеру: вот это техническое задание, вот дизайн, который к нему относится."
              : "Пока ничего — и выбрать пока не из чего: ни одна функция модели ничего не выдаёт, а результат бывает только у выданного."}
          </div>)}
        {picks.map((p) => {
          // Единицы этого ресурса — те, что и правда получились из сдач.
          const units = p.trait ? unitsOfTrait(model, p.trait)
            .filter((u) => !p.func || u.func === p.func) : [];
          const func = allFuncs.find((f) => f.id === p.func) || null;
          /* ─── списки связаны, но не запирают ───

             Функция и ресурс — не два независимых вопроса: результат бывает
             только там, где функция этот ресурс ВЫДАЁТ. Предлагать пару, у
             которой не может быть ни одного результата, значит предлагать
             выбрать пустоту — и человек будет искать, куда делись работы,
             которых там никогда и не было.

             Ведёт ФУНКЦИЯ: ресурсы — это её выходы. Список функций при
             выбранной функции не сужается ничем: сузить его выбранным
             ресурсом значило бы запереть человека в первом же выборе —
             сменить функцию стало бы нельзя, пока не сотрёшь ресурс.
             Сменил функцию — ресурс, которого она не выдаёт, снимается сам.

             Пока функция не выбрана, список сужается ресурсом: это путь
             «мне нужно вот это техническое задание — кто его делает». */
          const funcOpts = allFuncs.filter((f) => madeBy(f).length
            && (p.func || !p.trait || madeBy(f).includes(p.trait)));
          const traitOpts = func ? allTraits.filter((t) => madeBy(func).includes(t.id))
            : made;
          /* Пара, ставшая невозможной (функция перестала выдавать этот
             ресурс), не превращается в пустое поле: она показана как есть и
             помечена. Пустое поле выглядело бы как «ничего не выбрано», и
             человек не понял бы, что именно сломалось. */
          const stale = (list, id) => id && !list.some((x) => x.id === id);
          return (
            <div key={p.id} style={{ border: `1px solid ${C.line}`, borderRadius: 8,
              padding: 7, marginTop: 5 }}>
              <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
                <select style={{ ...S.inp, flex: "1 1 130px", minWidth: 0, fontSize: 11.5,
                  padding: "4px 6px" }}
                  aria-label="функция результата" value={p.func}
                  onChange={(e) => {
                    const next = allFuncs.find((f) => f.id === e.target.value) || null;
                    // Ресурс, которого новая функция не выдаёт, не остаётся:
                    // иначе пара молча стала бы невозможной.
                    const keep = !p.trait || (next && madeBy(next).includes(p.trait));
                    up({ picks: picks.map((x) => (x.id === p.id
                      ? { ...x, func: e.target.value, trait: keep ? x.trait : "", unit: "" }
                      : x)) });
                  }}>
                  <option value="">— функция —</option>
                  {funcOpts.map((f) => (
                    <option key={f.id} value={f.id}>{funcLabel(f, entities)}</option>))}
                  {stale(funcOpts, p.func) && (
                    <option value={p.func}>
                      {funcLabel(func, entities)} — этот ресурс не выдаёт</option>)}
                </select>
                <select style={{ ...S.inp, flex: "1 1 110px", minWidth: 0, fontSize: 11.5,
                  padding: "4px 6px" }}
                  aria-label="ресурс результата" value={p.trait}
                  onChange={(e) => up({ picks: picks.map((x) => (x.id === p.id
                    ? { ...x, trait: e.target.value, unit: "" } : x)) })}>
                  <option value="">
                    {func ? "— что она выдаёт —" : "— ресурс —"}</option>
                  {traitOpts.map((t) => (
                    <option key={t.id} value={t.id}>{t.l}</option>))}
                  {stale(traitOpts, p.trait) && (
                    <option value={p.trait}>
                      {traitName(p.trait)} — эта функция его не выдаёт</option>)}
                </select>
                <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
                  aria-label="убрать результат"
                  onClick={() => up({ picks: picks.filter((x) => x.id !== p.id) })}>×</button>
              </div>
              {/* Определённый результат по номеру — то, ради чего всё и
                  затевалось. Пусто — попадут все: так раздел заводят
                  заранее, когда работ ещё не было. */}
              <select style={{ ...S.inp, marginTop: 5, fontSize: 11.5, padding: "4px 6px" }}
                aria-label="определённый результат" value={p.unit || ""}
                disabled={!p.trait}
                onChange={(e) => up({ picks: picks.map((x) => (x.id === p.id
                  ? { ...x, unit: e.target.value } : x)) })}>
                <option value="">
                  {p.trait ? "все результаты этой функции по этому ресурсу"
                    : "— сначала выберите ресурс —"}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    №{u.no} · {u.title || "без названия"}
                    {u.accepted ? "" : " (не принято)"}</option>))}
              </select>
              {stale(traitOpts, p.trait) && (
                <div style={{ fontSize: 10, color: WARN, marginTop: 3, lineHeight: 1.5 }}>
                  Эта функция такого ресурса не выдаёт — результатов тут не
                  будет никогда. Выберите то, что она и правда делает.
                </div>)}
              {p.trait && !stale(traitOpts, p.trait) && !units.length && (
                <div style={{ fontSize: 10, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
                  Единиц с номерами ещё нет: они появляются из сдач — сдали
                  работу, и её результат стал вещью, на которую можно
                  сослаться.
                </div>)}
            </div>);
        })}
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
                : "Открывается у кого угодно и без входа: там снимок этого блока — разделы и принятые работы, и ничего сверх. Нажмите «обновить ссылку», чтобы показать сегодняшнее; чтобы закрыть доступ — удалите ссылку в списке."}
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
          собирается из одинаковых блоков без предела глубины. В блоке —
          ссылки на определённые результаты по номерам: вот это техническое
          задание, вот дизайн к нему. Сами результаты приложение достанет из
          уже сделанных сдач.
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
          Проектов пока нет. Проект — это заказ или направление работы: в нём
          разделы и ссылки на определённые результаты, каждый со своим
          номером.
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
