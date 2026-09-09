import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel, { docFrom } from "../components/SystemModel.jsx";
import { newTask } from "../components/TasksBoard.jsx";
import { normalizeGoals } from "../lib/goals.js";
import { emptySpace, normalizeSpace } from "../lib/space.js";

/* «Загрузить» из выгрузки читает документ ЦЕЛИКОМ.

   «Выгрузить» отдаёт весь документ, а «Загрузить» собирал его своим
   набором сеттеров и молча терял всё, что появилось в документе позже:
   цели, факторы, отчёты, пространство. Теперь путь один — тот же, что у
   сценария с диска (docFrom → restoreDoc). */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const exportTool = () => { tab("Инструменты"); tab("Выгрузка"); };
const jsonField = () => container.querySelector("textarea");
const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
// «Загрузить» есть и у сохранённых схем ниже; кнопка выгрузки — первая.
const loadBtn = () => screen.getAllByRole("button", { name: "Загрузить" })[0];
const load = (doc) => {
  commit(jsonField(), JSON.stringify(doc));
  fireEvent.click(loadBtn());
};
const exported = () => { tab("Выгрузить"); return JSON.parse(jsonField().value); };

const TASK = { ...newTask({ funcId: "f_act", title: "Сбор заявок" }), status: "backlog",
  setter: "local", assignee: "local" };
const SPACE = { notes: [{ id: "n1", title: "Идея", text: "", x: 10, y: 20 }],
  pos: { "task:t1": { x: 0, y: 0 } } };

describe("«Загрузить» из выгрузки", () => {
  it("пространство, цели и задачи из JSON попадают в документ, недостающее остаётся", () => {
    exportTool();
    const before = exported();
    expect(before.space).toEqual(emptySpace());
    load({ tasks: [{ ...TASK, id: "t1" }], space: SPACE,
      goals: [{ ...before.goals[0], id: "g_new", qty: 99 }] });
    expect(screen.getByText("Загружено.")).toBeInTheDocument();
    const after = exported();
    expect(after.space).toEqual(normalizeSpace(SPACE));
    expect(after.tasks.map((t) => t.title)).toEqual(["Сбор заявок"]);
    expect(after.goals.map((g) => g.id)).toEqual(["g_new"]);
    // Чего в JSON не было — осталось прежним, а не опустело.
    expect(after.entities).toEqual(before.entities);
    expect(after.kinds).toEqual(before.kinds);
    // Заметка видна на пространстве.
    tab("Задачи"); tab("Пространство");
    expect(screen.getByLabelText("название заметки")).toHaveValue("Идея");
    expect(screen.getByText("Сбор заявок")).toBeInTheDocument();
  });

  it("не-JSON и не-объект — «Не разобрал JSON.», документ цел", () => {
    exportTool();
    const before = exported();
    commit(jsonField(), "{ это не json");
    fireEvent.click(loadBtn());
    expect(screen.getByText("Не разобрал JSON.")).toBeInTheDocument();
    commit(jsonField(), "42");
    fireEvent.click(loadBtn());
    expect(screen.getByText("Не разобрал JSON.")).toBeInTheDocument();
    expect(exported()).toEqual(before);
  });

  it("docFrom: цели, факторы и отчёты идут через свои достройки, пространство — через свою", () => {
    const cur = { entities: [{ id: "a", name: "А" }], traits: [], kinds: [{ id: "k" }], tasks: [],
      funcs: [], goals: [], factors: [], reports: [], space: emptySpace() };
    const g = { id: "g1", trait: "t", qty: 5, rate: "week", dueKind: "in", dueIn: 1, dueUnit: "мес" };
    const out = docFrom({ goals: [g], space: { notes: [null, { id: "n1" }] }, kinds: [] }, cur);
    expect(out.goals).toEqual(normalizeGoals([g]));
    expect(out.space.notes.map((n) => n.id)).toEqual(["n1"]);
    expect(out.kinds).toBe(cur.kinds);         // пустые классификации не принимаются
    expect(out.entities.map((e) => e.id)).toEqual(["a"]);
    expect(docFrom(null, cur).space).toEqual(cur.space);
  });
});

/* «Отменить» при открытом пространстве.

   Раньше автораскладка производных блоков писалась в документ эффектом:
   открытие пространства само становилось шагом истории, а отмена тут же
   перекрывалась новой записью раскладки — и отменить переименование
   актива при открытом пространстве было нельзя. */
describe("«отменить» при открытом пространстве", () => {
  const undoBtn = () => screen.getByRole("button", { name: /↶ отменить/ });
  const redoBtn = () => screen.getByRole("button", { name: /↷ вернуть/ });
  const entityNames = () => [...container.querySelectorAll("svg g text")].map((t) => t.textContent);
  const selectEntity = (name) => {
    const g = [...container.querySelectorAll("svg g")].find((el) =>
      [...el.querySelectorAll("text")].some((t) => t.textContent === name));
    fireEvent.pointerDown(g, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 10, clientY: 10, pointerId: 1 });
  };

  it("переименование актива отменяется, пока на экране пространство с задачей", () => {
    exportTool();
    load({ tasks: [{ ...TASK, id: "t1" }] });   // шаг 1: появилась поставленная задача
    tab("Схема");
    selectEntity("Пользователи");
    commit(screen.getByDisplayValue("Пользователи"), "Клиенты");   // шаг 2
    expect(entityNames()).toContain("Клиенты");
    tab("Задачи"); tab("Пространство");
    expect(screen.getByText("Сбор заявок")).toBeInTheDocument();
    // Открытие пространства шагом не стало: отмена возвращает именно переименование…
    fireEvent.click(undoBtn());
    // …и возврат жив: раскладка не легла новым шагом поверх отменённого.
    expect(redoBtn()).toBeEnabled();
    expect(undoBtn()).toBeEnabled();   // остался шаг 1
    tab("Схема");
    expect(entityNames()).toContain("Пользователи");
    expect(entityNames()).not.toContain("Клиенты");
  });
});
