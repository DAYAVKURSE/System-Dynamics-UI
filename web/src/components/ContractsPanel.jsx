import React, { useEffect, useRef, useState } from "react";
import { ACC, BAD, C, OK, S, WARN, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import FramedField from "./FramedField.jsx";
import SignaturePad from "./SignaturePad.jsx";
import {
  addDoc, addDocVersion, createAgreement, docHtml, removeDoc, removeDocVersion, updateDoc,
} from "../identity.js";
import { getTelegram } from "../telegram.js";
import { diffHtml, diffText } from "../lib/docdiff.js";

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

/**
 * Документ над формой, на весь экран: HTML от сервера в contentEditable —
 * его листают и правят. Крестик в тёмном кружке закрывает. Правки уходят
 * наверх по вводу; сохраняет их кнопка «Сохранить изменения» на карточке.
 */
export function DocViewer({ title, html, editable = true, onChange, onClose }) {
  const box = useRef(null);
  // HTML ставится один раз: React не должен перерисовывать contentEditable
  // на каждом вводе — курсор улетал бы в начало.
  useEffect(() => { if (box.current) box.current.innerHTML = html || ""; }, [html]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div role="dialog" aria-label={`документ ${title}`} aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "#0E1420",
        overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <button type="button" aria-label="закрыть документ" onClick={onClose}
        style={{ position: "fixed", top: 10, right: 12, zIndex: 61, width: 38, height: 38,
          borderRadius: "50%", background: "#1D2839", color: "#fff", border: `1px solid ${C.line}`,
          fontSize: 18, lineHeight: "36px", textAlign: "center", cursor: "pointer",
          boxShadow: "0 2px 8px #0008" }}>✕</button>
      <div style={{ fontSize: 11, color: C.muted, padding: "12px 56px 4px 16px" }}>
        {title}{editable ? " · правится прямо здесь; сложное оформление Word при сохранении упрощается" : " · только чтение"}
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

/* ─────── изменения двумя рамками: «+» зелёная, «−» красная ─────── */

export function DiffForms({ diff, title, empty = "Изменений нет." }) {
  const box = (sign, list, color, label) => (
    <fieldset aria-label={label} style={{ border: `1px solid ${color}`, borderRadius: 6,
      padding: "4px 8px 8px", margin: "6px 0 0", minWidth: 0, flex: "1 1 200px" }}>
      <legend style={{ color, fontWeight: 700, fontSize: 12, padding: "0 4px" }}>{sign}</legend>
      {!list.length && <div style={{ ...hint, color: C.muted }}>—</div>}
      {list.map((line, i) => (
        <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: C.text,
          borderBottom: i < list.length - 1 ? `1px solid ${C.line}` : "none", padding: "2px 0" }}>
          {line}</div>))}
    </fieldset>);
  if (!diff) return null;
  const none = !diff.added.length && !diff.removed.length;
  return (
    <div style={{ marginTop: 6 }} aria-label="изменения">
      {title && <div style={{ ...S.lbl }}>{title}</div>}
      {none ? <div style={hint}>{empty}</div> : (
        <div className="flex flex-wrap gap-2">
          {box("+", diff.added, OK, "добавлено")}
          {box("−", diff.removed, BAD, "убрано")}
        </div>)}
    </div>);
}

/* ─────── форма загрузки нового документа ─────── */

function NewDocForm({ busy, act, onDone }) {
  const [name, setName] = useState("");
  const [same, setSame] = useState(true);
  const [file, setFile] = useState(null);
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
          onClick={() => act(async () => { await addDoc({ name: title.trim(), file }); onDone?.(); })}>
          Загрузить</button>
        <button type="button" style={btn(false)} onClick={onDone}>Отмена</button>
      </div>
    </div>
  );
}

/* ─────── один документ: строка, версии, плейсхолдеры, просмотр ─────── */

