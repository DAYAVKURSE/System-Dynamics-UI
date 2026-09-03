import { describe, expect, it } from "vitest";
import { WHY_ASSET, WHY_FUNC, WHY_TRAIT, checkAsset, checkFunc, checkTrait }
  from "../lib/funcs.js";

/* Подписи «актив», «функциональный элемент», «ресурс» белые, пока строение
   сходится, и красные, когда нет. Здесь проверяются сами правила: цвет и
   модальное окно — дело интерфейса, а вот «сходится или нет» решается тут.

   Связи в этой модели идут ОТ АКТИВА к РЕСУРСУ: {from: актив, to: ресурс},
   и стрелка может потреблять ресурс-источник (fromTrait). */

const T = (id, e) => ({ id, e, l: id });
const model = {
  traits: [T("a1", "A"), T("a2", "A"), T("b1", "B")],
  edges: [],
  funcs: [],
};
const withEdges = (...edges) => ({ ...model, edges });

describe("актив", () => {
  it("годен, когда есть и вход извне, и выход наружу", () => {
    const m = withEdges({ from: "B", to: "a1" }, { from: "A", to: "b1" });
    expect(checkAsset("A", m).ok).toBe(true);
  });

  it("без входа извне — не годен", () => {
    expect(checkAsset("A", withEdges({ from: "A", to: "b1" })).ok).toBe(false);
  });

  it("без выхода наружу — не годен", () => {
    expect(checkAsset("A", withEdges({ from: "B", to: "a1" })).ok).toBe(false);
  });

  it("внутренние стрелки внешними не считаются", () => {
    // Актив, который варится сам в себе, ничего не берёт снаружи и ничего
    // наружу не отдаёт — это не актив.
    expect(checkAsset("A", withEdges({ from: "A", to: "a2" })).ok).toBe(false);
  });

  it("объяснение — дословно то, что дал владелец", () => {
    expect(checkAsset("A", model).why).toBe(WHY_ASSET);
    expect(WHY_ASSET).toMatch(/берёт один ресурс из внешней системы/);
  });
});

describe("ресурс", () => {
  const full = () => ({
    traits: model.traits,
    edges: [{ from: "B", to: "a1" }, { from: "A", to: "b1" }],
    funcs: [],
  });

  it("годен: к нему идёт извне, а из его актива уходит стрелка", () => {
    expect(checkTrait("a1", full()).ok).toBe(true);
  });

  it("некуда не идёт — не годен", () => {
    const m = { ...full(), edges: [{ from: "B", to: "a1" }] };
    expect(checkTrait("a1", m).ok).toBe(false);
  });

  it("к нему ничего не идёт — не годен", () => {
    expect(checkTrait("a2", full()).ok).toBe(false);
  });

  it("приходит только изнутри своего актива — «внутрь» не засчитано", () => {
    const m = { ...full(), edges: [{ from: "A", to: "a1" }, { from: "A", to: "b1" }] };
    expect(checkTrait("a1", m).ok).toBe(false);
  });

  it("функция своего актива засчитывается и как «к нему», и как «внутрь»", () => {
    const m = {
      traits: model.traits,
      edges: [{ from: "A", to: "b1" }],
      funcs: [{ id: "f1", e: "A", takes: [{ trait: "a2" }], gives: [{ trait: "a1" }] }],
    };
    expect(checkTrait("a1", m).ok).toBe(true);
  });

  it("ресурс, меняющий сам себя, — не годен: это делают элементы", () => {
    const m = { ...full(), edges: [...full().edges, { from: "A", to: "a1", fromTrait: "a1" }] };
    expect(checkTrait("a1", m).ok).toBe(false);
  });

  it("объяснение — дословно то, что дал владелец", () => {
    expect(checkTrait("a1", model).why).toBe(WHY_TRAIT);
    expect(WHY_TRAIT).toMatch(/не должен изменяться сам/);
  });
});

describe("функция", () => {
  // Годная функция — это ещё и вилки, и время: без них она выглядит
  // заполненной, но не говорит ни сколько уйдёт, ни когда будет готово.
  const P = (trait) => ({ id: `p${trait}`, trait, lo: 1, hi: 2 });
  const F = (takes, gives, e = "A", over = {}) => ({
    id: "f1", e, dur: 1, durUnit: "дн",
    takes: takes.map(P), gives: gives.map(P), ...over,
  });

  it("преобразование целиком внутри актива — годна", () => {
    expect(checkFunc(F(["a1"], ["a2"]), model).ok).toBe(true);
  });

  it("берёт несколько ресурсов и выдаёт несколько других — годна", () => {
    expect(checkFunc(F(["a1", "b1"], ["a2"]), model).ok).toBe(true);
  });

  it("ресурсы и внутрь, и наружу — годна: это и есть передача в другой актив", () => {
    expect(checkFunc(F(["b1"], ["a1"]), model).ok).toBe(true);
    expect(checkFunc(F(["a1"], ["b1"]), model).ok).toBe(true);
  });

  it("всё снаружи — не годна: тогда она не часть этого актива", () => {
    expect(checkFunc(F(["b1"], ["b1"]), model).ok).toBe(false);
  });

  it("ничего не берёт или ничего не выдаёт — не годна: она не преобразует ничего", () => {
    expect(checkFunc(F([], ["a1"]), model).ok).toBe(false);
    expect(checkFunc(F(["a1"], []), model).ok).toBe(false);
    expect(checkFunc(null, model).ok).toBe(false);
  });

  it("ссылка на удалённый ресурс — обрыв, а не «наружу»", () => {
    expect(checkFunc(F(["нет-такого"], ["a1"]), model).ok).toBe(false);
  });

  it("вилка без количества или перевёрнутая — не годна", () => {
    const f = F(["a1"], ["a2"]);
    expect(checkFunc({ ...f, takes: [{ trait: "a1", lo: 0, hi: 0 }] }, model).ok).toBe(false);
    expect(checkFunc({ ...f, gives: [{ trait: "a2", lo: 5, hi: 3 }] }, model).ok).toBe(false);
  });

  it("без времени выполнения — не годна: неизвестно, когда будет готово", () => {
    expect(checkFunc(F(["a1"], ["a2"], "A", { dur: 0 }), model).ok).toBe(false);
  });

  it("объяснение — дословно то, что дал владелец", () => {
    expect(checkFunc(F([], []), model).why).toBe(WHY_FUNC);
    expect(WHY_FUNC).toMatch(/преобразует внешний ресурс во внутренний/);
    expect(WHY_FUNC).toMatch(/диапазон/);
    expect(WHY_FUNC).toMatch(/среднее арифметическое/);
  });
});
