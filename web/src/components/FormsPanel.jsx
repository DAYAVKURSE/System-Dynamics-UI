import React, { useState } from "react";
import { C, BAD, WARN, S, btn, TxtField } from "./ui.jsx";
import { addForm, removeForm, setForm, setRoleForm } from "../identity.js";
import { parseNumbered } from "../lib/formText.js";

/* ════════════════════════════════════════════════════════════════
   АНКЕТЫ КАК СЛОВАРИ

   Анкета — не одно большое поле с подсказкой «пиши по шаблону», а список
   конкретных вопросов: человеку показывают каждый отдельно, и он отвечает
   на него, а не пересказывает шаблон по памяти. Анкет несколько, и
   назначают их РОЛЯМ: дизайнера спрашивают про стек, курьера — про район,
   а не всех обо всём.

   Заводит и правит анкеты владелец — здесь, в «Людях и ролях», под
   ролями: анкета нужна роли, и искать её стоит рядом с ролью. Ответы
   пишет сам человек в своей анкете (`ProfilePanel`), по вопросам той
   анкеты, что назначена его ролям.

   Список ведёт сервер: каждая правка уезжает туда и список перечитывается
   (`act` из `PeoplePanel`), как у ролей, — показывать своё предположение
   о нём незачем.
   ════════════════════════════════════════════════════════════════ */

/** Какую анкету заполняют по этой роли. «— нет —» — роль ничего не спрашивает. */
export function RoleFormPick({ role, forms, busy, act }) {
  return (
    <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
      <span style={{ fontSize: 10.5, color: C.muted }}>анкета:</span>
      <select style={{ ...S.inp, flex: "0 1 220px", fontSize: 11.5, padding: "3px 6px" }}
        value={role.form || ""} disabled={busy}
        aria-label={`анкета роли «${role.name}»`}
        onChange={(e) => act(() => setRoleForm(role.id, e.target.value || null))}>
        <option value="">— нет —</option>
        {(forms || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </div>);
}

/**
 * Одна анкета: название, вопросы, «+ вопрос», «✕» у вопроса, «Удалить».
 *
 * Правка любого вопроса шлёт СПИСОК целиком, с идентификаторами: сервер по
 * ним узнаёт прежние вопросы и не пересоздаёт их, — иначе ответ, данный на
 * вопрос, потерялся бы от поправленной запятой в его тексте. Пустой текст
 * не отправляется: стёртый вопрос — это ✕, а не пустая строка.
 */
function FormCard({ form, busy, act }) {
  const [text, setText] = useState("");
  const qs = form.questions || [];
  const send = (questions) => act(() => setForm(form.id, { questions }));
  const retitle = (name) => {
    if (name.trim() && name.trim() !== form.name) act(() => setForm(form.id, { name }));
  };
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
      borderRadius: 8, padding: 8, marginBottom: 6 }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
        <TxtField value={form.name} aria-label={`название анкеты «${form.name}»`}
          style={{ flex: "1 1 160px", fontWeight: 700, fontSize: 12.5 }}
          onCommit={retitle} />
        <span style={{ fontSize: 10, color: C.muted }}>вопросов: {qs.length}</span>
        <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }} disabled={busy}
          onClick={() => act(() => removeForm(form.id))}>Удалить анкету</button>
      </div>
      {qs.map((q, i) => (
        <div key={q.id} className="flex flex-wrap gap-2"
          style={{ alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, color: C.muted, width: 18, textAlign: "right" }}>
            {i + 1}.</span>
          <TxtField value={q.text} aria-label={`вопрос ${i + 1} анкеты «${form.name}»`}
            style={{ flex: "1 1 200px", fontSize: 12 }}
            onCommit={(v) => {
              if (v.trim() && v.trim() !== q.text) {
                send(qs.map((x) => (x.id === q.id ? { id: x.id, text: v } : x)));
              }
            }} />
          <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
            padding: "2px 7px" }} disabled={busy}
            aria-label={`убрать вопрос ${i + 1} анкеты «${form.name}»`}
            onClick={() => send(qs.filter((x) => x.id !== q.id))}>✕</button>
        </div>))}
      {!qs.length && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
          Вопросов пока нет — человеку показать нечего.</div>)}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
        <TxtField value={text} placeholder="текст вопроса"
          aria-label={`новый вопрос анкеты «${form.name}»`}
          style={{ flex: "1 1 200px", fontSize: 12 }} onCommit={setText} />
        <button style={btn(true)} disabled={busy || !text.trim()}
          aria-label={`добавить вопрос в анкету «${form.name}»`}
          onClick={() => act(async () => {
            await setForm(form.id, { questions: [...qs, text.trim()] });
            setText("");
          })}>+ вопрос</button>
      </div>
    </div>);
}

