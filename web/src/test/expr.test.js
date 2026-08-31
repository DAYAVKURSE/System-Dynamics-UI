import { describe, expect, it } from "vitest";
import { evaluate, toDisplay, toStorage, refsOf } from "../lib/expr.js";

const VALUES = { r5: 10, u9: 200, m2: 18000, zero: 0 };
const valueOf = (id) => VALUES[id];
const val = (src) => evaluate(src, valueOf).value;
const err = (src) => evaluate(src, valueOf).error;

describe("числа и арифметика", () => {
  it("считает простое число", () => {
    expect(val("5")).toBe(5);
    expect(val("  42  ")).toBe(42);
  });

  it("понимает дробные и запятую как разделитель", () => {
    expect(val("2.5")).toBe(2.5);
    expect(val("2,5")).toBe(2.5); // на телефоне запятую набрать проще
  });

  it("складывает, вычитает, умножает и делит", () => {
    expect(val("2 + 3")).toBe(5);
    expect(val("10 - 4")).toBe(6);
    expect(val("6 * 7")).toBe(42);
    expect(val("20 / 4")).toBe(5);
  });

  it("соблюдает приоритет операций", () => {
    expect(val("2 + 3 * 4")).toBe(14);
    expect(val("10 - 2 * 3")).toBe(4);
  });

  it("учитывает скобки", () => {
    expect(val("(2 + 3) * 4")).toBe(20);
    expect(val("100 / (2 + 3)")).toBe(20);
  });

  it("понимает унарный минус", () => {
    expect(val("-5")).toBe(-5);
    expect(val("10 + -3")).toBe(7);
    expect(val("-(2 + 3)")).toBe(-5);
  });
});

describe("ссылки на ресурсы", () => {
  it("подставляет значение ресурса", () => {
    expect(val("{r5}")).toBe(10);
  });

  it("считает выражение с ресурсом и числом", () => {
    expect(val("{r5} * 2")).toBe(20);
    expect(val("{u9} / 100 + 5")).toBe(7);
  });

  it("считает выражение с несколькими ресурсами", () => {
    expect(val("{u9} / {r5}")).toBe(20);
    expect(val("({r5} + {u9}) * 2")).toBe(420);
  });

  it("сообщает о неизвестном ресурсе, а не молча считает нулём", () => {
    expect(err("{нетТакого}")).toMatch(/не найден/);
  });
});

describe("ошибки разбора", () => {
  it("пустое выражение — это ошибка, а не ноль", () => {
    expect(err("")).toBeTruthy();
    expect(err("   ")).toBeTruthy();
  });

  it("ловит незакрытую скобку", () => {
    expect(err("(2 + 3")).toMatch(/скобка/);
  });

  it("ловит обрыв выражения", () => {
    expect(err("2 +")).toMatch(/обрывается/);
  });

  it("ловит лишнее в конце", () => {
    expect(err("2 3")).toMatch(/лишнее/);
  });

  it("ловит непонятный символ", () => {
    expect(err("2 $ 3")).toMatch(/непонятный/);
  });

  it("ловит незакрытую ссылку", () => {
    expect(err("{r5")).toMatch(/незакрытая/);
  });

  it("нераспознанное имя в квадратных скобках объясняется по-человечески", () => {
    expect(err("[активные реферы] * 2")).toMatch(/неизвестный ресурс/);
  });

  it("деление на ноль не даёт бесконечность", () => {
    // В модели «делить на ноль» почти всегда значит «нет данных».
    expect(err("10 / 0")).toMatch(/ноль/);
    expect(err("10 / {zero}")).toMatch(/ноль/);
  });

  it("битое выражение не бросает исключение", () => {
    expect(() => evaluate("((((", valueOf)).not.toThrow();
    expect(() => evaluate(null, valueOf)).not.toThrow();
    expect(() => evaluate(undefined, valueOf)).not.toThrow();
  });
});

describe("ссылки: id ⇄ имя", () => {
  const names = { r5: "активные реферы", u9: "активные пользователи" };
  const nameOf = (id) => names[id];
  const idOf = (name) => Object.keys(names).find((k) => names[k] === name) || null;

  it("для показа подставляет имена вместо id", () => {
    expect(toDisplay("{r5} * 2", nameOf)).toBe("[активные реферы] * 2");
    expect(toDisplay("{r5} + {u9}", nameOf))
      .toBe("[активные реферы] + [активные пользователи]");
  });

  it("для хранения подставляет id вместо имён", () => {
    expect(toStorage("[активные реферы] * 2", idOf)).toBe("{r5} * 2");
  });

  it("переименование ресурса не ломает выражение", () => {
    // Хранится id, поэтому после переименования выражение продолжает
    // указывать на ту же величину и показывает уже новое имя.
    const stored = toStorage("[активные реферы] * 2", idOf);
    const renamed = (id) => (id === "r5" ? "ядро рефералов" : names[id]);
    expect(toDisplay(stored, renamed)).toBe("[ядро рефералов] * 2");
    expect(evaluate(stored, valueOf).value).toBe(20);
  });

  it("неузнанное имя остаётся видимым, а не пропадает молча", () => {
    expect(toStorage("[неизвестно] + 1", idOf)).toBe("[неизвестно] + 1");
  });

  it("удалённый ресурс показывается вопросом", () => {
    expect(toDisplay("{удалён}", nameOf)).toBe("[?]");
  });

  it("перевод туда и обратно ничего не теряет", () => {
    const stored = "{r5} * 2 + {u9} / 100";
    expect(toStorage(toDisplay(stored, nameOf), idOf)).toBe(stored);
  });

  it("находит все использованные ресурсы", () => {
    expect(refsOf("{r5} * 2 + {u9}")).toEqual(["r5", "u9"]);
    expect(refsOf("5 + 3")).toEqual([]);
  });
});
