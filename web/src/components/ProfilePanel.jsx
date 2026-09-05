import React, { useEffect, useState } from "react";
import { C, ACC, OK, WARN, S, btn, TxtField } from "./ui.jsx";
import PersonStats from "./PersonStats.jsx";
import { putProfile } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   СТРАНИЦА ЧЕЛОВЕКА · анкета и рейтинг

   Рейтинг говорит, КАК человек работал. Он не говорит, кто это: чем
   занимается, что умеет, как с ним связаться. Прежде этого не было нигде,
   и человек в модели был именем со средней оценкой.

   Здесь обе половины сразу: анкета сверху, история под ней. Разводить их
   по разным местам значило бы заставлять сличать две страницы, чтобы
   ответить на один вопрос — «кто это и стоит ли ему поручать».

   ─── кто пишет анкету ───

   Сам человек, и только свою. Про себя он знает точнее, а анкета,
   заполненная кем-то другим, была бы чужим мнением под чужим именем.
   Поэтому чужая страница здесь только читается: поля показаны как текст,
   а не как поля ввода, — и не потому, что «нет прав», а потому что писать
   там нечего.

   ─── почему вкладка первая ───

   Это единственное место, где человек говорит о СЕБЕ. Всё остальное в
   приложении — про работу; если бы своя анкета лежала внутри инструментов
   владельца, до неё нельзя было бы дойти тому, кто не владелец.
   ════════════════════════════════════════════════════════════════ */

/** Поля анкеты. Их немного: анкета должна заполняться, а не отпугивать. */
export const PROFILE_FIELDS = [
  { id: "title", name: "чем занимается", hint: "коротко: роль, специальность, должность" },
  { id: "about", name: "о себе", area: true, hint: "что о себе стоит знать тому, кто ставит задачу" },
  { id: "skills", name: "что умеет", area: true, hint: "то, за чем к нему приходят" },
  { id: "contact", name: "как связаться", hint: "почта, телеграм, телефон — как удобно" },
];

export const emptyProfile = () => Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, ""]));

/** Анкета из записи человека — в том виде, в каком её показывают. */
export const profileOf = (person = {}) => Object.fromEntries(
  PROFILE_FIELDS.map((f) => [f.id, String(person?.[f.id] || "")]),
);

/** Заполнена ли анкета хоть чем-нибудь. */
export const filled = (p = {}) => PROFILE_FIELDS.some((f) => String(p[f.id] || "").trim());

export default function ProfilePanel({ me, personId, people = [], tasks = [], funcs = [],
  traitName, onPerson, onSaved }) {
  // Чья страница открыта. По умолчанию — своя: с себя человек и начинает.
  const id = personId == null ? me?.id : personId;
  const mine = String(id) === String(me?.id);
  const person = people.find((p) => String(p.id) === String(id)) || null;
  const name = person?.name || me?.name || String(id ?? "");

  const [draft, setDraft] = useState(emptyProfile());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  /* Своя анкета приходит вместе с «кто я», чужая — из списка людей.
     Пересобираем при смене человека: иначе в чужой странице остались бы
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

  const others = people.filter((p) => String(p.id) !== String(id));

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
          <span style={S.lbl}>{mine ? "моя анкета" : "анкета"}</span>
          <span style={{ flex: 1 }} />
          {!mine && (
            <button style={btn(false)} onClick={() => onPerson && onPerson(me?.id)}>
              ← моя анкета</button>)}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{name || "—"}</div>
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
          {mine
            ? "Пишете только вы и только о себе: про себя вы знаете точнее, чем кто-либо. Это видно тем, кто выбирает, кому поручить работу."
            : "Анкету пишет сам человек — здесь она только читается."}
        </div>

        {PROFILE_FIELDS.map((fld) => (
          <div key={fld.id} style={{ marginBottom: 8 }}>
            <div style={S.lbl}>{fld.name}</div>
            {mine ? (<>
              <TxtField area={fld.area} value={draft[fld.id] || ""} placeholder={fld.hint}
                aria-label={fld.name}
                style={fld.area ? { minHeight: 56, lineHeight: 1.5 } : undefined}
                onCommit={(v) => setDraft((p) => ({ ...p, [fld.id]: v }))} />
            </>) : (
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

      {others.length > 0 && (
        <div style={{ ...S.card, marginBottom: 10 }}>
          <div style={{ ...S.lbl, marginBottom: 6 }}>другие люди</div>
          <div className="flex flex-wrap gap-2">
            {others.map((p) => (
              <button key={p.id} style={{ ...btn(false), fontSize: 11.5 }}
                onClick={() => onPerson && onPerson(p.id)}>{p.name || p.id}</button>))}
          </div>
        </div>)}
    </div>);
}
