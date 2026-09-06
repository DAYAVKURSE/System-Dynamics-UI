import React, { useEffect, useState } from "react";
import { C, ACC, OK, WARN, BAD, NEU, S, btn, TxtField } from "./ui.jsx";
import PersonStats from "./PersonStats.jsx";
import { putProfile } from "../identity.js";
import { WEEK } from "../lib/funcs.js";
import { WORK_STATUSES, hasSchedule, scheduleOfPerson, scheduleText, statusOf }
  from "../lib/workers.js";

/* ════════════════════════════════════════════════════════════════
   ЧЕЛОВЕК · анкета и рейтинг

   Две вещи, и ровно две. АНКЕТА — то, что человек сам о себе сказал.
   РЕЙТИНГ — то, как он работал: оценки, сроки, работы, из которых он
   сложился.

   ─── почему поле одно ───

   Прежде их было четыре: «чем занимается», «о себе», «что умеет», «как
   связаться». Это была не анкета, а допрос по форме, которую никто не
   заказывал: приложение решало за человека, что о себе рассказывать, и
   заранее знало, что вопрос «как с тобой связаться» важнее всего
   остального. Анкета — это анкета: одно поле, и что в нём написать,
   решает тот, кто пишет.

   ─── кто пишет ───

   Сам человек, и только свою. Про себя он знает точнее, а анкета,
   заполненная кем-то другим, была бы чужим мнением под чужим именем.
   Поэтому чужая страница здесь только читается: поле показано текстом, а
   не полем ввода, — и не потому, что «нет прав», а потому что писать там
   нечего.

   ─── чужих анкет тут нет ───

   Список «другие люди» отсюда убран. Страница отвечает на вопрос про
   ОДНОГО человека — того, которого открыли; список остальных превращал её
   в справочник и предлагал уйти с неё ровно тогда, когда её открыли,
   чтобы прочитать.
   ════════════════════════════════════════════════════════════════ */

/* Цвет статуса: свободен — зелёный, «сейчас нет» — жёлтый, «не берусь» —
   красный, «сегодня не работаю» — серый. Цвет здесь второй ответ к слову, а
   не вместо него: слово стоит рядом всегда. */
export const statusColor = (id) => (
  { ready: OK, break: WARN, off: NEU, busy: BAD }[id] || C.muted);

/**
 * Рабочий график и статус — читаются кем угодно, пишутся только своим.
 *
 * Стоят ВЫШЕ анкеты: прежде чем спрашивать, что человек умеет, спрашивают,
 * работает ли он сейчас. Ставить задачу тому, у кого сегодня выходной, —
 * значит назначить срок, которого никто не обещал.
 */
function Schedule({ mine, draft, setDraft }) {
  const sc = scheduleOfPerson(draft);
  const st = statusOf(sc.status);
  const flip = (d) => setDraft((p) => {
    const on = (scheduleOfPerson(p).days || []).includes(d);
    const was = scheduleOfPerson(p).days;
    return { ...p, days: on ? was.filter((x) => x !== d) : [...was, d] };
  });
  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>{mine ? "мой рабочий график" : "рабочий график"}</div>

      {/* ─── статус ─── */}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
        margin: "7px 0 3px" }}>
        <span style={{ width: 9, height: 9, borderRadius: 5,
          background: statusColor(sc.status) }} />
        <span style={{ fontSize: 12.5, fontWeight: 600,
          color: statusColor(sc.status) }}>{st.name}</span>
      </div>
      {mine ? (<>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 5 }}>
          {WORK_STATUSES.map((x) => (
            <button key={x.id} aria-label={`статус: ${x.name}`}
              style={{ ...btn(sc.status === x.id,
                sc.status === x.id ? statusColor(x.id) : null),
              fontSize: 11, padding: "4px 8px" }}
              onClick={() => setDraft((p) => ({ ...p, status: x.id }))}>
              {x.name}</button>))}
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
          Статус — про сейчас, график — про вообще: одно другого не отменяет,
          и в рабочий день можно быть на коротком перерыве.
        </div>
      </>) : null}

      {/* ─── дни недели ─── */}
      <div style={{ ...S.lbl, marginTop: 10 }}>рабочие дни</div>
      {mine ? (
        <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
          {WEEK.map((d) => {
            const on = sc.days.includes(d.id);
            return (
              <button key={d.id} aria-label={`рабочий день ${d.short}`}
                style={{ ...btn(on), fontSize: 11, padding: "4px 8px" }}
                onClick={() => flip(d.id)}>{d.short}</button>);
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, marginTop: 4,
          color: sc.days.length ? C.text : C.muted }}>
          {sc.days.length
            ? scheduleText({ ...sc, from: "", to: "" }, WEEK)
            : "дни не названы"}</div>)}

      {/* ─── часы ─── */}
      <div style={{ ...S.lbl, marginTop: 10 }}>время работы</div>
      {mine ? (
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
          marginTop: 4 }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>с</span>
          <input type="time" aria-label="работаю с" value={sc.from}
            style={{ ...S.inp, flex: "0 1 120px", fontSize: 12 }}
            onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value }))} />
          <span style={{ fontSize: 11.5, color: C.muted }}>до</span>
          <input type="time" aria-label="работаю до" value={sc.to}
            style={{ ...S.inp, flex: "0 1 120px", fontSize: 12 }}
            onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))} />
        </div>
      ) : (
        <div style={{ fontSize: 12, marginTop: 4,
          color: sc.from || sc.to ? C.text : C.muted }}>
          {sc.from || sc.to
            ? scheduleText({ ...sc, days: [] }, WEEK) : "часы не названы"}</div>)}

      {/* Пусто — это ответ «не названо», а не «все дни и круглые сутки»:
          дописать человеку семидневку за него нельзя. */}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        {hasSchedule(sc)
          ? `Работает: ${scheduleText(sc, WEEK)}.`
          : (mine
            ? "График не задан — значит про ваши дни и часы ничего не известно."
            : "График не задан: про дни и часы этого человека ничего не известно.")}
      </div>
    </div>);
}

