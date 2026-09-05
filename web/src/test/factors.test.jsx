import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { FUNC_KINDS, chanceOf, factorsOf, isFactor, funcKind, newFactor, newFunc,
  normalizeFunc, normalizeFactors, checkFunc } from "../lib/funcs.js";
import { factorHit, scheduleOf, solve } from "../lib/plan.js";

/* Функция выполняется либо людьми, либо сама собой.

   «Задача» — работу делают люди: у неё есть постановщик, исполнитель и
   проверяющий, и из неё берутся задачи на доске. «Фактор» — сезон, износ,
   курс: ресурсы он меняет так же, но спрашивать с него некого, и назначать
   на него людей значило бы поставить кого-то отвечать за погоду. */

describe("запись функции", () => {
  it("по умолчанию функция — задача: её делают люди", () => {
    expect(funcKind(newFunc("A"))).toBe("task");
    expect(isFactor(newFunc("A"))).toBe(false);
    expect(FUNC_KINDS.map((k) => k.name)).toEqual(["Задача", "Фактор"]);
  });

  it("чужая запись без вида читается как задача, а не ломается", () => {
    // Прежние функции вида не знали — и все они были работой людей.
    expect(funcKind(normalizeFunc({ id: "f1" }))).toBe("task");
    expect(normalizeFunc({ kind: "фактор?" }).kind).toBe("task");
    expect(normalizeFunc({ kind: "factor" })).toMatchObject({ kind: "factor", factors: [] });
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

  it("фактор без названного фактора — обрыв: сказано «само», но не сказано от чего", () => {
    const factors = [{ id: "x1", e: "A", name: "сезон" }];
    expect(checkFunc(F({ kind: "factor", factors: [] }), { traits, factors }).ok).toBe(false);
    expect(checkFunc(F({ kind: "factor", factor: "x1" }), { traits, factors }).ok).toBe(true);
    expect(checkFunc(F({ kind: "factor", factor: "нет-такого" }), { traits, factors }).ok)
      .toBe(false);
  });

  it("задаче фактор не нужен — с неё спрашивают людей", () => {
    expect(checkFunc(F({ kind: "task" }), { traits, factors: [] }).ok).toBe(true);
  });
});

describe("что фактор меняет в расчёте", () => {
  const model = (kind) => ({
    traits: [{ id: "t1", e: "A", have: 100 }, { id: "t2", e: "A", have: 0 }],
    funcs: [normalizeFunc({ id: "f1", e: "A", name: "рост", dur: 1, durUnit: "дн", kind,
      takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }] })],
  });

  it("часы фактора — не человеко-часы, а календарный срок остаётся", () => {
    // Фактор происходит сам: в бюджет человека его время не идёт, но
    // ждать его всё равно приходится.
    const task = solve(model("task"), { trait: "t2", want: 3 });
    const fact = solve(model("factor"), { trait: "t2", want: 3 });
    expect(task.workHours).toBeGreaterThan(0);
    expect(fact.workHours).toBe(0);
    expect(fact.criticalHours).toBe(task.criticalHours);
  });

  it("по фактору задач не заводится", () => {
    const fact = solve(model("factor"), { trait: "t2", want: 3 });
    expect(scheduleOf(fact.steps)).toEqual([]);
    const task = solve(model("task"), { trait: "t2", want: 3 });
    expect(scheduleOf(task.steps).length).toBe(3);
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
  const dump = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    return JSON.parse(container.querySelector("textarea").value);
  };

  it("«Факторы» — четвёртая вкладка актива, рядом с остальными частями", () => {
    scheme();
    expect(screen.getByRole("button", { name: /^Факторы \d/ })).toBeInTheDocument();
    assetTab("Факторы");
    expect(screen.getByText("факторы актива")).toBeInTheDocument();
  });

  it("фактор заводится с названием и уезжает в модель", () => {
    scheme(); assetTab("Факторы");
    const box = screen.getByPlaceholderText("название нового фактора");
    fireEvent.change(box, { target: { value: "сезон" } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "+ фактор" }));
    expect(screen.getByDisplayValue("сезон")).toBeInTheDocument();
    const m = dump();
    expect(m.factors.some((x) => x.name === "сезон")).toBe(true);
  });

  it("переключатель стоит перед ролями и убирает их у фактора", () => {
    // У фактора исполнителя нет: показывать пустые списки значило бы
    // спрашивать, кто отвечает за погоду.
    openFunc();
    expect(screen.getByText("исполнители")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Фактор" }));
    expect(screen.queryByText("исполнители")).toBeNull();
    expect(screen.queryByText("постановщики")).toBeNull();
    expect(screen.getByText("от каких факторов")).toBeInTheDocument();
    // И обратно — роли возвращаются.
    fireEvent.click(screen.getByRole("radio", { name: "Задача" }));
    expect(screen.getByText("исполнители")).toBeInTheDocument();
  });

  it("вид функции и выбранный фактор уезжают в модель", () => {
    scheme(); assetTab("Факторы");
    const box = screen.getByPlaceholderText("название нового фактора");
    fireEvent.change(box, { target: { value: "сезон" } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "+ фактор" }));

    openFunc();
    fireEvent.click(screen.getByRole("radio", { name: "Фактор" }));
    const sel = screen.getByLabelText("фактор функции");
    fireEvent.change(sel, { target: { value: [...sel.options][1].value } });

    const m = dump();
    const f = m.funcs.find((x) => x.kind === "factor");
    expect(f).toBeTruthy();
    expect(m.factors.some((x) => x.id === f.factors[0])).toBe(true);
  });

  it("на доске задач фактора нет — выполнять его некому", () => {
    openFunc();
    const name = screen.getByDisplayValue("Сбор заявок");
    fireEvent.click(screen.getByRole("radio", { name: "Фактор" }));
    expect(name).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.queryByText(/Сбор заявок/)).toBeNull();
  });

  it("удалённый фактор не оставляет функцию с мёртвой ссылкой", () => {
    scheme(); assetTab("Факторы");
    const box = screen.getByPlaceholderText("название нового фактора");
    fireEvent.change(box, { target: { value: "сезон" } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "+ фактор" }));
    openFunc();
    fireEvent.click(screen.getByRole("radio", { name: "Фактор" }));
    const sel = screen.getByLabelText("фактор функции");
    fireEvent.change(sel, { target: { value: [...sel.options][1].value } });

    scheme(); assetTab("Факторы");
    fireEvent.click(screen.getByRole("button", { name: "удалить фактор сезон" }));
    const m = dump();
    expect(m.factors).toHaveLength(0);
    expect(m.funcs.find((x) => x.kind === "factor").factors).toEqual([]);
  });
});

