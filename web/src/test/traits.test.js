import { describe, expect, it } from "vitest";
import { countKind, dropKind, hasKind, kindIdsOf, toggleKind } from "../lib/traits.js";

/* КЛАССИФИКАЦИИ РЕСУРСА · их может быть несколько.

   Одна вещь бывает сразу нескольких видов: деньги — и ресурс, и затрата.
   Пока классификация была одна, человеку приходилось выбирать, какой
   правдой пожертвовать. Считать классификация по-прежнему ничего не
   считает (инвариант 9) — она говорит, чем человек считает эту вещь. */

describe("несколько классификаций у одного ресурса", () => {
  it("ставятся и снимаются по одной, не мешая друг другу", () => {
    let t = { id: "t1", l: "деньги" };
    t = toggleKind(t, "res");
    t = toggleKind(t, "cost");
    expect(kindIdsOf(t)).toEqual(["res", "cost"]);
    expect(hasKind(t, "res")).toBe(true);

    t = toggleKind(t, "res");
    expect(kindIdsOf(t)).toEqual(["cost"]);
    expect(hasKind(t, "res")).toBe(false);
  });

  it("прежняя запись с одним полем читается как список из одного", () => {
    // Сохранённые модели не переписываются: чтение мягкое.
    expect(kindIdsOf({ k: "growth" })).toEqual(["growth"]);
    expect(hasKind({ k: "growth" }, "growth")).toBe(true);
    // И дописать к ней вторую можно, ничего не потеряв.
    expect(kindIdsOf(toggleKind({ k: "growth" }, "cost"))).toEqual(["growth", "cost"]);
  });

  it("старое поле не разъезжается с новым: в нём всегда первая из списка", () => {
    /* Его ещё читают снимок для помощника и чужие сценарии. Две записи про
       одно и то же обязаны сходиться, иначе непонятно, какой верить. */
    const t = toggleKind(toggleKind({}, "res"), "cost");
    expect(t.k).toBe("res");
    expect(toggleKind(t, "res").k).toBe("cost");
    expect(toggleKind(toggleKind(t, "res"), "cost").k).toBe("");
  });

  it("ни одной классификации — это ответ, а не поломка", () => {
    // «Не сказано» честнее выдуманного: подставлять первую попавшуюся не за что.
    expect(kindIdsOf({})).toEqual([]);
    expect(kindIdsOf({ k: "" })).toEqual([]);
  });

  it("повтор не задваивается", () => {
    expect(kindIdsOf({ ks: ["res", "res", "cost"] })).toEqual(["res", "cost"]);
  });

  it("удаление вида снимает его со всех ресурсов, остальные не трогает", () => {
    const traits = [
      { id: "t1", ks: ["res", "cost"] },
      { id: "t2", k: "cost" },
      { id: "t3", ks: ["res"] },
    ];
    expect(countKind(traits, "cost")).toBe(2);
    const after = dropKind(traits, "cost");
    expect(kindIdsOf(after[0])).toEqual(["res"]);
    expect(kindIdsOf(after[1])).toEqual([]);
    // Тот, кого удаление не касалось, остаётся тем же объектом.
    expect(after[2]).toBe(traits[2]);
  });
});
