import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ПОМОЩНИК, КОТОРЫЙ ДЕЛАЕТ (владелец, 2026-09-20).

   «У ассистента должны быть все те же знания, права и возможности, что и
   у пользователя, который к нему обращается». Права здесь не проверяются
   вторым сводом правил: действия зовут те же функции хранилища, что и
   кнопки в приложении, — поэтому проверяем, что зовут их с id человека и
   что отказ приходит словами. */

let tmp, agentMod, actions, settings, ws;

beforeEach(async () => {
  vi.resetModules();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-agent-"));
  process.env.ASSISTANT_DIR = path.join(tmp, "assistant");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.ORG_DIR = path.join(tmp, "org");
  agentMod = await import("../lib/assistantAgent.js");
  actions = await import("../lib/assistantActions.js");
  settings = await import("../lib/assistantSettings.js");
  ws = await import("../lib/workspaceStore.js");
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

/* Подменная модель: отвечает по сценарию — сперва зовёт инструмент,
   потом говорит словами. */
const scripted = (steps) => {
  const seen = [];
  let i = 0;
  const complete = async (p) => {
    seen.push({ system: p.system, messages: p.messages, tools: p.tools });
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return step;
  };
  return { complete, seen };
};

const MODEL = [{ id: "tk1", title: "Сверстать", status: "backlog", assignee: "200",
  setter: "100", reviewer: "100", submissions: [], reviews: [], chat: [] }];

describe("инструменты приложения", () => {
  it("берёт задачу в работу — тем же хранилищем, что и кнопка", async () => {
    await ws.writeModel({ tasks: MODEL });
    const { complete, seen } = scripted([
      { text: "", calls: [{ id: "c1", name: "task_take", args: { taskId: "tk1" } }] },
      { text: "Взял.", calls: [] },
    ]);
    const out = await agentMod.runAgent({ userId: "200", agentId: "assistant",
      question: "возьми задачу tk1", system: "S", model: {}, complete, ask: false });
    expect(out).toBe("Взял.");
    expect((await ws.readModel()).tasks[0].status).toBe("progress");
    // Ответ инструмента вернулся модели — иначе она не знала бы, что вышло.
    const back = seen[1].messages.find((m) => m.role === "tool");
    expect(back.content).toMatch(/Взял в работу/);
  });

  it("чужую задачу не берёт: отказ теми же словами, что и в приложении", async () => {
    await ws.writeModel({ tasks: MODEL });
    const { complete } = scripted([
      { text: "", calls: [{ id: "c1", name: "task_take", args: { taskId: "tk1" } }] },
      { text: "Не вышло.", calls: [] },
    ]);
    await agentMod.runAgent({ userId: "999", agentId: "assistant", question: "возьми",
      system: "S", model: {}, complete, ask: false });
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");
  });

  it("модель целиком правит только владелец", async () => {
    await ws.writeModel({ tasks: [], procs: [] });
    const call = { id: "c1", name: "proc_write", args: { name: "Приём", text: "Задача: A" } };
    const guest = scripted([{ text: "", calls: [call] }, { text: "ок", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "запиши",
      system: "S", model: {}, complete: guest.complete, ask: false, isOwner: false });
    expect((await ws.readModel()).procs || []).toEqual([]);
    const owner = scripted([{ text: "", calls: [call] }, { text: "ок", calls: [] }]);
    await agentMod.runAgent({ userId: "100", agentId: "assistant", question: "запиши",
      system: "S", model: {}, complete: owner.complete, ask: false, isOwner: true });
    expect((await ws.readModel()).procs[0]).toMatchObject({ name: "Приём", text: "Задача: A" });
  });

  it("владельцу инструмент модели виден, остальным — нет", () => {
    const own = actions.toolsFor({ isOwner: true }).map((t) => t.name);
    const guest = actions.toolsFor({ isOwner: false }).map((t) => t.name);
    expect(own).toContain("proc_write");
    expect(own).toContain("trait_set");
    expect(guest).not.toContain("proc_write");
    expect(guest).toContain("task_take");
  });
});

describe("спрашивать или делать", () => {
  /* ПОДТВЕРЖДЕНИЕ — КНОПКАМИ, А НЕ РАЗГОВОРОМ (владелец, 2026-09-21:
     «он несколько раз спросил подтверждение и в итоге сказал, что сделал,
     но ничего не сделал»). Модель зовёт инструмент сразу; приложение
     показывает человеку, что будет сделано, и ждёт нажатия. */
  it("со «спрашивать» изменение откладывается и показывается человеку", async () => {
    await ws.writeModel({ tasks: MODEL });
    const shown = [];
    const first = scripted([
      { text: "", calls: [{ id: "c1", name: "task_take", args: { taskId: "tk1" } }] },
      { text: "Готово, взял!", calls: [] },
    ]);
    const said = await agentMod.runAgent({ userId: "200", agentId: "assistant",
      question: "возьми tk1", system: "S", model: {}, complete: first.complete, ask: true,
      onConfirm: async (p) => { shown.push(p); return true; } });

    // Человеку показали, что именно будет сделано.
    expect(shown).toHaveLength(1);
    expect(shown[0].words).toMatch(/взять задачу tk1 в работу/);
    // Разговор оборван: второй круг модели не случился, и «Готово, взял!»
    // в ответ не попало — иначе это была бы ложь.
    expect(said).toMatch(/Жду вашего подтверждения/);
    expect(said).not.toMatch(/Готово, взял/);
    expect(first.seen).toHaveLength(1);
    // Ничего не поменялось — только отложилось.
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");

    // Нажали «Подтвердить» — теперь сделано.
    const r = await actions.applyPending(shown[0].id, { isOwner: false });
    expect(r.ok).toBe(true);
    expect((await ws.readModel()).tasks[0].status).toBe("progress");
    expect(actions.pendingById(shown[0].id)).toBeNull();
  });

  /* КЛИК ЧЕЛОВЕКА НЕ ТРАТИТСЯ ВПУСТУЮ (владелец, 2026-09-23: «нажал
     подтверждение, после чего агент сказал, что такой задачи нет»):
     несуществующая задача отклоняется ДО того, как спросили подтверждение,
     а не после кнопки. */
  it("несуществующая задача — отказ сразу, подтверждение не спрашивается вовсе", async () => {
    await ws.writeModel({ tasks: MODEL });
    const shown = [];
    const { complete } = scripted([
      { text: "", calls: [{ id: "c1", name: "task_setup", args: { taskId: "test-task-001", title: "Т" } }] },
      { text: "Такой задачи нет.", calls: [] },
    ]);
    const said = await agentMod.runAgent({ userId: "100", agentId: "assistant",
      question: "создай новую задачу", system: "S", model: {}, complete, ask: true, isOwner: true,
      onConfirm: async (p) => { shown.push(p); return true; } });
    expect(shown).toEqual([]);
    expect(said).toBe("Такой задачи нет.");
    expect((await ws.readModel()).tasks).toEqual(MODEL);
  });

  it("«Отменить» снимает отложенное, и модель его больше не применит", async () => {
    await ws.writeModel({ tasks: MODEL });
    const shown = [];
    const first = scripted([
      { text: "", calls: [{ id: "c1", name: "task_take", args: { taskId: "tk1" } }] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "возьми",
      system: "S", model: {}, complete: first.complete, ask: true,
      onConfirm: async (p) => { shown.push(p); return true; } });
    expect(actions.cancelPending(shown[0].id)).toMatchObject({ name: "task_take" });
    expect(await actions.applyPending(shown[0].id, {})).toBeNull();
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");
  });

  it("показать подтверждение не вышло — изменение не откладывается вовсе", async () => {
    await ws.writeModel({ tasks: MODEL });
    const { complete, seen } = scripted([
      { text: "", calls: [{ id: "c1", name: "task_take", args: { taskId: "tk1" } }] },
      { text: "Не смог.", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "возьми",
      system: "S", model: {}, complete, ask: true, onConfirm: async () => false });
    expect(seen[1].messages.find((m) => m.role === "tool").content)
      .toMatch(/спросить подтверждение не вышло/);
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");
  });

  it("чтение не спрашивает разрешения даже со «спрашивать»", async () => {
    await ws.writeModel({ tasks: MODEL });
    const { complete, seen } = scripted([
      { text: "", calls: [{ id: "c1", name: "tasks_list", args: {} }] },
      { text: "Вот список.", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "какие задачи",
      system: "S", model: {}, complete, ask: true });
    expect(seen[1].messages.find((m) => m.role === "tool").content).toMatch(/tk1/);
  });
});

describe("что у агента есть", () => {
  it("назначенные модели перечислены, а чего нет — сказано прямо", () => {
    const agent = { uses: { main: { providerId: "p1", model: "gpt-4.1" }, voice: null,
      draw: null, vision: null, transcribe: null } };
    const note = agentMod.modelsNote(agent, [{ id: "p1", name: "Мой OpenAI" }]);
    expect(note).toContain("Основная — gpt-4.1 (Мой OpenAI)");
    expect(note).toContain("Моделей НЕТ для:");
    expect(note).toContain("Рисование изображений");
    expect(note).toMatch(/не выдумывай/);
  });

  it("без назначений так и сказано", () => {
    const note = agentMod.modelsNote({ uses: {} }, []);
    expect(note).toContain("назначенных моделей нет");
  });

  /* «Сама нейросеть не должна спрашивать разрешения… Но должна знать,
     требуется ли ей это разрешение» (владелец, 2026-09-21). */
  it("модель знает про подтверждение, но просить его ей запрещено", () => {
    const note = agentMod.actionsNote(true);
    expect(note).toMatch(/ТОЛЬКО ПОСЛЕ ПОДТВЕРЖДЕНИЯ/);
    expect(note).toMatch(/разрешения НЕ спрашиваешь/);
    expect(note).toMatch(/не пиши, что сделал/);
    expect(agentMod.actionsNote(false)).toMatch(/применяй сразу/);
  });
});

/* ПРАВА АГЕНТА (владелец, 2026-09-23): «агентам должны выбираться права…
   агенты физически не смогут сделать то, чего нет у них в правах».
   Двойная граница: список инструментов у модели не содержит запрещённого
   (агент его не видит вовсе), а `runAction` отказывает и в обход списка. */
describe("права агента", () => {
  const NONE = { scheme: false, process: false, functions: false, tasks: false, reminders: false };

  it("без прав (null) — ограничений нет, как у ассистента; с правами — только разрешённые категории", () => {
    const own = actions.toolsFor({ isOwner: true, rights: null }).map((t) => t.name);
    expect(own).toContain("proc_write");
    expect(own).toContain("task_take");
    const restricted = actions.toolsFor({ isOwner: true, rights: { ...NONE, tasks: true } }).map((t) => t.name);
    expect(restricted).toContain("task_take");
    expect(restricted).toContain("task_setup");
    expect(restricted).not.toContain("proc_write");
    expect(restricted).not.toContain("trait_set");
    expect(restricted).not.toContain("func_set");
    expect(restricted).not.toContain("reminder_set");
    // Чтение — всегда, прав не спрашивает: без единого права список не пуст.
    expect(actions.toolsFor({ isOwner: true, rights: NONE }).map((t) => t.name)).toEqual(["tasks_list"]);
  });

  it("правами, а не только именем инструмента: runAction отказывает и без списка, владельцу тоже", async () => {
    await ws.writeModel({ tasks: MODEL });
    const r = await actions.runAction("task_take", { taskId: "tk1" },
      { userId: "200", agentId: "a1", isOwner: true, ask: false, rights: NONE });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/У агента нет права «редактировать задачи»/);
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");
    const ok = await actions.runAction("task_take", { taskId: "tk1" },
      { userId: "200", agentId: "a1", isOwner: true, ask: false, rights: { ...NONE, tasks: true } });
    expect(ok.ok).toBe(true);
  });

  it("действие без права не появляется у модели — она не может ни разу его позвать", async () => {
    await ws.writeModel({ tasks: MODEL });
    const { complete, seen } = scripted([{ text: "У меня нет права редактировать задачи.", calls: [] }]);
    const out = await agentMod.runAgent({ userId: "200", agentId: "a1", question: "возьми tk1",
      system: "S", model: {}, complete, ask: false, isOwner: true, rights: NONE });
    expect(out).toBe("У меня нет права редактировать задачи.");
    expect(seen[0].tools.map((t) => t.name)).not.toContain("task_take");
    expect((await ws.readModel()).tasks[0].status).toBe("backlog");
  });

  it("подсказка называет, что можно и что нельзя — словами, а не молчит об ограничении", () => {
    const restricted = agentMod.actionsNote(true, { ...NONE, reminders: true });
    expect(restricted).toMatch(/Тебе МОЖНО: напоминания/);
    expect(restricted).toMatch(/Тебе НЕЛЬЗЯ \(владелец не дал право\): редактировать схему, редактировать техпроцесс, редактировать функции, редактировать задачи/);
    expect(restricted).toMatch(/физически нет/);
    expect(agentMod.actionsNote(true, NONE)).toMatch(/нельзя менять модель ни в чём/);
    // Без прав (ассистент) — прежний текст, никакого «нельзя».
    const unrestricted = agentMod.actionsNote(true, null);
    expect(unrestricted).toMatch(/Права у тебя те же, что у человека/);
    expect(unrestricted).not.toMatch(/владелец не дал право/);
  });

  it("напоминания меняет только СВОИ — того, кто разговаривает, не чужие", async () => {
    const org = await import("../lib/orgStore.js");
    await org.identify("200", { name: "Иван" });
    const { complete } = scripted([
      { text: "", calls: [{ id: "c1", name: "reminder_set", args: { warnMin: 20 } }] },
      { text: "Готово.", calls: [] },
    ]);
    await agentMod.runAgent({ userId: "200", agentId: "a1", question: "напоминай мне за 20 минут",
      system: "S", model: {}, complete, ask: false, rights: { ...NONE, reminders: true } });
    const me = await org.identify("200", {}, { claim: false });
    expect(me.profile.warnMin).toBe(20);
  });
});

describe("MCP", () => {
  it("инструменты сервера приходят агенту наравне со своими", async () => {
    const { complete, seen } = scripted([{ text: "ок", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "погода?",
      system: "S", model: {}, complete, ask: false,
      servers: [{ id: "mcp1", name: "Погода", url: "https://x/mcp", tools: ["forecast"] }] });
    const names = seen[0].tools.map((t) => t.name);
    expect(names).toContain("task_take");
    expect(names.some((n) => n.startsWith("mcp__") && n.endsWith("forecast"))).toBe(true);
  });

  it("сервер не ответил — агент узнаёт об этом словами, а не молчанием", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("сеть не ответила"); }));
    const { complete, seen } = scripted([
      { text: "", calls: [{ id: "c1", name: "mcp__mcp1__forecast", args: {} }] },
      { text: "Не вышло.", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "погода?",
      system: "S", model: {}, complete, ask: false,
      servers: [{ id: "mcp1", name: "Погода", url: "https://x/mcp", tools: ["forecast"] }] });
    expect(seen[1].messages.find((m) => m.role === "tool").content).toMatch(/Погода не ответил/);
    vi.unstubAllGlobals();
  });

  /* ВХОД ПОСРЕДИ РАБОТЫ (владелец, 2026-09-21): «ассистент или агент
     должен сам запрашивать логин и пароль в чате… если это требуется
     непосредственно при выполнении задачи». Спрашивает тот, кто говорит с
     человеком; модель об этом только узнаёт — и не выдумывает, будто
     сделала. */
  it("сервер потребовал входа — человека спрашивают, а модели велят не звать снова", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401,
      headers: { get: () => 'Bearer resource_metadata="https://x/login"' },
      json: async () => ({}), text: async () => "" })));
    const asked = [];
    const { complete, seen } = scripted([
      { text: "", calls: [{ id: "c1", name: "mcp__mcp1__forecast", args: {} }] },
      { text: "Жду ключ.", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "погода?",
      system: "S", model: {}, complete, ask: false,
      onAuthNeeded: async (r) => { asked.push(r); return true; },
      servers: [{ id: "mcp1", name: "Погода", url: "https://x/mcp", tools: ["forecast"] }] });
    expect(asked).toEqual([{ server: "Погода", where: "https://x/login", url: "https://x/mcp",
      scheme: "oauth", realm: "" }]);
    const said = seen[1].messages.find((m) => m.role === "tool").content;
    expect(said).toMatch(/требует входа/);
    expect(said).toMatch(/не зови этот инструмент снова/);
    vi.unstubAllGlobals();
  });

  it("спросить некому — модель узнаёт и это, а не «сервер не ответил»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403,
      headers: { get: () => null }, json: async () => ({}), text: async () => "" })));
    const { complete, seen } = scripted([
      { text: "", calls: [{ id: "c1", name: "mcp__mcp1__forecast", args: {} }] },
      { text: "Не вышло.", calls: [] }]);
    await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "погода?",
      system: "S", model: {}, complete, ask: false,
      servers: [{ id: "mcp1", name: "Погода", url: "https://x/mcp", tools: ["forecast"] }] });
    expect(seen[1].messages.find((m) => m.role === "tool").content)
      .toMatch(/требует входа, а ключа у меня нет/);
    vi.unstubAllGlobals();
  });

  it("список серверов уходит в подсказку", () => {
    expect(agentMod.mcpNote([{ id: "m", name: "Погода", tools: ["forecast"] }]))
      .toContain("Погода: forecast");
    expect(agentMod.mcpNote([])).toBe("");
  });
});

