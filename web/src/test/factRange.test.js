import { describe, expect, it } from "vitest";
import { factOf, flowsFrom, inRange } from "../lib/funcs.js";

/* План живёт на стрелке (вилка-гипотеза), факт — в сдаче задачи. Держим
   порознь: сложи их в одно поле, план исчез бы ровно тогда, когда с ним
   впервые можно сравнить. */

describe("стрелки элемента", () => {
  it("берутся только выходящие: элемент передаёт дальше то, что отдал", () => {
    const flows = [{ id: "w1", from: "f1" }, { id: "w2", from: "f2" }, { id: "w3", from: "f1" }];
    expect(flowsFrom("f1", flows).map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(flowsFrom("нет", flows)).toEqual([]);
  });
});

describe("факт против гипотезы", () => {
  it("внутри вилки — сошлось", () => {
    expect(inRange({ lo: 3, hi: 5 }, 4)).toBe(true);
    expect(inRange({ lo: 3, hi: 5 }, 3)).toBe(true);
    expect(inRange({ lo: 3, hi: 5 }, 5)).toBe(true);
  });

  it("мимо вилки — не сошлось, но это не запрет", () => {
    // Жизнь не обязана попадать в гипотезу; запрет заставил бы врать в
    // отчёте. Проверяющий это увидит — и только.
    expect(inRange({ lo: 3, hi: 5 }, 2)).toBe(false);
    expect(inRange({ lo: 3, hi: 5 }, 6)).toBe(false);
  });

  it("односторонняя вилка сравнивается только со своей стороной", () => {
    expect(inRange({ lo: 3, hi: 0 }, 100)).toBe(true);
    expect(inRange({ lo: 3, hi: 0 }, 1)).toBe(false);
    expect(inRange({ lo: 0, hi: 5 }, 1)).toBe(true);
    expect(inRange({ lo: 0, hi: 5 }, 9)).toBe(false);
  });

  it("вилки нет — сравнивать не с чем, и это не «не сошлось»", () => {
    expect(inRange({ lo: 0, hi: 0 }, 7)).toBeNull();
    expect(inRange(null, 7)).toBeNull();
  });
});

describe("факт из сдачи", () => {
  it("находится по стрелке, а отсутствие факта — это null, а не ноль", () => {
    const sub = { facts: [{ flow: "w1", amount: 4 }] };
    expect(factOf(sub, "w1")).toBe(4);
    // Ноль означал бы «ничего не потратили», а его никто не вводил.
    expect(factOf(sub, "w2")).toBeNull();
    expect(factOf(null, "w1")).toBeNull();
  });
});
