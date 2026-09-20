import { describe, expect, it } from "vitest";
import { conceptsOf, nameHints, nearest, search, similarity, stem } from "../lib/semantic.js";

/* ПОИСК ПО СМЫСЛУ (владелец, 2026-09-20): «если у меня есть услуга
   „Разработка", а в поиск я ввожу „программирование", то этот поиск
   должен найти услугу по разработке». */

const ITEMS = [
  { id: "1", name: "Разработка", text: "сделаю сайт под ключ" },
  { id: "2", name: "Дизайн логотипа", text: "фирменный стиль и макеты" },
  { id: "3", name: "Доставка грузов", text: "по городу и области" },
  { id: "4", name: "Копирайтинг", text: "тексты и статьи" },
  { id: "5", name: "Вёрстка лендинга", text: "адаптивная" },
];
const names = (rows) => rows.map((r) => r.item.name);

describe("смысл, а не буквы", () => {
  it("«программирование» находит «Разработку»", () => {
    expect(names(search("программирование", ITEMS))).toContain("Разработка");
  });

  it("«перевозка» находит «Доставку», «лого» — «Дизайн логотипа»", () => {
    expect(names(search("перевозка", ITEMS))[0]).toBe("Доставка грузов");
    expect(names(search("лого", ITEMS))[0]).toBe("Дизайн логотипа");
  });

  it("«тексты» находит «Копирайтинг» — общих букв там нет", () => {
    expect(names(search("написать тексты", ITEMS))[0]).toBe("Копирайтинг");
  });

  it("чего нет — того нет: выдумывать совпадение нельзя", () => {
    expect(search("бухгалтерия и налоги", ITEMS)).toEqual([]);
    expect(search("", ITEMS)).toEqual([]);
    expect(search("что-нибудь", [])).toEqual([]);
  });

  it("формы одного слова — одно и то же", () => {
    expect(stem("разработка")).toBe(stem("разработки"));
    expect(similarity("дизайнер", "дизайнеров")).toBeGreaterThan(0.6);
    expect(similarity("Разработка сайта", "разработке сайтов")).toBeGreaterThan(0.8);
  });

  it("понятие у слова берётся по основе", () => {
    expect(conceptsOf("программ")).toContain("dev");
    expect(conceptsOf("логист")).toContain("logistics");
    expect(conceptsOf("абракадабр")).toEqual([]);
  });
});

describe("ближайшее по смыслу", () => {
  it("к «Разработке» ближе «Вёрстка», чем «Доставка»", () => {
    const near = names(nearest(ITEMS[0], ITEMS));
    expect(near[0]).toBe("Вёрстка лендинга");
    expect(near.indexOf("Вёрстка лендинга")).toBeLessThan(
      near.indexOf("Доставка грузов") === -1 ? 99 : near.indexOf("Доставка грузов"));
  });

  it("сам себя в соседях не показывает", () => {
    expect(names(nearest(ITEMS[0], ITEMS))).not.toContain("Разработка");
    expect(nearest(null, ITEMS)).toEqual([]);
  });
});

describe("готовые названия", () => {
  it("подсказывает близкое, но не то же самое, что набрали", () => {
    const hints = nameHints("разраб", ITEMS).map((h) => h.name);
    expect(hints).toContain("Разработка");
    // Уже набранное целиком не подсказывается: брать нечего.
    expect(nameHints("Разработка", ITEMS).map((h) => h.name)).not.toContain("Разработка");
  });

  it("одна буква ничего не подсказывает: это ещё не слово", () => {
    expect(nameHints("р", ITEMS)).toEqual([]);
  });

  it("повторяющееся название показывается один раз", () => {
    const twice = [...ITEMS, { id: "6", name: "Разработка", text: "ещё одна" }];
    expect(nameHints("программирование", twice).filter((h) => h.name === "Разработка"))
      .toHaveLength(1);
  });
});