describe("круги не бесконечны", () => {
  it("модель, которая только зовёт инструменты, получает ответ словами", async () => {
    await ws.writeModel({ tasks: MODEL });
    const { complete } = scripted([
      { text: "", calls: [{ id: "c1", name: "tasks_list", args: {} }] }]);
    const out = await agentMod.runAgent({ userId: "200", agentId: "assistant", question: "?",
      system: "S", model: {}, complete, ask: false, rounds: 3 });
    expect(out).toMatch(/Не справился за отведённые шаги/);
  });
});

describe("назначения в настройках", () => {
  it("выбранная модель назначения попадает и в коллекцию агента", () => {
    const p = settings.addProvider("7", { name: "P", kind: "openai", key: "k".repeat(12) });
    settings.updateProvider("7", p.id, { models: ["gpt-4.1"] });
    const a = settings.updateAgent("7", "assistant",
      { uses: { draw: { providerId: p.id, model: "gpt-4.1" } } });
    expect(a.uses.draw).toEqual({ providerId: p.id, model: "gpt-4.1" });
    expect(a.models).toEqual([{ providerId: p.id, model: "gpt-4.1" }]);
  });

  it("«расшифровка» и прежнее поле — одно и то же", () => {
    const p = settings.addProvider("7", { name: "P", kind: "openai", key: "k".repeat(12) });
    settings.updateProvider("7", p.id, { models: ["whisper-1"] });
    const a = settings.updateAgent("7", "assistant",
      { uses: { transcribe: { providerId: p.id, model: "whisper-1" } } });
    expect(a.transcribe).toEqual({ providerId: p.id, model: "whisper-1" });
  });

  it("настройка «спрашивать» хранится у агента", () => {
    expect(settings.agentFor("7", "assistant").ask).toBe(true);
    expect(settings.updateAgent("7", "assistant", { ask: false }).ask).toBe(false);
    expect(settings.agentFor("7", "assistant").ask).toBe(false);
  });

  it("MCP-сервер заводится, спрашивается и убирается вместе с правом агента", () => {
    const m = settings.addMcp("7", { name: "Погода", url: "https://x/mcp", repo: "https://git/x" });
    expect(m).toMatchObject({ name: "Погода", url: "https://x/mcp", tools: [] });
    settings.updateMcp("7", m.id, { tools: ["forecast", "alerts"] });
    expect(settings.settingsView("7").mcp[0].tools).toEqual(["forecast", "alerts"]);
    /* АГЕНТ ВЫБИРАЕТ ИНСТРУМЕНТЫ, А НЕ СЕРВЕР ЦЕЛИКОМ (владелец,
       2026-09-21): карта «сервер → разрешённые инструменты». */
    expect(settings.updateAgent("7", "assistant", { mcp: { [m.id]: ["forecast"] } }).mcp)
      .toEqual({ [m.id]: ["forecast"] });
    // Список id — прежняя форма записи: «разрешены все инструменты».
    expect(settings.updateAgent("7", "assistant", { mcp: [m.id] }).mcp)
      .toEqual({ [m.id]: ["forecast", "alerts"] });
    expect(settings.removeMcp("7", m.id)).toBe(true);
    expect(settings.agentFor("7", "assistant").mcp).toEqual({});
  });

  it("ни одного инструмента — сервера у агента нет: звать там нечего", () => {
    const m = settings.addMcp("7", { name: "Погода", url: "https://x/mcp" });
    settings.updateMcp("7", m.id, { tools: ["forecast"] });
    const a = settings.updateAgent("7", "assistant", { mcp: { [m.id]: [] } });
    expect(a.mcp).toEqual({ [m.id]: [] });
  });

  it("адрес MCP-сервера обязателен, и чужого id агенту не дают", () => {
    expect(() => settings.addMcp("7", { name: "Без адреса" })).toThrow(/Адрес/);
    expect(() => settings.updateAgent("7", "assistant", { mcp: ["нет-такого"] }))
      .toThrow(/Нет такого MCP/);
    expect(() => settings.updateAgent("7", "assistant", { mcp: { "нет-такого": ["x"] } }))
      .toThrow(/Нет такого MCP/);
  });
});

