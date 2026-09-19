import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import React from "react";

/* ШАПКА (владелец, 2026-09-19).

   «Убери надпись „активы, воркеры, функции, ресурсы" из шапки. Убери поле
   „горизонт". Сделай кнопки „отменить" и „вернуть" над вкладками, добавив
   туда кнопку „сохранить", и сделай так, чтобы они были значками без
   надписей. Сделай название приложения Blocktree». */

describe("шапка", () => {
  it("в шапке имя приложения со знаком, а не перечень того, что внутри", () => {
    const { container } = render(<SystemModel />);
    expect(screen.getByLabelText("Blocktree")).toBeInTheDocument();
    expect(screen.getByText("Blocktree")).toBeInTheDocument();
    expect(screen.queryByText(/Активы: воркеры/)).toBeNull();
    /* Знак — картинка, присланная владельцем (2026-09-19), рядом с именем.
       Логотип стоит только здесь. */
    expect(screen.getByLabelText("Blocktree").querySelector("img")).toBeTruthy();
    expect(container.textContent).not.toMatch(/горизонт/i);
  });

  it("отменить, вернуть и сохранить — значками у правого края, за вкладками", () => {
    render(<SystemModel />);
    ["отменить", "вернуть", "сохранить"].forEach((name) => {
      const b = screen.getByRole("button", { name });
      // Значок, а не надпись: внутри только рисунок.
      expect(b.textContent).toBe("");
      expect(b.querySelector("svg")).toBeTruthy();
      // Приглушены: значок не спорит за внимание с работой (владелец,
      // 2026-09-19 — «на 30% прозрачнее»).
      expect(Number(b.style.opacity)).toBeLessThanOrEqual(0.7);
    });
    /* Значки — ПОСЛЕ вкладок в строке шапки: они у правого края, вкладки
       сразу за знаком. */
    const undo = screen.getByRole("button", { name: "отменить" });
    const tab = screen.getByRole("button", { name: "Схема" });
    expect(tab.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("вкладки стоят справа от знака и выглядят вкладками, а не кнопками", () => {
    render(<SystemModel />);
    const brand = screen.getByLabelText("Blocktree");
    const tab = screen.getByRole("button", { name: "Схема" });
    // Знак и вкладки — в одной строке, знак первым.
    expect(brand.compareDocumentPosition(tab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(brand.closest("div").parentElement).toBe(tab.closest("div").parentElement);
    // Верх скруглён, низ — нет: вкладка сливается с полосой под рядом.
    expect(tab.style.borderRadius).toBe("8px 8px 0 0");
  });

  it("«сохранить» без имени сценария уводит туда, где его называют", () => {
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "сохранить" }));
    expect(screen.getByPlaceholderText("имя сценария")).toBeInTheDocument();
  });
});

/* Владелец (2026-09-19): «на схеме должны быть стрелки строго вертикальные
   и горизонтальные с закруглениями». */
const straight = (d) => {
  /* Разбираем путь на команды и проверяем каждый ПРЯМОЙ отрезок: он либо
     вертикальный, либо горизонтальный. Углы — «Q», их и не проверяем. */
  const cmds = d.match(/[MLQ][^MLQ]*/g) || [];
  let cur = null;
  return cmds.every((c) => {
    const nums = (c.slice(1).match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const end = pts[pts.length - 1];
    if (c[0] === "M" || !cur) { cur = end; return true; }
    const ok = c[0] === "Q" || Math.abs(end[0] - cur[0]) < 0.6 || Math.abs(end[1] - cur[1]) < 0.6;
    cur = end;
    return ok;
  });
};

describe("стрелки схемы", () => {
  it("передача — колено: строго по вертикали и горизонтали, углы скруглены", () => {
    const { container } = render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    const moves = [...container.querySelectorAll("[data-move]")];
    expect(moves.length).toBeGreaterThan(0);
    moves.forEach((p) => {
      expect(p.tagName.toLowerCase()).toBe("path");
      const d = p.getAttribute("d");
      expect(d.startsWith("M")).toBe(true);
      expect(straight(d)).toBe(true);
    });
  });
});

export { straight };

/* Логотип — ТОЛЬКО в шапке (владелец, 2026-09-19: «нигде больше логотипа
   не должно быть, кроме шапки»). */
describe("логотип только в шапке", () => {
  it("на форме постановки задачи знака нет", async () => {
    const { TaskSetup, newTask } = await import("../components/TasksBoard.jsx");
    const FUNCS = [{ id: "f1", e: "e1", name: "Ф", dur: 1, durUnit: "ч",
      takes: [], gives: [], owners: ["1"] }];
    const Host = () => {
      const [tasks, setTasks] = React.useState([newTask({ funcId: "f1", title: "Задача" })]);
      return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS}
        entities={[{ id: "e1", name: "Актив" }]} traits={[]}
        setTasks={setTasks} people={[]} nameOf={(id) => id} />);
    };
    const { container } = render(<Host />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByLabelText("знак задачи")).toBeNull();
  });
});