function DocCard({ doc, selected, onSelect, busy, act, onOpen, onDrop, html, setHtml }) {
  const ver = last(doc);
  const [versions, setVersions] = useState(false);
  const [values, setValues] = useState(doc.values || {});
  const [file, setFile] = useState(null);
  /* HTML версий — для разницы: последняя против предыдущей, и каждая
     версия против своей предыдущей в дереве. Грузится, когда нужно. */
  const [texts, setTexts] = useState({});   // versionId → html
  useEffect(() => { setValues(doc.values || {}); }, [doc.values]);
  const dirty = html != null && html !== doc._html;
  const needed = versions ? doc.versions.map((v) => v.id) : selected ? doc.versions.slice(-2).map((v) => v.id) : [];
  useEffect(() => {
    needed.filter((id) => texts[id] === undefined).forEach((id) => {
      docHtml(doc.id, id).then((r) => setTexts((t) => ({ ...t, [id]: r.html }))).catch(() => {});
    });
  }, [needed.join(","), doc.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const prev = doc.versions[doc.versions.length - 2];
  const latestHtml = texts[ver?.id] ?? doc._html;
  const diff = dirty && latestHtml != null ? diffHtml(latestHtml, html)
    : prev && texts[prev.id] != null && latestHtml != null ? diffHtml(texts[prev.id], latestHtml) : null;
  const diffTitle = dirty ? "изменения к сохранению" : prev ? `версия ${when(ver?.at)} против ${when(prev.at)}` : "";
  const verDiff = (i) => {
    const v = doc.versions[i], p = doc.versions[i - 1];
    if (!p) return "первая версия";
    return texts[v.id] != null && texts[p.id] != null ? diffText(diffHtml(texts[p.id], texts[v.id])) : "…";
  };
  const saveValues = () => {
    if (JSON.stringify(values) !== JSON.stringify(doc.values || {})) act(() => updateDoc(doc.id, { values }));
  };
  return (
    <div style={{ ...sub, borderColor: selected ? ACC : C.line, background: selected ? `${ACC}14` : C.panel2 }}
      aria-label={`договор ${doc.name}`}>
      <div className="flex items-center gap-2">
        {/* Название — кнопка: выделяет документ и открывает его; у
            выделенного оно становится «Скачать». Повторное нажатие на
            выделенный — закрыть и снять выделение. */}
        {selected ? (
          <a href={ver?.file?.url} download={ver?.file?.name || `${doc.name}.docx`}
            aria-label={`скачать ${doc.name}`}
            style={{ ...btn(true), textDecoration: "none", fontSize: 12 }}>⤓ Скачать</a>
        ) : null}
        <button type="button" aria-label={`документ ${doc.name}`} aria-pressed={selected}
          onClick={() => onSelect(doc)}
          style={{ ...btn(selected), flex: 1, textAlign: "left", fontSize: 12.5, fontWeight: 600,
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {doc.name}
          <span style={{ fontWeight: 400, color: C.muted, fontSize: 10.5 }}>
            {" "}· версий: {doc.versions.length} · {when(ver?.at)}</span>
        </button>
        {selected && (
          <button type="button" style={btn(true, dirty ? WARN : undefined)} disabled={busy || !dirty}
            aria-label={`сохранить изменения ${doc.name}`}
            title={dirty ? "" : "Правок в документе нет"}
            onClick={() => act(async () => { await addDocVersion(doc.id, { html }); setHtml(null); })}>
            Сохранить изменения</button>)}
        <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }} disabled={busy}
          aria-label={`удалить договор ${doc.name}`} onClick={() => onDrop(doc)}>Удалить</button>
      </div>
      {/* Изменения — как в git, двумя рамками: «+» зелёная, «−» красная. */}
      {selected && (diff
        ? <DiffForms diff={diff} title={diffTitle} />
        : !prev && !dirty ? <div style={{ ...hint, marginTop: 6 }}>Первая версия — сравнивать пока не с чем.</div> : null)}

      {/* Дерево версий — по нажатию на файл. У каждой — скачать и удалить. */}
      <button type="button" style={{ ...btn(versions), marginTop: 6, fontSize: 11 }}
        aria-label={`версии ${doc.name}`} onClick={() => setVersions((v) => !v)}>
        📄 {ver?.file?.name || "файл"} · версии ({doc.versions.length})</button>
      {versions && (
        <div style={{ marginTop: 4, borderLeft: `2px solid ${C.line}`, paddingLeft: 8 }}>
          {[...doc.versions].reverse().map((v, i) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2" style={{ fontSize: 11, padding: "3px 0" }}>
              <span style={{ color: i === 0 ? OK : C.muted }}>{i === 0 ? "● " : "○ "}{when(v.at)}</span>
              <span style={{ flex: 1, minWidth: 80 }} aria-label={`изменения версии ${v.id}`}>
                {verDiff(doc.versions.length - 1 - i)}</span>
              <a href={v.file?.url} download={v.file?.name} style={{ color: ACC }}
                aria-label={`скачать версию ${v.id}`}>скачать</a>
              {i !== 0 && (
                <button type="button" style={{ ...btn(false), color: BAD, padding: "1px 6px", fontSize: 10.5 }}
                  disabled={busy} aria-label={`удалить версию ${v.id}`}
                  onClick={() => act(() => removeDocVersion(doc.id, v.id))}>Удалить</button>)}
            </div>))}
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4 }}>
            <label style={{ ...btn(false), fontSize: 11, display: "inline-block" }}>
              {file ? `📄 ${file.name}` : "Новая версия файлом"}
              <input type="file" accept=".docx" style={{ display: "none" }}
                aria-label={`файл новой версии ${doc.name}`}
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            {file && (
              <button type="button" style={btn(true)} disabled={busy}
                onClick={() => act(async () => { await addDocVersion(doc.id, { file }); setFile(null); })}>
                Загрузить версию</button>)}
          </div>
        </div>)}

      {/* Плейсхолдеры — из последней версии; значения общие для всех выдач. */}
      <div style={{ ...S.lbl, marginTop: 8 }}>плейсхолдеры</div>
      <div style={{ marginTop: 4 }} onBlur={saveValues}>
        <PlaceholderFields placeholders={ver?.placeholders || []} values={values} onChange={setValues}
          label={`поле ${doc.name}`} />
      </div>
      <div style={hint}>Заполнять все не обязательно; при выдаче договора пустые дозаполняются.</div>
      {selected && (
        <button type="button" style={{ ...btn(false), marginTop: 6, fontSize: 11 }} onClick={() => onOpen(doc)}>
          Открыть документ</button>)}
    </div>
  );
}

