import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { chanceOf, conversionOf, factorsOf, newFactor, newFunc, normalizeFunc,
  normalizeFactors, checkFunc, funcGaps, takeQty } from "../lib/funcs.js";
import { scheduleOf, solve } from "../lib/plan.js";

/* ФАКТОР — КОНВЕРСИЯ, А НЕ ДРУГОЙ ВИД РАБОТЫ.

   Прежде функция была либо «задачей» (её делают люди), либо «фактором»
   (случается сам, без людей, по жребию). Владелец это снял: любая функция —
   работа с постановщиком, исполнителем и проверяющим, а факторы говорят,
   какая у неё КОНВЕРСИЯ: сколько входа уходит на одну порцию выхода. Без
   факторов — 100%, с фактором в 10% — входа нужно вдесятеро больше. */

describe("запись функции", () => {
  it("вида у функции нет: любая — работа людей", () => {
    expect(newFunc("A").kind).toBeUndefined();
    expect(normalizeFunc({ id: "f1" }).kind).toBeUndefined();
    // Старая запись «фактор» читается как обычная функция со своими факторами.
    expect(normalizeFunc({ kind: "factor", factor: "x1" }))
      .toMatchObject({ factors: ["x1"] });
    expect(normalizeFunc({ kind: "factor" }).kind).toBeUndefined();
  });

  it("фактор — своя запись, а не галочка на функции", () => {
    // Фактор один, а функций от него может быть несколько; галочкой он
    // существовал бы столько раз, сколько на него ссылаются.
    const x = newFactor("A", "сезон");
    expect(x).toMatchObject({ e: "A", name: "сезон" });
    expect(newFactor("A").id).not.toBe(newFactor("A").id);
    expect(normalizeFactors(undefined)).toEqual([]);
  });
});

describe("проверка строения", () => {
  const traits = [{ id: "t1", e: "A", l: "раз" }, { id: "t2", e: "A", l: "два" }];
  const F = (over) => normalizeFunc({ id: "f1", e: "A", dur: 1, durUnit: "дн",
    takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }],
    ...over });

  it("факторы необязательны: без них функция собрана", () => {
    const factors = [{ id: "x1", e: "A", name: "сезон" }];
    expect(checkFunc(F({ factors: [] }), { traits, factors }).ok).toBe(true);
    expect(checkFunc(F({ factors: ["x1"] }), { traits, factors }).ok).toBe(true);
  });

  it("удалённый фактор — обрыв: ссылка есть, фактора нет", () => {
    const factors = [{ id: "x1", e: "A", name: "сезон" }];
    const dead = F({ factors: ["x1", "нет-такого"] });
    expect(checkFunc(dead, { traits, factors }).ok).toBe(false);
    expect(funcGaps(dead, { traits, factors })).toContain("выбран удалённый фактор");
  });

  it("фактор другого актива — обрыв: сезон одного актива не двигает другой", () => {
    const factors = [{ id: "x1", e: "A", name: "сезон" }, { id: "x2", e: "B", name: "чужой" }];
    expect(checkFunc(F({ factors: ["x1"] }), { traits, factors }).ok).toBe(true);
    const foreign = F({ factors: ["x1", "x2"] });
    expect(checkFunc(foreign, { traits, factors }).ok).toBe(false);
    expect(funcGaps(foreign, { traits, factors })).toContain("выбран фактор другого актива");
  });
});

describe("что факторы меняют в расчёте", () => {
  const model = (factors = []) => ({
    traits: [{ id: "t1", e: "A", have: 100 }, { id: "t2", e: "A", have: 0 }],
    factors: [{ id: "g1", e: "A", name: "сезон", chance: 50 }],
    funcs: [normalizeFunc({ id: "f1", e: "A", name: "рост", dur: 1, durUnit: "дн", factors,
      takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }] })],
  });

  it("с факторами входа нужно больше, а работа остаётся работой людей", () => {
    const plain = solve(model([]), { trait: "t2", want: 3 });
    const half = solve(model(["g1"]), { trait: "t2", want: 3 });
    // Часы человека никуда не делись: функцию с фактором тоже делают люди.
    expect(plain.workHours).toBeGreaterThan(0);
    expect(half.workHours).toBeGreaterThan(0);
    // Конверсия 50% — входа вдвое больше.
    expect(conversionOf(model(["g1"]).funcs[0], model().factors)).toBeCloseTo(0.5);
    expect(takeQty(1, 0.5)).toBe(2);
  });

  it("задачи заводятся и по функции с факторами: выполнять её есть кому", () => {
    const half = solve(model(["g1"]), { trait: "t2", want: 3 });
    expect(scheduleOf(half.steps).length).toBeGreaterThan(0);
  });
});

