import React, { useEffect, useRef, useState } from "react";
import { ACC, BAD, C, OK, S, WARN, btn, TxtField } from "./ui.jsx";
import Modal from "./Modal.jsx";
import {
  addAgent, addMcp, addMemory, addProvider, dropAgent, dropMcp, dropMemory, dropProvider,
  getAssistantSettings, listMemory, mcpRegistry, mcpTools, providerModels, updateAgent,
  updateProvider,
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
const form = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
  padding: "var(--space-8)", marginTop: "var(--space-8)" };
const sameRow = (a, b) => !!a && !!b && a.providerId === b.providerId && a.model === b.model;
const hasRow = (list, row) => (list || []).some((x) => sameRow(x, row));

const EMPTY_FORM = { name: "", kind: "openai", baseUrl: "", key: "" };
/* Назначения приходят с сервера (`USES`), но список нужен и до ответа:
   форма рисуется сразу, а не после загрузки. */
const USES_FALLBACK = [
  { id: "main", name: "Основная" },
  { id: "voice", name: "Отправка голосовых сообщений" },
  { id: "draw", name: "Рисование изображений" },
  { id: "vision", name: "Распознавание изображений" },
  { id: "transcribe", name: "Расшифровка голоса" },
];
const DEFAULT_AGENT = { id: "assistant", name: "Ассистент", builtin: true, models: [],
  transcribe: null, uses: {}, mcp: [], ask: true };

export default function AgentsPanel({ me, onChanged }) {
  const [view, setView] = useState(null);   // providers, agents, kinds, tasks, mcp, uses
  const [agentId, setAgentId] = useState("assistant");
  const [current, setCurrent] = useState("");   // id открытого провайдера или "new"
  const [providerForm, setProviderForm] = useState(EMPTY_FORM);
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

  /* Правка, отказ от которой разбирает ВЫЗЫВАЮЩИЙ: `run` ловит ошибку и
     кладёт её в общее сообщение внизу карточки агентов — далеко от места,
     где нажали. Для MCP это и выглядело как «кнопка не работает»
     (владелец, 2026-09-21), поэтому там отказ нужен на руках. */
  const runRaw = async (job) => {
    setBusy(true); setMsg("");
    try { const out = await job(); await loadSettings(); return out; }
    finally { setBusy(false); }
  };

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
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
      <div style={S.lbl}>агенты</div>
      <div style={{ ...hint, margin: "var(--space-4) 0 var(--space-8)" }}>
        «Ассистент» отвечает в чате бота и в задачах тем, что видно вам самим, и умеет
        делать то же, что вы: взять задачу, сдать, принять. Удалить его нельзя.
      </div>

      {!view && (
        <div style={{ ...hint, marginTop: "var(--space-4)" }}>
          {msg || (solo ? "Без входа через Telegram агентов нет." : "Загружаю…")}</div>)}

      {view && (<>
        {/* Вкладки с именами, а «+ агент» — справа от них (владелец). */}
        <div className="flex flex-wrap gap-2" style={{ margin: "var(--space-4) 0 var(--space-8)", alignItems: "center" }}
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
          <div style={{ border: `1px solid ${ACC}66`, borderRadius: "var(--radius-sm)", padding: "var(--space-8)" }}>
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
              <div style={{ ...hint, margin: "var(--space-4) 0 var(--space-4)" }}>
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
                    style={{ alignItems: "center", marginTop: "var(--space-4)" }}>
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

              {/* ═══ спрашивать или делать ═══ */}
              <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>изменения в приложении</div>
              <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)" }}>
                {[[true, "Спрашивать перед применением"], [false, "Применять сразу"]].map(([v, t]) => (
                  <button key={String(v)} type="button" disabled={busy}
                    aria-label={t} aria-pressed={(agent.ask !== false) === v}
                    style={btn((agent.ask !== false) === v, v ? undefined : WARN)}
                    onClick={() => run(() => updateAgent(agent.id, { ask: v }))}>{t}</button>))}
              </div>
              <div style={{ ...hint, marginTop: "var(--space-4)" }}>
                Права у агента те же, что у вас: чужую задачу он не возьмёт, а модель
                целиком правит только владелец.
              </div>
            </div>

            {/* ═══ инструкции ═══ */}
            <Skill key={`skill-${agent.id}`} agent={agent} busy={busy}
              onSave={(text) => run(() => updateAgent(agent.id, { skill: text }),
                text ? "Инструкция сохранена." : "Инструкция удалена.")} />

            {/* ═══ память ═══ */}
            <Memory key={agent.id} agent={agent} busy={busy} setBusy={setBusy} />

            {/* ═══ MCP-серверы агента ═══ Сразу после памяти (владелец,
                2026-09-20): выбирают из коллекции, а собирают её в форме
                MCP-серверов ниже. */}
            <AgentMcp key={`mcp-${agent.id}`} agent={agent} servers={servers} busy={busy}
              onAsk={(id) => runRaw(() => mcpTools(id))}
              onPick={(map) => runRaw(() => updateAgent(agent.id, { mcp: map }))} />

            {/* ═══ удалить ═══ */}
            {!agent.builtin && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
                <button type="button" style={{ ...btn(true, BAD) }}
                  disabled={busy} aria-label={`удалить агента ${agent.name}`}
                  onClick={() => setKilling(agent)}>Удалить</button>
              </div>)}
          </div>)}

        {msg && <div style={{ fontSize: 12, color: C.muted, marginTop: "var(--space-8)" }} role="status">{msg}</div>}
      </>)}

      {killing && (
        <Modal title={`Удалить агента «${killing.name}»`} onClose={() => setKilling(null)}>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Вы уверены? Это действие необратимо</div>
          <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
            <button type="button" style={btn(true, BAD)} disabled={busy}
              onClick={() => killAgent(killing)}>Да</button>
            <button type="button" style={btn(false)} onClick={() => setKilling(null)}>Нет</button>
          </div>
        </Modal>)}
    </div>

    {/* ═══ 2. ПРОВАЙДЕРЫ И МОДЕЛИ ═══ */}
    {view && (
      <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="провайдеры и модели">
        <div style={S.lbl}>провайдеры и модели</div>
        <div style={{ ...hint, margin: "var(--space-4) 0 var(--space-8)" }}>
          Откуда берутся модели: вид API, адрес и ключ. Провайдеров может быть
          несколько; отмеченные модели считаются подключёнными — из них агенты и выбирают.
          Ключи общие на всех ваших агентов: платит один человек.
        </div>
        <div className="flex flex-wrap gap-2" style={{ margin: "var(--space-4) 0" }} role="tablist"
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
      <McpForm servers={servers} busy={busy}
        onAdd={(rec) => run(() => addMcp(rec),
          (m) => `Сервер «${m.name}» добавлен — спросите его инструменты.`)}
        onDrop={(m) => run(() => dropMcp(m.id), `Сервер «${m.name}» удалён.`)} />)}
  </>);
}

