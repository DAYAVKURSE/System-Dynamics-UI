import React, { useEffect, useRef, useState } from "react";
import { ACC, BAD, C, OK, S, WARN, btn, TxtField } from "./ui.jsx";
import {
  addAgent, addMemory, addProvider, dropAgent, dropMemory, dropProvider, getAssistantSettings,
  listMemory, providerModels, updateAgent, updateProvider,
} from "../assistant.js";

/* ════════════════════════════════════════════════════════════════
   АГЕНТЫ · карточка во вкладке «Инструменты»

   Владелец (2026-09-13): «вкладка «Помощник» должна называться «Агенты»;
   там одна форма «Ассистент» по умолчанию, которого нельзя удалить, и
   внизу кнопка для добавления новых агентов». И позже тем же днём:
   «второй пункт «Коллекция моделей» нужно удалить — он не имеет смысла.
   Пускай модели добавляются на форме провайдера, но убери поле ручного
   ввода модели и кнопку «Добавить модель». Здесь должно быть поле со
   списком моделей, которые загрузились при нажатии «Обновить список», и
   при нажатии на каждую слева появляется галочка; повторное нажатие
   снимает. Выбранные модели и есть коллекция».

   Две формы — два вопроса. ПРОВАЙДЕР: откуда модели берутся — вид API,
   адрес, ключ (общие для всех агентов человека: ключ один, платит он) и
   список моделей, где галочка у строки значит «этот агент может её
   использовать». Галочки — про ОТКРЫТОГО агента: в записи это
   `agent.models` (пары «провайдер + модель»), а `provider.models` —
   объединение отмеченного всеми агентами, оно ведётся здесь же
   (`toggleModel`), потому что сервер принимает в коллекцию только модели,
   отмеченные у провайдера. У «Ассистента» под списком — какая модель
   расшифровывает записи звонков. ПАМЯТЬ: что агент знает — у каждого своя.

   «Ассистент» — тот, кто отвечает в чате бота и в задачах: первая
   отмеченная модель его коллекции и есть модель ответа. Остальные агенты
   — участники организации у владельца: их можно выбирать в ролях и
   делать воркерами; что они при этом делают, решается отдельно.

   Ключ наружу не уходит никогда: сервер отдаёт лишь «есть/нет».
   ════════════════════════════════════════════════════════════════ */

/** Начало текста для списка: одна строка, не длиннее 80 знаков. */
export const preview = (text, n = 80) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const hint = { fontSize: 11.5, color: C.muted, lineHeight: 1.6 };
const form = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
  padding: 10, marginTop: 10 };
const sameRow = (a, b) => !!a && !!b && a.providerId === b.providerId && a.model === b.model;
const hasRow = (list, row) => (list || []).some((x) => sameRow(x, row));

const EMPTY_FORM = { name: "", kind: "openai", baseUrl: "", key: "" };

