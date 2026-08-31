import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Условия перетекания: два поля с числовыми выражениями.
   Левое — про актив-источник стрелки, правое — про что угодно. */

let container;
beforeEach(() => {
  ({ container } = render(<SystemModel />));
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  // Ресурс «активные пользователи» — в него входит стрелка от «Реферальной
  // системы» с двумя условиями из исходной модели.
  fireEvent.click(screen.getAllByText("активные пользователи")[0]);
});

// Карточка условия — блок вокруг подписи «условие N». Идём от самой подписи,
// иначе селектор цепляет ещё и контейнер всех условий.
const condCards = () =>
  [...container.querySelectorAll("span")]
    .filter((sp) => /^условие \d+$/.test(sp.textContent || ""))
    .map((sp) => sp.parentElement.parentElement);

const firstCond = () => condCards()[0];

// Блок актива на схеме выбирается pointer-событиями: у него перетаскивание.
function selectEntity(name) {
  const g = [...container.querySelectorAll("svg g")].find((el) =>
    [...el.querySelectorAll("text")].some((t) => t.textContent === name));
  if (!g) throw new Error(`актив «${name}» не найден на схеме`);
  fireEvent.pointerDown(g, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: 10, clientY: 10, pointerId: 1 });
}
const exprInputs = (card) => [...card.querySelectorAll("input")];
const pickers = (card) => [...card.querySelectorAll("select")]
  .filter((s) => s.textContent.includes("вставить ресурс"));

const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe("два поля выражений", () => {
  it("у условия есть левое и правое поле", () => {
    const card = firstCond();
    expect(exprInputs(card)).toHaveLength(2);
    expect(pickers(card)).toHaveLength(2);
  });

  it("исходное условие показано формулой с именем ресурса и числом", () => {
    const [left, right] = exprInputs(firstCond());
    // Cond("r5","min",5) — «активные реферы» не меньше 5.
    expect(left.value).toBe("[активные реферы]");
    expect(right.value).toBe("5");
  });

  it("левый список предлагает только ресурсы актива-источника", () => {
    const [leftPicker, rightPicker] = pickers(firstCond());

    // Стрелка идёт от «Реферальной системы» — её ресурсы в левом списке есть.
    expect(within(leftPicker).getByText(/активные реферы/)).toBeTruthy();
    // Ресурсы других активов — нет.
    expect(within(leftPicker).queryByText(/деньги с продаж/)).toBeNull();
    expect(within(leftPicker).queryByText(/увеличение спроса/)).toBeNull();

    // Правый список — по любому активу.
    expect(within(rightPicker).getByText(/активные реферы/)).toBeTruthy();
    expect(within(rightPicker).getByText(/деньги с продаж/)).toBeTruthy();
  });

  it("подпись левого поля называет актив-источник", () => {
    expect(within(firstCond()).getByText(/у «Реферальная система»/)).toBeTruthy();
  });
});

describe("ввод выражений", () => {
  it("принимает формулу с числом и ресурсом", () => {
    const [left] = exprInputs(firstCond());
    commit(left, "[активные реферы] * 2");
    expect(exprInputs(firstCond())[0].value).toBe("[активные реферы] * 2");
  });

  it("правое поле принимает ссылку на ресурс чужого актива", () => {
    const [, right] = exprInputs(firstCond());
    commit(right, "[активные пользователи] / 100");
    expect(exprInputs(firstCond())[1].value).toBe("[активные пользователи] / 100");
  });

  it("выражение меняет множитель условия", () => {
    const card = firstCond();
    const before = card.textContent.match(/(\d+)%/)?.[1];

    // Порог вдесятеро меньше — множитель обязан вырасти.
    commit(exprInputs(card)[0], "100");
    commit(exprInputs(firstCond())[1], "10");

    const after = firstCond().textContent.match(/(\d+)%/)?.[1];
    expect(Number(after)).toBeGreaterThan(Number(before ?? 0));
    expect(Number(after)).toBe(1000); // 100 против 10 = 1000%
  });

  it("список вставляет ресурс в поле, не заставляя набирать имя", () => {
    const card = firstCond();
    commit(exprInputs(card)[0], "");
    fireEvent.change(pickers(firstCond())[0], { target: { value: "r5" } });
    expect(exprInputs(firstCond())[0].value).toBe("[активные реферы]");
  });
});

describe("ошибки в выражении", () => {
  it("сломанное выражение объясняется словами", () => {
    commit(exprInputs(firstCond())[0], "(2 +");
    expect(within(firstCond()).getByText(/слева:/)).toBeTruthy();
  });

  it("сломанное условие не душит стрелку — оно просто не учитывается", () => {
    const card = firstCond();
    commit(exprInputs(card)[0], "((((");
    // Обнуление множителя схлопнуло бы весь прогноз без объяснения,
    // поэтому битое условие считается неограничивающим.
    expect(within(firstCond()).getByText(/не учитывается, пока не исправлено/))
      .toBeTruthy();
  });

  it("неизвестное имя ресурса названо прямо", () => {
    commit(exprInputs(firstCond())[1], "[такого ресурса нет]");
    expect(within(firstCond()).getByText(/неизвестный ресурс/)).toBeTruthy();
  });

  it("деление на ноль не превращается в бесконечность", () => {
    commit(exprInputs(firstCond())[1], "10 / 0");
    expect(within(firstCond()).getByText(/ноль/)).toBeTruthy();
  });
});

describe("совместимость и устойчивость", () => {
  it("условие из старого сценария читается и правится", () => {
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const area = container.querySelector("textarea");
    commit(area, JSON.stringify({
      entities: [
        { id: "a", name: "Актив А", color: "#fff", x: 0, y: 0 },
        { id: "b", name: "Актив Б", color: "#eee", x: 300, y: 0 },
      ],
      traits: [
        { id: "x", e: "a", k: "res", l: "ресурс А", unit: "шт.", have: 20 },
        { id: "y", e: "b", k: "res", l: "ресурс Б", unit: "шт.", have: 0 },
      ],
      // Старая форма условия: {trait, mode, amt}.
      edges: [{ id: "e1", from: "a", to: "y", carrier: "поток", gives: 4,
        per: "мес", sign: 1, conds: [{ trait: "x", mode: "min", amt: 10 }] }],
    }));
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    selectEntity("Актив Б");
    fireEvent.click(screen.getAllByText("ресурс Б")[0]);

    const [left, right] = exprInputs(firstCond());
    expect(left.value).toBe("[ресурс А]");
    expect(right.value).toBe("10");
    // 20 против 10 — множитель 200%.
    expect(within(firstCond()).getByText(/200%/)).toBeTruthy();
  });

  it("переименование ресурса не ломает выражение", () => {
    // Ссылка хранится по id, поэтому после переименования условие продолжает
    // указывать на ту же величину и показывает новое имя.
    selectEntity("Реферальная система");
    fireEvent.click(screen.getAllByText("активные реферы")[0]);
    commit(screen.getByDisplayValue("активные реферы"), "ядро рефералов");

    selectEntity("Пользователи");
    fireEvent.click(screen.getAllByText("активные пользователи")[0]);
    expect(exprInputs(firstCond())[0].value).toBe("[ядро рефералов]");
  });
});
