import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Работа по цели живёт во вкладке «Прогноз»; задача открывается под своей целью;
   метрика задачи становится движением в модели. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const expandCards = () => {
  [...container.querySelectorAll("span")]
    .filter((s) => s.textContent === "\u25b8")
    .forEach((s) => fireEvent.click(s.parentElement));
};
const goalCard = (name) => {
  // Цели живут на «Прогнозе», а стартовая вкладка — «Задачи». Карточки
  // свёрнуты — раскрываем, иначе внутри только имя и график.
  fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
  expandCards();
  const label = [...container.querySelectorAll("span")]
    .find((sp) => sp.textContent === name);
  if (!label) throw new Error(`цель «${name}» не найдена`);
  return label.closest("div").parentElement;
};
const dump = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  const m = JSON.parse(container.querySelector("textarea").value);
  fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
  return m;
};

describe("порядок и названия вкладок", () => {
  it("задачи, проверка, timeline, звонки, схема, прогноз, выгрузить", () => {
    const names = ["Задачи", "Проверка", "Timeline", "Схема", "Прогноз",
      "Инструменты"];
    const tabs = names.map((n) => screen.getAllByRole("button", { name: n })[0]);
    // Порядок в разметке — это и есть порядок на экране.
    const pos = tabs.map((b) => [...container.querySelectorAll("button")].indexOf(b));
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });
});

describe("работа по цели — во вкладке «Прогноз»", () => {
  it("кнопка «+ задача» стоит у каждого движения цели, а не у цели вообще", () => {
    const card = goalCard("активные пользователи");
    // Движение выбирается не в задаче, а тем, под чем нажата кнопка, —
    // значит, кнопок столько же, сколько движений входит в цель.
    const adds = within(card).getAllByRole("button", { name: /^\+ задача/ });
    expect(adds.length).toBeGreaterThan(0);
    expect(within(card).getByText(/движения этой цели — у каждого своя задача/))
      .toBeTruthy();
  });

  it("задача открывается под этой же целью и уже привязана к движению", () => {
    const card = goalCard("активные пользователи");
    fireEvent.click(within(card).getAllByRole("button", { name: /^\+ задача/ })[0]);

    // Редактор открылся внутри карточки этой цели, а не внизу страницы.
    expect(within(card).getByText(/движение, которое выполняет задача/)).toBeTruthy();
    // Название взято у движения — задача выросла из него, а не наоборот.
    expect(within(card).queryByDisplayValue("Новая задача")).toBeNull();
    expect(within(card).getByText(/Движение задано тем, под чем заведена задача/))
      .toBeTruthy();
  });
});

describe("сдача задачи даёт факт", () => {
  it("«СДАТЬ» записывает фактическое количество и уводит на проверку", () => {
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));

    expect(screen.getByText(/фактически перешло в/)).toBeTruthy();
    const amount = screen.getByPlaceholderText("сколько");
    fireEvent.change(amount, { target: { value: "9" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));

    expect(screen.getByText(/сдано 9/)).toBeTruthy();
    // Сдал — не значит принято: «Готово» ставит тот, кто отчёт принял.
    expect(screen.getAllByDisplayValue("Проверка").length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("Готово")).toBeNull();
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
    expect(screen.getByText(/завести задачу/)).toBeTruthy();
    // Каждое движение цели — своя строка со своей кнопкой.
    expect(screen.getAllByRole("button", { name: "+ задача" }).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText(/задач: 0/).length).toBeGreaterThan(0);
  });

  it("созданная задача берёт название движения и привязывается к нему", () => {
    board();
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);
    // Движение задано тем, под чем нажали, и селекта для него больше нет:
    // переназначить задачу мимо своей цели нельзя.
    expect(screen.getByText(/Движение задано тем, под чем заведена задача/))
      .toBeTruthy();
    expect([...container.querySelectorAll("select")]
      .some((s) => s.textContent.includes("не привязана к движению"))).toBe(false);
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

    // Отчёт появился на Timeline — там видно, что и когда делалось.
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    // Строка таймлайна — та, где написано название задачи.
    const row = [...container.querySelectorAll("div")]
      .find((d) => d.style.cursor === "pointer");
    expect(row).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText(/перешло 3/)).toBeTruthy();
  });

});
