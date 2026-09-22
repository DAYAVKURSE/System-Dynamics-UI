import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Timeline from "../components/Timeline.jsx";

/* Таймлайн работы (владелец, 2026-09-22): на линейке — одно слово
   «сегодня» без даты под ним; полосы в одном поле, линия сегодняшнего дня
   через все задачи. */
const DAY = 86400000;
const fmtD = (ms) => new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

describe("таймлайн работы", () => {
  it("«сегодня» словом, дата под ним не пишется; полосы в одном поле с общей линией дня", () => {
    const now = Date.now();
    const tasks = [
      { id: "a", funcId: "f", title: "Первая", status: "done", start: new Date(now - 3 * DAY).toISOString(), submissions: [] },
      { id: "b", funcId: "f", title: "Вторая", status: "done", start: new Date(now - DAY).toISOString(), submissions: [] },
    ];
    render(<Timeline tasks={tasks} funcs={[{ id: "f", dur: 2, durUnit: "дн" }]} />);
    expect(screen.getByLabelText("сегодня")).toHaveTextContent("сегодня");
    expect(screen.queryByText(fmtD(now))).toBeNull();
    const field = screen.getByLabelText("поле таймлайна");
    expect(screen.getAllByLabelText("поле таймлайна")).toHaveLength(1);
    expect(within(field).getByLabelText("линия сегодняшнего дня")).toBeInTheDocument();
    // Две задачи — две строки внутри одного поля, у строк своей рамки нет.
    const rowsIn = [...field.children].filter((n) => n.tagName === "DIV");
    expect(rowsIn).toHaveLength(2);
    rowsIn.forEach((r) => expect(r.style.border).toBe(""));
  });
});
