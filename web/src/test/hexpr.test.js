import { describe, expect, it } from "vitest";
import {
  arrowEnds, exprGaps, exprToEdges, exprText, negate, newToken, readExpr,
} from "../lib/hexpr.js";

/* Гипотеза — выражение из элементов; раскладывается в обычные стрелки. */

const TRAITS = [
  { id: "t1", e: "a", l: "рабочее время", unit: "ч", per: "мес", flow: true },
  { id: "t2", e: "b", l: "заявки", unit: "шт", per: "мес", flow: true },
  { id: "t3", e: "b", l: "деньги", unit: "₽", flow: false },
];

const res = (trait) => newToken("res", { trait });
const txt = (text) => newToken("text", { text });
const op = (o, patch) => newToken("op", { op: o, ...patch });
const arr = (patch) => newToken("arrow", { gives: 5, ...patch });

describe("концы стрелки", () => {
  it("берутся у соседних ресурсов", () => {
    const tk = [res("t1"), arr(), res("t2")];
    expect(arrowEnds(tk, 1)).toEqual({ from: "t1", to: "t2" });
  });

  it("без ресурса слева движение приходит извне модели", () => {
    const tk = [arr(), res("t2")];
    expect(arrowEnds(tk, 0)).toEqual({ from: null, to: "t2" });
  });

  it("две стрелки подряд не делят один ресурс — вторая приходит извне", () => {
    // [t1] → → [t2]: между стрелками ресурса нет, и брать источник у первой
    // нельзя — иначе один и тот же час работы утёк бы дважды.
    const tk = [res("t1"), arr(), arr(), res("t2")];
    expect(arrowEnds(tk, 2)).toEqual({ from: null, to: "t2" });
    // Симметрично справа: у первой стрелки приёмника нет.
    expect(arrowEnds(tk, 1)).toEqual({ from: "t1", to: null });
  });

  it("чужая стрелка не становится концом — цепочка не склеивается", () => {
    // [t1] → [t2] → [t3]: у второй стрелки слева именно t2, а не t1.
    const tk = [res("t1"), arr(), res("t2"), arr(), res("t3")];
    expect(arrowEnds(tk, 3)).toEqual({ from: "t2", to: "t3" });
  });
});

describe("разбор участков", () => {
  it("«если» собирает условие до своей первой стрелки", () => {
    const tk = [op("if"), res("t3"), txt(">"), txt("100"),
      res("t1"), arr(), res("t2")];
    const parts = readExpr(tk);
    expect(parts).toHaveLength(1);
    expect(parts[0].cond).toBe("{t3} > 100");
    expect(parts[0].arrows).toHaveLength(1);
  });

  it("«иначе» получает перевёрнутое условие, а не пустое", () => {
    const tk = [op("if"), res("t3"), txt(">"), txt("100"), res("t1"), arr(), res("t2"),
      op("else"), res("t1"), arr(), res("t3")];
    const parts = readExpr(tk);
    expect(parts[0].cond).toBe("{t3} > 100");
    expect(parts[1].cond).toBe("{t3} <= 100");
  });

  it("«повторить N» задаёт число повторов участка", () => {
    const parts = readExpr([op("for", { times: 3 }), res("t1"), arr(), res("t2")]);
    expect(parts[0].times).toBe(3);
  });

  it("движения без оператора — отдельный участок без условия", () => {
    const parts = readExpr([res("t1"), arr(), res("t2")]);
    expect(parts).toHaveLength(1);
    expect(parts[0].cond).toBe("");
    expect(parts[0].op).toBeNull();
  });
});

describe("отрицание условия", () => {
  it("переворачивает знак сравнения", () => {
    expect(negate("{a} > 10")).toBe("{a} <= 10");
    expect(negate("{a} <= 10")).toBe("{a} > 10");
    expect(negate("{a} = 10")).toBe("{a} ≠ 10");
  });
  it("без сравнения переворачивать нечего", () => {
    expect(negate("{a} + 1")).toBe("");
    expect(negate("")).toBe("");
  });
});