export default function AgentsPanel({ me, onChanged }) {
  const [view, setView] = useState(null);   // providers, agents, kinds, tasks
  const [agentId, setAgentId] = useState("assistant");
  const [current, setCurrent] = useState("");   // id открытого провайдера или "new"
  const [providerForm, setProviderForm] = useState(EMPTY_FORM);
  const [newAgent, setNewAgent] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSettings = async () => {
    try {
      const v = await getAssistantSettings();
      setView(v);
      setCurrent((c) => (c && v.providers.some((p) => p.id === c) ? c : (v.providers[0]?.id || "new")));
      setAgentId((a) => ((v.agents || []).some((x) => x.id === a) ? a : "assistant"));
    } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { loadSettings(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* Одна обёртка на все правки: занято → сделать → перечитать → сказать.
     Перечитываем с сервера, а не правим ответ у себя: коллекции агентов
     меняются от удаления провайдера и моделей, и считать это второй раз
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

  const providers = view?.providers || [];
  const agents = view?.agents || [{ id: "assistant", name: "Ассистент", builtin: true, models: [], transcribe: null }];
  const agent = agents.find((a) => a.id === agentId) || agents[0];
  const provider = providers.find((p) => p.id === current) || null;
  const kindOf = (id) => view?.kinds?.find((k) => k.id === id) || null;
  const solo = Boolean(me?.solo);

  const createProvider = async () => {
    const p = await run(() => addProvider(providerForm),
      (p) => `Провайдер «${p.name}» добавлен — отметьте его модели.`);
    if (p) { setProviderForm(EMPTY_FORM); setCurrent(p.id); }
  };
  const createAgent = async () => {
    const name = newAgent.trim();
    if (!name) return;
    const a = await run(() => addAgent(name), (a) => `Агент «${a.name}» добавлен.`);
    if (a) { setNewAgent(""); setAgentId(a.id); onChanged?.(); }
  };
  const removeAgent = async (a) => {
    await run(() => dropAgent(a.id), `Агент «${a.name}» удалён.`);
    setAgentId("assistant");
    onChanged?.();
  };
  /* Галочка у модели в списке провайдера — коллекция ОТКРЫТОГО агента.
     Ставим: сперва модель отмечается у провайдера (иначе сервер пару не
     примет), потом — пара в коллекцию агента. Снимаем: пара уходит из
     коллекции, а у провайдера модель остаётся, пока её держит другой
     агент, — снятая с провайдера модель ушла бы из всех коллекций. */
  const toggleModel = (row) => run(async () => {
    const p = providers.find((x) => x.id === row.providerId);
    if (!p) return null;
    if (hasRow(agent.models, row)) {
      await updateAgent(agent.id, { models: agent.models.filter((x) => !sameRow(x, row)) });
      const others = agents.some((a) => a.id !== agent.id && hasRow(a.models, row));
      if (!others && p.models.includes(row.model)) {
        await updateProvider(p.id, { models: p.models.filter((m) => m !== row.model) });
      }
      return null;
    }
    if (!p.models.includes(row.model)) await updateProvider(p.id, { models: [...p.models, row.model] });
    return updateAgent(agent.id, { models: [...agent.models, row] });
  });

  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>агенты</div>
      <div style={{ ...hint, margin: "6px 0 8px" }}>
        «Ассистент» отвечает в чате бота и в задачах тем, что видно вам самим.
        Другие агенты — участники: их можно выбирать в ролях и делать воркерами.
        Провайдеры, ключи и модели — у каждого человека свои.
      </div>

      {!view && (
        <div style={{ ...hint, marginTop: 6 }}>
          {msg || (solo ? "Без входа через Telegram агентов нет." : "Загружаю…")}</div>)}

      {view && (<>
        {/* ═══ КТО ═══ */}
        <div className="flex flex-wrap gap-2" style={{ margin: "4px 0 8px" }} role="tablist"
          aria-label="агенты">
          {agents.map((a) => (
            <button key={a.id} type="button" role="tab" style={btn(agent?.id === a.id)}
              aria-selected={agent?.id === a.id}
              onClick={() => { setAgentId(a.id); setMsg(""); }}>
              {a.name}{a.builtin ? "" : " · агент"}
            </button>))}
        </div>

        {agent && (
          <div style={{ border: `1px solid ${ACC}66`, borderRadius: 10, padding: 10 }}>
            <div className="flex flex-wrap items-center gap-2">
              <span style={S.lbl}>{agent.builtin ? "ассистент" : "агент"}</span>
              {agent.builtin ? (
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{agent.name}</span>
              ) : (
                <TxtField value={agent.name} aria-label="имя агента"
                  style={{ flex: "1 1 160px", fontSize: 13, fontWeight: 700 }}
                  onCommit={(v) => { if (v.trim() && v.trim() !== agent.name) {
                    run(() => updateAgent(agent.id, { name: v.trim() }), "Сохранено.").then(() => onChanged?.());
                  } }} />)}
              {!agent.builtin && (
                <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                  disabled={busy} aria-label={`удалить агента ${agent.name}`}
                  onClick={() => removeAgent(agent)}>Удалить агента</button>)}
            </div>
            <div style={{ ...hint, marginTop: 4 }}>
              {agent.builtin
                ? "Отвечает первой отмеченной моделью. Удалить нельзя — без него некому отвечать."
                : "Участник организации: роли и активы — во вкладке «Роли» и в воркерах актива."}
            </div>

            {/* ═══ 1. ПРОВАЙДЕР ═══ */}
            <div style={form}>
              <div style={S.lbl}>1 · провайдер</div>
              <div style={{ ...hint, margin: "4px 0 6px" }}>
                Откуда берутся модели: вид API, адрес и ключ. Загрузите список моделей
                и отметьте нажатием те, которыми {agent.builtin ? "ассистент" : "агент"} может
                пользоваться, — отмеченные и есть его коллекция.
              </div>
              <div className="flex flex-wrap gap-2" style={{ margin: "6px 0" }} role="tablist"
                aria-label="провайдеры">
                {providers.map((p) => (
                  <button key={p.id} type="button" role="tab" style={btn(current === p.id)}
                    aria-selected={current === p.id}
                    onClick={() => { setCurrent(p.id); setMsg(""); }}>
                    {p.name}{p.hasKey ? " ✓" : ""}
                  </button>))}
                <button type="button" role="tab" style={btn(current === "new", OK)}
                  aria-selected={current === "new"}
                  onClick={() => { setCurrent("new"); setMsg(""); }}>＋ провайдер</button>
              </div>
              {providers.length === 0 && (
                <div style={{ ...hint, marginBottom: 8 }}>
                  Провайдеров нет.
                </div>)}
              {current === "new" && (
                <NewProvider form={providerForm} setForm={setProviderForm} kinds={view.kinds || []}
                  busy={busy} onAdd={createProvider} />)}
              {provider && (
                <ProviderCard key={`${provider.id}:${agent.id}`} p={provider} kind={kindOf(provider.kind)}
                  busy={busy} agent={agent}
                  onSave={(patch) => run(() => updateProvider(provider.id, patch), "Сохранено.")}
                  onDrop={() => run(() => dropProvider(provider.id),
                    `Провайдер «${provider.name}» удалён вместе с ключом.`)}
                  onModels={() => providerModels(provider.id)}
                  onToggle={toggleModel} />)}
              {agent.builtin && (
                <Transcribe agent={agent} providers={providers} busy={busy}
                  onTranscribe={(row) => run(() => updateAgent(agent.id, { transcribe: row }))} />)}
            </div>

            {/* ═══ 2. ПАМЯТЬ ═══ */}
            <Memory key={agent.id} agent={agent} busy={busy} setBusy={setBusy} />
          </div>)}

        {msg && <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }} role="status">{msg}</div>}

        {/* ═══ НОВЫЙ АГЕНТ ═══ */}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 12 }}>
          <TxtField value={newAgent} placeholder="имя нового агента"
            style={{ flex: "2 1 170px" }} onCommit={setNewAgent} />
          <button type="button" style={btn(true)} disabled={busy || !newAgent.trim()}
            onClick={createAgent}>+ агент</button>
        </div>
        <div style={{ ...hint, marginTop: 5 }}>
          {me?.isOwner
            ? "Новый агент становится участником: его можно выбрать в ролях и сделать воркером актива."
            : "Новый агент — только ваш: участником организации агентов делает владелец."}
        </div>
      </>)}
    </div>
  );
}

