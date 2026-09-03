import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaskEditor, newTask } from "../components/TasksBoard.jsx";

/* Ресурсы, которые несут стрелки элемента, проверяются при сдаче задачи:
   у стрелки лежит вилка-гипотеза, исполнитель вписывает фактический
   расход, проверяющий видит одно рядом с другим. */

const traits = [{ id: "t1", e: "A", l: "деньги", unit: "₽" },
  { id: "t2", e: "A", l: "макеты", unit: "шт." }];
const funcs = [{ id: "f1", e: "A", name: "дизайнер", takes: [], gives: [] }];
const flows = [
  { id: "w1", from: "f1", to: "f2", trait: "t1", lo: 3, hi: 5 },
  { id: "w2", from: "f1", to: "f2", trait: "t2", lo: 1, hi: 1 },
];
const goals = [{ id: "g1", name: "Цель" }];
const edges = [{ id: "e1", from: "A", to: "t1", gives: 4, per: "мес" }];

let tasks;
const setTasks = (fn) => { tasks = typeof fn === "function" ? fn(tasks) : fn; };
const draw = () => render(
  <TaskEditor task={tasks[0]} goals={goals} traits={traits} entities={[{ id: "A", name: "Актив" }]}
    edges={edges} funcs={funcs} flows={flows} entityName={() => "Актив"}
    setTasks={setTasks} onClose={() => {}} onDelete={() => {}} />);

beforeEach(() => {
  tasks = [{ ...newTask({ goalId: "g1", edgeId: "e1", title: "Сделать" }), funcId: "f1" }];
});

describe("сдача по стрелкам элемента", () => {
  it("у задачи можно выбрать функцию элемента", () => {
    tasks = [newTask({ goalId: "g1", title: "Сделать" })];
    const { rerender } = draw();
    const pick = screen.getByLabelText("функция элемента");
    fireEvent.change(pick, { target: { value: "f1" } });
    expect(tasks[0].funcId).toBe("f1");
    rerender();
  });

  it("при сдаче спрашивают расход по каждой стрелке и показывают вилку", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    expect(screen.getByText("фактический расход по стрелкам")).toBeInTheDocument();
    expect(screen.getByText("деньги")).toBeInTheDocument();
    expect(screen.getByText("макеты")).toBeInTheDocument();
    // Вилка стоит рядом: человек видит, с чем сравнивают.
    expect(screen.getByText("план: от 3 до 5")).toBeInTheDocument();
    expect(screen.getByText("план: ровно 1")).toBeInTheDocument();
  });

  it("вписанный факт уезжает в сдачу по своей стрелке", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    const nums = [...document.querySelectorAll("input")].filter((i) => i.placeholder === "сколько");
    fireEvent.change(nums[1], { target: { value: "4" } });
    fireEvent.blur(nums[1]);
    fireEvent.change(nums[2], { target: { value: "9" } });
    fireEvent.blur(nums[2]);
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));

    const sub = tasks[0].submissions[0];
    expect(sub.facts).toEqual([{ flow: "w1", amount: 4 }, { flow: "w2", amount: 9 }]);
    expect(tasks[0].status).toBe("review");
  });

  it("незаполненная стрелка не превращается в ноль", () => {
    // «Не вписали» и «ничего не потратили» — разные вещи, и вторая должна
    // быть сказана явно.
    draw();
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    const nums = [...document.querySelectorAll("input")].filter((i) => i.placeholder === "сколько");
    fireEvent.change(nums[1], { target: { value: "4" } });
    fireEvent.blur(nums[1]);
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));
    expect(tasks[0].submissions[0].facts).toEqual([{ flow: "w1", amount: 4 }]);
  });
});

describe("проверяющий видит план рядом с фактом", () => {
  it("попавший в вилку и мимо неё различимы", () => {
    tasks = [{ ...tasks[0], submissions: [{ id: "s1", at: new Date().toISOString(),
      amount: 0, text: "", file: null, facts: [{ flow: "w1", amount: 4 }, { flow: "w2", amount: 9 }] }] }];
    draw();
    expect(screen.getByText("факт 4")).toBeInTheDocument();
    expect(screen.getByText("план от 3 до 5", { exact: false })).toBeInTheDocument();
    // Девять при плане «ровно 1» — расхождение, и оно названо.
    expect(screen.getByText(/мимо гипотезы/)).toBeInTheDocument();
  });
});
