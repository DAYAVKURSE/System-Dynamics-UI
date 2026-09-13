import { describe, expect, it } from "vitest";
import { NEED_NUMBERS, parseNumbered } from "../lib/formText.js";

/* Анкета принимается пронумерованным списком: строка «N. вопрос» — вопрос,
   строка без номера — продолжение предыдущего, текст без номеров — отказ
   словами. */
describe("анкета из пронумерованного списка", () => {
  it("строка с номером — вопрос; номер, точка, скобка или двоеточие", () => {
    expect(parseNumbered("1. Стек\n2) Уровень\n3: Город\n10. Опыт").questions)
      .toEqual(["Стек", "Уровень", "Город", "Опыт"]);
  });

  it("строка без номера продолжает предыдущий вопрос, пустые строки не в счёт", () => {
    const r = parseNumbered("1. Какие\n  проекты делали?\n\n2. Уровень\r\n");
    expect(r).toEqual({ questions: ["Какие проекты делали?", "Уровень"], error: "" });
  });

  it("без единого номера — отказ словами; пустой текст — просто пусто", () => {
    expect(parseNumbered("Стек\nУровень")).toEqual({ questions: [], error: NEED_NUMBERS });
    expect(parseNumbered("   ")).toEqual({ questions: [], error: "" });
    expect(parseNumbered(null).questions).toEqual([]);
  });

  it("число внутри вопроса — не номер: «1. Сколько 2 раза» — один вопрос", () => {
    expect(parseNumbered("1. Сколько 2 раза\n2 года\n2. Второй").questions)
      .toEqual(["Сколько 2 раза 2 года", "Второй"]);
  });
});
