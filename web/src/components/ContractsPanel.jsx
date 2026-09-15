import React, { useEffect, useRef, useState } from "react";
import { ACC, BAD, C, OK, S, WARN, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import FramedField from "./FramedField.jsx";
import SignaturePad from "./SignaturePad.jsx";
import {
  addDoc, addDocVersion, createAgreement, docHtml, removeDoc, removeDocVersion, updateDoc,
} from "../identity.js";
import { getTelegram } from "../telegram.js";
import { changeFormsHtml } from "../lib/docdiff.js";

/* ════════════════════════════════════════════════════════════════
   ДОГОВОРЫ · документы с версиями, просмотр и правка, приглашение

   Владелец (2026-09-14): «форма договоров как у анкет: название, под
   ним чекбокс «такое же, как у файла», загрузка файла, под ней поля
   плейсхолдеров. После загрузки кнопка «Загрузить» становится названием
   документа, справа — «Удалить». Нажатие на файл — дерево старых версий,
   у каждой «Удалить» — простое git-хранилище документов. Нажатие на
   документ выделяет его цветом, название становится кнопкой «Скачать», а
   справа — «Сохранить изменения»; под кнопками — описание изменений, как
   в git. Документ открывается над формой на весь экран, листается и
   правится; крестик в тёмном кружке закрывает. Все документы — Word.
   Повторное нажатие на выделенный документ закрывает его и снимает
   выделение. Плейсхолдеры — `[(ключ): описание]` — загружаются из
   документа сами; поля — одиночные, с описанием над полем, в тонкой
   рамке, замкнутой на середине букв описания (FramedField). Заполнять все
   не обязательно, но при выдаче договора они должны быть заполнены.
   «Пригласить участника»: заполнить пустые плейсхолдеры договора роли,
   сумму, даты начала и окончания, поставить подпись, «Отправить» —
   выбрать человека из чатов или переслать его сообщение боту».

   Что здесь решено:
   · Плейсхолдеры извлекает сервер при загрузке (документ — zip с XML,
     браузеру его не разобрать без библиотек): поля появляются на
     карточке документа сразу после загрузки, там же и заполняются.
   · Просмотр и правка — через HTML, который сервер делает из .docx, и
     обратно: текст, жирный/курсив/подчёркивание, рамки, таблицы. Сложное
     оформление Word при правке в приложении упрощается — это сказано
     под документом. Кто хочет сохранить оформление — правит в Word и
     загружает новую версию файлом.
   · Изменения — не словами, а как в git (владелец, 2026-09-14): разница
     по абзацам между версиями двумя рамками — зелёная с «+» (добавлено),
     красная с «−» (убрано); у выделенного документа с правками — что
     уйдёт в новую версию, без правок — последняя версия против
     предыдущей; в дереве версий у каждой «+N −M».
   · Приглашение — ссылка на бота с токеном договора: «Выбрать чат»
     открывает у владельца выбор чата Telegram (t.me/share), человек
     открывает бота по ссылке — и договор его. Запасной путь — переслать
     боту сообщение человека: ждущий договор роли привяжется сам.
   ════════════════════════════════════════════════════════════════ */

const hint = { fontSize: 11, color: C.muted, lineHeight: 1.5 };
const sub = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8,
  marginBottom: 6 };
const when = (iso) => {
  const d = new Date(iso || "");
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
    year: "2-digit", hour: "2-digit", minute: "2-digit" });
};
export const dayText = (v) => {
  const d = new Date(String(v || ""));
  return isNaN(d.getTime()) ? String(v || "—") : d.toLocaleDateString("ru-RU");
};
const last = (doc) => (doc?.versions || [])[doc.versions.length - 1] || null;
const REQUIRED = ["sum", "start", "end"];
const REQUIRED_LABEL = { sum: "сумма договора", start: "начало действия", end: "окончание действия" };

/* ─────── поля плейсхолдеров ─────── */

/**
 * Одиночные поля с описанием над каждым, в рамке (FramedField). Ключи
 * sum/start/end — обязательные плейсхолдеры договора: сумма и даты; у дат
 * — поле даты. `required` — при выдаче: тогда пустое подсвечено.
 */
