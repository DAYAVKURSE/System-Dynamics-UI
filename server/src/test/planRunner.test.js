import { describe, expect, it } from "vitest";
import {
  DONE, FAILED, MAX_STEPS, PENDING, PLAN_NOTE, UNSOLVED_LEAD, parseJson, parsePlan, parseStep, render,
  runPlanned, strike,
} from "../lib/planRunner.js";

/* ═══════════════════════════════════════════════════════════════
   РЕЖИМ ПЛАНИРОВАНИЯ

   Просьба → план → шаги по одному → сверка с ожидаемым → пересбор при
   несовпадении с первого изменённого шага → итог. Модель — заглушка,
   которая отвечает по очереди; проверяем, что и в каком порядке её
   спрашивают, и что видит человек.
   ═══════════════════════════════════════════════════════════════ */

const plan = (steps, over = {}) => JSON.stringify({ request: "посчитать задачи", result: "число задач названо",
  steps: steps.map((s) => (typeof s === "string" ? { action: s, expect: `${s} — есть` } : s)), ...over });
const ok = (result) => `сделал.\n{"ok": true, "result": "${result}"}`;
const bad = (result) => `не вышло.\n{"ok": false, "result": "${result}"}`;

/** Заглушка: ответы по порядку, все подсказки — в `prompts`. */
function scripted(answers) {
  const prompts = [];
  const run = async (p) => { prompts.push(p); if (!answers.length) throw new Error("заглушке нечего ответить"); return answers.shift(); };
  return { run, prompts };
}

