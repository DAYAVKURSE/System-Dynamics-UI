import { describe, expect, it } from "vitest";
import { MONTH_H, cycles, forecast, load, portQty, reach, runSide, solve,
  solveRange, stepHours, transfers } from "../lib/plan.js";
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
  /* Куда уезжает выданное, говорит сам ресурс: он принадлежит активу, и
     функция выдаёт его туда, где он есть. Отдельного получателя у выхода
     нет — он спрашивал бы то, что уже сказано выбором ресурса. */
  const m = {
    traits: [{ id: "t1", e: "A" }, { id: "t2", e: "B" }],
    funcs: [F({ takes: [{ trait: "t1", lo: 1, hi: 1 }],
      gives: [{ trait: "t2", lo: 2, hi: 4 }, { trait: "t1", lo: 1, hi: 1 }],
      dur: 1, durUnit: "мес" })],
  };

  it("едет только чужой ресурс — свой остаётся в активе", () => {
    const out = transfers(m);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "A", to: "B", trait: "t2", lo: 2, hi: 4 });
  });

  it("выход удалённым ресурсом никуда не едет — ехать некуда", () => {
    const gone = { ...m, traits: [{ id: "t1", e: "A" }] };
    expect(transfers(gone)).toHaveLength(0);
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

describe("расписание функции", () => {
  it("реже, чем работа: цикл считается по расписанию", () => {
    // Работа занимает час, но делается раз в месяц — значит цикл месяц, а
    // не час. Иначе расписание ни на что не влияло бы.
    const f = F({ dur: 1, durUnit: "ч", every: 1, everyUnit: "мес" });
    expect(stepHours(f)).toBe(MONTH_H);
    expect(cycles(f)).toBeCloseTo(1);
  });

  it("чаще самой работы не выйдет: считаем по длительности", () => {
    const f = F({ dur: 1, durUnit: "нед", every: 1, everyUnit: "ч" });
    expect(stepHours(f)).toBe(168);
  });

  it("пусто значит непрерывно — упирается только в длительность", () => {
    expect(stepHours(F({ dur: 2, durUnit: "дн" }))).toBe(48);
  });
});

describe("что нужно сделать, чтобы дойти до цели", () => {
  /* Цепочка: спрос → заявки → пользователи. Чтобы получить пользователей,
     надо обработать заявки, а чтобы обработать — собрать. */
  const chainModel = {
    traits: [{ id: "dem", e: "mkt", have: 3000 }, { id: "req", e: "usr", have: 0 },
      { id: "act", e: "usr", have: 20 }],
    funcs: [
      F({ id: "f_req", e: "usr", name: "Сбор", dur: 2, durUnit: "ч",
        takes: [{ trait: "dem", lo: 2, hi: 4 }],
        gives: [{ trait: "req", lo: 1, hi: 1, to: "vm" }] }),
      F({ id: "f_act", e: "vm", name: "Обработка", dur: 4, durUnit: "ч",
        takes: [{ trait: "req", lo: 1, hi: 1 }],
        gives: [{ trait: "act", lo: 1, hi: 1, to: "usr" }] }),
    ],
  };

  it("считает, сколько выполнений какой функции нужно", () => {
    const r = solve(chainModel, { trait: "act", want: 500, side: "hi" });
    // Не хватает 480 — значит 480 обработок, а под них 480 сборов.
    expect(r.need).toBe(480);
    expect(r.steps.find((x) => x.func === "f_act").runs).toBe(480);
    expect(r.steps.find((x) => x.func === "f_req").runs).toBe(480);
  });

  it("то, что уже есть, идёт в дело первым — и не вычитается дважды", () => {
    // Было 20 из 500: производить надо 480, а не 460 и не 500.
    const r = solve(chainModel, { trait: "act", want: 500, side: "hi" });
    expect(r.steps.find((x) => x.func === "f_act").runs).toBe(480);
    // Запас на входе тоже тратится: спроса 3000, и его хватает.
    expect(r.ok).toBe(true);
  });

  it("цель, которая уже взята, работы не требует", () => {
    expect(solve(chainModel, { trait: "act", want: 10 }).need).toBe(0);
    expect(solve(chainModel, { trait: "act", want: 10 }).steps).toEqual([]);
  });

  it("два времени: работы всего и срок по самой длинной цепочке", () => {
    const r = solve(chainModel, { trait: "act", want: 500, side: "hi" });
    // 480×4ч + 480×2ч работы; цепочка последовательная, поэтому срок тот же.
    expect(r.workHours).toBeCloseTo(480 * 4 + 480 * 2);
    expect(r.criticalHours).toBeCloseTo(480 * 4 + 480 * 2);
  });

  it("расписание удлиняет срок, а объём работы оставляет прежним", () => {
    const slow = { ...chainModel,
      funcs: [chainModel.funcs[0], F({ ...chainModel.funcs[1], every: 1, everyUnit: "дн" })] };
    const r = solve(slow, { trait: "act", want: 500, side: "hi" });
    expect(r.workHours).toBeCloseTo(480 * 4 + 480 * 2);
    expect(r.criticalHours).toBeGreaterThan(480 * 24);
  });

  it("ресурс, который не выдаёт ни одна функция, — это дыра, а не молчание", () => {
    const m = { traits: [{ id: "x", e: "A", have: 0 }], funcs: [] };
    const r = solve(m, { trait: "x", want: 10 });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["x"]);
  });

  it("замкнувшаяся сама на себя цепочка обрывается и говорит об этом", () => {
    // Ресурс нужен для того, чтобы получить этот же ресурс.
    const m = {
      traits: [{ id: "a", e: "A", have: 0 }, { id: "b", e: "A", have: 0 }],
      funcs: [
        F({ id: "f1", e: "A", takes: [{ trait: "b", lo: 1, hi: 1 }],
          gives: [{ trait: "a", lo: 1, hi: 1 }] }),
        F({ id: "f2", e: "A", takes: [{ trait: "a", lo: 1, hi: 1 }],
          gives: [{ trait: "b", lo: 1, hi: 1 }] }),
      ],
    };
    expect(solve(m, { trait: "a", want: 5 }).looped).toBe(true);
  });

  it("вилка даёт две оценки: по нижней границе плана может не быть вовсе", () => {
    // Если выход по нижней границе нулевой, цель по ней недостижима, и
    // выдавать верхнюю за единственную оценку нельзя.
    const m = { ...chainModel,
      funcs: [chainModel.funcs[0], F({ ...chainModel.funcs[1],
        gives: [{ trait: "act", lo: 0, hi: 1, to: "usr" }] })] };
    const { lo, hi } = solveRange(m, { trait: "act", want: 500 });
    expect(hi.ok).toBe(true);
    expect(lo.ok).toBe(false);
  });

  it("фактические выполнения вытесняют вилку и в плане тоже", () => {
    // По факту обработка даёт по 2 пользователя — значит выполнений вдвое
    // меньше, чем по плану.
    const runsOf = (id) => (id === "f_act"
      ? [{ hours: 4, takes: { req: 1 }, gives: { act: 2 } }] : []);
    const r = solve(chainModel, { trait: "act", want: 500, side: "hi", runsOf });
    expect(r.steps.find((x) => x.func === "f_act").runs).toBe(240);
  });
});
