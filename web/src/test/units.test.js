import { describe, expect, it } from "vitest";
import { normalizeFunc, newPort, portSpends, shortage } from "../lib/funcs.js";
import { runSide, solve } from "../lib/plan.js";
import { doneBy, heldBy, unitById, unitsOf, unitsOfTrait } from "../lib/units.js";

/* ЕДИНИЦА РЕСУРСА И ЕЁ НОМЕР.

   Взять ресурс можно двумя способами, и они разные. РАСХОДУЕТ — взятое
   исчезает у всех: ткань, из которой сшили платье, больше ничья. НЕ
   РАСХОДУЕТ — остаётся на месте и достаётся другим функциям, но эта уже
   отработала по нему: прочитанную заявку не читают второй раз.

   Ограничение «второй раз не берём» принадлежит ОДНОЙ функции, а не всем
   сразу. Считать это можно только поединично — отсюда номера. */

const F = (over) => normalizeFunc({ e: "A", dur: 1, durHi: 1, durUnit: "ч",
  every: 0, everyHi: 0, ...over });

describe("расходует или только обрабатывает", () => {
  it("не сказано — расходует: молчание прежней модели её смысла не меняет", () => {
    expect(portSpends({ trait: "t1" })).toBe(true);
    expect(portSpends(newPort("t1"))).toBe(true);
    expect(portSpends({ trait: "t1", spend: false })).toBe(false);
    // Признак живёт у входа и достраивается из чужой записи.
    expect(normalizeFunc({ takes: [{ trait: "t1", spend: false }] }).takes[0].spend)
      .toBe(false);
    expect(normalizeFunc({ takes: [{ trait: "t1" }] }).takes[0].spend).toBe(true);
  });

  it("у выхода признака нет вовсе: выдавать, не выдавая, нечего", () => {
    expect(normalizeFunc({ gives: [{ trait: "t2" }] }).gives[0])
      .not.toHaveProperty("spend");
  });
});

describe("одна и та же единица — одной функции только раз", () => {
  const model = (spend) => ({
    traits: [{ id: "in", e: "A", have: 3 }, { id: "out", e: "A", have: 0 }],
    funcs: [F({ id: "f1", takes: [{ trait: "in", lo: 1, hi: 1, spend }],
      gives: [{ trait: "out", lo: 1, hi: 1 }] })],
  });

  it("расходует — взятое исчезает и у неё, и у соседей", () => {
    const out = runSide(model(true), { span: 3, side: "hi" });
    expect(out.in[3]).toBe(0);
    expect(out.out[3]).toBe(3);
  });

  it("не расходует — ресурс на месте, но второй раз она его не берёт", () => {
    const out = runSide(model(false), { span: 3, side: "hi" });
    // Три единицы никуда не делись: их не тратили.
    expect(out.in[3]).toBe(3);
    // Но выполнений всё равно три: обработать каждую можно только однажды.
    expect(out.out[3]).toBe(3);
  });

  it("двум РАЗНЫМ функциям одна и та же единица достаётся обеим", () => {
    /* Прежде расходовалось всё и всегда, и прочитанная заявка пропадала у
       соседа. Ограничение принадлежит одной функции, а не всем. */
    const m = {
      traits: [{ id: "in", e: "A", have: 2 }, { id: "a", e: "A", have: 0 },
        { id: "b", e: "A", have: 0 }],
      funcs: [
        F({ id: "f1", takes: [{ trait: "in", lo: 1, hi: 1, spend: false }],
          gives: [{ trait: "a", lo: 1, hi: 1 }] }),
        F({ id: "f2", takes: [{ trait: "in", lo: 1, hi: 1, spend: false }],
          gives: [{ trait: "b", lo: 1, hi: 1 }] }),
      ],
    };
    const out = runSide(m, { span: 1, side: "hi" });
    expect(out.in[1]).toBe(2);
    // Каждая обработала обе единицы — и ни одна не отняла их у другой.
    expect(out.a[1]).toBe(2);
    expect(out.b[1]).toBe(2);
  });

  it("а расходуемый вход они по-прежнему делят: больше, чем есть, не съесть", () => {
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
    expect(out.a[1] + out.b[1]).toBeLessThanOrEqual(6);
    expect(out.in[1]).toBeCloseTo(0, 9);
  });
});

