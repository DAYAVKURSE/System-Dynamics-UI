import React, { useEffect, useState } from "react";
import { C, ACC, OK, WARN, S, btn, TxtField } from "./ui.jsx";
import PersonStats from "./PersonStats.jsx";
import { putProfile } from "../identity.js";

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

/** Поле анкеты одно. Что в него писать — решает человек, а не форма. */
export const PROFILE_FIELDS = [
  { id: "about", name: "анкета", area: true,
    hint: "что о себе стоит знать тому, кто выбирает, кому поручить работу" },
];

export const emptyProfile = () => Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, ""]));

/** Анкета из записи человека — в том виде, в каком её показывают. */
export const profileOf = (person = {}) => Object.fromEntries(
  PROFILE_FIELDS.map((f) => [f.id, String(person?.[f.id] || "")]),
);

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
      const saved = await putProfile(draft);
      onSaved?.(saved?.profile || draft);
      setMsg("Сохранено.");
    } catch (e) { setMsg(e.message || "не удалось сохранить"); }
    setBusy(false);
  };

  return (
    <div>
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
              {busy ? "Сохраняю…" : "Сохранить анкету"}</button>
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
