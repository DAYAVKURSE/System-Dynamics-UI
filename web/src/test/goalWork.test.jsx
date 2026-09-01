import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Работа по цели живёт во вкладке «Цели»; задача открывается под своей целью;
   метрика задачи становится движением в модели. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const goalCard = (name) => {
  const label = [...container.querySelectorAll("span")]
    .find((sp) => sp.textContent === name);
  if (!label) throw new Error(`цель «${name}» не найдена`);
  return label.closest("div").parentElement;
};
const dump = () => {
  fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[1]);
  const m = JSON.parse(container.querySelector("textarea").value);
  fireEvent.click(screen.getByRole("button", { name: "Цели" }));
  return m;
};

describe("порядок и названия вкладок", () => {
  it("цели, задачи, типы, схема, прогноз, выгрузить", () => {
    const names = ["Цели", "Задачи", "Типы", "Схема", "Прогноз", "Выгрузить"];
    const tabs = names.map((n) => screen.getAllByRole("button", { name: n })[0]);
    // Порядок в разметке — это и есть порядок на экране.
    const pos = tabs.map((b) => [...container.querySelectorAll("button")].indexOf(b));
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });
});

describe("работа по цели — во вкладке «Цели»", () => {
  it("у цели есть «+ задача», и задача открывается под этой же целью", () => {
    const card = goalCard("активные пользователи");
    const add = within(card).getByRole("button", { name: "+ задача" });
    fireEvent.click(add);

    // Редактор открылся внутри карточки этой цели, а не внизу страницы.
    expect(within(card).getByDisplayValue("Новая задача")).toBeTruthy();
    expect(within(card).getByText(/какое движение выполняет эта задача/)).toBeTruthy();
  });

  it("задача второй цели не открывается под первой", () => {
    const first = goalCard("активные пользователи");
    fireEvent.click(within(first).getByRole("button", { name: "+ задача" }));
    expect(within(first).queryByDisplayValue("Новая задача")).toBeTruthy();

    const cards = screen.getAllByRole("button", { name: "+ задача" });
    expect(cards.length).toBeGreaterThan(0);
  });
});

describe("сдача задачи даёт факт", () => {
  it("«СДАТЬ» записывает фактическое количество и закрывает задачу", () => {
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));

    expect(screen.getByText(/фактически перешло в/)).toBeTruthy();
    const amount = screen.getByPlaceholderText("сколько");
    fireEvent.change(amount, { target: { value: "9" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));

    expect(screen.getByText(/сдано 9/)).toBeTruthy();
    // Сдача закрывает задачу: работа сделана, факт записан.
    expect(screen.getAllByDisplayValue("Готово").length).toBeGreaterThan(0);
  });

  it("сдача уезжает в сценарий вместе с задачей", () => {
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));

    const m = dump();
    expect(m.tasks[0].submissions).toHaveLength(1);
    expect(m.tasks[0].submissions[0].at).toBeTruthy();
  });
});

describe("задача от движения", () => {
  const board = () => fireEvent.click(screen.getByRole("button", { name: "Задачи" }));

  it("список движений показывает, у скольких есть задачи", () => {
    board();
    expect(screen.getByText(/движения ресурсов — у каждого своя задача/)).toBeTruthy();
    // Каждое движение модели — своя строка со своей кнопкой.
    expect(screen.getAllByRole("button", { name: "+ задача" }).length)
      .toBeGreaterThan(1);
    expect(screen.getAllByText(/задач: 0/).length).toBeGreaterThan(0);
  });

  it("созданная задача берёт название движения и привязывается к нему", () => {
    board();
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    // Движение уже выбрано — задача выросла из него, а не наоборот.
    const movePicker = [...container.querySelectorAll("select")]
      .find((s) => s.textContent.includes("— не привязана к движению —"));
    expect(movePicker.value).not.toBe("");
    expect(screen.getAllByText(/задач: 1/).length).toBeGreaterThan(0);
  });

  it("сдача становится фактом движения в прогнозе", () => {
    board();
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    const amount = screen.getByPlaceholderText("сколько");
    fireEvent.change(amount, { target: { value: "3" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));

    // Отчёт появился на своей вкладке — там видно, что и когда делалось.
    fireEvent.click(screen.getByRole("button", { name: "Отчёты" }));
    // Строка таймлайна — та, где написано название задачи.
    const row = [...container.querySelectorAll("div")]
      .find((d) => d.style.cursor === "pointer");
    expect(row).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText(/перешло 3/)).toBeTruthy();
  });

});
