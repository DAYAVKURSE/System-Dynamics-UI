import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TaskSetup, newTask } from "../components/TasksBoard.jsx";

/* Чужие рейтинги в выпадающем списке постановки у не-владельца.

   У позванного постановщика в модели только свои задачи, и рейтинг рядом
   с именем считался по неполной модели — «без оценок» у человека, которого
   проверяли десять раз в чужих задачах. Ответ сервера `GET /ratings` —
   его глазами и по всей модели — теперь стоит и здесь, как в анкете. */

const ENTITIES = [{ id: "usr", name: "Пользователи", pickByOrder: false }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [], gives: [], setters: ["1"], owners: ["2", "3"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];
const task = () => ({ ...newTask({ funcId: "f1", title: "Задача A" }), setter: "1", status: "wait" });

function Setup({ ratings, meId = "1" }) {
  const [tasks, setTasks] = React.useState([task()]);
  return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS} entities={ENTITIES}
    traits={[]} setTasks={setTasks} people={PEOPLE} canAssign nameOf={(id) => id}
    meId={meId} ratings={ratings} />);
}
const option = (label, name) => [...screen.getByLabelText(label).querySelectorAll("option")]
  .map((o) => o.textContent).find((t) => t.startsWith(name));

describe("рейтинг в списке постановки", () => {
  it("без ответа сервера — по тому, что видно в модели", () => {
    render(<Setup />);
    expect(option("исполнитель", "Иван")).toMatch(/без оценок/);
  });

  it("с ответом сервера — средняя оттуда, число работ — из модели", () => {
    render(<Setup ratings={{ mine: { comments: [] },
      others: { 2: { mark: 8.5, count: 3, setup: { mark: null, count: 0 }, comments: [] } } }} />);
    expect(option("исполнитель", "Иван")).toMatch(/^Иван · 8\.5/);
    expect(option("исполнитель", "Пётр")).toMatch(/без оценок/);
  });

  it("про себя сервер цифр не даёт, и список не выдумывает: «свой рейтинг скрыт»", () => {
    render(<Setup meId="2" ratings={{ mine: { comments: [] },
      others: { 3: { mark: 4, count: 2, setup: { mark: null, count: 0 }, comments: [] } } }} />);
    expect(option("исполнитель", "Иван")).toMatch(/свой рейтинг скрыт/);
    expect(option("исполнитель", "Пётр")).toMatch(/^Пётр · 4/);
  });
});