describe("в интерфейсе", () => {
  let container;
  beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });
  const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  const assetTab = (name) => fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  const openFunc = () => {
    scheme(); assetTab("Функции");
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
  };
  const addFactor = (name = "сезон") => {
    scheme(); assetTab("Факторы");
    const box = screen.getByPlaceholderText("название нового фактора");
    fireEvent.change(box, { target: { value: name } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "+ фактор" }));
  };
  const dump = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    return JSON.parse(container.querySelector("textarea").value);
  };

  it("«Факторы» — вкладка актива сразу после «Функций»", () => {
    scheme();
    const names = screen.getAllByRole("button", { name: /^(Воркеры|Функции|Факторы|Ресурсы) \d/ })
      .map((b) => b.textContent.split(" ")[0]);
    expect(names).toEqual(["Воркеры", "Функции", "Факторы", "Ресурсы"]);
    assetTab("Факторы");
    expect(screen.getByText("факторы актива")).toBeInTheDocument();
  });

  it("фактор заводится с названием и уезжает в модель", () => {
    addFactor("сезон");
    expect(screen.getByDisplayValue("сезон")).toBeInTheDocument();
    expect(dump().factors.some((x) => x.name === "сезон")).toBe(true);
  });

  it("переключателя «задача или фактор» нет, а роли есть у любой функции", () => {
    openFunc();
    expect(screen.queryByRole("radio", { name: "Фактор" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Задача" })).toBeNull();
    ["постановщики", "исполнители", "проверяющие"].forEach((many) => {
      expect(screen.getByText(`${many} — должности`)).toBeInTheDocument();
    });
  });

  it("факторы стоят сразу за ресурсами — перед временем выполнения", () => {
    openFunc();
    const card = screen.getByText("факторы — необязательно").closest("div").parentElement;
    const pos = (t) => {
      const el = within(card).getByText(t);
      return [...card.querySelectorAll("*")].indexOf(el);
    };
    expect(pos("выдаёт")).toBeLessThan(pos("факторы — необязательно"));
    expect(pos("факторы — необязательно")).toBeLessThan(pos("выполняется за"));
  });

  it("выбранный фактор уезжает в модель и показывает конверсию", () => {
    addFactor("сезон");
    openFunc();
    const sel = screen.getByLabelText("фактор функции");
    fireEvent.change(sel, { target: { value: [...sel.options][1].value } });
    const m = dump();
    const f = m.funcs.find((x) => (x.factors || []).length);
    expect(f).toBeTruthy();
    expect(m.factors.some((x) => x.id === f.factors[0])).toBe(true);
    // Конверсия названа числом: сколько входа нужно, видно сразу.
    openFunc();
    expect(screen.getByText(/Конверсия 100%/)).toBeInTheDocument();
  });

  it("функция с фактором остаётся на доске задач: её выполняют люди", () => {
    addFactor("сезон");
    openFunc();
    const sel = screen.getByLabelText("фактор функции");
    fireEvent.change(sel, { target: { value: [...sel.options][1].value } });
    const m = dump();
    expect(m.funcs.find((x) => (x.factors || []).length).owners).toBeDefined();
  });

  it("удалённый фактор не оставляет функцию с мёртвой ссылкой", () => {
    addFactor("сезон");
    openFunc();
    const sel = screen.getByLabelText("фактор функции");
    fireEvent.change(sel, { target: { value: [...sel.options][1].value } });
    scheme(); assetTab("Факторы");
    fireEvent.click(screen.getByRole("button", { name: "удалить фактор сезон" }));
    const m = dump();
    expect(m.factors).toHaveLength(0);
    expect(m.funcs.every((x) => !(x.factors || []).length)).toBe(true);
  });
});

/* НЕСКОЛЬКО ФАКТОРОВ У ОДНОЙ ФУНКЦИИ.

   «Реклама или сезон» — два разных события, каждое со своей вероятностью.
   Хватает любого, поэтому вместе они дают БОЛЬШЕ, чем каждый по себе:
   считается через обратное — что не удался ни один. */
describe("факторов может быть несколько", () => {
  const FACTORS = [{ id: "x1", e: "A", name: "реклама", chance: 50 },
    { id: "x2", e: "A", name: "сезон", chance: 40 }];
  const F = (over) => normalizeFunc({ id: "f1", e: "A",
    dur: 1, durHi: 1, durUnit: "ч",
    takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }],
    ...over });

  it("прежняя запись с одним фактором читается как список из одного", () => {
    expect(factorsOf({ factor: "x1" })).toEqual(["x1"]);
    expect(normalizeFunc({ factor: "x1" }).factors).toEqual(["x1"]);
    // И одного поля рядом со списком не остаётся: двум местам для одного и
    // того же разойтись — вопрос первой правки.
    expect(normalizeFunc({ factor: "x1" }).factor).toBeUndefined();
  });

  it("хватает любого фактора из списка: вместе — чаще, а не реже", () => {
    expect(chanceOf(F({ factors: ["x1"] }), FACTORS)).toBe(50);
    // 50% и 40%: не выйдет ни один — 0.5·0.6 = 30%, значит выйдет 70%.
    expect(chanceOf(F({ factors: ["x1", "x2"] }), FACTORS)).toBeCloseTo(70, 6);
    // Без факторов — сто процентов: функция срабатывает всегда.
    expect(chanceOf(F({ factors: [] }), FACTORS)).toBe(100);
  });

  it("невозможный фактор в списке ничего не портит — просто не помогает", () => {
    const none = [...FACTORS, { id: "x3", e: "A", name: "чудо", chance: 0 }];
    expect(chanceOf(F({ factors: ["x1", "x3"] }), none)).toBeCloseTo(50, 6);
    // А когда в списке только он — не происходит ничего.
    expect(chanceOf(F({ factors: ["x3"] }), none)).toBe(0);
    expect(conversionOf(F({ factors: ["x3"] }), none)).toBe(0);
  });
});