/* ─────── новый провайдер: название, вид API, адрес, ключ ─────── */

function NewProvider({ form, setForm, kinds, busy, onAdd }) {
  const kind = kinds.find((k) => k.id === form.kind) || null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div style={{ background: C.panel, borderRadius: 8, padding: 10, marginBottom: 6 }}>
      <div style={S.lbl}>новый провайдер</div>
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

/* ─────── открытый провайдер: ключ «есть/нет», список моделей с галочками, удалить ─────── */

function ProviderCard({ p, kind, busy, agent, onSave, onDrop, onModels, onToggle }) {
  const [name, setName] = useState(p.name);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [key, setKey] = useState("");
  const [offered, setOffered] = useState(null);   // список от провайдера: null — не спрашивали
  const [listMsg, setListMsg] = useState("");
  const [confirm, setConfirm] = useState(false);

  const changed = name !== p.name || baseUrl !== p.baseUrl || key;
  const save = async () => {
    await onSave({ name, baseUrl, ...(key ? { key } : {}) });
    setKey("");
  };
  const fetchList = async () => {
    setListMsg("");
    try {
      const list = await onModels();
      setOffered(list);
      if (!list.length) setListMsg(`${kind?.name || "Провайдер"} список не отдал: проверьте адрес и ключ.`);
    } catch (e) { setOffered([]); setListMsg(e.message); }
  };
  /* Что в списке: то, что отдал провайдер, а над ним — отмеченное у него
     ранее, чего в списке нет (список ещё не спрашивали или модель из него
     ушла): отмеченное не должно исчезать с экрана. */
  const known = new Set((offered || []).map((m) => m.id));
  const extra = p.models.filter((m) => !known.has(m));
  const rows = [...extra.map((m) => ({ id: m, name: m, extra: true })), ...(offered || [])];
  const picked = (id) => hasRow(agent?.models, { providerId: p.id, model: id });
  const count = (agent?.models || []).filter((r) => r.providerId === p.id).length;

  return (
    <div style={{ background: C.panel, borderRadius: 8, padding: 10 }}>
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
      <div style={{ ...hint, margin: "4px 0 6px" }}>
        Нажатие ставит галочку — модель в коллекции {agent?.builtin ? "ассистента" : "агента"};
        повторное — снимает.{count ? ` Отмечено: ${count}.` : " Пока ничего не отмечено."}
      </div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
        <button type="button" style={btn(false)} disabled={busy} onClick={fetchList}>
          {offered ? "Обновить список" : "Загрузить список моделей"}</button>
      </div>
      {/* Список — строки-кнопки с галочкой слева, а не чекбоксы: владелец
          просил именно так («при нажатии слева появляется галочка»).
          Для читалки и тестов строка — role="checkbox" с aria-checked. */}
      {rows.length > 0 && (
        <div role="group" aria-label={`модели ${p.name}`}
          style={{ maxHeight: 220, overflowY: "auto", marginBottom: 6,
            border: `1px solid ${C.line}`, borderRadius: 6 }}>
          {rows.map((m) => {
            const on = picked(m.id);
            return (
              <button key={m.id} type="button" role="checkbox" aria-checked={on} disabled={busy}
                aria-label={`модель ${m.id}`} onClick={() => onToggle({ providerId: p.id, model: m.id })}
                className="flex items-center gap-2"
                style={{ width: "100%", textAlign: "left", background: on ? `${OK}22` : "transparent",
                  border: "none", borderBottom: `1px solid ${C.line}`, color: C.text,
                  padding: "5px 8px", fontSize: 12, cursor: busy ? "default" : "pointer" }}>
                <span aria-hidden="true" style={{ width: 16, display: "inline-block",
                  color: OK, fontWeight: 700 }}>{on ? "✓" : ""}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                </span>
              </button>);
          })}
        </div>)}
      {!rows.length && !listMsg && (
        <div style={{ ...hint, marginBottom: 4 }}>
          Список пуст — нажмите «Загрузить список моделей».</div>)}
      {listMsg && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{listMsg}</div>}
    </div>
  );
}

/* ─────── расшифровка записей звонков: только у «Ассистента» ─────── */

function Transcribe({ agent, providers, busy, onTranscribe }) {
  /* Выбирать — из коллекции ассистента: то, что он может использовать. */
  const rows = (agent.models || []).map((r) => {
    const p = providers.find((x) => x.id === r.providerId);
    return { ...r, label: `${p?.name || r.providerId} / ${r.model}` };
  });
  const t = agent.transcribe;
  const tValue = t ? `${t.providerId}|${t.model}` : "";
  return (
    <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 8 }}>
      <span style={{ fontSize: 11.5, color: C.muted }}>расшифровка записей звонков</span>
      <select aria-label="модель для расшифровки" style={{ ...S.inp, width: "auto", flex: 1, minWidth: 150 }}
        disabled={busy || rows.length === 0} value={tValue}
        onChange={(e) => {
          const v = e.target.value;
          const i = v.indexOf("|");
          onTranscribe(v ? { providerId: v.slice(0, i), model: v.slice(i + 1) } : null);
        }}>
        {/* У расшифровки отката на модель чата нет (lib/transcribe.js):
            подпись обязана говорить, что будет на самом деле — ничего. */}
        <option value="">— не выбрана (расшифровки не будет)</option>
        {rows.map((r) => (
          <option key={`${r.providerId}|${r.model}`} value={`${r.providerId}|${r.model}`}>{r.label}</option>))}
      </select>
    </div>
  );
}