describe("разбор ответов", () => {
  it("план — из JSON, и в ```json тоже; не план — null; шагов не больше предела", () => {
    expect(parsePlan("```json\n" + plan(["а", "б"]) + "\n```")).toMatchObject({ request: "посчитать задачи", steps: [{ action: "а", state: "pending" }, { action: "б" }] });
    expect(parsePlan("просто ответ словами")).toBeNull();
    expect(parsePlan('{"steps": []}')).toBeNull();
    expect(parsePlan('{"impossible": "нет прав"}')).toEqual({ impossible: "нет прав" });
    expect(parsePlan(plan(Array.from({ length: 20 }, (_, i) => `шаг ${i}`))).steps).toHaveLength(MAX_STEPS);
    expect(parseJson('вот: {"a": {"b": 1}} и всё')).toEqual({ a: { b: 1 } });
  });

  it("итог шага — последняя JSON-строка; без неё шаг считается сделанным", () => {
    expect(parseStep(ok("три задачи"))).toEqual({ ok: true, result: "три задачи" });
    expect(parseStep(bad("задач нет"))).toEqual({ ok: false, result: "задач нет" });
    expect(parseStep("просто текст")).toEqual({ ok: true, result: "просто текст" });
  });

  it("план словами: просьба, шаги с кружком и номером, ожидаемый результат; сделанные зачёркнуты", () => {
    const p = parsePlan(plan(["а", "б", "в"]));
    p.steps[0].state = "done"; p.steps[1].state = "failed";
    const text = render(p, { title: "Агент «Юрист» начинает задачу" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Агент «Юрист» начинает задачу");
    expect(lines[1]).toBe("Что нужно сделать: посчитать задачи");
    expect(lines[2]).toBe(`${DONE} 1. ${strike("а → а — есть")}`);
    expect(lines[3]).toBe(`${FAILED} 2. б → б — есть`);
    expect(lines[4]).toBe(`${PENDING} 3. в → в — есть`);
    expect(lines[5]).toBe("Ожидаемый результат: число задач названо");
    expect(PLAN_NOTE).toMatch(/ТОЛЬКО JSON/);
  });
});

describe("выполнение", () => {
  it("не план — прямой ответ, одним запросом", async () => {
    const m = scripted(["у вас три задачи"]);
    const r = await runPlanned({ question: "сколько задач?", run: m.run });
    expect(r).toEqual({ planned: false, answer: "у вас три задачи", plan: null, unsolved: false });
    expect(m.prompts).toEqual(["сколько задач?"]);
  });

  it("план → шаги по порядку → итог; человек видит план после каждого шага", async () => {
    const m = scripted([plan(["посмотреть список", "посчитать"]), ok("список есть"), ok("три"), "Задач три."]);
    const shown = [];
    const r = await runPlanned({ question: "сколько задач?", run: m.run, onPlan: (t) => shown.push(t) });
    expect(r.planned).toBe(true);
    expect(r.answer).toBe("Задач три.");
    expect(r.unsolved).toBe(false);
    expect(m.prompts[1]).toMatch(/Сейчас выполни шаг 1: посмотреть список/);
    expect(m.prompts[1]).toMatch(/Ожидаемый результат шага: посмотреть список — есть/);
    expect(m.prompts[2]).toMatch(/Сейчас выполни шаг 2: посчитать/);
    expect(m.prompts[2]).toMatch(/1\. посмотреть список .*\[сделан: список есть\]/);
    expect(m.prompts[3]).toMatch(/Все шаги выполнены/);
    // Показ: план, после первого шага, после второго.
    expect(shown).toHaveLength(3);
    expect(shown[0]).toContain(`${PENDING} 1. посмотреть список`);
    expect(shown[1]).toContain(`${DONE} 1. ${strike("посмотреть список → посмотреть список — есть")}`);
    expect(shown[1]).toContain(`${PENDING} 2. посчитать`);
    expect(shown[2]).toContain(`${DONE} 2.`);
    expect(r.plan.steps.every((s) => s.state === "done")).toBe(true);
  });

  it("шаг не дал ожидаемого — план пересобирается с новыми данными, сделанные остаются, идём с первого изменённого", async () => {
    const m = scripted([
      plan(["открыть доску", "взять задачу", "сдать"]),
      ok("доска открыта"),
      bad("задача уже у другого"),
      // Пересбор: первый шаг тот же, дальше — новые.
      plan(["открыть доску", "спросить владельца", "сдать"]),
      ok("владелец разрешил"),
      ok("сдано"),
      "Сдано после разрешения.",
    ]);
    const shown = [];
    const r = await runPlanned({ question: "сдай задачу", run: m.run, onPlan: (t) => shown.push(t) });
    expect(r.answer).toBe("Сдано после разрешения.");
    expect(m.prompts[3]).toMatch(/Шаг 2 не дал ожидаемого результата: задача уже у другого/);
    expect(m.prompts[3]).toMatch(/Пересоставь план/);
    // После пересбора выполняется шаг 2 нового плана, а не первый заново.
    expect(m.prompts[4]).toMatch(/Сейчас выполни шаг 2: спросить владельца/);
    expect(m.prompts[5]).toMatch(/Сейчас выполни шаг 3: сдать/);
    // Что видел человек: 🔴 на неудаче, затем план без него.
    const failed = shown.find((t) => t.includes(FAILED));
    expect(failed).toContain(`${FAILED} 2. взять задачу`);
    const after = shown[shown.indexOf(failed) + 1];
    expect(after).not.toContain("взять задачу");
    expect(after).toContain(`${DONE} 1. ${strike("открыть доску → открыть доску — есть")}`);
    expect(after).toContain(`${PENDING} 2. спросить владельца`);
  });

  it("пересбор с изменённым сделанным шагом — выполнение с него", async () => {
    const m = scripted([
      plan(["а", "б"]), ok("а есть"), bad("б нет"),
      plan(["а иначе", "б"]), ok("а иначе есть"), ok("б есть"), "Готово.",
    ]);
    await runPlanned({ question: "x", run: m.run });
    expect(m.prompts[4]).toMatch(/Сейчас выполни шаг 1: а иначе/);
  });

  it("пересборов больше предела — «не справился», словами человеку, с планом", async () => {
    const m = scripted([plan(["а"]), bad("нет"), plan(["а"]), bad("нет"), plan(["а"]), bad("нет")]);
    const r = await runPlanned({ question: "x", run: m.run, maxReplans: 2 });
    expect(r.unsolved).toBe(true);
    expect(r.answer).toMatch(new RegExp(`^${UNSOLVED_LEAD} нет`));
    expect(r.answer).toContain(FAILED);
    expect(m.prompts).toHaveLength(6);
  });

  it("модель говорит «нельзя» — сразу человеку, без шагов", async () => {
    const m = scripted([plan(["а"]), bad("нет прав"), '{"impossible": "у агента нет права сдавать"}']);
    const r = await runPlanned({ question: "x", run: m.run });
    expect(r).toMatchObject({ planned: true, unsolved: true, answer: `${UNSOLVED_LEAD} у агента нет права сдавать` });
    expect(await runPlanned({ question: "y", run: scripted(['{"impossible": "нечем"}']).run }))
      .toMatchObject({ unsolved: true, answer: `${UNSOLVED_LEAD} нечем` });
  });

  it("итог «не достигнут» — ещё круг плана; отмена останавливает между шагами", async () => {
    const m = scripted([plan(["а"]), ok("а"), '{"notDone": "б не сделано"}', plan(["а", "б"]), ok("б"), "Теперь всё."]);
    const r = await runPlanned({ question: "x", run: m.run });
    expect(r.answer).toBe("Теперь всё.");
    expect(m.prompts[4]).toMatch(/Сейчас выполни шаг 2: б/);

    const ac = new AbortController();
    const c = scripted([plan(["а", "б"]), ok("а")]);
    const run = async (p) => { const t = await c.run(p); if (c.prompts.length === 2) ac.abort(); return t; };
    await expect(runPlanned({ question: "x", run, signal: ac.signal })).rejects.toThrow("Отменено");
  });
});
