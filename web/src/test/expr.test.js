import { describe, expect, it } from "vitest";
import { evalExpr, evalPorts, fromQty, goalOf, letterIndex, letterOf, lettersIn, parseExpr, refsOf,
  splitOp, toShown, toStored } from "../lib/expr.js";

/* ВЫРАЖЕНИЕ ЦЕЛИ: знак, числа, действия и ссылки на другие ресурсы.
   Ссылка хранится по идентификатору и показывается по имени. */

const TRAITS = [{ id: "t1", l: "Заявки" }, { id: "t2", l: "Заявки в работе" }, { id: "t3", l: "Договоры" }];
const STOCK = { t1: 10, t2: 4, t3: 2 };

describe("разбор", () => {
  it("знак первым; без знака — «ровно», как у прежней числовой цели", () => {
    expect(splitOp(">10")).toEqual({ op: ">", rest: "10" });
    expect(splitOp(" ! 3 ")).toEqual({ op: "!", rest: "3" });
    expect(splitOp("7")).toEqual({ op: "=", rest: "7" });
    expect(fromQty(5)).toBe("=5");
    expect(fromQty("")).toBe("");
  });

  it("числа, четыре действия, скобки, минус, дробная запятая", () => {
    expect(evalExpr("=2+3*4").value).toBe(14);
    expect(evalExpr(">(2+3)*4").value).toBe(20);
    expect(evalExpr("=-2+10/4").value).toBe(0.5);
    expect(evalExpr("=1,5*2").value).toBe(3);
  });

  it("ссылки — по идентификатору, сколько угодно", () => {
    expect(refsOf("=@{t1}+@{t2}*2-@{t1}")).toEqual(["t1", "t2"]);
    const r = evalExpr("=@{t1}+@{t2}*2", (id) => STOCK[id]);
    expect(r).toMatchObject({ op: "=", value: 18, lo: 18, hi: 18, error: "" });
  });

  it("ошибка — словами и с позицией, а не нулём", () => {
    expect(parseExpr("=2+").error).toMatch(/ожидалось число/);
    expect(parseExpr("=(2+3").error).toMatch(/скобк/);
    expect(parseExpr("=2 3").error).toMatch(/лишнее/);
    expect(parseExpr("=@Заявки").error).toMatch(/не выбран из списка/);
    expect(evalExpr("=@{нет}", () => undefined).error).toMatch(/удалён/);
    expect(evalExpr("=1/0").error).toMatch(/ноль/);
    expect(evalExpr("=1/0").value).toBeNull();
    // Пусто — не ошибка: цель ещё не задана.
    expect(parseExpr("")).toEqual({ op: "=", ast: null, error: "" });
  });
});

describe("что цель значит", () => {
  it("«=» и «>» дают число для плана; «<» и «!» — только условие", () => {
    expect(goalOf("=@{t3}*5", STOCK, 4)).toMatchObject({ op: "=", value: 10, target: 10, met: false });
    expect(goalOf(">10", STOCK, 11)).toMatchObject({ target: 10, met: true });
    expect(goalOf(">10", STOCK, 10).met).toBe(false);
    expect(goalOf("<@{t1}", STOCK, 3)).toMatchObject({ target: null, met: true });
    expect(goalOf("!2", STOCK, 2)).toMatchObject({ target: null, met: false });
    expect(goalOf("!2", STOCK, 3).met).toBe(true);
    // Остаток не дан — выполнено ли, не сказать.
    expect(goalOf("=5", STOCK).met).toBeNull();
    // Ошибка — ни цели, ни ответа.
    expect(goalOf("=@{x}", STOCK, 1)).toMatchObject({ target: null, met: null });
  });
});

describe("имя ↔ идентификатор", () => {
  it("в записи — идентификаторы, на экране — имена", () => {
    expect(toStored(">@Заявки*2", TRAITS)).toBe(">@{t1}*2");
    expect(toShown(">@{t1}*2", (id) => TRAITS.find((t) => t.id === id)?.l)).toBe(">@Заявки*2");
    expect(toShown("=@{нет}", () => "")).toBe("=@?");
  });

  it("самое длинное имя: «Заявки в работе» — не «Заявки» и хвост", () => {
    expect(toStored("=@Заявки в работе+@Заявки", TRAITS)).toBe("=@{t2}+@{t1}");
    expect(evalExpr(toStored("=@Заявки в работе+@Заявки", TRAITS), (id) => STOCK[id]).value).toBe(14);
  });

  it("неузнанное имя остаётся как есть — и разбор скажет, что ресурс не выбран", () => {
    expect(toStored("=@Нет такого", TRAITS)).toBe("=@Нет такого");
    expect(parseExpr(toStored("=@Нет такого", TRAITS)).error).toMatch(/не выбран/);
    // Уже записанная ссылка не портится.
    expect(toStored("=@{t1}", TRAITS)).toBe("=@{t1}");
  });
});

describe("процент (владелец, 2026-09-15: операции)", () => {
  it("«20%» — 0,2; «20% @ресурс» — процент от ресурса; «@ресурс*20%» — то же", () => {
    expect(evalExpr("=20%").value).toBe(0.2);
    expect(evalExpr("> 20% @{t1}", (id) => STOCK[id]).value).toBe(2);
    expect(evalExpr("=@{t1}*20%", (id) => STOCK[id]).value).toBe(2);
    expect(evalExpr("=50% (2+8)").value).toBe(5);
    expect(evalExpr("=10 + 50% 4").value).toBe(12);
  });
  it("процент без числа — ошибка словами", () => {
    expect(parseExpr("=%").error).toMatch(/не понимаю/);
  });
});

