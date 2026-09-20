import React, { useEffect, useRef, useState } from "react";
import { ACC, BAD, C, OK, S, WARN, btn, TxtField } from "./ui.jsx";
import Modal from "./Modal.jsx";
import {
  addAgent, addMcp, addMemory, addProvider, dropAgent, dropMcp, dropMemory, dropProvider,
  getAssistantSettings, listMemory, mcpTools, providerModels, updateAgent, updateProvider,
} from "../assistant.js";

/* ════════════════════════════════════════════════════════════════
   АГЕНТЫ · вкладка «Инструменты»

   ТРИ ФОРМЫ, и каждая отвечает на свой вопрос (владелец, 2026-09-20):

   1. АГЕНТЫ — кто отвечает и что ему поручено. Вкладки с именами, справа
      от них «+ агент»; имя правится двойным нажатием по нему в шапке
      формы. Внизу формы «Удалить» — с вопросом «Вы уверены?».
   2. ПРОВАЙДЕРЫ И МОДЕЛИ — откуда модели берутся. Провайдеров несколько,
      моделей несколько; отмеченная модель считается ПОДКЛЮЧЁННОЙ.
   3. MCP-СЕРВЕРЫ — чужие инструменты: адрес, репозиторий, откуда он взят,
      и список того, что сервер умеет. Приложение ходит к ним само.

   Почему так разделено: провайдер и ключ — про деньги и доступ, они общие
   на всех агентов человека; а назначения и MCP — про то, чем занят
   конкретный агент. Пока они жили одной формой, «отметить модель» значило
   сразу две разные вещи.

   НАЗНАЧЕНИЯ. У агента пять полей — основная, голосовые, рисование,
   распознавание, расшифровка, — и в каждом выбор ТОЛЬКО из подключённых
   моделей. Чего не выбрали, того у агента нет, и он об этом говорит прямо,
   а не выдумывает результат (`modelsNote` на сервере).

   ЧТО ОН ДЕЛАЕТ САМ. Ассистент умеет то же, что человек, который к нему
   обращается: взять задачу, сдать, принять, поправить модель — если тот
   владелец. Права не описаны второй раз: действия зовут те же функции,
   что и кнопки. Переключатель «спрашивать / применять сразу» — здесь же,
   у агента: от него зависит, спросит он разрешения или просто сделает.

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
const EMPTY_MCP = { name: "", url: "", repo: "" };
/* Назначения приходят с сервера (`USES`), но список нужен и до ответа:
   форма рисуется сразу, а не после загрузки. */
const USES_FALLBACK = [
  { id: "main", name: "Основная" },
  { id: "voice", name: "Отправка голосовых сообщений" },
  { id: "draw", name: "Рисование изображений" },
  { id: "vision", name: "Распознавание изображений" },
  { id: "transcribe", name: "Расшифровка записей звонков" },
];
const DEFAULT_AGENT = { id: "assistant", name: "Ассистент", builtin: true, models: [],
  transcribe: null, uses: {}, mcp: [], ask: true };

