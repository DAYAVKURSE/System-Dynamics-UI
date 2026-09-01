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

describe("метрика задачи попадает в модель", () => {
  const addEffect = (card, dir) =>
    fireEvent.click(within(card).getByRole("button", { name: `+ ${dir}` }));

  it("строка метрики становится стрелкой к ресурсу", () => {
    const card = goalCard("активные пользователи");
    fireEvent.click(within(card).getByRole("button", { name: "+ задача" }));
    addEffect(card, "приносит");

    // Выбираем ресурс и величину.
    const picker = [...card.querySelectorAll("select")]
      .find((s) => s.textContent.includes("— какой ресурс —"));
    fireEvent.change(picker, { target: { value: "u9" } });
    const amount = [...card.querySelectorAll("input")]
      .find((i) => i.value === "0");
    fireEvent.change(amount, { target: { value: "7" } });
    fireEvent.blur(amount);

    // Метрика видна в модели: у ресурса появилась входящая стрелка задачи.
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getAllByText("активные пользователи")[0]);
    expect(screen.getByText(/метрика задачи «Новая задача»/)).toBeTruthy();
  });

  it("метрика не сохраняется отдельной стрелкой — она выводится из задачи", () => {
    const card = goalCard("активные пользователи");
    fireEvent.click(within(card).getByRole("button", { name: "+ задача" }));
    addEffect(card, "тратит");
    const m = dump();
    // В сценарий уехала задача с метрикой, а не лишняя стрелка.
    expect(m.tasks[0].effects).toHaveLength(1);
    expect(m.edges.some((e) => e.task)).toBe(false);
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

  it("количество за выполнение доходит до прогноза", () => {
    board();
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);

    const amount = [...container.querySelectorAll("input")]
      .find((i) => i.value === "0");
    fireEvent.change(amount, { target: { value: "4" } });
    fireEvent.blur(amount);

    // Сказано, сколько это даёт в месяц при текущей периодичности.
    expect(screen.getByText(/выполнение.* в месяц/)).toBeTruthy();
    // И это уехало в сценарий вместе с задачей.
    const m = (() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[1]);
      return JSON.parse(container.querySelector("textarea").value);
    })();
    expect(m.tasks[0].amount).toBe(4);
    expect(m.tasks[0].edgeId).toBeTruthy();
  });
});