describe("буквы ресурсов и диапазоны (владелец, 2026-09-15)", () => {
  const PORTS = [{ id: "p1", lo: 1000, hi: 1000 }, { id: "p2", lo: 1, hi: 1, expr: "50% A" }];
  it("буквы — заглавные латинские по порядку: «A», «B», «C»; строчная читается так же; кириллица — не буква", () => {
    expect([0, 1, 2].map(letterOf)).toEqual(["A", "B", "C"]);
    expect(letterIndex("B")).toBe(1);
    expect(letterIndex("b")).toBe(1);
    expect(letterIndex("б")).toBe(-1);
    expect(letterIndex("ы")).toBe(-1);
    expect(lettersIn("50% A + b")).toEqual([0, 1]);
    expect(parseExpr("=50% б").error).toMatch(/не буква ресурса: буквы латинские/);
  });
  it("буква в операции — количество того ресурса; «50% A» — половина «A»", () => {
    const portOf = ({ i }) => (i === 0 ? { lo: 1000, hi: 1000 } : undefined);
    expect(evalExpr("=50% A", () => undefined, portOf).value).toBe(500);
    expect(evalExpr("=a/2", () => undefined, portOf).value).toBe(500);
    expect(evalExpr("=50% B", () => undefined, portOf).error).toMatch(/нет ресурса с буквой «B»/);
    // Слово из букв — не буква: ресурс пишут через @.
    expect(parseExpr("=abc").error).toMatch(/буква — одна/);
  });
  it("диапазон «45-55» — от и до; выражение даёт обе границы", () => {
    expect(evalExpr("=45-55")).toMatchObject({ value: 45, lo: 45, hi: 55, error: "" });
    expect(evalExpr("=45-55% A", () => undefined, () => ({ lo: 1000, hi: 1000 }))).toMatchObject({ lo: 450, hi: 550 });
    // Вычитаемое и делитель — наоборот, чтобы границы оставались границами.
    expect(evalExpr("=10-(2-4)")).toMatchObject({ lo: 6, hi: 8 });
    expect(evalExpr("=100/(2-4)")).toMatchObject({ lo: 25, hi: 50 });
    // Обычное вычитание без диапазона — как было.
    expect(evalExpr("=10 - 3").value).toBe(7);
    expect(evalExpr("=@{t1}-3", (id) => STOCK[id]).value).toBe(7);
  });
  it("цель с диапазоном: «=45-55» выполнена между границами, «>» — выше верхней", () => {
    expect(goalOf("=45-55", STOCK, 50)).toMatchObject({ target: 45, met: true });
    expect(goalOf("=45-55", STOCK, 60).met).toBe(false);
    expect(goalOf(">45-55", STOCK, 56)).toMatchObject({ target: 55, met: true });
    expect(goalOf("<45-55", STOCK, 44).met).toBe(true);
    expect(goalOf("!45-55", STOCK, 50).met).toBe(false);
  });
  it("количества портов считаются по операциям: буква — другой порт, он первым; круг — ошибка", () => {
    const r = evalPorts(PORTS);
    expect(r[0]).toMatchObject({ id: "p1", lo: 1000, hi: 1000, letter: "A", error: "" });
    expect(r[1]).toMatchObject({ id: "p2", lo: 500, hi: 500, letter: "B", error: "" });
    // По идентификатору порта — то же; диапазон тянется по цепочке; сотые.
    const chain = evalPorts([...PORTS, { id: "p3", expr: "#{p2}*45-55%" }, { id: "p4", expr: "#{p3}/3" }]);
    expect(chain[2]).toMatchObject({ lo: 225, hi: 275 });
    expect(chain[3]).toMatchObject({ lo: 75, hi: 91.67 });
    const loop = evalPorts([{ id: "x", expr: "B" }, { id: "y", expr: "A" }]);
    expect(loop.map((x) => x.error)).toEqual(["операции ссылаются друг на друга по кругу", "«A» не посчиталась"]);
    // Порт без операции остаётся со своими числами; убранный порт — ошибка словами.
    expect(evalPorts([{ id: "z", lo: 2, hi: 4 }])[0]).toMatchObject({ lo: 2, hi: 4, error: "" });
    expect(evalPorts([{ id: "z", expr: "#{нет}" }])[0].error).toMatch(/убран/);
  });
  it("в записи буква — `#{id}` порта, на экране — буква по его месту; буква внутри имени не трогается", () => {
    const ids = ["p1", "p2"];
    expect(toStored("50% a + @Заявки*B", TRAITS, ids)).toBe("50% #{p1} + @{t1}*#{p2}");
    expect(toStored("50% C", TRAITS, ids)).toBe("50% C");   // такого порта нет — как есть
    expect(toStored("=@Заявки в работе*2", TRAITS, ids)).toBe("=@{t2}*2");
    expect(toShown("50% #{p1} + @{t1}*#{p9}", (id) => TRAITS.find((t) => t.id === id)?.l, ids)).toBe("50% A + @Заявки*?");
  });
});
