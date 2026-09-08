import React, { useEffect, useRef, useState } from "react";
import { ACC, BAD, C, OK, S, btn } from "./ui.jsx";
import {
  addMemory, addProvider, dropMemory, dropProvider, getAssistantSettings, listMemory,
  providerModels, putTasks, updateProvider,
} from "../assistant.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК · карточка во вкладке «Инструменты»

   Две вещи, и обе — про то, чем помощник располагает У ЭТОГО человека.

   «Чем думает» — свои провайдеры и модели. Провайдер — вид API (совместимый
   с OpenAI / Anthropic / Hugging Face), адрес и ключ; OpenRouter или Groq
   — ещё один провайдер вида «OpenAI» с другим адресом. У провайдера
   список моделей (из списка провайдера или вручную), а таблица «задача →
   модель» говорит, какая из них на что отвечает. Ключ ставит сам человек
   за свой счёт; владелец за других ничего не ставит. Самого ключа не видит
   никто, включая того, кто его вставил: сервер отдаёт лишь «есть/нет».

   «Память» — то, что человек положил в помощника сам: заметку или файл.
   Только своё: список приходит с сервера уже отфильтрованным по подписи,
   и чужого здесь не бывает по построению, а не по кнопке.
   ════════════════════════════════════════════════════════════════ */

/** Начало текста для списка: одна строка, не длиннее 80 знаков. */
export const preview = (text, n = 80) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/* Строка таблицы едет в <select> одним значением: id провайдера и имя
   модели через «|» — в id нет «|» (он из hex), в имени модели тоже
   (сервер пускает только буквы, цифры и . _ : / -). */
export const rowValue = (row) => (row ? `${row.providerId}|${row.model}` : "");
export const rowFrom = (value) => {
  if (!value) return null;
  const i = value.indexOf("|");
  return { providerId: value.slice(0, i), model: value.slice(i + 1) };
};

const hint = { fontSize: 11.5, color: C.muted, lineHeight: 1.6 };

const EMPTY_FORM = { name: "", kind: "openai", baseUrl: "", key: "" };

