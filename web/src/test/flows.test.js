import { describe, expect, it } from "vitest";
import { WHY_FLOW, checkFlow, newFlow, normalizeFlows, rangeText } from "../lib/funcs.js";

/* Поток — стрелка от одного функционального элемента к другому, несущая
   ресурс. Ресурс сам себя не передаёт: это делают элементы. У потока не
   одно число, а вилка гипотетических значений — факт появится позже, при
   сдаче задачи. */

const model = {
  funcs: [{ id: "f1", e: "A" }, { id: "f2", e: "A" }],
  traits: [{ id: "t1", e: "A" }],
};

describe("запись потока", () => {
  it("новый поток знает концы и ресурс, а вилка пока пуста", () => {
    const w = newFlow("f1", "f2", "t1");
    expect(w).toMatchObject({ from: "f1", to: "f2", trait: "t1", lo: 0, hi: 0 });
    expect(w.id).toBeTruthy();
  });

  it("чужая запись достраивается, а отсутствие списка — это пусто", () => {
    expect(normalizeFlows(undefined)).toEqual([]);
    const [w] = normalizeFlows([{ id: "w1", from: "f1", lo: "3", hi: "5" }]);
    expect(w).toMatchObject({ to: "", trait: "", lo: 3, hi: 5 });
  });
});

describe("вилка по-человечески", () => {
  it("читается словами, а не парой чисел", () => {
    expect(rangeText({ lo: 3, hi: 5 })).toBe("от 3 до 5");
    expect(rangeText({ lo: 4, hi: 4 })).toBe("ровно 4");
    expect(rangeText({ lo: 3, hi: 0 })).toBe("от 3");
    expect(rangeText({ lo: 0, hi: 5 })).toBe("до 5");
    // Незаданное — так и сказано: ноль здесь означал бы «ничего не будет».
    expect(rangeText({ lo: 0, hi: 0 })).toBe("сколько — не задано");
    expect(rangeText(null)).toBe("сколько — не задано");
  });
});

describe("годность потока", () => {
  const ok = (over) => checkFlow({ ...newFlow("f1", "f2", "t1"), lo: 1, hi: 2, ...over }, model).ok;

  it("оба конца, ресурс и вилка — годен", () => {
    expect(ok({})).toBe(true);
  });

  it("элемент сам в себя ничего не передаёт", () => {
    expect(ok({ to: "f1" })).toBe(false);
  });

  it("несуществующий конец или ресурс — не годен", () => {
    expect(ok({ to: "нет-такого" })).toBe(false);
    expect(ok({ trait: "нет-такого" })).toBe(false);
  });

  it("перевёрнутая вилка — не годна: молча она считалась бы как попало", () => {
    expect(ok({ lo: 5, hi: 3 })).toBe(false);
  });

  it("пустая вилка — не годна: стрелка без количества ничего не переносит", () => {
    expect(ok({ lo: 0, hi: 0 })).toBe(false);
  });

  it("объяснение говорит и про диапазон, и про то, что факт будет позже", () => {
    expect(checkFlow(null, model).why).toBe(WHY_FLOW);
    expect(WHY_FLOW).toMatch(/диапазон гипотетических значений/);
    expect(WHY_FLOW).toMatch(/при сдаче задачи/);
  });
});
