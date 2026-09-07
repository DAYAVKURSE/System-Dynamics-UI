import React, { useEffect, useRef, useState } from "react";
import { ACC, C, OK, S, btn } from "./ui.jsx";
import {
  addMemory, dropMemory, getAssistantSettings, listMemory, putAssistantSettings,
} from "../assistant.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК · карточка во вкладке «Инструменты»

   Две вещи, и обе — про то, чем помощник располагает.

   «Чем думает» — провайдер, модель и ключ. Ключ ставит ТОЛЬКО владелец:
   это его счёт и его секрет. Остальные видят, какой провайдер выбран и
   есть ли ключ вообще, — чтобы понимать, почему помощник молчит, — но
   самого ключа не видит никто, включая владельца: сервер отдаёт лишь
   «есть/нет».

   «Память» — то, что человек положил в помощника сам: заметку или файл.
   Только своё: список приходит с сервера уже отфильтрованным по подписи,
   и чужого здесь не бывает по построению, а не по кнопке.

   Права проверяет сервер. Карточка лишь не рисует поле ключа тому, кому
   всё равно ответят отказом.
   ════════════════════════════════════════════════════════════════ */

export const PROVIDERS = [
  ["openai", "OpenAI"], ["claude", "Claude"], ["hf", "Hugging Face"],
];

const NAME = Object.fromEntries(PROVIDERS);