/* ─────── MCP-серверы: адрес, репозиторий и что сервер умеет ─────── */

function McpForm({ servers, busy, onAdd, onDrop }) {
  const [kill, setKill] = useState(null);
  const [list, setList] = useState(null);
  const [open, setOpen] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setLoading(true); setErr("");
    try { setList(await mcpRegistry()); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const have = new Set(servers.map((m) => m.url));

  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="mcp-серверы">
      <div className="flex items-center gap-2">
        <span style={{ ...S.lbl, flex: 1 }}>MCP-серверы</span>
        <button type="button" style={btn(false)} disabled={loading}
          aria-label="обновить список серверов" onClick={refresh}>
          {loading ? "…" : "Обновить"}</button>
      </div>

      {/* Высота формы ограничена, прокрутка внутри (владелец, 2026-09-21):
          в реестре под две сотни серверов, и без предела форма уезжала бы
          на десяток экранов. */}
      <div style={{ maxHeight: 360, overflowY: "auto", marginTop: "var(--space-4)" }}>
      {servers.map((m) => (
        <div key={m.id} aria-label={`mcp-сервер ${m.name}`}
          style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
            padding: "var(--space-8)", marginTop: "var(--space-4)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: "1 1 120px" }}>{m.name}</span>
            <span style={{ fontSize: 10.5, color: (m.tools || []).length ? OK : C.muted }}>
              инструментов: {(m.tools || []).length}</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginTop: 0 }}>
            <div>адрес: {m.url}</div>
            {m.repo && <div>репозиторий: {m.repo}</div>}
            {!!(m.tools || []).length && <div>умеет: {m.tools.join(", ")}</div>}
          </div>
          {/* «Спросить инструменты» отсюда ушла на форму агента (владелец,
              2026-09-21): спрашивают их тогда, когда выбирают, — и отказ
              сервера человек должен читать там же, где нажал. */}
          <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)" }}>
            <button type="button" style={{ ...btn(true, BAD) }}
              disabled={busy} aria-label={`удалить сервер ${m.name}`}
              onClick={() => setKill(m)}>Удалить</button>
          </div>
        </div>))}

      {/* ─── РЕЕСТР: что вообще есть (владелец, 2026-09-20) ───
          Список общий, поэтому он не хранится, а спрашивается. Нажатие на
          сервер раскрывает его форму: что он такое, откуда и по какому
          адресу; там же «Добавить» — и он попадает в коллекцию, из которой
          выбирают на форме агента. */}
      <div style={{ ...S.lbl, marginTop: "var(--space-12)" }}>реестр</div>
      {err && <div style={{ ...hint, color: BAD, marginTop: "var(--space-4)" }}>{err}</div>}
      {!list && !err && <div style={{ ...hint, marginTop: "var(--space-4)" }}>Загружаю…</div>}
      {list && !list.servers.length && !err && (
        <div style={{ ...hint, marginTop: "var(--space-4)" }}>Реестр ничего не вернул.</div>)}

      <div style={{ marginTop: "var(--space-4)" }}>
        {(list?.servers || []).map((r) => {
          const on = open === r.id;
          const added = have.has(r.url);
          return (
            <div key={r.id} style={{ borderTop: `1px solid ${C.line}` }}>
              <button type="button" aria-expanded={on} aria-label={`сервер ${r.name}`}
                onClick={() => setOpen(on ? "" : r.id)}
                style={{ ...S.inp, width: "100%", textAlign: "left", border: "none",
                  background: "transparent", cursor: "pointer", padding: "var(--space-8) 0",
                  display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{r.name}</span>
                {added && <span style={{ fontSize: 10, color: OK }}>добавлен</span>}
                <span style={{ fontSize: 11, color: C.muted }}>{on ? "▾" : "▸"}</span>
              </button>
              {on && (
                <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
                  borderRadius: "var(--radius-sm)", padding: "var(--space-8)", marginBottom: "var(--space-4)" }}
                  aria-label={`форма сервера ${r.name}`}>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
                    {r.description && <div>{r.description}</div>}
                    <div>имя: {r.full}</div>
                    {r.version && <div>версия: {r.version}</div>}
                    <div>адрес: {r.url}</div>
                    {r.transport && <div>подключение: {r.transport}</div>}
                    {r.repo && <div>репозиторий: {r.repo}</div>}
                  </div>
                  <button type="button" style={{ ...btn(!added, added ? undefined : OK),
                    marginTop: "var(--space-8)" }}
                    disabled={busy || added} aria-label={`добавить сервер ${r.name}`}
                    onClick={() => onAdd({ name: r.name, url: r.url, repo: r.repo })}>
                    {added ? "Уже добавлен" : "Добавить"}</button>
                </div>)}
            </div>);
        })}
      </div>
      </div>

      {kill && (
        <Modal title={`Удалить сервер «${kill.name}»`} onClose={() => setKill(null)}>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Вы уверены? Это действие необратимо</div>
          <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
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
    <div style={{ background: C.panel, borderRadius: "var(--radius-sm)", padding: "var(--space-8)", marginBottom: "var(--space-4)" }}>
      <div style={S.lbl}>новый провайдер</div>
      <input aria-label="название провайдера" style={{ ...S.inp, marginBottom: "var(--space-4)" }}
        placeholder="название — как вы его называете: «Мой OpenRouter»"
        value={form.name} onChange={set("name")} />
      <select aria-label="вид API" style={{ ...S.inp, marginBottom: "var(--space-4)" }} value={form.kind} onChange={set("kind")}>
        {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
      <input aria-label="адрес провайдера" style={{ ...S.inp, marginBottom: "var(--space-4)" }}
        placeholder={kind ? `пусто — ${kind.defaultBaseUrl}` : "адрес"}
        value={form.baseUrl} onChange={set("baseUrl")} />
      <input aria-label="ключ провайдера" type="password" autoComplete="off"
        style={{ ...S.inp, marginBottom: "var(--space-4)" }} placeholder="ключ — вставьте; наружу он не отдаётся"
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
    <div style={{ background: C.panel, borderRadius: "var(--radius-sm)", padding: "var(--space-8)" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: "var(--space-4)" }}>
        <div style={S.lbl}>провайдер · {kind?.name || p.kind}</div>
        <div style={{ fontSize: 11.5, color: p.hasKey ? OK : BAD, marginLeft: "auto" }}>
          {p.hasKey ? "ключ есть" : "ключа нет"}
        </div>
      </div>
      <input aria-label="название провайдера" style={{ ...S.inp, marginBottom: "var(--space-4)" }}
        value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="адрес провайдера" style={{ ...S.inp, marginBottom: "var(--space-4)" }}
        placeholder={kind ? `пусто — ${kind.defaultBaseUrl}` : "адрес"}
        value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <input aria-label="заменить ключ" type="password" autoComplete="off"
        style={{ ...S.inp, marginBottom: "var(--space-4)" }} value={key}
        placeholder={p.hasKey ? "ключ есть — введите новый, чтобы заменить" : "ключа нет — вставьте"}
        onChange={(e) => setKey(e.target.value)} />
      <div style={{ ...hint, marginBottom: "var(--space-8)" }}>Наружу ключ не отдаётся, только «есть/нет».</div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: "var(--space-8)" }}>
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
      <div style={{ ...hint, margin: "var(--space-4) 0 var(--space-4)" }}>
        Нажатие подключает модель, повторное — отключает. Подключённые видны в
        назначениях у агентов.{count ? ` Подключено: ${count}.` : " Пока ничего не подключено."}
      </div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: "var(--space-4)" }}>
        <button type="button" style={btn(false)} disabled={busy} onClick={fetchList}>
          {offered ? "Обновить список" : "Загрузить список моделей"}</button>
      </div>
      {/* Список — строки-кнопки с галочкой слева, а не чекбоксы: владелец
          просил именно так («при нажатии слева появляется галочка»).
          Для читалки и тестов строка — role="checkbox" с aria-checked. */}
      {rows.length > 0 && (
        <div role="group" aria-label={`модели ${p.name}`}
          style={{ maxHeight: 220, overflowY: "auto", marginBottom: "var(--space-4)",
            border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)" }}>
          {rows.map((m) => {
            const on = picked(m.id);
            return (
              <button key={m.id} type="button" role="checkbox" aria-checked={on} disabled={busy}
                aria-label={`модель ${m.id}`} onClick={() => onToggle({ providerId: p.id, model: m.id })}
                className="flex items-center gap-2"
                style={{ width: "100%", textAlign: "left", background: on ? `${OK}22` : "transparent",
                  border: "none", borderBottom: `1px solid ${C.line}`, color: C.text,
                  padding: "var(--space-4) var(--space-8)", fontSize: 12, cursor: busy ? "default" : "pointer" }}>
                <span aria-hidden="true" style={{ width: 16, display: "inline-block",
                  color: OK, fontWeight: 700 }}>{on ? "✓" : ""}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                </span>
              </button>);
          })}
        </div>)}
      {!rows.length && !listMsg && (
        <div style={{ ...hint, marginBottom: "var(--space-4)" }}>
          Список пуст — нажмите «Загрузить список моделей».</div>)}
      {listMsg && <div style={{ fontSize: 12, color: C.muted, marginTop: "var(--space-4)" }}>{listMsg}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MCP-СЕРВЕРЫ АГЕНТА · выбор ИНСТРУМЕНТОВ (владелец, 2026-09-21)

   Прежде агент отмечал СЕРВЕР целиком. Но сервер — это не одно умение, а
   десяток: у одного и поиск, и запись, и удаление. Разрешать их скопом
   значит разрешать последнее ради первого.

   Поэтому кнопка сервера теперь говорит ТРИ вещи, и цветом, и знаком:

   · зелёная с галочкой — выбраны все его инструменты;
   · жёлтая с кружком — выбрана часть;
   · серая с пустым кружком — ни одного, и сервера у агента нет.

   Нажатие на сервер спрашивает у него список инструментов заново и
   раскрывает его; второе нажатие — сворачивает. Заново — потому что
   список у сервера свой, он меняется, и показывать вчерашний значило бы
   предлагать выбрать то, чего уже нет.

   Список — своя форма с ограниченной высотой и прокруткой внутри:
   инструментов бывает под сотню, и без предела форма агента уезжала бы на
   три экрана. Первые кнопки в нём — «Выделить всё» и «Снять выделение»:
   чаще всего нужно именно это, а не перебирать по одному.
   ════════════════════════════════════════════════════════════════ */

/* Что выбрано у сервера: ничего, часть или всё. Сервер, который ещё не
   спрашивали, своих инструментов не знает — тогда «часть» честнее «всего»:
   обещать, что выбрано ВСЁ, не зная, сколько всего, нельзя. */
export function pickState(all = [], on = []) {
  if (!on.length) return "none";
  if (all.length && on.length >= all.length) return "all";
  return "some";
}
const STATE_MARK = { all: "✓", some: "●", none: "○" };
const STATE_TONE = { all: OK, some: WARN, none: undefined };

function AgentMcp({ agent, servers, busy, onAsk, onPick }) {
  const [open, setOpen] = useState("");
  const [asking, setAsking] = useState("");
  const [err, setErr] = useState("");

  const picked = agent.mcp && typeof agent.mcp === "object" && !Array.isArray(agent.mcp)
    ? agent.mcp : {};
  const toolsOf = (id) => picked[id] || [];

  const ask = async (id) => {
    setAsking(id); setErr("");
    try { await onAsk(id); }
    catch (e) { setErr(e.message); }
    finally { setAsking(""); }
  };

  /* Нажатие делает ДВА дела: раскрывает список и спрашивает его заново.
     Раскрыть, не спросив, значило бы показать вчерашний список. */
  const toggle = (m) => {
    if (open === m.id) { setOpen(""); return; }
    setOpen(m.id);
    setErr("");
    ask(m.id);
  };

  const set = async (id, list) => {
    setErr("");
    try { await onPick({ ...picked, [id]: list }); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div style={form} aria-label="mcp-серверы агента">
      <div style={S.lbl}>3 · MCP-серверы</div>
      {!servers.length && (
        <div style={{ ...hint, marginTop: "var(--space-4)" }}>
          Серверов нет — добавьте их в форме ниже.</div>)}

      {/* Высота ограничена, прокрутка внутри: серверов может быть двадцать. */}
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: "var(--space-4)" }}>
        {servers.map((m) => {
          const all = m.tools || [];
          const on = toolsOf(m.id);
          const state = pickState(all, on);
          const shown = open === m.id;
          return (
            <div key={m.id} style={{ marginBottom: "var(--space-4)" }}>
              <button type="button" aria-expanded={shown} disabled={busy}
                aria-label={`mcp ${m.name}: ${state === "all" ? "все инструменты"
                  : state === "some" ? "часть инструментов" : "ни одного инструмента"}`}
                style={{ ...btn(state !== "none", STATE_TONE[state]), width: "100%",
                  textAlign: "left" }}
                onClick={() => toggle(m)}>
                {STATE_MARK[state]} {m.name}
                <span style={{ color: C.muted, fontSize: 10.5 }}>
                  {" "}· {on.length}{all.length ? ` из ${all.length}` : ""}</span>
              </button>

              {shown && (
                <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
                  borderRadius: "var(--radius-sm)", padding: "var(--space-8)", marginTop: "var(--space-4)" }}
                  aria-label={`инструменты ${m.name}`}>
                  <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-4)" }}>
                    <span style={{ ...S.lbl, flex: 1 }}>инструменты</span>
                    <button type="button" style={btn(false)} disabled={busy || asking === m.id}
                      aria-label={`спросить инструменты ${m.name}`}
                      onClick={() => ask(m.id)}>
                      {asking === m.id ? "Спрашиваю…" : "Спросить инструменты"}</button>
                  </div>

                  {/* Высота ограничена, прокрутка внутри: инструментов
                      у сервера бывает под сотню. */}
                  <div className="flex flex-wrap gap-2"
                    style={{ maxHeight: 160, overflowY: "auto" }}>
                    <button type="button" style={btn(false, OK)} disabled={busy || !all.length}
                      aria-label={`выделить всё: ${m.name}`}
                      onClick={() => set(m.id, [...all])}>Выделить всё</button>
                    <button type="button" style={btn(false)} disabled={busy || !on.length}
                      aria-label={`снять выделение: ${m.name}`}
                      onClick={() => set(m.id, [])}>Снять выделение</button>
                    {all.map((t) => {
                      const has = on.includes(t);
                      return (
                        <button key={t} type="button" role="checkbox" aria-checked={has}
                          disabled={busy} aria-label={`инструмент ${t}`}
                          style={{ ...btn(has, has ? OK : undefined), fontSize: 11,
                            padding: "0 var(--space-8)" }}
                          onClick={() => set(m.id, has ? on.filter((x) => x !== t)
                            : [...on, t])}>
                          {has ? "✓ " : ""}{t}</button>);
                    })}
                  </div>
                  {!all.length && asking !== m.id && (
                    <div style={{ ...hint, marginTop: "var(--space-4)" }}>
                      Инструменты ещё не известны.</div>)}
                </div>)}
            </div>);
        })}
      </div>

      {/* Отказ — здесь же, под кнопкой, а не в чужой карточке наверху:
          именно поэтому «Спросить инструменты» и выглядела нерабочей. */}
      {err && <div role="status" style={{ fontSize: 11.5, color: BAD, marginTop: "var(--space-4)" }}>{err}</div>}
    </div>);
}

