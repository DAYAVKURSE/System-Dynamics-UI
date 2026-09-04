import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

// Карточки прогноза свёрнуты: имя и график. Рычаги, гипотезы и задачи
// разворачиваются нажатием на заголовок, поэтому тесты сначала раскрывают всё.
const expandCards = (container) => {
  [...container.querySelectorAll("span")]
    .filter((s) => s.textContent === "\u25b8")
    .forEach((s) => fireEvent.click(s.parentElement));
};

import { sameDoc } from "../lib/history.js";

/* Отмена и возврат правок модели.
   Удаление актива и удаление классификации каскадные и подтверждения не
   спрашивают — эти тесты держат обратный ход. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const undoBtn = () => screen.getByRole("button", { name: /отменить/ });
/* «Вернуть» есть и на проверке («Вернуть в бэклог») — берём кнопку шапки
   со стрелкой, а не любое слово «вернуть». */
const redoBtn = () => screen.getByRole("button", { name: /↷ вернуть/ });
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
    /* «Прогноз» и «Timeline» — подвкладки под схемой, поэтому до них надо
       сначала открыть её. */
    for (const tab of ["Задачи", "Проверка", "Схема", "Прогноз", "Timeline",
      "Управление", "Инструменты"]) {
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
  it("возвращает удалённый актив вместе с его ресурсами и передачами", () => {
    scheme();
    const arrowsBefore = container.querySelectorAll("svg line").length;
    selectEntity("Виртуальный менеджер");
    fireEvent.click(screen.getByRole("button", { name: "Удалить актив" }));
    expect(entityNames()).not.toContain("Виртуальный менеджер");
    // Передачи в удалённый актив исчезают вместе с ним.
    expect(container.querySelectorAll("svg line").length).toBeLessThan(arrowsBefore);

    fireEvent.click(undoBtn());
    expect(entityNames()).toContain("Виртуальный менеджер");
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
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    // Классификации — на вкладке ресурсов и под спойлером.
    fireEvent.click(screen.getByRole("button", { name: /^Ресурсы/ }));
    fireEvent.click(screen.getByRole("button", { name: /классификации ресурсов/ }));
    const before = screen.getAllByDisplayValue("рост").length;
    const card = screen.getByDisplayValue("рост").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "✕" }));
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

describe("отмена в работе с функциями", () => {
  it("возвращает удалённую функцию вместе с её задачами", () => {
    // Функция — то, по чему считается прогноз, и то, что выполняют задачи:
    // потерять её отменяемым движением нельзя.
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    selectEntity("Пользователи");
    const name = () => screen.queryByDisplayValue("Сбор заявок");
    expect(name()).toBeInTheDocument();

    const card = name().closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));
    expect(name()).toBeNull();

    fireEvent.click(undoBtn());
    expect(screen.getByDisplayValue("Сбор заявок")).toBeInTheDocument();
  });

  it("отмена возвращает прежний диапазон входа — и прогноз вместе с ним", () => {
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    selectEntity("Пользователи");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть функции" })[0]);
    const field = screen.getByLabelText("сколько максимум спрос");
    const was = field.value;
    fireEvent.change(field, { target: { value: "40" } });
    expect(screen.getByLabelText("сколько максимум спрос").value).toBe("40");

    fireEvent.click(undoBtn());
    expect(screen.getByLabelText("сколько максимум спрос").value).toBe(was);
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
