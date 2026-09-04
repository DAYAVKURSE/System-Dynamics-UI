import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { newPort, normalizeFunc, portMode, portNeed, rangeText, shortage }
  from "../lib/funcs.js";
import { eachRuns, effect, intakeOf, runSide, solve } from "../lib/plan.js";

/* УКЛАД ВХОДА: по количеству, каждый, всё.

   Вилкой «от и до» сказано, сколько функция берёт, когда это решает
   человек. Но чаще решает не он:

   · «каждый» — работа возникает от появления ресурса. Пришло семь заявок —
     семь выполнений, по одному на заявку;
   · «всё» — одно выполнение разгребает накопленное разом, сколько бы его
     ни лежало.

   Ни то, ни другое вилкой не выразить, поэтому это не третье число, а
   уклад — и на форме он чекбоксом, а не полем. */

/* Функция короткая и без простоя: в месяц её помещается сколько угодно.
   Иначе проверялся бы потолок, а не уклад входа. */
const F = (takes, id = "f1") => normalizeFunc({ id, e: "A",
  dur: 1, durHi: 1, durUnit: "час", every: 1, everyHi: 1, everyUnit: "час",
  takes, gives: [{ trait: "out", lo: 1, hi: 1 }] });
const model = (takes, have = 7) => ({
  traits: [{ id: "in", e: "A", have }, { id: "out", e: "A", have: 0 }],
  funcs: [F(takes)],
});

describe("запись", () => {
  it("новый вход считается по количеству: прежние модели ничего не меняют", () => {
    expect(portMode(newPort("in"))).toBe("range");
    expect(portMode({ trait: "in" })).toBe("range");
    expect(portMode({ trait: "in", mode: "чепуха" })).toBe("range");
  });

  it("уклад хранится у входа и переживает нормализацию", () => {
    const f = normalizeFunc({ takes: [{ trait: "in", mode: "each" }],
      gives: [{ trait: "out", mode: "all" }] });
    expect(portMode(f.takes[0])).toBe("each");
    // У выхода уклада нет: сколько функция выдаёт, решает она сама.
    expect(portMode(f.gives[0])).toBe("range");
  });

  it("сказан словами: «каждый» и «всё» — не вилка, и вилкой не подписаны", () => {
    expect(rangeText({ trait: "in", mode: "each" })).toBe("каждый");
    expect(rangeText({ trait: "in", mode: "all" })).toBe("всё, что есть");
    expect(rangeText({ lo: 1, hi: 3 })).toBe("от 1 до 3");
  });

  it("взяться можно с одной единицы: вилки, которую ждать, тут нет", () => {
    expect(portNeed({ lo: 2, hi: 5 })).toBe(5);
    expect(portNeed({ mode: "each", lo: 0, hi: 0 })).toBe(1);
    expect(portNeed({ mode: "all", lo: 0, hi: 0 })).toBe(1);
  });
});

describe("сколько уходит на выполнения", () => {
  it("«каждый» — по единице на выполнение", () => {
    expect(intakeOf({ mode: "each" }, { level: 100, n: 7 })).toBe(7);
  });

  it("«всё» — весь остаток, сколько бы выполнений ни планировалось", () => {
    expect(intakeOf({ mode: "all" }, { level: 12, n: 1 })).toBe(12);
    expect(intakeOf({ mode: "all" }, { level: 12, n: 5 })).toBe(12);
    expect(intakeOf({ mode: "all" }, { level: 0, n: 5 })).toBe(0);
  });

  it("по количеству — как задано вилкой", () => {
    expect(intakeOf({ lo: 2, hi: 2 }, { level: 100, n: 3, side: "hi" })).toBe(6);
  });

  it("число выполнений диктует вход «каждый», а не план", () => {
    expect(eachRuns(F([{ trait: "in", mode: "each" }]), () => 7)).toBe(7);
    // Двум «каждым» сразу — по самому скудному: работа целая, а не половина.
    expect(eachRuns(F([{ trait: "a", mode: "each" }, { trait: "b", mode: "each" }]),
      (id) => (id === "a" ? 7 : 3))).toBe(3);
    // Нет такого входа — решает кто-то другой, и ответа тут нет.
    expect(eachRuns(F([{ trait: "in", lo: 1, hi: 1 }]), () => 7)).toBe(null);
  });
});

describe("прогноз", () => {
  it("«каждый»: семь единиц — семь выполнений, и все семь съедены", () => {
    const out = runSide(model([{ trait: "in", mode: "each" }]), { span: 1, side: "hi" });
    expect(out.out[1]).toBe(7);
    expect(out.in[1]).toBe(0);
  });

  it("«каждый» считает так же без применённых целей и с ними: работа не от плана", () => {
    const m = model([{ trait: "in", mode: "each" }]);
    const withPlan = runSide(m, { span: 1, side: "hi", plan: { perMonth: {}, once: {} } });
    expect(withPlan.out[1]).toBe(7);
  });

  it("«всё»: одно выполнение забирает накопленное разом", () => {
    const m = model([{ trait: "in", mode: "all" }], 12);
    const out = runSide(m, { span: 1, side: "hi" });
    expect(out.in[1]).toBe(0);
    // Выполнение одно — и выход у него один, сколько бы ни съело.
    expect(out.out[1]).toBeGreaterThan(0);
  });

  it("больше, чем помещается в месяц, «каждый» не сделает — остальное ждёт", () => {
    /* Работа возникает от появления ресурса, но время от этого не
       растягивается: за месяц делается столько, сколько успевается. */
    const slow = { traits: [{ id: "in", e: "A", have: 7 }, { id: "out", e: "A", have: 0 }],
      funcs: [normalizeFunc({ id: "f1", e: "A", dur: 1, durHi: 1, durUnit: "мес",
        every: 1, everyHi: 1, everyUnit: "мес",
        takes: [{ trait: "in", mode: "each" }], gives: [{ trait: "out", lo: 1, hi: 1 }] })] };
    const out = runSide(slow, { span: 1, side: "hi" });
    expect(out.out[1]).toBe(1);
    expect(out.in[1]).toBe(6);
  });

  it("брать нечего — «каждый» ничего и не делает", () => {
    const out = runSide(model([{ trait: "in", mode: "each" }], 0), { span: 1, side: "hi" });
    expect(out.out[1]).toBe(0);
  });
});

