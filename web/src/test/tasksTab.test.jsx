import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import TasksTab from "../components/TasksTab.jsx";
import { newTask } from "../components/TasksBoard.jsx";
import { emptySpace } from "../lib/space.js";

const ENTITIES = [{ id: "usr", name: "Пользователи", color: "#fff", x: 0, y: 0 }];
const TRAITS = [{ id: "t1", e: "usr", k: "growth", l: "спрос", unit: "шт." }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }], gives: [],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TASK = { ...newTask({ funcId: "f1", title: "Задача A" }), status: "backlog",
  setter: "1", assignee: "2", reviewer: "3", end: "2030-01-01T10:00" };

function Host({ setOpenId = () => {} }) {
  const [tasks, setTasks] = React.useState([TASK]);
  const [space, setSpace] = React.useState(emptySpace);
  const [openId, setOpen] = React.useState(null);
  return <TasksTab funcs={FUNCS} entities={ENTITIES} traits={TRAITS} tasks={tasks} setTasks={setTasks}
    openId={openId} setOpenId={(id) => { setOpen(id); setOpenId(id); }} nameOf={(id) => id}
    space={space} setSpace={setSpace} files={[]} memory={[]} ask={async () => "ответ"} />;
}

beforeEach(() => localStorage.clear());

describe("вкладка задач — два вида", () => {
  it("по умолчанию доска; вводного текста на её месте больше нет", () => {
    render(<Host />);
    expect(screen.getByRole("button", { name: "Доска" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Бэклог")).toBeInTheDocument();
    expect(screen.queryByText(/задачи — то, что поручено/)).toBeNull();
    expect(screen.queryByRole("button", { name: "+ заметка" })).toBeNull();
  });

  it("«Пространство» показывает облако блоков и запоминается", () => {
    const { unmount } = render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Пространство" }));
    expect(screen.getByRole("button", { name: "+ заметка" })).toBeInTheDocument();
    expect(screen.queryByText("Бэклог")).toBeNull();
    expect(screen.getByText("Задача A")).toBeInTheDocument();
    expect(localStorage.getItem("sd_tasks_view")).toBe("space");
    unmount();
    render(<Host />);
    expect(screen.getByRole("button", { name: "Пространство" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "+ заметка" })).toBeInTheDocument();
  });

  it("мусор в памяти браузера — доска, как ни в чём не бывало", () => {
    localStorage.setItem("sd_tasks_view", "куда-то");
    render(<Host />);
    expect(screen.getByText("Бэклог")).toBeInTheDocument();
  });

  it("задача из пространства открывается на доске", () => {
    const setOpenId = vi.fn();
    render(<Host setOpenId={setOpenId} />);
    fireEvent.click(screen.getByRole("button", { name: "Пространство" }));
    fireEvent.click(screen.getByText("Задача A"));
    expect(setOpenId).toHaveBeenCalledWith(TASK.id);
    expect(screen.getByText("Бэклог")).toBeInTheDocument();
    expect(localStorage.getItem("sd_tasks_view")).toBe("board");
  });
});
