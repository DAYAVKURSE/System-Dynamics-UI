import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Ползунок времени на главной схеме, симуляция без кнопки «запустить»,
   задача по нажатию на цель. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const slider = () => container.querySelector('input[type="range"]');

describe("время на главной схеме", () => {
  beforeEach(() => { fireEvent.click(screen.getByRole("button", { name: "Схема" })); });

  it("ползунок есть и начинается с «сейчас»", () => {
    expect(slider()).toBeTruthy();
    expect(screen.getByText("сейчас")).toBeTruthy();
  });

  it("сдвиг в будущее меняет значения на схеме", () => {
    // Детерминированная модель: запас растёт по 100 в месяц к цели 1200 —
    // «сейчас» шкала цели пустая, через 12 месяцев полная.
    fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
    const area = container.querySelector("textarea");
    fireEvent.change(area, { target: { value: JSON.stringify({
      entities: [{ id: "a", name: "Касса", color: "#fff", x: 0, y: 0 }],
      traits: [{ id: "m", e: "a", k: "res", l: "деньги", unit: "₽",
        have: 0, want: 1200, by: 12, flow: false }],
      edges: [{ id: "e", from: "a", to: "m", carrier: "", gives: 100,
        per: "мес", sign: 1, conds: [], basis: "fact" }],
    }) } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));

    const gauge = () => [...container.querySelectorAll("svg text")]
      .map((t) => t.textContent).find((x) => /% факт/.test(x));
    expect(gauge()).toMatch(/^0% факт/);
    fireEvent.change(slider(), { target: { value: "12" } });
    expect(screen.getByText("+12 мес.")).toBeTruthy();
    expect(gauge()).toMatch(/^100% факт/);
  });

  it("правки при сдвинутом времени всё равно правят модель «сейчас»", () => {
    fireEvent.change(slider(), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "+ актив" }));
    expect([...container.querySelectorAll("svg text")]
      .some((t) => t.textContent === "Новый актив")).toBe(true);
  });
});

describe("вкладка «Симуляция» — только активы и графики", () => {
  beforeEach(() => { fireEvent.click(screen.getByRole("button", { name: "Прогноз" })); });

  it("кнопки «запустить» больше нет — пересчёт сам", () => {
    expect(screen.queryByRole("button", { name: /запустить/i })).toBeNull();
    expect(screen.getByText(/Пересчитывается сама/)).toBeTruthy();
  });

  it("схемы здесь нет — она на вкладке «Схема»", () => {
    expect(container.querySelector("svg rect[rx='12']")).toBeNull();
  });

  it("графики по активам показываются сразу, без запуска", () => {
    // Кнопки активов и карточки ресурсов с графиками уже на месте.
    fireEvent.click(screen.getAllByRole("button", { name: "Пользователи" })[0]);
    expect(screen.getAllByText(/гипотетически/).length).toBeGreaterThan(0);
  });
});

describe("задача по нажатию на цель", () => {
  beforeEach(() => { fireEvent.click(screen.getByRole("button", { name: "Задачи" })); });

  it("у каждого движения своя кнопка «+ задача»", () => {
    // Задачи ставятся от движений: список движений — над доской.
    expect(screen.getByText(/движения ресурсов — у каждого своя задача/))
      .toBeTruthy();
    const btns = screen.getAllByRole("button", { name: "+ задача" });
    expect(btns.length).toBeGreaterThan(1);
  });

  it("задача от движения открывается с ним, с целью и с кнопкой сдачи", () => {
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    expect(screen.getByText(/движение, которое выполняет задача/)).toBeTruthy();
    expect(screen.getByText(/цель и гипотеза, на которой она построена/))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "СДАТЬ" })).toBeTruthy();
  });
});