describe("план под цель", () => {
  it("необработанное надо ИМЕТЬ, но остаток оно не съедает", () => {
    /* Две функции просят один и тот же вход, не расходуя его. Лежащего
       хватает обеим: оно никуда не девается. */
    const m = {
      traits: [{ id: "in", e: "A", have: 4 }, { id: "mid", e: "A", have: 0 },
        { id: "out", e: "A", have: 0 }],
      funcs: [
        F({ id: "f1", takes: [{ trait: "in", lo: 2, hi: 2, spend: false }],
          gives: [{ trait: "mid", lo: 1, hi: 1 }] }),
        F({ id: "f2", takes: [{ trait: "in", lo: 2, hi: 2, spend: false },
          { trait: "mid", lo: 1, hi: 1 }],
        gives: [{ trait: "out", lo: 1, hi: 1 }] }),
      ],
    };
    const plan = solve(m, { trait: "out", want: 2 });
    // Тратится ноль: ни одна из двух ничего не израсходовала.
    expect(plan.spent.in).toBeUndefined();
    /* «Иметь» — это не сумма по функциям: каждой нужно по четыре единицы,
       и лежащие четыре закрывают нужду обеих. Сложить их в восемь значило
       бы объявить нехваткой то, что лежит на месте и никуда не девается. */
    expect(plan.held.in).toBe(4);
    expect(plan.missing).not.toContain("in");
  });
});

describe("чего не хватает, чтобы взяться за работу", () => {
  const f = F({ id: "f1", takes: [{ trait: "in", lo: 1, hi: 1, spend: false }],
    gives: [{ trait: "out", lo: 1, hi: 1 }] });
  const traits = [{ id: "in", e: "A", have: 2 }];

  it("нехватка считает только НЕОБРАБОТАННОЕ этой функцией", () => {
    expect(shortage(f, traits)).toEqual([]);
    expect(shortage(f, traits, { in: 1 })).toEqual([]);
    // Обе единицы обработаны — брать нечего, хотя ресурс на месте.
    const miss = shortage(f, traits, { in: 2 });
    expect(miss).toHaveLength(1);
    expect(miss[0]).toMatchObject({ trait: "in", have: 0, done: 2, spend: false });
  });

  it("у расходуемого входа обработанное ни при чём: там всё видно по остатку", () => {
    const spends = F({ id: "f2", takes: [{ trait: "in", lo: 1, hi: 1 }],
      gives: [{ trait: "out", lo: 1, hi: 1 }] });
    expect(shortage(spends, traits, { in: 2 })).toEqual([]);
  });
});

describe("номера единиц", () => {
  const funcs = [{ id: "f1", e: "A", name: "Разобрать заявку" }];
  const tasks = [
    { id: "tk1", funcId: "f1", title: "Заявка Петрова", status: "done", assignee: "2",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 2,
        takes: { in: 1 }, gives: { tz: 1 }, text: "разобрал" }] },
    { id: "tk2", funcId: "f1", title: "Заявка Иванова", status: "done", assignee: "3",
      submissions: [{ id: "s2", at: "2026-02-03T10:00:00Z", hours: 3,
        takes: { in: 1 }, gives: { tz: 1 } }] },
    { id: "tk3", funcId: "f1", title: "Ещё не принято", status: "review", assignee: "3",
      submissions: [{ id: "s3", at: "2026-02-05T10:00:00Z", hours: 1,
        takes: { in: 1 }, gives: { tz: 1 } }] },
  ];

  it("единица рождается сдачей, и номер у неё свой — от старых к новым", () => {
    const units = unitsOf({ tasks, funcs });
    expect(units.map((u) => u.no)).toEqual([1, 2, 3]);
    expect(units[0]).toMatchObject({ id: "s1~tz", trait: "tz", task: "tk1",
      title: "Заявка Петрова", by: "2", accepted: true });
    // Непринятая сдача — уже вещь, но ещё не результат: это видно по флагу.
    expect(units[2].accepted).toBe(false);
  });

  it("единицу ресурса можно найти по номеру: на неё и ссылаются отчёты", () => {
    expect(unitById({ tasks, funcs }, "s2~tz")).toMatchObject({ no: 2,
      title: "Заявка Иванова" });
    expect(unitById({ tasks, funcs }, "нет-такой")).toBeNull();
    // Для выбора — от новых к старым: ссылаются чаще на свежее.
    expect(unitsOfTrait({ tasks, funcs }, "tz").map((u) => u.no)).toEqual([3, 2, 1]);
  });

  it("обработанное функцией считается по принятым задачам, а не по всем", () => {
    // Непринятая сдача — заявление исполнителя, а не сделанная работа.
    expect(doneBy(tasks, "f1")).toEqual({ in: 2 });
    // И только по тем входам, которые не расходуются: у расходуемого всё
    // видно по самому остатку ресурса.
    const f = normalizeFunc({ id: "f1", takes: [{ trait: "in", spend: false }] });
    expect(heldBy(tasks, f)).toEqual({ in: 2 });
    expect(heldBy(tasks, normalizeFunc({ id: "f1", takes: [{ trait: "in" }] }))).toEqual({});
  });
});
