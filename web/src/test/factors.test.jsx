import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { FUNC_KINDS, isFactor, funcKind, newFactor, newFunc, normalizeFunc,
  normalizeFactors, checkFunc } from "../lib/funcs.js";
import { scheduleOf, solve } from "../lib/plan.js";

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
    expect(normalizeFunc({ kind: "factor" })).toMatchObject({ kind: "factor", factor: "" });
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
    expect(checkFunc(F({ kind: "factor", factor: "" }), { traits, factors }).ok).toBe(false);
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
    expect(screen.getByLabelText("фактор функции")).toBeInTheDocument();
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
    expect(m.factors.some((x) => x.id === f.factor)).toBe(true);
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
    expect(m.funcs.find((x) => x.kind === "factor").factor).toBe("");
  });
});