/* НЕСКОЛЬКО ФАКТОРОВ У ОДНОЙ ФУНКЦИИ.

   «Реклама сработала, и при этом был сезон» — это два разных события,
   каждое со своей вероятностью. В одной попытке они применяются ПО
   ПОРЯДКУ: не случился первый — до второго дело не доходит. Поэтому
   цепочка честно оказывается реже каждого своего звена. */
describe("факторов может быть несколько", () => {
  const FACTORS = [{ id: "x1", e: "A", name: "реклама", chance: 50 },
    { id: "x2", e: "A", name: "сезон", chance: 40 }];
  const F = (over) => normalizeFunc({ id: "f1", e: "A", kind: "factor",
    dur: 1, durHi: 1, durUnit: "ч",
    takes: [{ trait: "t1", lo: 1, hi: 1 }], gives: [{ trait: "t2", lo: 1, hi: 1 }],
    ...over });

  it("прежняя запись с одним фактором читается как список из одного", () => {
    expect(factorsOf({ factor: "x1" })).toEqual(["x1"]);
    expect(normalizeFunc({ kind: "factor", factor: "x1" }).factors).toEqual(["x1"]);
    // И одного поля рядом со списком не остаётся: двум местам для одного и
    // того же разойтись — вопрос первой правки.
    expect(normalizeFunc({ kind: "factor", factor: "x1" }).factor).toBeUndefined();
  });

  it("вероятности перемножаются: два события подряд случаются реже одного", () => {
    expect(chanceOf(F({ factors: ["x1"] }), FACTORS)).toBe(50);
    expect(chanceOf(F({ factors: ["x1", "x2"] }), FACTORS)).toBeCloseTo(20, 6);
    // У задачи вероятности нет вовсе: либо назначили, либо нет.
    expect(chanceOf(F({ kind: "task", factors: ["x1"] }), FACTORS)).toBe(100);
  });

  it("невероятное звено делает невозможной всю цепочку", () => {
    const none = [...FACTORS, { id: "x3", e: "A", name: "чудо", chance: 0 }];
    expect(chanceOf(F({ factors: ["x1", "x3"] }), none)).toBe(0);
    expect(factorHit(F({ factors: ["x1", "x3"] }), none, 7, "k")).toBe(false);
  });

  it("верные факторы срабатывают всегда — и по одному, и цепочкой", () => {
    const sure = [{ id: "x1", e: "A", name: "всегда", chance: 100 },
      { id: "x2", e: "A", name: "тоже всегда", chance: 100 }];
    expect(factorHit(F({ factors: ["x1", "x2"] }), sure, 3, "k")).toBe(true);
  });

  it("жребий посеян: одно и то же семя даёт один и тот же ответ", () => {
    const once = factorHit(F({ factors: ["x1", "x2"] }), FACTORS, 11, "f1#3");
    expect(factorHit(F({ factors: ["x1", "x2"] }), FACTORS, 11, "f1#3")).toBe(once);
    // Разные попытки — разные жребии, иначе фактор либо всегда, либо никогда.
    const many = Array.from({ length: 40 },
      (_, i) => factorHit(F({ factors: ["x1", "x2"] }), FACTORS, 11, `f1#${i}`));
    expect(new Set(many).size).toBe(2);
  });

  it("цепочка выпадает реже, чем каждое её звено", () => {
    const hits = (ids) => Array.from({ length: 400 },
      (_, i) => factorHit(F({ factors: ids }), FACTORS, 5, `f1#${i}`)).filter(Boolean).length;
    const one = hits(["x1"]);
    const both = hits(["x1", "x2"]);
    expect(both).toBeLessThan(one);
    expect(both / 400).toBeGreaterThan(0.1);
    expect(both / 400).toBeLessThan(0.3);
  });

  it("фактор без единого фактора — обрыв: не сказано, от чего это происходит", () => {
    const traits = [{ id: "t1", e: "A" }, { id: "t2", e: "A" }];
    expect(checkFunc(F({ factors: [] }), { traits, factors: FACTORS }).ok).toBe(false);
    // И ссылка на несуществующий фактор — тоже обрыв, даже рядом с живой.
    expect(checkFunc(F({ factors: ["x1", "нет"] }), { traits, factors: FACTORS }).ok)
      .toBe(false);
    expect(checkFunc(F({ factors: ["x1", "x2"] }), { traits, factors: FACTORS }).ok)
      .toBe(true);
  });
});