/* ─────── память агента ─────── */

function Memory({ agent, busy, setBusy }) {
  const [memory, setMemory] = useState(null);
  const [memMsg, setMemMsg] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const fileRef = useRef(null);
  const reload = async () => {
    try { setMemory(await listMemory(agent.id)); } catch (e) { setMemMsg(e.message); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id]);

  const remember = async () => {
    if (!text.trim()) { setMemMsg("Напишите текст — пустую запись запоминать нечего."); return; }
    setBusy(true); setMemMsg("");
    try {
      await addMemory({ title: title.trim(), text }, agent.id);
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
      await addMemory(file, agent.id);
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
    <div style={form}>
      <div style={S.lbl}>2 · память</div>
      <div style={{ ...hint, margin: "4px 0 8px" }}>
        Заметки и файлы, которые {agent.builtin ? "ассистент" : "агент"} будет знать. Только
        ваши: чужой памяти здесь нет, а вашей нет ни у кого.
        {agent.builtin ? " В чате бота — «запомни: …» или просто пришлите документ." : ""}
      </div>
      {memory === null && <div style={hint}>{memMsg || "Загружаю…"}</div>}
      {memory && memory.length === 0 && <div style={{ ...hint, marginBottom: 8 }}>Память пуста.</div>}
      {memory && memory.map((m) => (
        <div key={m.id} className="flex gap-2"
          style={{ alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.title}</div>
            {m.text ? <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{preview(m.text)}</div> : null}
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
          placeholder="что агенту знать"
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
