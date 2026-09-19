import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

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
    // Знак — рисованный, рядом с именем.
    expect(screen.getByLabelText("Blocktree").querySelector("svg")).toBeTruthy();
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

describe("стрелки схемы", () => {
  it("передача — мягкая дуга, а не прямая", () => {
    const { container } = render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    const moves = [...container.querySelectorAll("[data-move]")];
    expect(moves.length).toBeGreaterThan(0);
    moves.forEach((p) => {
      expect(p.tagName.toLowerCase()).toBe("path");
      // Квадратичная кривая: у прямой линии никакого «Q» нет.
      expect(p.getAttribute("d")).toMatch(/^M[\d.,-]+ Q[\d.,-]+ [\d.,-]+$/);
    });
  });
});