/** Поле анкеты одно. Что в него писать — решает человек, а не форма. */
export const PROFILE_FIELDS = [
  { id: "about", name: "анкета", area: true,
    hint: "что о себе стоит знать тому, кто выбирает, кому поручить работу" },
];

export const emptyProfile = () => ({
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, ""])),
  ...scheduleOfPerson({}),
});

/** Анкета из записи человека — в том виде, в каком её показывают. */
export const profileOf = (person = {}) => ({
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, String(person?.[f.id] || "")])),
  ...scheduleOfPerson(person),
});

/** Заполнена ли анкета. */
export const filled = (p = {}) => PROFILE_FIELDS.some((f) => String(p[f.id] || "").trim());

export default function ProfilePanel({ me, personId, people = [], tasks = [], funcs = [],
  traitName, onSaved }) {
  // Чья анкета открыта. По умолчанию — своя: с себя человек и начинает.
  const id = personId == null ? me?.id : personId;
  const mine = String(id) === String(me?.id);
  const person = people.find((p) => String(p.id) === String(id)) || null;
  const name = person?.name || (mine ? me?.name : "") || String(id ?? "");

  const [draft, setDraft] = useState(emptyProfile());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  /* Своя анкета приходит вместе с «кто я», чужая — из списка людей.
     Пересобираем при смене человека: иначе в чужой анкете остались бы
     твои слова. */
  useEffect(() => {
    setMsg("");
    setDraft(mine ? { ...emptyProfile(), ...(me?.profile || {}) } : profileOf(person));
  }, [id, mine, me, person]);

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      /* Уходит и анкета, и график со статусом: их пишет тот же человек и
         тем же нажатием. Разделять на две кнопки значило бы заставить
         сохранять дважды одно решение о себе. */
      const saved = await putProfile({ ...draft, ...scheduleOfPerson(draft) });
      onSaved?.(saved?.profile || draft);
      setMsg("Сохранено.");
    } catch (e) { setMsg(e.message || "не удалось сохранить"); }
    setBusy(false);
  };

  return (
    <div>
      {/* График и статус — ПЕРВЫМИ: прежде чем спрашивать, что человек
          умеет, спрашивают, работает ли он сейчас. И видно это всем, кто
          открыл воркера, а не только ему самому. */}
      <Schedule mine={mine} draft={draft} setDraft={setDraft} />

      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>{mine ? "моя анкета" : "анкета"}</div>
        <div style={{ fontSize: 15, fontWeight: 700, margin: "6px 0 2px" }}>
          {name || "—"}</div>
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
          {mine
            ? "Пишете только вы и только о себе: про себя вы знаете точнее, чем кто-либо. Это видно тем, кто выбирает, кому поручить работу."
            : "Анкету пишет сам человек — здесь она только читается."}
        </div>

        {PROFILE_FIELDS.map((fld) => (
          <div key={fld.id} style={{ marginBottom: 8 }}>
            {mine ? (
              <TxtField area={fld.area} value={draft[fld.id] || ""} placeholder={fld.hint}
                aria-label={fld.name}
                style={fld.area ? { minHeight: 96, lineHeight: 1.5 } : undefined}
                onCommit={(v) => setDraft((p) => ({ ...p, [fld.id]: v }))} />
            ) : (
              <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap",
                color: draft[fld.id] ? C.text : C.muted }}>
                {draft[fld.id] || "не заполнено"}</div>)}
          </div>))}

        {mine && (
          <div className="flex items-center gap-2">
            <button style={btn(true, ACC)} disabled={busy} onClick={save}>
              {busy ? "Сохраняю…" : "Сохранить анкету и график"}</button>
            {msg && (
              <span style={{ fontSize: 11, color: msg === "Сохранено." ? OK : WARN }}>
                {msg}</span>)}
          </div>)}
      </div>

      {/* Рейтинг — вторая половина ответа на тот же вопрос: не «кто это», а
          «как он работал». Поэтому здесь же, а не в отдельном окне. */}
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={{ ...S.lbl, marginBottom: 8 }}>рейтинг и работы</div>
        <PersonStats tasks={tasks} funcs={funcs} personId={id} traitName={traitName} />
      </div>
    </div>);
}