/** Раздел «анкеты» в «Людях и ролях»: список анкет и заведение новой. */
export function FormsSection({ forms, busy, act }) {
  const [name, setName] = useState("");
  /* «Загрузить анкету»: пронумерованный список вопросов — вставленный или
     из текстового файла. Разбирается на лету (`parseNumbered`), число
     вопросов видно до отправки; название — то же поле, что у «+ анкета». */
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = parseNumbered(text);
  const fromFile = async (e) => {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  };
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, color: C.muted, margin: "0 0 8px", lineHeight: 1.5 }}>
        Список вопросов, на которые человек отвечает в своей анкете. Какую
        анкету заполнять, говорит роль — выберите её у роли выше.
      </div>
      {(forms || []).map((f) => <FormCard key={f.id} form={f} busy={busy} act={act} />)}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <TxtField value={name} placeholder="название новой анкеты"
          style={{ flex: "2 1 170px" }} onCommit={setName} />
        <button style={btn(true)} disabled={busy || !name.trim()}
          onClick={() => act(async () => { await addForm(name.trim()); setName(""); })}>
          + анкета</button>
        <button style={btn(open)} disabled={busy} onClick={() => setOpen((v) => !v)}>
          Загрузить анкету</button>
      </div>
      {open && (
        <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
          padding: 8, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 6 }}>
            Пронумерованный список: каждая строка — «1. вопрос». Строка без
            номера продолжает предыдущий вопрос. Название — в поле выше.
          </div>
          <textarea aria-label="текст анкеты" value={text}
            placeholder={"1. Ваш стек\n2. Уровень"}
            onChange={(e) => setText(e.target.value)}
            style={{ ...S.inp, width: "100%", minHeight: 110, lineHeight: 1.5,
              boxSizing: "border-box" }} />
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 6 }}>
            <input type="file" accept=".txt,text/plain" aria-label="файл анкеты"
              onChange={fromFile} style={{ fontSize: 11, flex: "1 1 160px" }} />
            <span style={{ fontSize: 10.5, color: parsed.error ? WARN : C.muted }}>
              {parsed.error || `вопросов: ${parsed.questions.length}`}</span>
            <button style={btn(true)} aria-label="загрузить анкету из списка"
              disabled={busy || !name.trim() || !parsed.questions.length}
              title={name.trim() ? "" : "Назовите анкету в поле выше"}
              onClick={() => act(async () => {
                await addForm(name.trim(), parsed.questions);
                setName(""); setText(""); setOpen(false);
              })}>Загрузить</button>
          </div>
        </div>)}
    </div>);
}

/* ════════════════════════════════════════════════════════════════
   ВОПРОСЫ В АНКЕТЕ ЧЕЛОВЕКА

   Есть анкеты по ролям — человек видит вопросы, а не одно большое поле:
   заголовок анкеты, под ним каждый вопрос подписью и поле ответа. Ответы
   лежат по идентификатору вопроса (`answers`), и уезжают той же кнопкой
   «Сохранить анкету». Чужая анкета — только читается: вопрос и ответ
   текстом, «не заполнено» там, где ответа нет.
   ════════════════════════════════════════════════════════════════ */
export function FormAnswers({ forms, answers = {}, mine, onChange }) {
  return (forms || []).map((f) => (
    <div key={f.id} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, margin: "4px 0 6px" }}>{f.name}</div>
      {!(f.questions || []).length && (
        <div style={{ fontSize: 11, color: C.muted }}>В этой анкете пока нет вопросов.</div>)}
      {(f.questions || []).map((q) => (
        <div key={q.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 3, lineHeight: 1.5 }}>
            {q.text}</div>
          {mine ? (
            <TxtField area value={answers[q.id] || ""} aria-label={q.text}
              style={{ minHeight: 44, lineHeight: 1.5, fontSize: 12.5 }}
              onCommit={(v) => onChange({ ...answers, [q.id]: v })} />
          ) : (
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap",
              color: answers[q.id] ? C.text : C.muted }}>
              {answers[q.id] || "не заполнено"}</div>)}
        </div>))}
    </div>));
}