export default function AgentsPanel({ me, onChanged }) {
  const [view, setView] = useState(null);   // providers, agents, kinds, tasks, mcp, uses
  const [agentId, setAgentId] = useState("assistant");
  const [current, setCurrent] = useState("");   // id открытого провайдера или "new"
  const [providerForm, setProviderForm] = useState(EMPTY_FORM);
  const [mcpForm, setMcpForm] = useState(EMPTY_MCP);
  const [renaming, setRenaming] = useState(false);
  const [killing, setKilling] = useState(null);
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

  /* Одна обёртка на все правки: занято → сделать → перечитать → сказать. */
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
  const agents = view?.agents || [DEFAULT_AGENT];
  const agent = agents.find((a) => a.id === agentId) || agents[0];
  const provider = providers.find((p) => p.id === current) || null;
  const servers = view?.mcp || [];
  const uses = view?.uses || USES_FALLBACK;
  const kindOf = (id) => view?.kinds?.find((k) => k.id === id) || null;
  const solo = Boolean(me?.solo);

  /* ПОДКЛЮЧЁННЫЕ МОДЕЛИ — отмеченные у провайдеров. Из них и только из
     них агент выбирает, чем ему что делать. */
  const connected = providers.flatMap((p) => (p.models || [])
    .map((m) => ({ providerId: p.id, model: m, label: `${p.name} / ${m}` })));

  const createProvider = async () => {
    const p = await run(() => addProvider(providerForm),
      (x) => `Провайдер «${x.name}» добавлен — загрузите список моделей.`);
    if (p) { setProviderForm(EMPTY_FORM); setCurrent(p.id); }
  };
  /* «+ агент» заводит агента сразу, без поля имени: имя правится в шапке
     его формы двойным нажатием (владелец, 2026-09-20). */
  const createAgent = async () => {
    const a = await run(() => addAgent(`Агент ${agents.length}`), (x) => `Агент «${x.name}» добавлен.`);
    if (a) { setAgentId(a.id); setRenaming(true); onChanged?.(); }
  };
  const killAgent = async (a) => {
    setKilling(null);
    await run(() => dropAgent(a.id), `Агент «${a.name}» удалён.`);
    setAgentId("assistant");
    onChanged?.();
  };
  /* Галочка у модели в списке провайдера — ПОДКЛЮЧЕНИЕ модели. Снятая
     уходит и из назначений: назначить то, чего нет, нельзя. */
  const toggleModel = (row) => run(async () => {
    const p = providers.find((x) => x.id === row.providerId);
    if (!p) return null;
    const on = (p.models || []).includes(row.model);
    if (on) {
      for (const a of agents) {
        const patch = {};
        const left = (a.models || []).filter((x) => !sameRow(x, row));
        if (left.length !== (a.models || []).length) patch.models = left;
        const drop = {};
        uses.forEach((u) => { if (sameRow(a.uses?.[u.id], row)) drop[u.id] = null; });
        if (Object.keys(drop).length) patch.uses = drop;
        if (Object.keys(patch).length) await updateAgent(a.id, patch);
      }
      return updateProvider(p.id, { models: (p.models || []).filter((m) => m !== row.model) });
    }
    return updateProvider(p.id, { models: [...(p.models || []), row.model] });
  });

  const setUse = (useId, value) => run(() => updateAgent(agent.id, { uses: { [useId]: value } }));

  return (<>
    {/* ═══ 1. АГЕНТЫ ═══ */}
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>агенты</div>
      <div style={{ ...hint, margin: "6px 0 8px" }}>
        «Ассистент» отвечает в чате бота и в задачах тем, что видно вам самим, и умеет
        делать то же, что вы: взять задачу, сдать, принять. Удалить его нельзя.
      </div>

      {!view && (
        <div style={{ ...hint, marginTop: 6 }}>
          {msg || (solo ? "Без входа через Telegram агентов нет." : "Загружаю…")}</div>)}

      {view && (<>
        {/* Вкладки с именами, а «+ агент» — справа от них (владелец). */}
        <div className="flex flex-wrap gap-2" style={{ margin: "4px 0 8px", alignItems: "center" }}
          role="tablist" aria-label="агенты">
          {agents.map((a) => (
            <button key={a.id} type="button" role="tab" style={btn(agent?.id === a.id)}
              aria-selected={agent?.id === a.id}
              onClick={() => { setAgentId(a.id); setRenaming(false); setMsg(""); }}>
              {a.name}
            </button>))}
          <button type="button" style={btn(true, OK)} disabled={busy}
            aria-label="добавить агента" onClick={createAgent}>+ агент</button>
        </div>

        {agent && (
          <div style={{ border: `1px solid ${ACC}66`, borderRadius: 10, padding: 10 }}>
            <div className="flex flex-wrap items-center gap-2">
              <span style={S.lbl}>{agent.builtin ? "ассистент" : "агент"}</span>
              {renaming && !agent.builtin ? (
                <TxtField value={agent.name} aria-label="имя агента" autoFocus
                  style={{ flex: "1 1 160px", fontSize: 13, fontWeight: 700 }}
                  onCommit={(v) => {
                    setRenaming(false);
                    if (v.trim() && v.trim() !== agent.name) {
                      run(() => updateAgent(agent.id, { name: v.trim() }), "Сохранено.")
                        .then(() => onChanged?.());
                    }
                  }} />
              ) : (
                /* Двойное нажатие по имени — правка (владелец, 2026-09-20).
                   У встроенного имя не правится: он один на всех местах. */
                <span role="button" tabIndex={0} aria-label={`имя агента: ${agent.name}`}
                  title={agent.builtin ? "" : "Двойное нажатие — переименовать"}
                  onDoubleClick={() => { if (!agent.builtin) setRenaming(true); }}
                  style={{ fontSize: 13, fontWeight: 700, flex: 1,
                    cursor: agent.builtin ? "default" : "text" }}>{agent.name}</span>)}
            </div>

            {/* ═══ назначения ═══ */}
            <div style={form}>
              <div style={S.lbl}>модели по назначениям</div>
              <div style={{ ...hint, margin: "4px 0 6px" }}>
                Выбор — из подключённых моделей (форма «провайдеры и модели» ниже).
                Чего не выбрали, того у агента нет: он так и скажет, а не придумает.
              </div>
              {!connected.length && (
                <div style={{ ...hint, color: WARN }}>
                  Подключённых моделей нет — отметьте их у провайдера ниже.</div>)}
              {uses.map((u) => {
                const row = agent.uses?.[u.id] || (u.id === "transcribe" ? agent.transcribe : null);
                const value = row ? `${row.providerId}|${row.model}` : "";
                return (
                  <div key={u.id} className="flex flex-wrap gap-2"
                    style={{ alignItems: "center", marginTop: 6 }}>
                    <span style={{ fontSize: 11.5, color: C.muted, flex: "1 1 160px" }}>{u.name}</span>
                    <select aria-label={`модель: ${u.name}`} value={value}
                      disabled={busy || !connected.length}
                      style={{ ...S.inp, width: "auto", flex: "2 1 180px", minWidth: 140 }}
                      onChange={(e) => {
                        const v = e.target.value;
                        const i = v.indexOf("|");
                        setUse(u.id, v ? { providerId: v.slice(0, i), model: v.slice(i + 1) } : null);
                      }}>
                      <option value="">— не выбрана</option>
                      {connected.map((c) => (
                        <option key={`${c.providerId}|${c.model}`}
                          value={`${c.providerId}|${c.model}`}>{c.label}</option>))}
                    </select>
                  </div>);
              })}

              {/* ═══ MCP-серверы агента ═══ */}
              <div style={{ ...S.lbl, marginTop: 10 }}>MCP-серверы</div>
              <div style={{ ...hint, margin: "4px 0 6px" }}>
                Какие из подключённых серверов этот агент может звать.
              </div>
              {!servers.length && (
                <div style={hint}>Серверов нет — добавьте их в форме ниже.</div>)}
              <div className="flex flex-wrap gap-2">
                {servers.map((m) => {
                  const on = (agent.mcp || []).includes(m.id);
                  return (
                    <button key={m.id} type="button" role="checkbox" aria-checked={on}
                      disabled={busy} aria-label={`mcp ${m.name}`}
                      style={btn(on, on ? OK : undefined)}
                      onClick={() => run(() => updateAgent(agent.id, {
                        mcp: on ? (agent.mcp || []).filter((x) => x !== m.id)
                          : [...(agent.mcp || []), m.id] }))}>
                      {on ? "✓ " : ""}{m.name}</button>);
                })}
              </div>

              {/* ═══ спрашивать или делать ═══ */}
              <div style={{ ...S.lbl, marginTop: 10 }}>изменения в приложении</div>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
                {[[true, "Спрашивать перед применением"], [false, "Применять сразу"]].map(([v, t]) => (
                  <button key={String(v)} type="button" disabled={busy}
                    aria-label={t} aria-pressed={(agent.ask !== false) === v}
                    style={btn((agent.ask !== false) === v, v ? undefined : WARN)}
                    onClick={() => run(() => updateAgent(agent.id, { ask: v }))}>{t}</button>))}
              </div>
              <div style={{ ...hint, marginTop: 4 }}>
                Права у агента те же, что у вас: чужую задачу он не возьмёт, а модель
                целиком правит только владелец.
              </div>
            </div>

            {/* ═══ память ═══ */}
            <Memory key={agent.id} agent={agent} busy={busy} setBusy={setBusy} />

            {/* ═══ удалить ═══ */}
            {!agent.builtin && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                  disabled={busy} aria-label={`удалить агента ${agent.name}`}
                  onClick={() => setKilling(agent)}>Удалить</button>
              </div>)}
          </div>)}

        {msg && <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }} role="status">{msg}</div>}
      </>)}

      {killing && (
        <Modal title={`Удалить агента «${killing.name}»`} onClose={() => setKilling(null)}>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Вы уверены? Это действие необратимо</div>
          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <button type="button" style={btn(true, BAD)} disabled={busy}
              onClick={() => killAgent(killing)}>Да</button>
            <button type="button" style={btn(false)} onClick={() => setKilling(null)}>Нет</button>
          </div>
        </Modal>)}
    </div>

    {/* ═══ 2. ПРОВАЙДЕРЫ И МОДЕЛИ ═══ */}
    {view && (
      <div style={{ ...S.card, marginBottom: 10 }} aria-label="провайдеры и модели">
        <div style={S.lbl}>провайдеры и модели</div>
        <div style={{ ...hint, margin: "6px 0 8px" }}>
          Откуда берутся модели: вид API, адрес и ключ. Провайдеров может быть
          несколько; отмеченные модели считаются подключёнными — из них агенты и выбирают.
          Ключи общие на всех ваших агентов: платит один человек.
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
        {current === "new" && (
          <NewProvider form={providerForm} setForm={setProviderForm} kinds={view.kinds || []}
            busy={busy} onAdd={createProvider} />)}
        {provider && (
          <ProviderCard key={provider.id} p={provider} kind={kindOf(provider.kind)}
            busy={busy}
            onSave={(patch) => run(() => updateProvider(provider.id, patch), "Сохранено.")}
            onDrop={() => run(() => dropProvider(provider.id),
              `Провайдер «${provider.name}» удалён вместе с ключом.`)}
            onModels={() => providerModels(provider.id)}
            onToggle={toggleModel} />)}
      </div>)}

    {/* ═══ 3. MCP-СЕРВЕРЫ ═══ */}
    {view && (
      <McpForm servers={servers} form={mcpForm} setForm={setMcpForm} busy={busy}
        onAdd={() => run(() => addMcp(mcpForm), "Сервер добавлен — спросите его инструменты.")
          .then((m) => { if (m) setMcpForm(EMPTY_MCP); })}
        onTools={(id) => run(() => mcpTools(id),
          (m) => `${m.name}: инструментов — ${(m.tools || []).length}.`)}
        onDrop={(m) => run(() => dropMcp(m.id), `Сервер «${m.name}» удалён.`)} />)}
  </>);
}