export function PlaceholderFields({ placeholders = [], values = {}, onChange, required = false,
  disabled = false, only = null, label = "плейсхолдер" }) {
  const list = placeholders.filter((p) => !only || only.includes(p.key));
  if (!list.length) return <div style={hint}>Плейсхолдеров в документе нет.</div>;
  return list.map((p) => {
    const dateKey = p.key === "start" || p.key === "end";
    const v = values[p.key] ?? "";
    const must = required && REQUIRED.includes(p.key);
    return (
      <FramedField key={p.key} label={`${p.desc || p.key}${REQUIRED.includes(p.key) ? ` (${REQUIRED_LABEL[p.key]})` : ""}`}
        required={must}>
        <input aria-label={`${label}: ${p.key}`} type={dateKey ? "date" : "text"}
          inputMode={p.key === "sum" ? "decimal" : undefined}
          style={{ ...S.inp, padding: "5px 7px", fontSize: 12,
            borderColor: must && !String(v).trim() ? `${BAD}88` : C.line }}
          value={v} disabled={disabled}
          onChange={(e) => onChange({ ...values, [p.key]: e.target.value })} />
      </FramedField>);
  });
}

/* ─────── документ на весь экран ─────── */

/* Круглый полупрозрачный значок на документе — как крестик, чтобы не
   загораживать текст (владелец, 2026-09-15). */
const roundBtn = (extra = {}) => ({ width: 38, height: 38, borderRadius: "50%",
  background: "rgba(29,40,57,.72)", color: "#fff", border: `1px solid ${C.line}`, fontSize: 17,
  lineHeight: "36px", textAlign: "center", cursor: "pointer", boxShadow: "0 2px 8px #0008",
  backdropFilter: "blur(2px)", padding: 0, ...extra });

/**
 * Документ над формой, на весь экран: HTML от сервера в contentEditable —
 * его листают и правят. Кнопки — ТОЛЬКО здесь, столбиком под крестиком
 * (владелец, 2026-09-15): свернуть (документ прячется, правки остаются),
 * отменить и вернуть правку, сохранить (новая версия). Крестик закрывает;
 * несохранённые правки при этом спрашиваются.
 */
export function DocViewer({ title, html, editable = true, dirty = false, busy = false,
  onChange, onSave, onCollapse, onClose }) {
  const box = useRef(null);
  // HTML ставится один раз: React не должен перерисовывать contentEditable
  // на каждом вводе — курсор улетал бы в начало.
  useEffect(() => { if (box.current) box.current.innerHTML = html || ""; }, [html]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") (onCollapse || onClose)?.(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCollapse, onClose]);
  const cmd = (name) => {
    box.current?.focus();
    try { document.execCommand(name); } catch { /* jsdom без execCommand */ }
    if (box.current) onChange?.(box.current.innerHTML);
  };
  const close = () => {
    if (dirty && typeof window !== "undefined" && !window.confirm("Закрыть без сохранения правок?")) return;
    onClose?.();
  };
  return (
    <div role="dialog" aria-label={`документ ${title}`} aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "#0E1420",
        overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "fixed", top: 10, right: 12, zIndex: 61, display: "flex",
        flexDirection: "column", gap: 8 }}>
        <button type="button" aria-label="закрыть документ" title="Закрыть" onClick={close}
          style={roundBtn()}>✕</button>
        {editable && (<>
          <button type="button" aria-label="свернуть документ" title="Свернуть — правки останутся"
            onClick={onCollapse} style={roundBtn({ display: "flex", alignItems: "center", justifyContent: "center" })}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 6 L8 11 L13 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg></button>
          <button type="button" aria-label="отменить правку" title="Отменить"
            onClick={() => cmd("undo")} style={roundBtn()}>↶</button>
          <button type="button" aria-label="вернуть правку" title="Вернуть"
            onClick={() => cmd("redo")} style={roundBtn()}>↷</button>
          {/* Сохранение — словом, а не значком (владелец, 2026-09-15): оно
              должно быть очевидным. Зелёное, когда есть что сохранять. */}
          <button type="button" aria-label="сохранить документ" title={dirty ? "Сохранить новой версией" : "Правок нет"}
            disabled={!dirty || busy} onClick={onSave}
            style={roundBtn({ width: "auto", borderRadius: 19, padding: "0 14px", fontSize: 12.5, fontWeight: 700,
              background: dirty ? "rgba(61,220,151,.85)" : "rgba(29,40,57,.72)",
              color: dirty ? "#0E1420" : "#fff", opacity: dirty ? 1 : 0.55 })}>Сохранить</button>
        </>)}
      </div>
      <div style={{ fontSize: 11, color: C.muted, padding: "12px 60px 4px 16px" }}>
        {title}{editable ? " · правится прямо здесь; сложное оформление Word при сохранении упрощается" : " · только чтение"}
        {dirty ? " · есть несохранённые правки" : ""}
      </div>
      <div ref={box} contentEditable={editable} suppressContentEditableWarning
        aria-label="текст документа"
        onInput={(e) => onChange?.(e.currentTarget.innerHTML)}
        style={{ background: "#fff", color: "#111", margin: "8px auto 24px", maxWidth: 820,
          minHeight: "80vh", padding: "28px 24px", borderRadius: 4, fontFamily: "Georgia, serif",
          fontSize: 14, lineHeight: 1.6, outline: "none", boxSizing: "border-box" }} />
    </div>
  );
}