/** Начало текста для списка: одна строка, не длиннее 80 знаков. */
export const preview = (text, n = 80) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export default function AssistantSettings({ me }) {
  const canEdit = Boolean(me?.isOwner || me?.solo);
  const [view, setView] = useState(null);   // ответ сервера: provider, model, hasKey, defaults
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [memory, setMemory] = useState(null);
  const [memMsg, setMemMsg] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const fileRef = useRef(null);

  const loadSettings = async () => {
    try {
      const v = await getAssistantSettings();
      setView(v);
      setProvider(v.provider || "");
      setModel(v.model || "");
    } catch (e) { setMsg(e.message); }
  };
  const loadMemory = async () => {
    try { setMemory(await listMemory()); } catch (e) { setMemMsg(e.message); }
  };
  useEffect(() => { loadSettings(); loadMemory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    if (!provider) { setMsg("Сначала выберите провайдера."); return; }
    setBusy(true); setMsg("");
    try {
      const v = await putAssistantSettings({ provider, model, key });
      setView(v); setKey("");
      setMsg("Сохранено.");
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const remember = async () => {
    if (!text.trim()) { setMemMsg("Напишите текст — пустую запись запоминать нечего."); return; }
    setBusy(true); setMemMsg("");
    try {
      await addMemory({ title: title.trim(), text });
      setTitle(""); setText("");
      await loadMemory();
      setMemMsg("Запомнено.");
    } catch (e) { setMemMsg(e.message); }
    setBusy(false);
  };

  const rememberFile = async (file) => {
    if (!file) return;
    setBusy(true); setMemMsg("");
    try {
      await addMemory(file);
      await loadMemory();
      setMemMsg(`Файл «${file.name}» в памяти.`);
    } catch (e) { setMemMsg(e.message); }
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
  };

  const forget = async (id) => {
    setBusy(true); setMemMsg("");
    try { await dropMemory(id); await loadMemory(); }
    catch (e) { setMemMsg(e.message); }
    setBusy(false);
  };

  const hasKey = Boolean(view?.hasKey?.[provider]);
  const placeholder = provider ? (view?.defaults?.[provider] || "") : "сначала выберите провайдера";

  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>помощник</div>
      <div style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 10px", lineHeight: 1.6 }}>
        Помощник отвечает в чате бота и в пространстве задач. Он знает только то,
        что видно вам самим: ваши задачи, файлы, встречи и вашу память;
        владельцу — модель целиком.
      </div>

      {/* ═══ ЧЕМ ДУМАЕТ ═══ */}
      <div style={S.lbl}>чем думает</div>
      {!view && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>{msg || "Загружаю…"}</div>}
      {view && (
        <>
          <div className="flex flex-wrap gap-2" style={{ margin: "8px 0" }}>
            {PROVIDERS.map(([id, name]) => (
              <button key={id} type="button" style={btn(provider === id)}
                aria-pressed={provider === id}
                disabled={!canEdit}
                onClick={() => { setProvider(id); setKey(""); setMsg(""); }}>
                {name}{view.hasKey?.[id] ? " ✓" : ""}
              </button>))}
          </div>
          {!provider && (
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>
              Провайдер не выбран{canEdit ? "" : " — выбирает владелец"}.
            </div>)}

          <div style={S.lbl}>модель</div>
          <input aria-label="модель" style={{ ...S.inp, margin: "6px 0 10px" }}
            value={model} placeholder={placeholder}
            disabled={!canEdit || !provider}
            onChange={(e) => setModel(e.target.value)} />
          {provider && !model && (
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: -6, marginBottom: 10 }}>
              Пусто — подставится {view.defaults?.[provider] || "модель по умолчанию"}.
            </div>)}

          <div style={S.lbl}>ключ {provider ? NAME[provider] : ""}</div>
          {canEdit ? (
            <>
              <input aria-label="ключ" type="password" autoComplete="off"
                style={{ ...S.inp, margin: "6px 0 6px" }}
                value={key} disabled={!provider}
                placeholder={hasKey ? "ключ есть — введите новый, чтобы заменить" : "ключа нет — вставьте"}
                onChange={(e) => setKey(e.target.value)} />
              <div style={{ fontSize: 11.5, color: hasKey ? OK : C.muted, marginBottom: 10 }}>
                {provider ? (hasKey ? "ключ есть" : "ключа нет") : "сначала выберите провайдера"}
                {" · "}наружу ключ не отдаётся, только «есть/нет»
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 10px" }}>
              Ключ ставит владелец.{" "}
              {provider ? (hasKey ? <span style={{ color: OK }}>Ключ есть.</span> : "Ключа нет — помощник пока не отвечает.") : ""}
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
              <button type="button" style={btn(true)} disabled={busy} onClick={save}>Сохранить</button>
              {msg && <span style={{ fontSize: 12, color: C.muted }}>{msg}</span>}
            </div>)}
          {!canEdit && msg && <div style={{ fontSize: 12, color: C.muted }}>{msg}</div>}
        </>
      )}

      {/* ═══ ПАМЯТЬ ═══ */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        <div style={S.lbl}>память помощника</div>
        <div style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 8px", lineHeight: 1.6 }}>
          Заметки и файлы, которые помощник будет знать. Только ваши: чужой памяти
          здесь нет, а вашей нет ни у кого. В чате бота — «запомни: …» или просто
          пришлите документ.
        </div>

        {memory === null && <div style={{ fontSize: 11.5, color: C.muted }}>{memMsg || "Загружаю…"}</div>}
        {memory && memory.length === 0 && (
          <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>Память пуста.</div>)}
        {memory && memory.map((m) => (
          <div key={m.id} className="flex gap-2"
            style={{ alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.title}</div>
              {m.text
                ? <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{preview(m.text)}</div>
                : null}
              {m.file && (
                <a href={m.file.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11.5, color: ACC, display: "inline-block", marginTop: 2 }}>
                  📎 {m.file.name}
                </a>)}
            </div>
            <button type="button" style={btn(false)} disabled={busy}
              aria-label={`удалить из памяти: ${m.title}`}
              onClick={() => forget(m.id)}>Удалить</button>
          </div>))}

        <div style={{ marginTop: 10 }}>
          <div style={S.lbl}>добавить текстом</div>
          <input aria-label="название записи" style={{ ...S.inp, margin: "6px 0" }}
            placeholder="название (можно оставить пустым — возьмётся первая строка)"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea aria-label="текст записи" style={{ ...S.inp, minHeight: 70, marginBottom: 6 }}
            placeholder="что помощнику знать"
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
            <button type="button" style={btn(true)} disabled={busy} onClick={remember}>Запомнить</button>
            <label style={{ ...btn(false), display: "inline-block" }}>
              Добавить файлом
              <input ref={fileRef} type="file" aria-label="файл в память" style={{ display: "none" }}
                onChange={(e) => rememberFile(e.target.files?.[0])} />
            </label>
            {memMsg && <span style={{ fontSize: 12, color: C.muted }}>{memMsg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