/* ─────── MCP-серверы: адрес, репозиторий и что сервер умеет ─────── */

function McpForm({ servers, form, setForm, busy, onAdd, onTools, onDrop }) {
  const [kill, setKill] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div style={{ ...S.card, marginBottom: 10 }} aria-label="mcp-серверы">
      <div style={S.lbl}>MCP-серверы</div>
      <div style={{ ...hint, margin: "6px 0 8px" }}>
        Чужие инструменты, которыми агент может пользоваться. Приложение ходит к серверу
        само: укажите его адрес, а репозиторий — чтобы было видно, откуда он взят.
      </div>

      {servers.map((m) => (
        <div key={m.id} aria-label={`mcp-сервер ${m.name}`}
          style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
            padding: 8, marginBottom: 6 }}>
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: "1 1 120px" }}>{m.name}</span>
            <span style={{ fontSize: 10.5, color: (m.tools || []).length ? OK : C.muted }}>
              инструментов: {(m.tools || []).length}</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginTop: 2 }}>
            <div>адрес: {m.url}</div>
            {m.repo && <div>репозиторий: {m.repo}</div>}
            {!!(m.tools || []).length && <div>умеет: {m.tools.join(", ")}</div>}
          </div>
          <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
            <button type="button" style={btn(false)} disabled={busy}
              aria-label={`спросить инструменты ${m.name}`}
              onClick={() => onTools(m.id)}>
              {(m.tools || []).length ? "Обновить инструменты" : "Спросить инструменты"}</button>
            <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
              disabled={busy} aria-label={`удалить сервер ${m.name}`}
              onClick={() => setKill(m)}>Удалить</button>
          </div>
        </div>))}
      {!servers.length && <div style={{ ...hint, marginBottom: 6 }}>Серверов пока нет.</div>}

      <div style={{ background: C.panel, borderRadius: 8, padding: 10 }}>
        <div style={S.lbl}>новый сервер</div>
        <input aria-label="название сервера" style={{ ...S.inp, margin: "6px 0" }}
          placeholder="название — как вы его называете" value={form.name} onChange={set("name")} />
        <input aria-label="адрес сервера" style={{ ...S.inp, marginBottom: 6 }}
          placeholder="адрес: https://…/mcp" value={form.url} onChange={set("url")} />
        <input aria-label="репозиторий сервера" style={{ ...S.inp, marginBottom: 6 }}
          placeholder="репозиторий: https://github.com/…" value={form.repo} onChange={set("repo")} />
        <button type="button" style={btn(true, OK)} disabled={busy || !form.url.trim()}
          onClick={onAdd}>Добавить сервер</button>
      </div>

      {kill && (
        <Modal title={`Удалить сервер «${kill.name}»`} onClose={() => setKill(null)}>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Вы уверены? Это действие необратимо</div>
          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <button type="button" style={btn(true, BAD)} disabled={busy}
              onClick={() => { const m = kill; setKill(null); onDrop(m); }}>Да</button>
            <button type="button" style={btn(false)} onClick={() => setKill(null)}>Нет</button>
          </div>
        </Modal>)}
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

function ProviderCard({ p, kind, busy, onSave, onDrop, onModels, onToggle }) {
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
  /* Галочка значит ПОДКЛЮЧЕНА (владелец, 2026-09-20): из подключённых
     агенты и выбирают, чем им что делать. Прежде она значила «в коллекции
     открытого агента», и одно нажатие делало сразу две разные вещи. */
  const picked = (id) => (p.models || []).includes(id);
  const count = (p.models || []).length;

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
        Нажатие подключает модель, повторное — отключает. Подключённые видны в
        назначениях у агентов.{count ? ` Подключено: ${count}.` : " Пока ничего не подключено."}
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