/* ─────── изменения формами: «+» зелёная, «−» красная, по одному месту ─────── */

/**
 * Одна форма — одно изменение (владелец, 2026-09-15): предложение, в
 * которое добавили или из которого убрали слова, и сами слова выделены
 * цветом рамки. Форм столько, сколько мест изменилось.
 */
export function DiffForms({ forms, title, empty = "Изменений нет." }) {
  if (!forms) return null;
  const box = (f, i) => {
    const color = f.sign === "+" ? OK : BAD;
    return (
      <fieldset key={i} aria-label={f.sign === "+" ? "добавлено" : "убрано"}
        style={{ border: `1px solid ${color}`, borderRadius: 6, padding: "2px 8px 6px",
          margin: "6px 0 0", minWidth: 0 }}>
        <legend style={{ color, fontWeight: 700, fontSize: 12, padding: "0 4px" }}>{f.sign === "+" ? "+" : "−"}</legend>
        <div style={{ fontSize: 11.5, lineHeight: 1.6, color: C.text }}>
          {f.parts.map((p, k) => (
            <span key={k} data-hl={p.hl ? f.sign : undefined}
              style={p.hl ? { background: `${color}33`, color, fontWeight: 600, borderRadius: 3, padding: "0 2px" } : undefined}>
              {p.text}{k < f.parts.length - 1 ? " " : ""}</span>))}
        </div>
      </fieldset>);
  };
  return (
    <div style={{ marginTop: 4 }} aria-label="изменения">
      {title && <div style={S.lbl}>{title}</div>}
      {!forms.length ? <div style={hint}>{empty}</div> : forms.map(box)}
    </div>);
}

/* ─────── форма загрузки нового документа ─────── */

function NewDocForm({ busy, act, onDone }) {
  const [name, setName] = useState("");
  const [same, setSame] = useState(true);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  const fileName = file ? file.name.replace(/\.docx$/i, "") : "";
  const title = same ? fileName : name;
  return (
    <div style={sub} aria-label="новый договор">
      <div style={S.lbl}>новый договор</div>
      <input aria-label="название договора" style={{ ...S.inp, margin: "6px 0 4px" }}
        placeholder="название" value={title} disabled={same}
        onChange={(e) => setName(e.target.value)} />
      <label className="flex items-center gap-2" style={{ fontSize: 11.5, cursor: "pointer", marginBottom: 6 }}>
        <input type="checkbox" checked={same} aria-label="такое же, как у файла"
          style={{ accentColor: ACC }} onChange={(e) => setSame(e.target.checked)} />
        <span>такое же, как у файла</span>
      </label>
      <label style={{ ...btn(false), display: "inline-block", fontSize: 11.5 }}>
        {file ? `📄 ${file.name}` : "Выбрать файл Word (.docx)"}
        <input type="file" accept=".docx" style={{ display: "none" }} aria-label="файл договора"
          onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>
      <div style={{ ...hint, marginTop: 6 }}>
        Плейсхолдеры вида [(ключ): описание] найдутся в документе сами и появятся полями под ним.
        Обязательные: [(sum): …], [(start): …], [(end): …] — сумма и срок действия.
        Рамка сплошной линией — место подписи стороны 1, пунктирной — стороны 2.
      </div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !file || !title.trim()}
          aria-label="загрузить договор"
          onClick={() => { setErr(""); act(async () => { await addDoc({ name: title.trim(), file }); onDone?.(); }, { quiet: true })
            .catch((e) => setErr(e.message)); }}>
          Загрузить</button>
        <button type="button" style={btn(false)} onClick={onDone}>Отмена</button>
      </div>
      {/* Ошибка — здесь, под кнопкой, а не внизу страницы. */}
      {err && <div role="alert" style={{ fontSize: 11.5, color: BAD, marginTop: 6, lineHeight: 1.5 }}>{err}</div>}
    </div>
  );
}

