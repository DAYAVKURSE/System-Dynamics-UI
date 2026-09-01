import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { sameDoc } from "../lib/history.js";

/* Отмена и возврат правок модели.
   Удаление актива и удаление классификации каскадные и подтверждения не
   спрашивают — эти тесты держат обратный ход. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const undoBtn = () => screen.getByRole("button", { name: /отменить/ });
const redoBtn = () => screen.getByRole("button", { name: /вернуть/ });
const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
const addEntity = () => fireEvent.click(screen.getByRole("button", { name: "+ актив" }));

const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

// Блок актива на схеме: у него перетаскивание, поэтому pointer-события.
const entityG = (name) => {
  const g = [...container.querySelectorAll("svg g")].find((el) =>
    [...el.querySelectorAll("text")].some((t) => t.textContent === name));
  if (!g) throw new Error(`актив «${name}» не найден на схеме`);
  return g;
};
const entityRect = (name) => entityG(name).querySelector("rect");
const entityNames = () => [...container.querySelectorAll("svg g text")]
  .map((t) => t.textContent);

// Выбор актива — pointer-события: у блока перетаскивание, и обычный click
// до обработчика не доходит.
function selectEntity(name) {
  const g = entityG(name);
  fireEvent.pointerDown(g, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: 10, clientY: 10, pointerId: 1 });
}

describe("кнопки истории", () => {
  it("в начале отменять нечего", () => {
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
  });

  it("видны с любой вкладки — правки есть везде", () => {
    for (const tab of ["Цели", "Задачи", "Схема", "Симуляция", "Типы", "JSON"]) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(undoBtn()).toBeTruthy();
    }
  });
});

describe("отмена правки значения", () => {
  it("возвращает прежнее название актива и снова его убирает", () => {
    scheme();
    selectEntity("Пользователи");
    commit(screen.getByDisplayValue("Пользователи"), "Клиенты");
    expect(entityNames()).toContain("Клиенты");

    fireEvent.click(undoBtn());
    expect(entityNames()).toContain("Пользователи");

    fireEvent.click(redoBtn());
    expect(entityNames()).toContain("Клиенты");
  });

  it("повторная запись того же значения шагом не считается", () => {
    scheme();
    selectEntity("Пользователи");
    commit(screen.getByDisplayValue("Пользователи"), "Клиенты");
    commit(screen.getByDisplayValue("Клиенты"), "Клиенты");

    // Один шаг — значит после одной отмены отменять уже нечего.
    fireEvent.click(undoBtn());
    expect(undoBtn()).toBeDisabled();
  });
});

describe("отмена структурных правок", () => {
  it("возвращает удалённый актив вместе с его ресурсами и стрелками", () => {
    scheme();
    const arrowsBefore = container.querySelectorAll("svg line").length;
    selectEntity("Реферальная система");
    fireEvent.click(screen.getByRole("button", { name: "Удалить актив" }));
    expect(entityNames()).not.toContain("Реферальная система");

    fireEvent.click(undoBtn());
    expect(entityNames()).toContain("Реферальная система");
    expect(container.querySelectorAll("svg line").length).toBe(arrowsBefore);
  });

  it("убирает добавленный актив", () => {
    scheme();
    addEntity();
    expect(entityNames()).toContain("Новый актив");
    fireEvent.click(undoBtn());
    expect(entityNames()).not.toContain("Новый актив");
  });

  it("возвращает удалённую классификацию и прежний тип ресурса", () => {
    fireEvent.click(screen.getByRole("button", { name: "Типы" }));
    const before = screen.getAllByDisplayValue("рост").length;
    const card = screen.getByDisplayValue("рост").closest("div").parentElement;
    fireEvent.click(within(card).getByRole("button", { name: /удалить/i }));
    expect(screen.queryAllByDisplayValue("рост")).toHaveLength(0);

    fireEvent.click(undoBtn());
    expect(screen.getAllByDisplayValue("рост")).toHaveLength(before);
  });
});

describe("перетаскивание", () => {
  it("весь жест — один шаг, а не полсотни промежуточных положений", () => {
    scheme();
    const g = entityG("Пользователи");
    const x0 = entityRect("Пользователи").getAttribute("x");

    fireEvent.pointerDown(g, { clientX: 0, clientY: 0, pointerId: 1 });
    for (let i = 1; i <= 6; i++)
      fireEvent.pointerMove(g, { clientX: i * 20, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 120, clientY: 0, pointerId: 1 });

    expect(entityRect("Пользователи").getAttribute("x")).not.toBe(x0);
    fireEvent.click(undoBtn());
    expect(entityRect("Пользователи").getAttribute("x")).toBe(x0);
    expect(undoBtn()).toBeDisabled(); // шаг был ровно один
  });

  it("тап по активу историю не трогает", () => {
    scheme();
    const g = entityG("Пользователи");
    fireEvent.pointerDown(g, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(undoBtn()).toBeDisabled();
  });
});

describe("клавиши", () => {
  it("Ctrl+Z отменяет, Ctrl+Shift+Z возвращает", () => {
    scheme();
    addEntity();
    expect(entityNames()).toContain("Новый актив");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(entityNames()).not.toContain("Новый актив");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(entityNames()).toContain("Новый актив");
  });

  it("в поле ввода Ctrl+Z остаётся браузерным — набранный текст важнее", () => {
    scheme();
    addEntity();
    const field = screen.getByDisplayValue("Новый актив");
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });
    expect(entityNames()).toContain("Новый актив");
  });
});

describe("прогноз после отмены", () => {
  it("отмена «взять в работу» возвращает и рекомендацию, и прогноз", () => {
    const recs = () => screen.queryAllByRole("button", { name: "Взять в работу" });
    const before = recs().length;
    fireEvent.click(recs()[0]);
    expect(recs().length).toBeLessThan(before);

    fireEvent.click(undoBtn());
    expect(recs().length).toBe(before);
    expect(screen.queryByText(/взято в работу/)).toBeNull();
  });

  it("отмена уносит и заведённые под рекомендацию KR с задачей", () => {
    // Пустая колонка канбана подписана «Пусто.» — считаем по ним, не завися
    // от текста конкретной рекомендации.
    const tasks = () => fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    const goals = () => fireEvent.click(screen.getByRole("button", { name: "Цели" }));
    const emptyCols = () => screen.queryAllByText("Пусто.").length;

    tasks();
    const allEmpty = emptyCols();
    expect(allEmpty).toBeGreaterThan(0);

    goals();
    fireEvent.click(screen.getAllByRole("button", { name: "Взять в работу" })[0]);
    tasks();
    expect(emptyCols()).toBeLessThan(allEmpty);

    fireEvent.click(undoBtn());
    expect(emptyCols()).toBe(allEmpty);
  });
});

describe("sameDoc", () => {
  it("одинаковые по содержанию документы считает равными", () => {
    expect(sameDoc({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
  });
  it("разницу в глубине замечает", () => {
    expect(sameDoc({ a: [{ b: 2 }] }, { a: [{ b: 3 }] })).toBe(false);
    expect(sameDoc({ a: 1 }, { a: 1, c: 2 })).toBe(false);
    expect(sameDoc([1, 2], [1, 2, 3])).toBe(false);
  });
});