/* ─────── ИНСТРУКЦИИ АГЕНТА · СКИЛЛ (владелец, 2026-09-20) ───────

   Одно поле и две кнопки. «Сохранить» кладёт инструкцию агенту, и она
   уходит в его системную подсказку в каждом разговоре — это и значит
   «применяется как скилл»: не напоминание в одном вопросе, а то, что он
   умеет всегда. «Удалить» — то же сохранение пустым: умения больше нет.

   Поле живёт своим черновиком, а не полем агента: пока человек печатает,
   ничего не отправляется, иначе каждое нажатие клавиши было бы запросом. */
function Skill({ agent, busy, onSave }) {
  const [text, setText] = useState(agent.skill || "");
  const saved = String(agent.skill || "");
  const dirty = text.trim() !== saved;
  return (
    <div style={form} aria-label="инструкции агента">
      <div style={S.lbl}>1 · инструкции</div>
      <textarea aria-label="инструкция агента" rows={4} value={text}
        disabled={busy} onChange={(e) => setText(e.target.value)}
        style={{ ...S.inp, width: "100%", marginTop: "var(--space-4)", resize: "vertical",
          minHeight: 72, lineHeight: 1.5 }} />
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)" }}>
        <button type="button" style={btn(dirty, dirty ? OK : undefined)}
          disabled={busy || !dirty} onClick={() => onSave(text.trim())}>Сохранить</button>
        <button type="button" style={{ ...btn(true, BAD) }}
          disabled={busy || (!saved && !text)}
          onClick={() => { setText(""); onSave(""); }}>Удалить</button>
      </div>
    </div>);
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
      <div style={{ ...hint, margin: "var(--space-4) 0 var(--space-8)" }}>
        Заметки и файлы, которые {agent.builtin ? "ассистент" : "агент"} будет знать. Только
        ваши: чужой памяти здесь нет, а вашей нет ни у кого.
        {agent.builtin ? " В чате бота — «запомни: …» или просто пришлите документ." : ""}
      </div>
      {memory === null && <div style={hint}>{memMsg || "Загружаю…"}</div>}
      {memory && memory.length === 0 && <div style={{ ...hint, marginBottom: "var(--space-8)" }}>Память пуста.</div>}
      {memory && memory.map((m) => (
        <div key={m.id} className="flex gap-2"
          style={{ alignItems: "flex-start", padding: "var(--space-4) 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.title}</div>
            {m.text ? <div style={{ fontSize: 11.5, color: C.muted, marginTop: 0 }}>{preview(m.text)}</div> : null}
            {m.file && (
              <a href={m.file.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 11.5, color: ACC, display: "inline-block", marginTop: 0 }}>
                📎 {m.file.name}
              </a>)}
          </div>
          <button type="button" style={btn(false)} disabled={busy}
            aria-label={`удалить из памяти: ${m.title}`}
            onClick={() => forget(m.id)}>Удалить</button>
        </div>))}
      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={S.lbl}>добавить текстом</div>
        <input aria-label="название записи" style={{ ...S.inp, margin: "var(--space-4) 0" }}
          placeholder="название (можно оставить пустым — возьмётся первая строка)"
          value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea aria-label="текст записи" style={{ ...S.inp, minHeight: 70, marginBottom: "var(--space-4)" }}
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
