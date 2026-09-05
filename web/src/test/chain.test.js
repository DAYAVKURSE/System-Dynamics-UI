import { describe, expect, it } from "vitest";
import { normalizeFunc } from "../lib/funcs.js";
import { actualOf, chainOf, estimate, estimateRange, factorsIn } from "../lib/chain.js";

/* ЦЕПОЧКА · что случится с этим ресурсом дальше.

   Счёт идёт ВПЕРЁД, от того, что уже лежит на столе. Цель разворачивается
   назад — «что сделать, чтобы получить»; здесь наоборот — «вот заявка, во
   что она превратится, до какого звена и какой ценой». */

const F = (over) => normalizeFunc({ e: "A", dur: 1, durHi: 1, durUnit: "ч",
  every: 0, everyHi: 0, ...over });

const MODEL = {
  traits: [{ id: "zayavka", e: "A", l: "заявка", have: 5 },
    { id: "tz", e: "A", l: "ТЗ", have: 0 },
    { id: "maket", e: "A", l: "макет", have: 0 },
    { id: "sait", e: "A", l: "сайт", have: 0 },
    { id: "dengi", e: "A", l: "деньги", have: 100 }],
  funcs: [
    F({ id: "f1", name: "Разобрать заявку", takes: [{ trait: "zayavka", lo: 1, hi: 1 }],
      gives: [{ trait: "tz", lo: 1, hi: 1 }] }),
    F({ id: "f2", name: "Собрать макет", takes: [{ trait: "tz", lo: 1, hi: 1, spend: false }],
      gives: [{ trait: "maket", lo: 1, hi: 2 }] }),
    F({ id: "f3", name: "Сверстать", takes: [{ trait: "maket", lo: 1, hi: 1 },
      { trait: "dengi", lo: 10, hi: 10 }],
    gives: [{ trait: "sait", lo: 1, hi: 1 }] }),
  ],
  factors: [{ id: "x1", e: "A", name: "сезон", chance: 40 }],
  tasks: [],
};