export default function AssistantSettings({ me }) {
  const [view, setView] = useState(null);   // ответ сервера: providers, tasks, kinds, taskList
  const [current, setCurrent] = useState("");   // id открытого провайдера или "new"
  const [form, setForm] = useState(EMPTY_FORM);
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
      setCurrent((c) => (c && v.providers.some((p) => p.id === c) ? c : (v.providers[0]?.id || "new")));
    } catch (e) { setMsg(e.message); }
  };
  const loadMemory = async () => {
    try { setMemory(await listMemory()); } catch (e) { setMemMsg(e.message); }
  };
  useEffect(() => { loadSettings(); loadMemory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* Одна обёртка на все правки: занято → сделать → перечитать → сказать.
     Перечитываем с сервера, а не правим ответ у себя: таблица задач
     меняется от удаления провайдера и моделей, и считать это второй раз
     на клиенте значило бы разойтись с сервером. */
  const run = async (job, done) => {
    setBusy(true); setMsg("");
    try {
      const out = await job();
      await loadSettings();
      if (done) setMsg(typeof done === "function" ? done(out) : done);
      return out;
    } catch (e) { setMsg(e.message); return null; } finally { setBusy(false); }
  };

  const create = async () => {
    const p = await run(() => addProvider(form), (p) => `Провайдер «${p.name}» добавлен — теперь модели.`);
    if (p) { setForm(EMPTY_FORM); setCurrent(p.id); }
  };

  const providers = view?.providers || [];
  const provider = providers.find((p) => p.id === current) || null;
  const kindOf = (id) => view?.kinds?.find((k) => k.id === id) || null;
  const solo = Boolean(me?.solo);

  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>помощник</div>
      <div style={{ ...hint, margin: "6px 0 10px" }}>
        Помощник отвечает в чате бота и в пространстве задач. Он знает только то,
        что видно вам самим: ваши задачи, файлы, встречи, чаты с ботом и вашу память;
        владельцу — модель целиком. Провайдеры, ключи и модели — у каждого свои:
        вы спрашиваете своей моделью за свой счёт.
      </div>

      {/* ═══ ЧЕМ ДУМАЕТ ═══ */}
      <div style={S.lbl}>чем думает</div>
      {!view && <div style={{ ...hint, marginTop: 6 }}>{msg || (solo ? "Без входа через Telegram помощника нет." : "Загружаю…")}</div>}
      {view && (
        <>
          <div className="flex flex-wrap gap-2" style={{ margin: "8px 0" }} role="tablist" aria-label="провайдеры">
            {providers.map((p) => (
              <button key={p.id} type="button" role="tab" style={btn(current === p.id)}
                aria-selected={current === p.id} aria-pressed={current === p.id}
                onClick={() => { setCurrent(p.id); setMsg(""); }}>
                {p.name}{p.hasKey ? " ✓" : ""}
              </button>))}
            <button type="button" role="tab" style={btn(current === "new", OK)}
              aria-selected={current === "new"} aria-pressed={current === "new"}
              onClick={() => { setCurrent("new"); setMsg(""); }}>＋ провайдер</button>
          </div>
          {providers.length === 0 && (
            <div style={{ ...hint, marginBottom: 8 }}>
              Провайдеров нет — помощник пока не отвечает. Добавьте первого: вид API, адрес и ключ.
            </div>)}

          {current === "new" && (
            <NewProvider form={form} setForm={setForm} kinds={view.kinds || []} busy={busy}
              onAdd={create} />)}

          {provider && (
            <ProviderCard key={provider.id} p={provider} kind={kindOf(provider.kind)} busy={busy}
              onSave={(patch) => run(() => updateProvider(provider.id, patch), "Сохранено.")}
              onDrop={() => run(() => dropProvider(provider.id), `Провайдер «${provider.name}» удалён вместе с ключом.`)}
              onModels={() => providerModels(provider.id)} />)}

          <TaskTable taskList={view.taskList || []} tasks={view.tasks || {}} providers={providers} busy={busy}
            onPick={(taskId, row) => run(() => putTasks({ [taskId]: row }))} />

          {msg && <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }} role="status">{msg}</div>}
        </>
      )}

      {/* ═══ ПАМЯТЬ ═══ */}
      <Memory memory={memory} memMsg={memMsg} setMemMsg={setMemMsg} busy={busy} setBusy={setBusy}
        title={title} setTitle={setTitle} text={text} setText={setText} fileRef={fileRef}
        reload={loadMemory} />
    </div>
  );
}

/* ─────── новый провайдер: название, вид API, адрес, ключ ─────── */