describe("план под цель", () => {
  const m = (takes, have) => ({
    traits: [{ id: "in", e: "A", have }, { id: "out", e: "A", have: 0 }],
    funcs: [F(takes)],
  });

  it("«каждый» заказывает по единице на выполнение", () => {
    const plan = solve(m([{ trait: "in", mode: "each" }], 0), { trait: "out", want: 5 });
    expect(plan.steps[0].runs).toBe(5);
    expect(plan.spent.in).toBe(5);
  });

  it("«всё» ничего не заказывает: оно разгребает то, что уже лежит", () => {
    /* Требовать под «всё» производство значило бы придумать число, которого
       функция не просила: сколько накопится, она не спрашивает. */
    const plan = solve(m([{ trait: "in", mode: "all" }], 3), { trait: "out", want: 2 });
    expect(plan.spent.in ?? 0).toBe(0);
    expect(plan.missing).toEqual([]);
    expect(plan.ok).toBe(true);
  });

  it("что план сделает с ресурсами — по тому же укладу", () => {
    const mm = m([{ trait: "in", mode: "each" }], 10);
    const plan = solve(mm, { trait: "out", want: 4 });
    expect(effect(mm, plan.steps).in).toBe(-4);
    const all = m([{ trait: "in", mode: "all" }], 10);
    // «Всё» съедает остаток целиком — и говорит об этом одним числом.
    expect(effect(all, solve(all, { trait: "out", want: 1 }).steps).in).toBe(-10);
  });
});

describe("хватает ли ресурсов, чтобы взяться", () => {
  const traits = [{ id: "in", e: "A", l: "заявки", have: 1 }];

  it("одной единицы довольно: разгребать уже есть что", () => {
    expect(shortage(F([{ trait: "in", mode: "each" }]), traits)).toEqual([]);
    expect(shortage(F([{ trait: "in", mode: "all" }]), traits)).toEqual([]);
  });

  it("а пусто — так и сказано, и сказано про одну единицу", () => {
    const none = [{ id: "in", e: "A", l: "заявки", have: 0 }];
    const miss = shortage(F([{ trait: "in", mode: "each" }]), none);
    expect(miss).toHaveLength(1);
    expect(miss[0].need).toBe(1);
  });
});

describe("в форме", () => {
  let container;
  beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });
  const openFunc = () => {
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: /^Функции/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
  };
  const dump = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    return JSON.parse(container.querySelector("textarea").value);
  };
  const takeOf = () => dump().funcs.find((x) => x.id === "f_req").takes[0];

  it("у входа есть чекбоксы «каждый» и «всё»", () => {
    openFunc();
    expect(screen.getAllByLabelText(/^каждый · /).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^всё · /).length).toBeGreaterThan(0);
  });

  it("у выхода их нет: сколько выдать, решает сама функция", () => {
    openFunc();
    // Входов у первой функции один, выходов один — значит по одному чекбоксу.
    expect(screen.getAllByLabelText(/^каждый · /)).toHaveLength(1);
  });

  it("«каждый» записывается в модель и прячет вилку", () => {
    openFunc();
    const box = screen.getAllByLabelText(/^каждый · /)[0];
    const label = box.getAttribute("aria-label").replace("каждый · ", "");
    expect(screen.getByLabelText(`сколько минимум ${label}`)).toBeInTheDocument();
    fireEvent.click(box);
    expect(portMode(takeOf())).toBe("each");
    // Вилка ушла: при «каждом» она врала бы — количество решает не человек.
    expect(screen.queryByLabelText(`сколько минимум ${label}`)).toBeNull();
  });

  it("«всё» исключает «каждый»: это два ответа на один вопрос", () => {
    openFunc();
    fireEvent.click(screen.getAllByLabelText(/^каждый · /)[0]);
    fireEvent.click(screen.getAllByLabelText(/^всё · /)[0]);
    expect(screen.getAllByLabelText(/^каждый · /)[0].checked).toBe(false);
    // Выгрузка уводит со вкладки, поэтому она последней: до неё проверяем
    // то, что видно на форме.
    expect(portMode(takeOf())).toBe("all");
  });

  it("снятый чекбокс возвращает вилку", () => {
    openFunc();
    fireEvent.click(screen.getAllByLabelText(/^каждый · /)[0]);
    fireEvent.click(screen.getAllByLabelText(/^каждый · /)[0]);
    expect(portMode(takeOf())).toBe("range");
  });

  it("в свёрнутой строке уклад видно — иначе он был бы тайной", () => {
    openFunc();
    fireEvent.click(screen.getAllByLabelText(/^каждый · /)[0]);
    expect(screen.getAllByText(/\(каждый\)/).length).toBeGreaterThan(0);
  });
});
