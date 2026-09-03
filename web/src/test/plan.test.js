import { describe, expect, it } from "vitest";
import { MONTH_H, cycles, forecast, load, portQty, reach, runSide, transfers }
  from "../lib/plan.js";
import { normalizeFunc } from "../lib/funcs.js";

/* Считает модель одно: функции. Из времени одного выполнения выходит,
   сколько раз функция срабатывает за месяц, из вилок входов и выходов —
   сколько ресурса при этом уходит и приходит.

   Здесь проверяется сам расчёт: границы ленты, нехватка ресурса, факт,
   передачи между активами и нагрузка людей. */

const F = (over) => normalizeFunc({ id: "f1", e: "A", dur: 1, durUnit: "нед",
  takes: [], gives: [], ...over });

const model = {
  traits: [{ id: "t1", e: "A", have: 100 }, { id: "t2", e: "A", have: 0 }],
  funcs: [F({ takes: [{ trait: "t1", lo: 1, hi: 2 }],
    gives: [{ trait: "t2", lo: 3, hi: 5 }] })],
};

describe("сколько раз функция выполняется за месяц", () => {
  it("цикл короче месяца повторяется, длиннее — выдаёт долю", () => {
    expect(cycles(F({ dur: 1, durUnit: "мес" }))).toBeCloseTo(1);
    expect(cycles(F({ dur: 1, durUnit: "нед" }))).toBeCloseTo(MONTH_H / 168);
    expect(cycles(F({ dur: 6, durUnit: "мес" }))).toBeCloseTo(1 / 6);
  });

  it("без времени — ноль, а не бесконечность", () => {
    expect(cycles(F({ dur: 0 }))).toBe(0);
  });

  it("фактическое время цикла сильнее заложенного", () => {
    // Измеренное честнее обещанного: как только выполнения появились,
    // считаем по ним.
    const runs = [{ hours: MONTH_H / 2 }, { hours: MONTH_H / 2 }];
    expect(cycles(F({ dur: 1, durUnit: "нед" }), runs)).toBeCloseTo(2);
  });
});

describe("сколько ресурса берётся и выдаётся на одном выполнении", () => {
  const take = { trait: "t1", lo: 1, hi: 2 };
  const give = { trait: "t2", lo: 3, hi: 5 };

  it("нижняя граница уровня: берут по максимуму, выдают по минимуму", () => {
    expect(portQty(take, { kind: "takes", side: "lo" })).toBe(2);
    expect(portQty(give, { kind: "gives", side: "lo" })).toBe(3);
  });

  it("верхняя — наоборот", () => {
    expect(portQty(take, { kind: "takes", side: "hi" })).toBe(1);
    expect(portQty(give, { kind: "gives", side: "hi" })).toBe(5);
  });

  it("факт вытесняет вилку с обеих сторон — измеренное не нуждается в границах", () => {
    const runs = [{ takes: { t1: 4 }, gives: { t2: 10 }, hours: 1 },
      { takes: { t1: 6 }, gives: { t2: 20 }, hours: 1 }];
    expect(portQty(take, { kind: "takes", side: "lo", runs })).toBe(5);
    expect(portQty(give, { kind: "gives", side: "hi", runs })).toBe(15);
  });
});