/** Раздел «договоры» на «Ролях»: список документов и загрузка нового. */
export function DocsSection({ docs = [], busy, act }) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null);   // id документа
  const [viewer, setViewer] = useState(null);       // {doc, html}
  const [html, setHtml] = useState(null);           // правленный HTML выделенного
  const [err, setErr] = useState("");
  const open = async (doc) => {
    setErr("");
    try {
      const r = await docHtml(doc.id);
      doc._html = r.html;
      setViewer({ doc, html: r.html });
    } catch (e) { setErr(e.message); }
  };
  const select = (doc) => {
    if (selected === doc.id) { setSelected(null); setViewer(null); setHtml(null); return; }
    setSelected(doc.id); setHtml(null); open(doc);
  };
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...hint, marginBottom: 8 }}>
        Договоры — документы Word с историей версий. Нажатие на договор открывает его на весь экран;
        повторное — закрывает. Какой договор подписывают по роли, выбирается у роли.
      </div>
      {docs.map((d) => (
        <DocCard key={d.id} doc={d} selected={selected === d.id} onSelect={select} busy={busy} act={act}
          onOpen={open} html={selected === d.id ? html : null} setHtml={setHtml}
          onDrop={(doc) => act(async () => { await removeDoc(doc.id); if (selected === doc.id) { setSelected(null); setViewer(null); } })} />))}
      {!docs.length && <div style={{ ...hint, marginBottom: 6 }}>Договоров пока нет.</div>}
      {adding ? (
        <NewDocForm busy={busy} act={act} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" style={btn(true)} disabled={busy} onClick={() => setAdding(true)}>
          + договор</button>)}
      {err && <div style={{ fontSize: 11.5, color: BAD, marginTop: 6 }}>{err}</div>}
      {viewer && selected === viewer.doc.id && (
        <DocViewer title={viewer.doc.name} html={viewer.html} onChange={setHtml}
          onClose={() => { setViewer(null); }} />)}
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