/* ─────── один документ: «Редактировать», название в рамке, плейсхолдеры, версии ─────── */

function DocCard({ doc, opened, onEdit, busy, act, onDrop, html, setHtml, viewer }) {
  const ver = last(doc);
  const [phOpen, setPhOpen] = useState(false);
  const [versions, setVersions] = useState(false);
  const [openVer, setOpenVer] = useState(null);   // id раскрытой прошлой версии
  const [values, setValues] = useState(doc.values || {});
  const [file, setFile] = useState(null);
  const [verErr, setVerErr] = useState("");
  /* HTML версий — для изменений: текущие правки против последней, и каждая
     прошлая версия против своей предыдущей. Грузится, когда нужно. */
  const [texts, setTexts] = useState({});   // versionId → html
  useEffect(() => { setValues(doc.values || {}); }, [doc.values]);
  const dirty = html != null && doc._html != null && html !== doc._html;
  const needed = versions ? doc.versions.map((v) => v.id) : [];
  useEffect(() => {
    needed.filter((id) => texts[id] === undefined).forEach((id) => {
      docHtml(doc.id, id).then((r) => setTexts((t) => ({ ...t, [id]: r.html }))).catch(() => {});
    });
  }, [needed.join(","), doc.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const current = dirty ? changeFormsHtml(doc._html, html) : null;
  const verForms = (i) => {
    const v = doc.versions[i], p = doc.versions[i - 1];
    if (!p) return [];
    return texts[v.id] != null && texts[p.id] != null ? changeFormsHtml(texts[p.id], texts[v.id]) : null;
  };
  const saveValues = () => {
    if (JSON.stringify(values) !== JSON.stringify(doc.values || {})) act(() => updateDoc(doc.id, { values }));
  };
  return (
    /* Название — в рамке ВСЕЙ карточки договора, в её левом верхнем углу
       (владелец, 2026-09-15), как знак у форм «+» и «−». */
    <fieldset style={{ ...sub, borderColor: opened ? ACC : C.line, padding: "2px 8px 8px", minWidth: 0 }}
      aria-label={`договор ${doc.name}`}>
      <legend style={{ fontSize: 12.5, fontWeight: 700, padding: "0 6px", color: C.text,
        maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</legend>
      <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 6 }}>
        версий: {doc.versions.length} · {when(ver?.at)}{dirty ? " · есть несохранённые правки" : ""}</div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Порядок кнопок — владельца: редактировать, скачать, удалить.
            Новых кнопок при открытии документа не появляется. */}
        <button type="button" style={btn(opened)} disabled={busy} aria-label={`редактировать ${doc.name}`}
          onClick={() => onEdit(doc)}>Редактировать</button>
        <a href={ver?.file?.url} download={ver?.file?.name || `${doc.name}.docx`}
          aria-label={`скачать ${doc.name}`} style={{ ...btn(false), textDecoration: "none" }}>Скачать</a>
        <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }} disabled={busy}
          aria-label={`удалить договор ${doc.name}`} onClick={() => onDrop(doc)}>Удалить</button>
      </div>
      {/* Текущие правки — формами, по одному месту в каждой. */}
      {dirty && <DiffForms forms={current} title="несохранённые изменения" />}

      {/* Плейсхолдеры — под спойлером: их много, а нужны не каждый раз. */}
      <button type="button" style={{ ...btn(phOpen), marginTop: 6, fontSize: 11 }}
        aria-expanded={phOpen} aria-label={`плейсхолдеры ${doc.name}`} onClick={() => setPhOpen((v) => !v)}>
        {phOpen ? "▾" : "▸"} плейсхолдеры ({(ver?.placeholders || []).length})</button>
      {phOpen && (
        <div style={{ marginTop: 4 }} onBlur={saveValues}>
          <PlaceholderFields placeholders={ver?.placeholders || []} values={values} onChange={setValues}
            label={`поле ${doc.name}`} />
          <div style={hint}>Заполнять все не обязательно; при выдаче договора пустые дозаполняются.</div>
        </div>)}

      {/* «Загрузить новый» — перед списком версий. */}
      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 6 }}>
        <label style={{ ...btn(false), fontSize: 11, display: "inline-block" }}>
          {file ? `📄 ${file.name}` : "Загрузить новый"}
          <input type="file" accept=".docx" style={{ display: "none" }}
            aria-label={`файл новой версии ${doc.name}`}
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {file && (
          <button type="button" style={btn(true)} disabled={busy} aria-label={`загрузить версию ${doc.name}`}
            onClick={() => { setVerErr(""); act(async () => { await addDocVersion(doc.id, { file }); setFile(null); }, { quiet: true })
              .catch((e) => setVerErr(e.message)); }}>
            Загрузить</button>)}
        <button type="button" style={{ ...btn(versions), fontSize: 11 }} aria-expanded={versions}
          aria-label={`прошлые версии ${doc.name}`} onClick={() => setVersions((v) => !v)}>
          прошлые версии ({doc.versions.length})</button>
      </div>
      {verErr && <div role="alert" style={{ fontSize: 11.5, color: BAD, marginTop: 4 }}>{verErr}</div>}
      {versions && (
        <div style={{ marginTop: 4, borderLeft: `2px solid ${C.line}`, paddingLeft: 8 }}>
          {[...doc.versions].reverse().map((v, i) => {
            const idx = doc.versions.length - 1 - i;
            const isOpen = openVer === v.id;
            const forms = isOpen ? verForms(idx) : null;
            return (
              <div key={v.id} style={{ padding: "3px 0" }}>
                <button type="button" aria-label={`версия ${v.id}`} aria-expanded={isOpen}
                  style={{ ...btn(isOpen), fontSize: 11, textAlign: "left", width: "100%" }}
                  onClick={() => setOpenVer(isOpen ? null : v.id)}>
                  <span style={{ color: i === 0 ? OK : C.muted }}>{i === 0 ? "● " : "○ "}</span>
                  {when(v.at)}{i === 0 ? " · последняя" : ""}{idx === 0 ? " · первая" : ""}</button>
                {isOpen && (
                  <div style={{ padding: "4px 0 4px 6px" }}>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" style={btn(false)} aria-label={`открыть версию ${v.id}`}
                        onClick={() => viewer(doc, v)}>открыть</button>
                      <a href={v.file?.url} download={v.file?.name} aria-label={`скачать версию ${v.id}`}
                        style={{ ...btn(false), textDecoration: "none" }}>скачать</a>
                      {i !== 0 && (
                        <button type="button" style={{ ...btn(false), color: BAD }} disabled={busy}
                          aria-label={`удалить версию ${v.id}`}
                          onClick={() => act(() => removeDocVersion(doc.id, v.id))}>удалить</button>)}
                    </div>
                    {idx === 0 ? <div style={{ ...hint, marginTop: 4 }}>Первая версия — сравнивать не с чем.</div>
                      : forms == null ? <div style={{ ...hint, marginTop: 4 }}>Считаю изменения…</div>
                        : <DiffForms forms={forms} title="изменения против предыдущей" />}
                  </div>)}
              </div>);
          })}
        </div>)}
    </fieldset>
  );
}