describe("прогон по месяцам", () => {
  it("ресурс растёт на то, что функции в него выдали", () => {
    const out = runSide(model, { span: 2, side: "hi" });
    // ~4.345 выполнения в месяц по 5 — примерно 21.7 за месяц.
    expect(out.t2[0]).toBe(0);
    expect(out.t2[1]).toBeCloseTo((MONTH_H / 168) * 5, 1);
    expect(out.t2[2]).toBeCloseTo((MONTH_H / 168) * 10, 1);
  });

  it("нижняя граница ниже верхней — это и есть лента", () => {
    const lo = runSide(model, { span: 6, side: "lo" });
    const hi = runSide(model, { span: 6, side: "hi" });
    expect(lo.t2[6]).toBeLessThan(hi.t2[6]);
    // У входа наоборот: снизу тратим больше, значит остаётся меньше.
    expect(lo.t1[6]).toBeLessThan(hi.t1[6]);
  });

  it("ресурс не уходит в минус: взять больше, чем есть, нельзя", () => {
    const m = { traits: [{ id: "t1", e: "A", have: 3 }, { id: "t2", e: "A", have: 0 }],
      funcs: model.funcs };
    const out = runSide(m, { span: 6, side: "lo" });
    expect(Math.min(...out.t1)).toBeGreaterThanOrEqual(0);
    // И выдать больше, чем позволил дефицитный вход, тоже нельзя: за всё
    // время выйдет не больше, чем было чем оплатить.
    expect(out.t2[6]).toBeLessThanOrEqual(3 * 5);
  });

  it("нехватку делят поровну по спросу, а не по порядку в списке", () => {
    // Порядок функций — случайность заведения, а не приоритет: кто раньше
    // заведён, не должен съедать весь остаток.
    const m = {
      traits: [{ id: "t1", e: "A", have: 10 }, { id: "t2", e: "A", have: 0 },
        { id: "t3", e: "A", have: 0 }],
      funcs: [
        F({ id: "fa", takes: [{ trait: "t1", lo: 5, hi: 5 }],
          gives: [{ trait: "t2", lo: 1, hi: 1 }], dur: 1, durUnit: "мес" }),
        F({ id: "fb", takes: [{ trait: "t1", lo: 5, hi: 5 }],
          gives: [{ trait: "t3", lo: 1, hi: 1 }], dur: 1, durUnit: "мес" }),
      ],
    };
    const out = runSide(m, { span: 1, side: "hi" });
    expect(out.t2[1]).toBeCloseTo(out.t3[1]);
  });

  it("без функций ресурс стоит на месте — сам он не меняется", () => {
    const out = runSide({ traits: model.traits, funcs: [] }, { span: 3, side: "hi" });
    expect(out.t1).toEqual([100, 100, 100, 100]);
  });
});

describe("прогноз целиком", () => {
  it("лента есть всегда, линия факта — только когда были выполнения", () => {
    expect(forecast(model, { span: 3 }).fact).toBeNull();
    const withRuns = forecast(model, { span: 3,
      runsOf: () => [{ hours: 168, takes: { t1: 1 }, gives: { t2: 4 } }] });
    expect(withRuns.fact).not.toBeNull();
    expect(withRuns.fact.t2[3]).toBeGreaterThan(0);
  });

  it("цель даёт два срока: наверняка и в лучшем случае", () => {
    // Одна дата здесь была бы обещанием, которого вилка не даёт.
    const fc = forecast(model, { span: 24 });
    const r = reach(fc, { id: "t2", want: 100 });
    expect(r.best).toBeLessThanOrEqual(r.sure);
    expect(r.best).toBeGreaterThan(0);
  });

  it("недостижимая цель — это null, а не выдуманный месяц", () => {
    const fc = forecast(model, { span: 3 });
    expect(reach(fc, { id: "t2", want: 1e9 })).toMatchObject({ best: null, sure: null });
    expect(reach(fc, { id: "t2", want: null })).toBeNull();
  });
});

describe("передачи между активами", () => {
  const m = {
    traits: [{ id: "t1", e: "A" }, { id: "t2", e: "A" }],
    funcs: [F({ takes: [{ trait: "t1", lo: 1, hi: 1 }],
      gives: [{ trait: "t2", lo: 2, hi: 4, to: "B" }, { trait: "t1", lo: 1, hi: 1 }],
      dur: 1, durUnit: "мес" })],
  };

  it("считаются только выходы с получателем — остальное никуда не едет", () => {
    const out = transfers(m);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "A", to: "B", trait: "t2", lo: 2, hi: 4 });
  });

  it("это месячные числа: за месяц столько и уедет", () => {
    const fast = { ...m, funcs: [{ ...m.funcs[0], dur: 15, durUnit: "дн" }] };
    expect(transfers(fast)[0].hi).toBeCloseTo(4 * (MONTH_H / 360), 1);
  });
});

describe("нагрузка исполнителей", () => {
  it("часы функции делятся между её исполнителями поровну", () => {
    const m = { funcs: [F({ dur: 1, durUnit: "мес", owners: ["p1", "p2"] })] };
    const by = load(m);
    expect(by.p1).toBeCloseTo(MONTH_H / 2);
    expect(by.p2).toBeCloseTo(MONTH_H / 2);
  });

  it("функция без исполнителей ни на кого не ложится", () => {
    expect(load({ funcs: [F({ dur: 1, durUnit: "мес" })] })).toEqual({});
  });
});
