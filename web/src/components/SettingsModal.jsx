import React, { useState } from "react";
import Modal from "./Modal.jsx";
import { C, S } from "./ui.jsx";
import { PlanCard } from "./CodeGate.jsx";
import { LANGS, currentLang, setLang } from "../i18n/t.js";
import { putProfile } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   НАСТРОЙКИ (владелец, 2026-09-21)

   Открываются шестерёнкой на анкете, окном. Внутри — язык приложения и
   бота (русский, английский, китайский; словари — locales/ в корне) и
   форма «мой план», переехавшая сюда с анкеты.

   Смена языка: в анкету на сервере (бот читает оттуда) и в localStorage,
   затем страница перезагружается — иначе половина экрана осталась бы на
   прежнем языке.
   ════════════════════════════════════════════════════════════════ */
export default function SettingsModal({ me, onClose, onChanged }) {
  const [lang, setLangState] = useState(currentLang());
  const [busy, setBusy] = useState(false);
  const pick = async (next) => {
    setLangState(next);
    setBusy(true);
    if (me?.known && !me?.solo) { try { await putProfile({ lang: next }); } catch { /* язык всё равно сменится здесь */ } }
    setLang(next);
    setBusy(false);
  };
  return (
    <Modal title="Настройки" onClose={onClose}>
      <div aria-label="настройки">
        <div style={S.lbl}>язык</div>
        <select aria-label="язык" value={lang} disabled={busy}
          onChange={(e) => pick(e.target.value)}
          style={{ ...S.inp, width: "100%", marginTop: "var(--space-4)" }}>
          {LANGS.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
        </select>
        {me?.code && (
          <div style={{ marginTop: "var(--space-12)", borderTop: `1px solid ${C.line}`, paddingTop: "var(--space-8)" }}>
            <PlanCard me={me} onChanged={onChanged} />
          </div>)}
      </div>
    </Modal>);
}