/* Свёрнутый документ — полоска внизу экрана с названием (владелец,
   2026-09-15): нажатие разворачивает, крестик закрывает. Правки при
   этом никуда не деваются. */
function CollapsedBar({ title, dirty, onExpand, onClose }) {
  return (
    <div role="region" aria-label={`свёрнутый документ ${title}`}
      style={{ position: "fixed", left: 8, right: 8, bottom: 8, zIndex: 55,
        background: "rgba(29,40,57,.95)", border: `1px solid ${ACC}66`, borderRadius: 10,
        boxShadow: "0 -2px 12px #0008", display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 12px" }}>
      <button type="button" aria-label={`развернуть документ ${title}`} onClick={onExpand}
        style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", color: "#fff",
          textAlign: "left", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        📄 {title}
        <span style={{ fontWeight: 400, color: C.muted, fontSize: 11 }}> · свёрнут{dirty ? " · есть несохранённые правки" : ""}</span>
      </button>
      <button type="button" aria-label={`закрыть свёрнутый документ ${title}`} onClick={onClose}
        style={{ ...roundBtn(), width: 30, height: 30, lineHeight: "28px", fontSize: 14 }}>✕</button>
    </div>);
}

/** Раздел «договоры» на «Ролях»: список документов и загрузка нового. */
export function DocsSection({ docs = [], busy, act }) {
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);      // {doc, html} — документ в правке (может быть свёрнут)
  const [shown, setShown] = useState(false);   // документ на экране
  const [readOnly, setReadOnly] = useState(null);   // {doc, version, html} — прошлая версия
  const [html, setHtml] = useState(null);      // правленный HTML
  const [err, setErr] = useState("");
  const openEdit = async (doc) => {
    setErr("");
    // Свёрнутый документ с правками — просто показать снова.
    if (edit?.doc.id === doc.id) { setShown((v) => !v); return; }
    try {
      const r = await docHtml(doc.id);
      doc._html = r.html;
      setEdit({ doc, html: r.html }); setHtml(null); setShown(true);
    } catch (e) { setErr(e.message); }
  };
  const openVersion = async (doc, v) => {
    setErr("");
    try {
      const r = await docHtml(doc.id, v.id);
      setReadOnly({ doc, version: v, html: r.html });
    } catch (e) { setErr(e.message); }
  };
  const save = () => act(async () => {
    await addDocVersion(edit.doc.id, { html });
    // Сохранённое — теперь и есть документ: правок больше нет.
    edit.doc._html = html; setHtml(null); setEdit(null); setShown(false);
  });
  const cur = edit ? docs.find((d) => d.id === edit.doc.id) : null;
  if (cur && edit && cur !== edit.doc) { cur._html = edit.doc._html; }
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...hint, marginBottom: 8 }}>
        Договоры — документы Word с историей версий. «Редактировать» открывает документ на весь экран;
        сохранить, отменить и свернуть — значками на самом документе. Какой договор подписывают по роли,
        выбирается у роли.
      </div>
      {docs.map((d) => (
        <DocCard key={d.id} doc={d} opened={edit?.doc.id === d.id} onEdit={openEdit} busy={busy} act={act}
          html={edit?.doc.id === d.id ? html : null} setHtml={setHtml} viewer={openVersion}
          onDrop={(doc) => act(async () => { await removeDoc(doc.id); if (edit?.doc.id === doc.id) { setEdit(null); setShown(false); } })} />))}
      {!docs.length && <div style={{ ...hint, marginBottom: 6 }}>Договоров пока нет.</div>}
      {adding ? (
        <NewDocForm busy={busy} act={act} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" style={btn(true)} disabled={busy} onClick={() => setAdding(true)}>
          + договор</button>)}
      {err && <div style={{ fontSize: 11.5, color: BAD, marginTop: 6 }}>{err}</div>}
      {edit && shown && (
        <DocViewer title={edit.doc.name} html={edit.html} dirty={html != null && html !== edit.doc._html}
          busy={busy} onChange={setHtml} onSave={save}
          onCollapse={() => setShown(false)}
          onClose={() => { setEdit(null); setHtml(null); setShown(false); }} />)}
      {edit && !shown && (
        <CollapsedBar title={edit.doc.name} dirty={html != null && html !== edit.doc._html}
          onExpand={() => setShown(true)}
          onClose={() => {
            const dirtyNow = html != null && html !== edit.doc._html;
            if (dirtyNow && typeof window !== "undefined" && !window.confirm("Закрыть без сохранения правок?")) return;
            setEdit(null); setHtml(null);
          }} />)}
      {readOnly && (
        <DocViewer title={`${readOnly.doc.name} · версия ${when(readOnly.version.at)}`} html={readOnly.html}
          editable={false} onClose={() => setReadOnly(null)} />)}
    </div>
  );
}

