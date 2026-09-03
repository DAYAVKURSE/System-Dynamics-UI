import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Схема: перетаскивание блоков и выравнивание по сетке.
   Перетаскивание на телефоне шло рывками — тесты держат обе причины:
   события уходили мимо блока, и модель перерисовывалась на каждое движение. */

let container;
beforeEach(() => {
  ({ container } = render(<SystemModel />));
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
});

const entityG = (name) => {
  const g = [...container.querySelectorAll("svg g")].find((el) =>
    [...el.querySelectorAll("text")].some((t) => t.textContent === name));
  if (!g) throw new Error(`актив «${name}» не найден на схеме`);
  return g;
};
const xOf = (name) => Number(entityG(name).querySelector("rect").getAttribute("x"));
const undoBtn = () => screen.getByRole("button", { name: /отменить/ });

// Состояние модели читаем через выгрузку JSON — не через то, что нарисовано.
const model = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  const m = JSON.parse(container.querySelector("textarea").value);
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  return m;
};
const at = (m, name) => m.entities.find((e) => e.name === name);

const pd = (el, x, y) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 });
const pm = (el, x, y) =>
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
const pu = (el, x, y) =>
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });

describe("перетаскивание блока", () => {
  it("продолжается, когда палец ушёл за границы блока", () => {
    // Ровно это и давало рывки: события висели на самом блоке, палец его
    // обгонял, и движение обрывалось до следующего касания блока.
    const g = entityG("Пользователи");
    const x0 = xOf("Пользователи");

    pd(g, 0, 0);
    pm(document.body, 400, 0);
    pu(document.body, 400, 0);

    expect(xOf("Пользователи")).toBeGreaterThan(x0);
  });

  it("блок идёт за пальцем ещё до отпускания", () => {
    const g = entityG("Пользователи");
    const x0 = xOf("Пользователи");

    pd(g, 0, 0);
    pm(document.body, 200, 0);
    expect(xOf("Пользователи")).toBeGreaterThan(x0); // видно сразу, без отпускания

    pu(document.body, 200, 0);
  });

  it("во время жеста модель не трогается — правка одна, в конце", () => {
    // Правка модели на каждое движение перерисовывала всё приложение; на
    // телефоне это и тормозило. Признак — история пуста до отпускания.
    const g = entityG("Пользователи");
    pd(g, 0, 0);
    pm(document.body, 100, 0);
    pm(document.body, 200, 0);
    pm(document.body, 300, 0);
    expect(undoBtn()).toBeDisabled();

    pu(document.body, 300, 0);
    expect(undoBtn()).toBeEnabled();
  });

  it("прокрутка холста во время жеста гасится", () => {
    const scroll = () => {
      const ev = new Event("touchmove", { bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(scroll()).toBe(false); // вне жеста схема прокручивается как обычно

    pd(entityG("Пользователи"), 0, 0);
    pm(document.body, 100, 0);
    expect(scroll()).toBe(true); // ведём блок — браузер не уводит жест в прокрутку

    pu(document.body, 100, 0);
    expect(scroll()).toBe(false);
  });

  it("прерванный жест не теряет уже сделанное движение", () => {
    const g = entityG("Пользователи");
    const x0 = xOf("Пользователи");
    pd(g, 0, 0);
    pm(document.body, 250, 0);
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(xOf("Пользователи")).toBeGreaterThan(x0);
    expect(undoBtn()).toBeEnabled();
  });

  it("тап без сдвига по-прежнему открывает блок, а не двигает его", () => {
    const x0 = xOf("Реферальная система");
    pd(entityG("Реферальная система"), 5, 5);
    pu(document.body, 6, 6);

    expect(xOf("Реферальная система")).toBe(x0);
    expect(screen.getByDisplayValue("Реферальная система")).toBeTruthy();
    expect(undoBtn()).toBeDisabled();
  });
});

describe("выравнивание по сетке", () => {
  // Блоки нарочно вразнобой: два в верхнем ряду, два в нижнем.
  const MESSY = {
    entities: [
      { id: "a", name: "А", color: "#fff", x: 300, y: 10 },
      { id: "b", name: "Б", color: "#eee", x: 50, y: 40 },
      { id: "c", name: "В", color: "#ddd", x: 500, y: 400 },
      { id: "d", name: "Г", color: "#ccc", x: 20, y: 430 },
    ],
    traits: [], edges: [],
  };
  const load = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    const area = container.querySelector("textarea");
    fireEvent.change(area, { target: { value: JSON.stringify(MESSY) } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  };
  const align = () => fireEvent.click(screen.getByRole("button", { name: /выровнять/ }));

  it("ставит блоки на одну сетку", () => {
    load();
    align();
    const m = model();

    // Шаг сетки — размер блока плюс зазор: 208+48 по горизонтали и
    // 126+56 по вертикали. Блок стал выше на строку подписи «актив».
    m.entities.forEach((e) => {
      expect((e.x - 24) % 256).toBe(0);
      expect((e.y - 24) % 182).toBe(0);
    });
  });

  it("сохраняет расстановку: кто был в одном ряду — там и остался", () => {
    load();
    align();
    const m = model();

    expect(at(m, "А").y).toBe(at(m, "Б").y);   // верхний ряд
    expect(at(m, "В").y).toBe(at(m, "Г").y);   // нижний ряд
    expect(at(m, "А").y).toBeLessThan(at(m, "В").y);
    // Кто был левее, левее и остался.
    expect(at(m, "Б").x).toBeLessThan(at(m, "А").x);
    expect(at(m, "Г").x).toBeLessThan(at(m, "В").x);
  });

  it("прижимает схему к левому верхнему углу, а не оставляет пустоту", () => {
    load();
    align();
    const m = model();
    expect(Math.min(...m.entities.map((e) => e.x))).toBe(24);
    expect(Math.min(...m.entities.map((e) => e.y))).toBe(24);
  });

  it("это один шаг истории — отмена возвращает прежнюю расстановку", () => {
    load();
    align();
    fireEvent.click(undoBtn());
    const m = model();

    MESSY.entities.forEach((e) => {
      expect(at(m, e.name).x).toBe(e.x);
      expect(at(m, e.name).y).toBe(e.y);
    });
  });

  it("на нетронутой схеме тоже работает и ничего не ломает", () => {
    const before = model().entities.length;
    align();
    const m = model();
    expect(m.entities).toHaveLength(before);
    expect(m.entities.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y))).toBe(true);
  });
});