/* ─────── ОТКАТ: РОВНО ТО, ЧТО ВНЕСЛИ (владелец, 2026-09-21) ───────

   Разница считается по записям, а не по всей модели: вернуть модель
   целиком значило бы отменить заодно всё, что человек сделал руками
   после подтверждения. */
describe("разница и откат", () => {
  it("видит изменённое, добавленное и удалённое — и кладёт назад", async () => {
    const before = { tasks: [{ id: "a", s: 1 }, { id: "b", s: 2 }], published: ["x"] };
    const after = { tasks: [{ id: "a", s: 9 }, { id: "c", s: 3 }], published: ["x", "y"] };
    const d = actions.diffOf(before, after);
    expect(d.lists.tasks.added).toEqual(["c"]);
    expect(d.lists.tasks.changed).toEqual({ a: { id: "a", s: 1 }, b: { id: "b", s: 2 } });
    // Список строк разбирать по записям нечем — он возвращается целиком.
    expect(d.fields.published).toEqual({ has: true, value: ["x"] });

    const back = actions.restoreDiff(after, d);
    expect(back.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(back.tasks.find((t) => t.id === "a").s).toBe(1);
    expect(back.published).toEqual(["x"]);
  });

  it("чего действие не трогало, того откат не касается", async () => {
    const before = { tasks: [{ id: "a", s: 1 }] };
    const after = { tasks: [{ id: "a", s: 2 }] };
    const d = actions.diffOf(before, after);
    // Человек добавил своё уже после.
    const later = { tasks: [{ id: "a", s: 2 }, { id: "z", s: 7 }], goals: [{ id: "g" }] };
    const back = actions.restoreDiff(later, d);
    expect(back.tasks).toEqual([{ id: "a", s: 1 }, { id: "z", s: 7 }]);
    expect(back.goals).toEqual([{ id: "g" }]);
  });

  it("ничего не изменилось — и откатывать нечего", () => {
    expect(actions.diffEmpty(actions.diffOf({ tasks: [] }, { tasks: [] }))).toBe(true);
    expect(actions.diffEmpty(actions.diffOf({ a: 1 }, { a: 2 }))).toBe(false);
  });
});