/* ─────── приглашение участника: заполнить, подписать, отправить ─────── */

/**
 * Окно «Пригласить участника» для роли с договором: пустые плейсхолдеры
 * (можно оставить пустыми — дозаполнит человек), сумма и даты
 * (обязательно), подпись владельца (обязательно, каждый раз своя),
 * «Отправить» → ссылка: «Выбрать чат» открывает выбор чата Telegram,
 * запасной путь — переслать боту сообщение человека.
 */
export function InviteModal({ role, doc, me, onClose, onDone }) {
  const ver = last(doc);
  const [values, setValues] = useState({ ...(doc?.values || {}) });
  const [sig, setSig] = useState(null);
  const [pad, setPad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(null);   // {link}
  const missing = REQUIRED.filter((k) => !String(values[k] || "").trim());
  const ready = !missing.length && !!sig && !busy;
  const send = async () => {
    setBusy(true); setErr("");
    try {
      const { sum, start, end, ...rest } = values;
      const a = await createAgreement({ docId: doc.id, roleId: role.id, values: rest, sum, start, end, sign1: sig });
      setSent({ link: a.link, id: a.id });
      onDone?.(a);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(sent.link)}&text=${encodeURIComponent(`Договор «${doc.name}» по роли «${role.name}»: откройте ссылку, чтобы заполнить и подписать`)}`;
    const tg = getTelegram();
    if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank", "noopener");
  };
  return (
    <Modal title={`Пригласить участника · ${role.name}`} onClose={onClose}>
      {!doc && <div style={{ fontSize: 12, color: WARN }}>У роли нет договора — выберите его у роли.</div>}
      {doc && !sent && (<>
        <div style={{ ...hint, marginBottom: 8 }}>
          Договор «{doc.name}». Заполните, что знаете, — остальное дозаполнит участник. Сумма и даты
          действия обязательны, подпись — тоже: каждая выдача подписывается отдельно.
        </div>
        <PlaceholderFields placeholders={ver?.placeholders || []} values={values} onChange={setValues}
          required label="приглашение" />
        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 8 }}>
          <button type="button" style={btn(true, sig ? OK : ACC)} onClick={() => setPad(true)}>
            {sig ? "Подпись поставлена ✓ — переподписать" : "Поставить подпись"}</button>
          {sig && <span style={{ fontSize: 10.5, color: C.muted }}>{when(sig.at)} · хеш {sig.hash.slice(0, 10)}…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 10 }}>
          <button type="button" style={btn(true, OK)} disabled={!ready} onClick={send}
            title={missing.length ? `Заполните: ${missing.map((k) => REQUIRED_LABEL[k]).join(", ")}` : !sig ? "Поставьте подпись" : ""}>
            {busy ? "Отправляю…" : "Отправить"}</button>
          <span style={hint}>
            {missing.length ? `не хватает: ${missing.map((k) => REQUIRED_LABEL[k]).join(", ")}` : !sig ? "нужна подпись" : "готово к отправке"}
          </span>
        </div>
        {err && <div style={{ fontSize: 11.5, color: BAD, marginTop: 6 }}>{err}</div>}
      </>)}
      {sent && (
        <div>
          <div style={{ fontSize: 12.5, color: OK, fontWeight: 600, marginBottom: 6 }}>Договор подписан и готов к отправке.</div>
          <div style={{ ...hint, marginBottom: 6 }}>
            Кому его отправить? Выберите чат — человек получит ссылку, откроет бота и договор станет его.
            Если так не выйдет — перешлите боту любое сообщение этого человека и выберите роль «{role.name}»:
            ждущий договор привяжется к нему сам.
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" style={btn(true, OK)} onClick={share}>Выбрать чат</button>
            <button type="button" style={btn(false)} onClick={() => navigator.clipboard?.writeText(sent.link)}>
              Скопировать ссылку</button>
          </div>
          <div style={{ fontSize: 11, color: ACC, marginTop: 6, wordBreak: "break-all" }} aria-label="ссылка приглашения">{sent.link}</div>
          <div style={{ marginTop: 10 }}>
            <button type="button" style={btn(false)} onClick={onClose}>Закрыть</button>
          </div>
        </div>)}
      {pad && (
        <SignaturePad by={me?.id} docHash={ver?.hash} title="Подпись стороны 1"
          onDone={(rec) => { setSig(rec); setPad(false); }} onCancel={() => setPad(false)} />)}
    </Modal>
  );
}
