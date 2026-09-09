import { describe, expect, it } from "vitest";
import { runsOfFunc, newTask, autoStatus } from "../components/TasksBoard.jsx";
import { unitsOf, doneBy } from "../lib/units.js";
import { historyOf } from "../lib/workers.js";
import { actualOf, chainOf } from "../lib/chain.js";
import { normalizeFunc } from "../lib/funcs.js";

/* ОТМЕНЁННАЯ ЗАДАЧА · остаётся в списке, работой не считается.

   Работу отменяют, а не стирают: удаление уносило вместе с задачей её
   сдачи и оценки, а они были. Но и считать отменённое сделанным нельзя —
   ни в факте расчёта, ни в вещах, ни в нагрузке, ни в напоминаниях. */

const done = (over = {}) => ({
  ...newTask({ funcId: "f1", title: "Работа", assignee: "p1" }),
  id: "tk1", status: "done",
  submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 4,
    takes: { t1: 1 }, gives: { t2: 1 } }],
  ...over,
});

describe("отменённая работой не считается", () => {
  it("в факт расчёта не идёт", () => {
    expect(runsOfFunc([done()], "f1")).toHaveLength(1);
    expect(runsOfFunc([done({ canceled: true })], "f1")).toHaveLength(0);
  });

  it("вещей не порождает: единицы с номерами по ней не заводятся", () => {
    // Сдача есть, но решение — «этого не делаем»: вещи, которой в деле нет,
    // номера не дают.
    expect(unitsOf({ tasks: [done()], funcs: [] })).toHaveLength(1);
    expect(unitsOf({ tasks: [done({ canceled: true })], funcs: [] })).toHaveLength(0);
  });

  it("взятое ею не считается израсходованным", () => {
    expect(doneBy([done()], "f1")).toEqual({ t1: 1 });
    expect(doneBy([done({ canceled: true })], "f1")).toEqual({});
  });

  it("в историю человека не идёт", () => {
    expect(historyOf([done()], [], "p1")).toHaveLength(1);
    expect(historyOf([done({ canceled: true })], [], "p1")).toHaveLength(0);
  });

  it("в фактическую оценку отчёта не идёт", () => {
    const model = {
      traits: [{ id: "t1", e: "e1", l: "вход" }, { id: "t2", e: "e1", l: "выход" }],
      funcs: [normalizeFunc({ id: "f1", e: "e1", dur: 1, durHi: 1, durUnit: "ч",
        takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }] })],
      tasks: [done({ canceled: true })],
    };
    const chain = chainOf(model, { from: "t1", upto: "" });
    const act = actualOf(model, chain, { only: new Set(["tk1"]) });
    // Задача в списке осталась — а факта по ней нет.
    expect(act.tasks).toHaveLength(1);
    expect(act.done).toBe(0);
    expect(act.any).toBe(false);
    expect(act.hours).toBe(0);
  });

  it("время её больше не трогает: краснеть «Дедлайном» ей не за что", () => {
    const late = { ...newTask({ funcId: "f1", title: "Работа" }), status: "progress",
      end: "2020-01-01T10:00", taken: true };
    expect(autoStatus(late, {})).toBe("deadline");
    expect(autoStatus({ ...late, canceled: true }, {})).toBe("progress");
  });

  it("новая задача заводится не отменённой", () => {
    expect(newTask({ funcId: "f1" }).canceled).toBe(false);
  });
});
