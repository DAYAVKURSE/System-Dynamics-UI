import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import TasksBoard, { TaskSetup, newTask } from "../components/TasksBoard.jsx";
import { dropCommentRemote } from "../identity.js";

/* Убрать комментарий (✕).

   Модель целиком пишет владелец, поэтому у позванного нажатие ✕ раньше
   жило только в окне: сервера операции не было, и комментарий возвращался
   с перезагрузкой. Теперь удаление у позванного уходит на сервер своей
   операцией (DELETE …/comments/:cid), а ✕ показывается по тому же
   правилу, что и на сервере: владельцу — у любого, остальным — у своего.
   Показывать шире значило бы обещать то, что не сбудется. */

const ENTITIES = [{ id: "usr", name: "Пользователи", setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [], gives: [], setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];
const nameOf = (id) => PEOPLE.find((p) => p.id === String(id))?.name || String(id);

const COMMENTS = [
  { id: "c_ivan", text: "моё слово", at: "2026-01-01T10:00:00Z", by: "2", to: null, hidden: false },
  { id: "c_petr", text: "слово Петра", at: "2026-01-01T10:01:00Z", by: "3", to: null, hidden: false },
];
const task = (over = {}) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  setter: "1", assignee: "2", reviewer: "3", status: "progress", comments: COMMENTS, ...over });

function Board({ meId, canAssign, onDropComment, last }) {
  const [tasks, setTasks] = React.useState([task()]);
  const [openId, setOpenId] = React.useState("");
  if (last) last.current = tasks;
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={nameOf} meId={meId} canAssign={canAssign} onDropComment={onDropComment} />);
}
const row = (text) => screen.getByText(text).parentElement;
const cross = (text) => within(row(text)).queryByLabelText("убрать комментарий");

afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

describe("✕ у комментария", () => {
  it("исполнитель видит ✕ только у своего; удаление уходит наружу с задачей и id", () => {
    const dropped = [];
    const last = { current: null };
    render(<Board meId="2" canAssign={false} onDropComment={(t, id) => dropped.push([t.id, id])} last={last} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(cross("моё слово")).toBeInTheDocument();
    expect(cross("слово Петра")).toBeNull();
    fireEvent.click(cross("моё слово"));
    expect(screen.queryByText("моё слово")).toBeNull();
    expect(screen.getByText("слово Петра")).toBeInTheDocument();
    expect(last.current[0].comments.map((c) => c.id)).toEqual(["c_petr"]);
    expect(dropped).toEqual([[last.current[0].id, "c_ivan"]]);
  });

  it("владелец видит ✕ у любого", () => {
    render(<Board meId="1" canAssign onDropComment={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(cross("моё слово")).toBeInTheDocument();
    expect(cross("слово Петра")).toBeInTheDocument();
  });

  it("в постановке слова только читаются: ни ✕, ни формы — пишет исполнитель при сдаче", () => {
    /* Форма постановки — только постановка. Комментарий к ней пишет
       исполнитель, когда сдаёт; постановщику здесь показывают сказанное —
       адресованное ему и публичное, — и ничего с ним сделать нельзя. */
    const Host = () => {
      const [tasks, setTasks] = React.useState([task({ status: "wait" })]);
      return <TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS} traits={TRAITS}
        entities={ENTITIES} people={PEOPLE} canAssign={false} nameOf={nameOf} meId="3"
        setTasks={setTasks} onClose={() => {}} />;
    };
    render(<Host />);
    expect(screen.getByText("слово Петра")).toBeInTheDocument();
    expect(screen.getByText("моё слово")).toBeInTheDocument();
    expect(cross("слово Петра")).toBeNull();
    expect(cross("моё слово")).toBeNull();
    expect(screen.queryByPlaceholderText("написать комментарий")).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
  });
});

describe("dropCommentRemote", () => {
  it("DELETE /api/workspace/tasks/:id/comments/:cid с подписью; 204 — пустой ответ", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 204, json: async () => null }));
    const out = await dropCommentRemote("t 1", "c/1");
    expect(out).toBeNull();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/workspace/tasks/t%201/comments/c%2F1");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers["X-Telegram-Init-Data"]).toBeDefined();
  });

  it("отказ сервера — ошибка его словами", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "not yours" }) }));
    await expect(dropCommentRemote("t1", "c1")).rejects.toThrow("not yours");
  });
});