function NewProvider({ form, setForm, kinds, busy, onAdd }) {
  const kind = kinds.find((k) => k.id === form.kind) || null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div style={{ background: C.panel2, borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div style={S.lbl}>новый провайдер</div>
      <div style={{ ...hint, margin: "4px 0 8px" }}>
        Вид API говорит, как с ним разговаривать; адрес — куда. OpenRouter, Groq и
        подобные — вид «совместимый с OpenAI» со своим адресом.
      </div>
      <input aria-label="название провайдера" style={{ ...S.inp, marginBottom: 6 }}
        placeholder="название — как вы его называете: «Мой OpenRouter»"
        value={form.name} onChange={set("name")} />
      <select aria-label="вид API" style={{ ...S.inp, marginBottom: 6 }} value={form.kind} onChange={set("kind")}>
        {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
      <input aria-label="адрес провайдера" style={{ ...S.inp, marginBottom: 6 }}
        placeholder={kind ? `пусто — ${kind.defaultBaseUrl}` : "адрес"}
        value={form.baseUrl} onChange={set("baseUrl")} />
      <input aria-label="ключ провайдера" type="password" autoComplete="off"
        style={{ ...S.inp, marginBottom: 6 }} placeholder="ключ — вставьте; наружу он не отдаётся"
        value={form.key} onChange={set("key")} />
      <button type="button" style={btn(true, OK)} disabled={busy} onClick={onAdd}>Добавить провайдера</button>
    </div>
  );
}

/* ─────── открытый провайдер: ключ «есть/нет», модели, удалить ─────── */

function ProviderCard({ p, kind, busy, onSave, onDrop, onModels }) {
  const [name, setName] = useState(p.name);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [key, setKey] = useState("");
  const [manual, setManual] = useState("");
  const [offered, setOffered] = useState(null);   // список от провайдера: null — не спрашивали
  const [pick, setPick] = useState("");
  const [listMsg, setListMsg] = useState("");
  const [confirm, setConfirm] = useState(false);

  const changed = name !== p.name || baseUrl !== p.baseUrl || key;
  const save = async () => {
    await onSave({ name, baseUrl, ...(key ? { key } : {}) });
    setKey("");
  };
  const addModel = async (m) => {
    const id = String(m || "").trim();
    if (!id) { setListMsg("Введите имя модели — пустую добавлять нечего."); return; }
    if (p.models.includes(id)) { setListMsg(`«${id}» уже в списке.`); return; }
    setListMsg("");
    await onSave({ models: [...p.models, id] });
    setManual(""); setPick("");
  };
  const fetchList = async () => {
    setListMsg("");
    try {
      const list = await onModels();
      setOffered(list);
      setPick(list[0]?.id || "");
      if (!list.length) setListMsg(`${kind?.name || "Провайдер"} список не отдал — введите имя модели вручную.`);
    } catch (e) { setOffered([]); setListMsg(e.message); }
  };

  return (
    <div style={{ background: C.panel2, borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
        <div style={S.lbl}>провайдер · {kind?.name || p.kind}</div>
        <div style={{ fontSize: 11.5, color: p.hasKey ? OK : BAD, marginLeft: "auto" }}>
          {p.hasKey ? "ключ есть" : "ключа нет"}
        </div>
      </div>
      <input aria-label="название провайдера" style={{ ...S.inp, marginBottom: 6 }}
        value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="адрес провайдера" style={{ ...S.inp, marginBottom: 6 }}
        placeholder={kind ? `пусто — ${kind.defaultBaseUrl}` : "адрес"}
        value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <input aria-label="заменить ключ" type="password" autoComplete="off"
        style={{ ...S.inp, marginBottom: 4 }} value={key}
        placeholder={p.hasKey ? "ключ есть — введите новый, чтобы заменить" : "ключа нет — вставьте"}
        onChange={(e) => setKey(e.target.value)} />
      <div style={{ ...hint, marginBottom: 8 }}>Наружу ключ не отдаётся, только «есть/нет».</div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 10 }}>
        <button type="button" style={btn(true)} disabled={busy || !changed} onClick={save}>Сохранить</button>
        {!confirm && (
          <button type="button" style={btn(false, BAD)} disabled={busy}
            onClick={() => setConfirm(true)}>Удалить провайдера</button>)}
        {confirm && (
          <>
            <span style={{ fontSize: 12, color: C.text }}>Удалить «{p.name}» вместе с ключом?</span>
            <button type="button" style={btn(true, BAD)} disabled={busy} onClick={onDrop}>Да, удалить</button>
            <button type="button" style={btn(false)} onClick={() => setConfirm(false)}>Нет</button>
          </>)}
      </div>

      <div style={S.lbl}>модели</div>
      {p.models.length === 0 && (
        <div style={{ ...hint, margin: "4px 0" }}>Моделей нет — без них провайдер в таблице задач не появится.</div>)}
      <div className="flex flex-wrap gap-2" style={{ margin: "6px 0" }}>
        {p.models.map((m) => (
          <span key={m} style={{ ...btn(true), display: "inline-flex", gap: 6, alignItems: "center", cursor: "default" }}>
            {m}
            <button type="button" aria-label={`убрать модель ${m}`} disabled={busy}
              style={{ background: "none", border: 0, color: C.muted, cursor: "pointer", padding: 0, fontSize: 13 }}
              onClick={() => onSave({ models: p.models.filter((x) => x !== m) })}>×</button>
          </span>))}
      </div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
        <button type="button" style={btn(false)} disabled={busy} onClick={fetchList}>Список у провайдера</button>
        {offered && offered.length > 0 && (
          <>
            <select aria-label="модель из списка провайдера" style={{ ...S.inp, width: "auto", flex: 1, minWidth: 140 }}
              value={pick} onChange={(e) => setPick(e.target.value)}>
              {offered.map((m) => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
            </select>
            <button type="button" style={btn(true)} disabled={busy} onClick={() => addModel(pick)}>Добавить из списка</button>
          </>)}
      </div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <input aria-label="имя модели" style={{ ...S.inp, width: "auto", flex: 1, minWidth: 140 }}
          placeholder="или вручную: gpt-4.1, claude-sonnet-4-5, meta-llama/…"
          value={manual} onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addModel(manual); }} />
        <button type="button" style={btn(true)} disabled={busy} onClick={() => addModel(manual)}>Добавить модель</button>
      </div>
      {listMsg && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{listMsg}</div>}
    </div>
  );
}

/* ─────── таблица «задача → модель» ─────── */

function TaskTable({ taskList, tasks, providers, busy, onPick }) {
  const options = providers.flatMap((p) => p.models.map((m) => ({ value: rowValue({ providerId: p.id, model: m }),
    label: `${p.name} / ${m}` })));
  return (
    <div style={{ marginTop: 6 }}>
      <div style={S.lbl}>задача → модель</div>
      <div style={{ ...hint, margin: "4px 0 6px" }}>
        Какая модель на что отвечает. Пустая строка значит «как помощник по умолчанию»;
        пустой «помощник по умолчанию» — первый провайдер и первая модель из его списка.
        Исключение — расшифровка записей: без своей строки она не запускается вовсе
        (модель чата записи не расшифровывает), а после выбора модели записи без текста
        расшифруются сами.
      </div>
      {options.length === 0 && (
        <div style={{ ...hint, marginBottom: 6 }}>Выбирать пока не из чего: добавьте провайдеру хотя бы одну модель.</div>)}
      {taskList.map((t) => (
        <div key={t.id} className="flex gap-2" style={{ alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1, fontSize: 12.5 }}>{t.name}</div>
          <select aria-label={`модель для: ${t.name}`} style={{ ...S.inp, width: "auto", flex: 1.4, minWidth: 150 }}
            disabled={busy || options.length === 0}
            value={rowValue(tasks[t.id])} onChange={(e) => onPick(t.id, rowFrom(e.target.value))}>
            {/* У расшифровки отката на «по умолчанию» нет (lib/transcribe.js):
                подпись обязана говорить, что будет на самом деле — ничего. */}
            <option value="">{t.id === "chat" ? "— не выбрана"
              : t.id === "transcribe" ? "— не выбрана (расшифровки не будет)" : "— как по умолчанию"}</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>))}
    </div>
  );
}

/* ─────── память ─────── */

function Memory({ memory, memMsg, setMemMsg, busy, setBusy, title, setTitle, text, setText, fileRef, reload }) {
  const remember = async () => {
    if (!text.trim()) { setMemMsg("Напишите текст — пустую запись запоминать нечего."); return; }
    setBusy(true); setMemMsg("");
    try {
      await addMemory({ title: title.trim(), text });
      setTitle(""); setText("");
      await reload();
      setMemMsg("Запомнено.");
    } catch (e) { setMemMsg(e.message); }
    setBusy(false);
  };

  const rememberFile = async (file) => {
    if (!file) return;
    setBusy(true); setMemMsg("");
    try {
      await addMemory(file);
      await reload();
      setMemMsg(`Файл «${file.name}» в памяти.`);
    } catch (e) { setMemMsg(e.message); }
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
  };

  const forget = async (id) => {
    setBusy(true); setMemMsg("");
    try { await dropMemory(id); await reload(); }
    catch (e) { setMemMsg(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
      <div style={S.lbl}>память помощника</div>
      <div style={{ ...hint, margin: "6px 0 8px" }}>
        Заметки и файлы, которые помощник будет знать. Только ваши: чужой памяти
        здесь нет, а вашей нет ни у кого. В чате бота — «запомни: …» или просто
        пришлите документ.
      </div>

      {memory === null && <div style={hint}>{memMsg || "Загружаю…"}</div>}
      {memory && memory.length === 0 && (
        <div style={{ ...hint, marginBottom: 8 }}>Память пуста.</div>)}
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
  );
}
