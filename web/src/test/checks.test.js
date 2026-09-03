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

  it("функциональный элемент своего актива засчитывается и как «к нему», и как «внутрь»", () => {
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

describe("функциональный элемент", () => {
  const F = (takes, gives, e = "A") => ({ id: "f1", e, takes, gives });

  it("преобразование целиком внутри актива — годен", () => {
    expect(checkFunc(F([{ trait: "a1" }], [{ trait: "a2" }]), model).ok).toBe(true);
  });

  it("стрелки и внутрь, и наружу — годен", () => {
    expect(checkFunc(F([{ trait: "b1" }], [{ trait: "a1" }]), model).ok).toBe(true);
  });

  it("всё снаружи — не годен: тогда он не часть этого актива", () => {
    expect(checkFunc(F([{ trait: "b1" }], [{ trait: "b1" }]), model).ok).toBe(false);
  });

  it("ничего не берёт или ничего не выдаёт — не годен: он не преобразует ничего", () => {
    expect(checkFunc(F([], [{ trait: "a1" }]), model).ok).toBe(false);
    expect(checkFunc(F([{ trait: "a1" }], []), model).ok).toBe(false);
    expect(checkFunc(null, model).ok).toBe(false);
  });

  it("ссылка на удалённый ресурс — обрыв, а не «наружу»", () => {
    expect(checkFunc(F([{ trait: "нет-такого" }], [{ trait: "a1" }]), model).ok).toBe(false);
  });

  it("объяснение — дословно то, что дал владелец", () => {
    expect(checkFunc(F([], []), model).why).toBe(WHY_FUNC);
    expect(WHY_FUNC).toMatch(/преобразует внешний ресурс во внутренний/);
  });
});
