import { describe, expect, it } from "vitest";
import { stockOf, withStock } from "../lib/stock.js";

/* Зеркало `stockOf` клиента (`web/src/lib/units.js`): те же случаи, что в
   `web/src/test/materials.test.js`, чтобы сервер и форма не разошлись. */

const F = { id: "f1", takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }] };
const done = (id, { takes = {}, gives = {}, status = "done", canceled } = {}) => ({
  id, funcId: "f1", status, canceled, submissions: [{ takes, gives }],
});

describe("сколько есть — по материалам и сдачам", () => {
  it("материалы плюс принятые сдачи минус расход", () => {
    const materials = [{ id: "m1", trait: "t1", kind: "text", qty: 5 }];
    const tasks = [
      done("a", { takes: { t1: 2 }, gives: { t2: 1 } }),
      done("b", { takes: { t1: 1 }, gives: { t2: 1 }, status: "review" }),
      done("c", { takes: { t1: 1 }, gives: { t2: 1 }, canceled: true }),
    ];
    // «b» на проверке: функция сначала берёт — взятое выдано при взятии (по сдаче, 1).
    expect(stockOf({ tasks, funcs: [F], materials })).toEqual({ t1: 2, t2: 1 });
    // У функции, что сначала отдаёт, взятое уходит только после проверки.
    const giveFirst = { ...F, steps: [{ kind: "give", ports: [] }, { kind: "take", ports: [] }] };
    expect(stockOf({ tasks, funcs: [giveFirst], materials })).toEqual({ t1: 3, t2: 1 });
    // В работе без сдачи — списывается план (`lo`).
    expect(stockOf({ tasks: [{ id: "d", funcId: "f1", status: "progress", taken: true, submissions: [] }], funcs: [F], materials })).toEqual({ t1: 4 });
  });

  it("нерасходуемый вход не уменьшает; ниже нуля не бывает; записанное число не читается", () => {
    const f = { ...F, takes: [{ trait: "t1", lo: 1, hi: 1, spend: false }] };
    const materials = [{ id: "m1", trait: "t1", kind: "text", qty: 1 }];
    expect(stockOf({ tasks: [done("a", { takes: { t1: 1 } })], funcs: [f], materials })).toEqual({ t1: 1 });
    expect(stockOf({ tasks: [done("a", { takes: { t1: 9 } })], funcs: [F], materials })).toEqual({ t1: 0 });
    const traits = [{ id: "t1", have: 3000 }, { id: "t2", have: 7 }];
    expect(withStock({ traits, tasks: [], funcs: [F], materials }).map((t) => t.have)).toEqual([1, 0]);
  });

  it("чужая запись: количество меньше единицы читается как одна, без ресурса — не считается", () => {
    expect(stockOf({ materials: [{ trait: "t1", qty: 0 }, { trait: "t1" }, { kind: "text" }, null] }))
      .toEqual({ t1: 2 });
  });
});