describe("несколько факторов в форме", () => {
  beforeEach(() => { localStorage.clear(); });
  const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  const assetTab = (name) =>
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  const addFactor = (name) => {
    scheme(); assetTab("Факторы");
    const box = screen.getByPlaceholderText("название нового фактора");
    fireEvent.change(box, { target: { value: name } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "+ фактор" }));
  };
  const openFunc = () => {
    scheme(); assetTab("Функции");
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
  };
  const pick = () => {
    const sel = screen.getByLabelText("фактор функции");
    fireEvent.change(sel, { target: { value: [...sel.options][1].value } });
  };

  it("выбранные факторы идут списком и по порядку — «затем»", () => {
    let container;
    ({ container } = render(<SystemModel />));
    addFactor("реклама");
    addFactor("сезон");
    openFunc();
    fireEvent.click(screen.getByRole("radio", { name: "Фактор" }));
    pick();
    pick();

    expect(screen.getByText("затем")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    const m = JSON.parse(container.querySelector("textarea").value);
    expect(m.funcs.find((x) => x.kind === "factor").factors).toHaveLength(2);
  });

  it("выбранный фактор из списка убирается", () => {
    render(<SystemModel />);
    addFactor("реклама");
    openFunc();
    fireEvent.click(screen.getByRole("radio", { name: "Фактор" }));
    pick();
    fireEvent.click(screen.getByRole("button", { name: "убрать фактор реклама" }));
    expect(screen.getByText(/выберите хотя бы один фактор/)).toBeInTheDocument();
  });
});
