import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import TasksBoard, { BOARD, newTask } from "../components/TasksBoard.jsx";
import ReviewBoard, { canKill } from "../components/ReviewBoard.jsx";

/* ГОТОВЫЕ — НА «ПРОВЕРКЕ», ОТМЕНА — ЭТО ОТМЕНА РАБОТЫ.

   Доска задач отвечает на вопрос «что мне делать»: колонка со сделанным
   отвечала на другой, и её там больше нет — готовые смотрят там, где их
   принимали.

   «Отменить» на доске — про РАБОТУ: задача в работе, человек её бросает,
   и она возвращается в бэклог. Лежащую в бэклоге отменять не за что: её
   никто не делает. Удаляют насовсем на «Проверке», и только пока задачу
   не начали: у начатой есть сдачи, часы и оценки. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" },
  { id: "3", name: "Пётр" }];

const task = (over = {}) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  setter: "1", assignee: "2", reviewer: "3", end: "2030-01-01T10:00", ...over });

function Board({ tasks: t0, meId = "2" }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={(id) => id} meId={meId} canAssign />);
}
function Review({ tasks: t0, onDelete }) {
  const [tasks, setTasks] = React.useState(t0);
  return (<ReviewBoard tasks={tasks} setTasks={setTasks} funcs={FUNCS} traits={TRAITS}
    entities={ENTITIES} people={PEOPLE} meId="1" isOwner canAssign nameOf={(id) => id}
    onAccept={() => {}} onReturn={() => {}} onDelete={onDelete} />);
}

describe("готовых на доске задач нет", () => {
  it("колонки «Готово» нет вовсе", () => {
    expect(BOARD.map((c) => c.name)).not.toContain("Готово");
  });

  it("принятая задача с доски уходит, а в работе остаётся", () => {
    render(<Board tasks={[task({ id: "a", status: "done", taken: true }),
      task({ id: "b", title: "Задача B", status: "progress", taken: true })]} />);
    expect(screen.queryByText("Задача A")).toBeNull();
    expect(screen.getByText("Задача B")).toBeInTheDocument();
  });

  it("на «Проверке» готовые стоят своим разделом", () => {
    render(<Review tasks={[task({ id: "a", status: "done", taken: true,
      submissions: [{ id: "s1", at: "2026-01-01T10:00:00Z", hours: 2 }] })]} />);
    expect(screen.getByText("готовые")).toBeInTheDocument();
    expect(screen.getByText("Задача A")).toBeInTheDocument();
  });
});

describe("«Отменить» — это отмена работы", () => {
  it("у взятой в работу есть, и она возвращается в бэклог", () => {
    render(<Board tasks={[task({ id: "a", status: "progress", taken: true })]} />);
    fireEvent.click(screen.getByLabelText("отменить работу Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "Да, вернуть в бэклог" }));
    // Карточка осталась, но уже в бэклоге — её снова можно взять.
    expect(screen.getByText("Задача A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Взять в работу" })).toBeInTheDocument();
    expect(screen.queryByLabelText("отменить работу Задача A")).toBeNull();
  });

  it("у лежащей в бэклоге кнопки нет: её никто не делает", () => {
    render(<Board tasks={[task({ id: "a", status: "backlog" })]} />);
    expect(screen.getByRole("button", { name: "Взять в работу" })).toBeInTheDocument();
    expect(screen.queryByLabelText("отменить работу Задача A")).toBeNull();
  });

  it("у сданной и принятой — тоже нет: одну проверяют, другую сделали", () => {
    render(<Board tasks={[task({ id: "a", status: "review", taken: true })]} />);
    expect(screen.queryByLabelText("отменить работу Задача A")).toBeNull();
  });
});

describe("удалить можно только то, что ещё не начали", () => {
  it("правило одно на всё приложение", () => {
    expect(canKill(task({ status: "wait" }))).toBe(true);
    expect(canKill(task({ status: "backlog" }))).toBe(true);
    expect(canKill(task({ status: "deferred" }))).toBe(true);
    expect(canKill(task({ status: "progress", taken: true }))).toBe(false);
    expect(canKill(task({ status: "review" }))).toBe(false);
    expect(canKill(task({ status: "done" }))).toBe(false);
    // Сдача есть — значит работа была, и стирать её нельзя.
    expect(canKill(task({ status: "backlog", submissions: [{ id: "s1" }] }))).toBe(false);
  });

  it("непоставленная удаляется с подтверждением", () => {
    const killed = [];
    render(<Review tasks={[{ ...task({ id: "a", status: "wait" }), setter: null,
      assignee: null, reviewer: null }]} onDelete={(t) => killed.push(t.id)} />);
    fireEvent.click(screen.getByLabelText("удалить задачу Задача A"));
    expect(screen.getByText("удалить насовсем?")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("да, удалить Задача A"));
    expect(killed).toEqual(["a"]);
  });

  it("без обработчика задача исчезает из списка сама", () => {
    render(<Review tasks={[{ ...task({ id: "a", status: "wait" }), setter: null,
      assignee: null, reviewer: null }]} />);
    fireEvent.click(screen.getByLabelText("удалить задачу Задача A"));
    fireEvent.click(screen.getByLabelText("да, удалить Задача A"));
    expect(screen.queryByText("Задача A")).toBeNull();
  });

  it("у взятой в работу кнопки удаления нет вовсе", () => {
    render(<Review tasks={[task({ id: "a", status: "progress", taken: true })]} />);
    expect(screen.queryByLabelText("удалить задачу Задача A")).toBeNull();
  });
});
