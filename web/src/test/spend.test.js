import { describe, expect, it } from "vitest";
import { normalizeFunc } from "../lib/funcs.js";
import { runSide, solve } from "../lib/plan.js";

/* ОБРАБОТАННЫЙ РЕСУРС НЕ БЕРЁТСЯ ПОВТОРНО.

   Это не настройка и не галочка на форме, а то, как модель устроена: вход
   ТРАТИТСЯ. Взяв единицу, функция её израсходовала — ни она сама в
   следующий раз, ни соседняя функция того же месяца эту единицу больше не
   получат. Прежде для этого заводили уклад входа («каждый», «всё»); он
   спрашивал у человека то, что и так верно всегда, и убран.

   Сколько ресурса на одно выполнение — по-прежнему вилка функции, а
   сколько выполнений будет — считается по целям. */

const F = (over) => normalizeFunc({ e: "A", dur: 1, durHi: 1, durUnit: "ч",
  every: 0, everyHi: 0, ...over });

describe("вход тратится", () => {
  it("взятое исчезает из остатка и второй раз не берётся", () => {
    const m = {
      traits: [{ id: "in", e: "A", have: 10 }, { id: "out", e: "A", have: 0 }],
      funcs: [F({ id: "f1", takes: [{ trait: "in", lo: 2, hi: 2 }],
        gives: [{ trait: "out", lo: 1, hi: 1 }] })],
    };
    const out = runSide(m, { span: 3, side: "hi" });
    // Десять единиц дают ровно пять выполнений — и ни одним больше, сколько
    // бы месяцев ни прошло.
    expect(out.in[3]).toBe(0);
    expect(out.out[3]).toBe(5);
  });

  it("двум функциям одного ресурса не хватит дважды", () => {
    const m = {
      traits: [{ id: "in", e: "A", have: 6 }, { id: "a", e: "A", have: 0 },
        { id: "b", e: "A", have: 0 }],
      funcs: [
        F({ id: "f1", takes: [{ trait: "in", lo: 1, hi: 1 }],
          gives: [{ trait: "a", lo: 1, hi: 1 }] }),
        F({ id: "f2", takes: [{ trait: "in", lo: 1, hi: 1 }],
          gives: [{ trait: "b", lo: 1, hi: 1 }] }),
      ],
    };
    const out = runSide(m, { span: 1, side: "hi" });
    // Сколько бы каждая ни хотела, вместе они не съедят больше, чем было.
    expect(out.a[1] + out.b[1]).toBeLessThanOrEqual(6);
    expect(out.in[1]).toBeCloseTo(0, 9);
  });

  it("в плане под цель остаток уходит в дело один раз", () => {
    /* Две функции просят один и тот же вход. То, что уже лежит, закрывает
       спрос лишь однажды — иначе план недосчитал бы ровно на остаток. */
    const m = {
      traits: [{ id: "in", e: "A", have: 4 }, { id: "mid", e: "A", have: 0 },
        { id: "out", e: "A", have: 0 }],
      funcs: [
        F({ id: "f1", takes: [{ trait: "in", lo: 2, hi: 2 }],
          gives: [{ trait: "mid", lo: 1, hi: 1 }] }),
        F({ id: "f2", takes: [{ trait: "in", lo: 2, hi: 2 }, { trait: "mid", lo: 1, hi: 1 }],
          gives: [{ trait: "out", lo: 1, hi: 1 }] }),
      ],
    };
    const plan = solve(m, { trait: "out", want: 2 });
    // Спрос на вход — четыре единицы у одной функции и четыре у другой:
    // восемь. Лежащие четыре покрывают часть, остальное объявлено нехваткой.
    expect(plan.spent.in).toBe(8);
    expect(plan.missing).toContain("in");
  });
});