describe("цепочка от ресурса", () => {
  it("идёт вперёд по слоям: ресурс → функция → ресурс", () => {
    const c = chainOf(MODEL, { from: "zayavka" });
    expect(c.steps.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(c.traits).toEqual(["zayavka", "tz", "maket", "sait"]);
    // «Деньги» в цепочку не входят: их эта работа не производит, они
    // приходят со стороны.
    expect(c.traits).not.toContain("dengi");
  });

  it("ресурс-звено закрывает цепочку на себе", () => {
    const c = chainOf(MODEL, { from: "zayavka", upto: "maket" });
    expect(c.steps.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(c.traits).toEqual(["zayavka", "tz", "maket"]);
    expect(c.ok).toBe(true);
  });

  it("функция-звено входит в цепочку последней", () => {
    const c = chainOf(MODEL, { from: "zayavka", upto: "f2" });
    expect(c.steps.map((f) => f.id)).toEqual(["f1", "f2"]);
    // Её выход дальше не разворачивается: человек просил остановиться на ней.
    expect(c.traits).toEqual(["zayavka", "tz"]);
  });

  it("до звена не дошли — это разрыв, и молчать о нём нельзя", () => {
    const c = chainOf(MODEL, { from: "maket", upto: "tz" });
    expect(c.ok).toBe(false);
  });

  it("кольцо не зацикливает: функция входит в цепочку один раз", () => {
    const loop = { ...MODEL, funcs: [
      F({ id: "a", takes: [{ trait: "x" }], gives: [{ trait: "y" }] }),
      F({ id: "b", takes: [{ trait: "y" }], gives: [{ trait: "x" }] }),
    ] };
    expect(chainOf(loop, { from: "x" }).steps.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("предварительная оценка", () => {
  const chain = chainOf(MODEL, { from: "zayavka" });

  it("считает выполнения, время и изменение ресурсов", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    expect(e.steps.map((s) => s.func)).toEqual(["f1", "f2", "f3"]);
    // Одна заявка — одно ТЗ — щедрой стороной два макета — два сайта.
    expect(e.steps.find((s) => s.func === "f2").runs).toBe(1);
    expect(e.delta.zayavka).toBe(-1);
    expect(e.delta.tz).toBe(1);
    expect(e.delta.sait).toBeGreaterThan(0);
  });

  it("обработанное не расходуется: ТЗ остаётся на месте", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    // f2 берёт ТЗ, не расходуя: в минус оно не уходит.
    expect(e.delta.tz).toBe(1);
  });

  it("вход со стороны работу не сдерживает, но и не замалчивается", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    // Деньги в цепочке не производятся — они в «нужно со стороны».
    expect(e.need.dengi).toBeGreaterThan(0);
  });

  it("календарный срок — по самой длинной ветке, а не сумма всего", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    expect(e.calendarHours).toBeGreaterThan(0);
    expect(e.calendarHours).toBeLessThanOrEqual(
      e.steps.reduce((s, x) => s + x.calendarHours, 0));
    // Вторая функция ждёт первую: раньше её выхода она не начнётся.
    expect(e.steps.find((s) => s.func === "f2").startHours).toBeGreaterThan(0);
  });

  it("оценка — вилка, а не число: одно число было бы обещанием", () => {
    const r = estimateRange(MODEL, chain, { qty: 1 });
    expect(r.lo.delta.maket).toBeLessThanOrEqual(r.hi.delta.maket);
  });

  it("пустая цепочка ничего не выдумывает", () => {
    const e = estimate(MODEL, chainOf(MODEL, { from: "sait" }), { qty: 1 });
    expect(e.steps).toEqual([]);
    expect(e.workHours).toBe(0);
  });
});

describe("факторы, которые влияют", () => {
  it("фактор, трогающий ресурс цепочки, назван — с его вероятностью", () => {
    const m = { ...MODEL, funcs: [...MODEL.funcs,
      F({ id: "fx", name: "Сезонный спад", kind: "factor", factors: ["x1"],
        takes: [], gives: [{ trait: "maket", lo: 1, hi: 1 }] })] };
    const list = factorsIn(m, chainOf(m, { from: "zayavka" }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ func: "fx", traits: ["maket"] });
    expect(list[0].factors[0]).toMatchObject({ name: "сезон", chance: 40 });
  });

  it("фактор в стороне от цепочки её не касается", () => {
    const m = { ...MODEL, funcs: [...MODEL.funcs,
      F({ id: "fy", kind: "factor", factors: ["x1"],
        gives: [{ trait: "dengi", lo: 1, hi: 1 }] })] };
    expect(factorsIn(m, chainOf(m, { from: "zayavka" }))).toEqual([]);
  });
});

describe("фактическая оценка", () => {
  const tasks = [
    { id: "t1", funcId: "f1", title: "Заявка Петрова", status: "done",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 3,
        takes: { zayavka: 1 }, gives: { tz: 1 } }] },
    { id: "t2", funcId: "f2", title: "Макет", status: "review",
      submissions: [{ id: "s2", at: "2026-02-02T10:00:00Z", hours: 9,
        takes: { tz: 1 }, gives: { maket: 1 } }] },
    { id: "t3", funcId: "нет-в-цепочке", title: "Чужая", status: "done",
      submissions: [{ id: "s3", at: "2026-02-03T10:00:00Z", hours: 5,
        takes: {}, gives: {} }] },
  ];
  const model = { ...MODEL, tasks };
  const chain = chainOf(model, { from: "zayavka" });

  it("в числа идут только принятые сдачи", () => {
    const a = actualOf(model, chain);
    // Задача на проверке — заявление исполнителя, а не измерение.
    expect(a.hours).toBe(3);
    expect(a.done).toBe(1);
    // Но из виду она не пропадает: это и есть ответ «сколько осталось».
    expect(a.total).toBe(2);
    expect(a.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("чужая работа в отчёт не попадает", () => {
    expect(actualOf(model, chain).tasks.some((t) => t.id === "t3")).toBe(false);
  });

  it("вычитается только израсходованное, обработанное остаётся", () => {
    const a = actualOf(model, chain);
    expect(a.delta.zayavka).toBe(-1);
    expect(a.delta.tz).toBe(1);
  });

  it("без принятых сдач факта не существует", () => {
    const a = actualOf({ ...model, tasks: [tasks[1]] }, chain);
    expect(a.any).toBe(false);
    expect(a.hours).toBe(0);
  });
});
