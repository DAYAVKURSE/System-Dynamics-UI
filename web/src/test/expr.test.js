import { describe, expect, it } from "vitest";
import { evalExpr, fromQty, goalOf, parseExpr, refsOf, splitOp, toShown, toStored }
  from "../lib/expr.js";

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
    expect(r).toEqual({ op: "=", value: 18, error: "" });
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
