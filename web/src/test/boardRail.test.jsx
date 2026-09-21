import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import TasksBoard, { newTask } from "../components/TasksBoard.jsx";

/* ПОЛОСА ПРОКРУТКИ НАД ДОСКОЙ (владелец, 2026-09-20): «в задачах статусы
   прокручиваются вправо; нужно сделать линию прокрутки… над задачами,
   которая будет визуально показывать, что движение должно происходить
   вправо или влево».

   Полоса — про ОКНО, а не про задачи: бегунок показывает, какая часть
   доски видна, стрелки горят в ту сторону, где есть ещё. Помещается доска
   целиком — полосы нет. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }], gives: [],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];

function Board() {
  const [tasks, setTasks] = React.useState([
    { ...newTask({ funcId: "f1", title: "Задача A" }), setter: "1", assignee: "2", reviewer: "3" }]);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={(id) => id} meId="2" canAssign />);
}

/* jsdom не меряет ширину: задаём её доске руками, как задал бы экран. */
function widen(el, { scrollWidth, clientWidth }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollTo = ({ left }) => { el.scrollLeft = left; fireEvent.scroll(el); };
  fireEvent.scroll(el);
}

describe("полоса прокрутки над доской", () => {
  /* Системной полосы снизу нет: у доски класс `no-bar` (владелец,
     2026-09-21). */
  it("у доски спрятана системная полоса прокрутки", () => {
    render(<Board />);
    const board = document.querySelector("[data-pannable]");
    expect(board).toHaveClass("no-bar");
  });

  it("доска помещается — полосы нет", () => {
    const { container } = render(<Board />);
    widen(container.querySelector("[data-pannable]"), { scrollWidth: 400, clientWidth: 400 });
    expect(screen.queryByRole("scrollbar", { name: "прокрутка доски" })).toBeNull();
  });

  it("доска шире экрана — полоса показывает окно и везёт вправо и влево", () => {
    const { container } = render(<Board />);
    const board = container.querySelector("[data-pannable]");
    widen(board, { scrollWidth: 1000, clientWidth: 400 });
    const rail = screen.getByRole("scrollbar", { name: "прокрутка доски" });
    expect(rail).toHaveAttribute("aria-orientation", "horizontal");
    expect(rail).toHaveAttribute("aria-valuenow", "0");
    // У левого края влево ехать некуда, вправо — есть.
    expect(screen.getByRole("button", { name: "левее" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "правее" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "правее" }));
    expect(board.scrollLeft).toBe(198);
    expect(rail).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByRole("button", { name: "левее" })).toBeEnabled();

    // Доехали до конца — правая стрелка гаснет, окно дальше не уедет.
    board.scrollLeft = 600; fireEvent.scroll(board);
    expect(rail).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("button", { name: "правее" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "левее" }));
    expect(board.scrollLeft).toBe(402);
  });

  it("полоса стоит над доской, а не под ней", () => {
    const { container } = render(<Board />);
    const board = container.querySelector("[data-pannable]");
    widen(board, { scrollWidth: 1000, clientWidth: 400 });
    const rail = screen.getByRole("scrollbar", { name: "прокрутка доски" });
    expect(rail.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