describe("чего не хватает", () => {
  const ok = [op("if"), res("t3"), txt(">"), txt("100"), res("t1"), arr(), res("t2")];

  it("готовое выражение не жалуется", () => {
    expect(exprGaps(ok, TRAITS)).toEqual([]);
  });

  it("без стрелки движений нет", () => {
    expect(exprGaps([res("t1"), txt("+"), txt("1")], TRAITS).join(" "))
      .toMatch(/нет ни одной стрелки/);
  });

  it("стрелка без ресурса справа никуда не переносит", () => {
    expect(exprGaps([res("t1"), arr()], TRAITS).join(" ")).toMatch(/некуда переносить/);
  });

  it("стрелка сама в себя не имеет смысла", () => {
    expect(exprGaps([res("t1"), arr(), res("t1")], TRAITS).join(" "))
      .toMatch(/сам в себя/);
  });

  it("нулевое количество — это не движение", () => {
    expect(exprGaps([res("t1"), arr({ gives: 0 }), res("t2")], TRAITS).join(" "))
      .toMatch(/сколько переносится/);
  });

  it("«если» без условия ничего не решает", () => {
    expect(exprGaps([op("if"), res("t1"), arr(), res("t2")], TRAITS).join(" "))
      .toMatch(/не написано условие/);
  });

  it("«иначе» без сравнения выше не к чему отнести", () => {
    expect(exprGaps([op("else"), res("t1"), arr(), res("t2")], TRAITS).join(" "))
      .toMatch(/не к чему отнести/);
  });

  it("ссылка на удалённый ресурс замечается", () => {
    const tk = [res("нет-такого"), arr(), res("t2")];
    expect(exprGaps(tk, TRAITS).join(" ")).toMatch(/удалённый ресурс/);
  });
});

describe("раскладка в стрелки модели", () => {
  it("условие участка становится условием стрелки", () => {
    const tk = [op("if"), res("t3"), txt(">"), txt("100"),
      res("t1"), arr({ gives: 5, per: "день" }), res("t2")];
    const [ed] = exprToEdges(tk, TRAITS);
    expect(ed.from).toBe("a");        // актив ресурса слева
    expect(ed.fromTrait).toBe("t1");
    expect(ed.to).toBe("t2");
    expect(ed.gives).toBe(5);
    expect(ed.per).toBe("день");
    expect(ed.conds).toEqual([{ expr: "{t3} > 100" }]);
    expect(ed.basis).toBe("hypo");
  });

  it("две ветки дают две стрелки с противоположными условиями", () => {
    const tk = [op("if"), res("t3"), txt(">"), txt("100"), res("t1"), arr(), res("t2"),
      op("else"), res("t1"), arr(), res("t3")];
    const eds = exprToEdges(tk, TRAITS);
    expect(eds).toHaveLength(2);
    expect(eds[0].conds[0].expr).toBe("{t3} > 100");
    expect(eds[1].conds[0].expr).toBe("{t3} <= 100");
  });

  it("«повторить N» умножает потоки, а не количество за попытку", () => {
    const tk = [op("for", { times: 3 }), res("t1"), arr({ gives: 5, threads: 2 }), res("t2")];
    const [ed] = exprToEdges(tk, TRAITS);
    expect(ed.threads).toBe(6);
    expect(ed.gives).toBe(5);
  });

  it("параметры исполнения доезжают до стрелки целиком", () => {
    const tk = [res("t1"), arr({ gives: 1, start: "2026-01-01T09:00",
      end: "2026-03-01T18:00", report: true, repeat: "approved", threads: 4 }), res("t2")];
    const [ed] = exprToEdges(tk, TRAITS);
    expect(ed.start).toBe("2026-01-01T09:00");
    expect(ed.end).toBe("2026-03-01T18:00");
    expect(ed.report).toBe(true);
    expect(ed.repeat).toBe("approved");
    expect(ed.threads).toBe(4);
  });

  it("стрелка без ресурса слева — приход извне, актив берётся у приёмника", () => {
    const [ed] = exprToEdges([arr({ gives: 2 }), res("t2")], TRAITS);
    expect(ed.fromTrait).toBeNull();
    expect(ed.from).toBe("b");
  });

  it("«купирует» — это знак, а не отрицательное количество", () => {
    const [ed] = exprToEdges([res("t1"), arr({ gives: -5, sign: -1 }), res("t2")], TRAITS);
    expect(ed.sign).toBe(-1);
    expect(ed.gives).toBe(5);
  });
});

describe("выражение словами", () => {
  it("называет ресурсы по именам, а операторы по-русски", () => {
    const tk = [op("if"), res("t3"), txt(">"), txt("100"), res("t1"), arr(), res("t2")];
    const s = exprText(tk, TRAITS);
    expect(s).toBe("если [деньги] > 100 [рабочее время] → [заявки]");
  });

  it("невыбранный ресурс так и назван, а не пропущен молча", () => {
    expect(exprText([newToken("res")], TRAITS)).toBe("[ресурс]");
  });
});
