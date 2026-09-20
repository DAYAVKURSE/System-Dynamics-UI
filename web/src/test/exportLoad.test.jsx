import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SystemModel, { docFrom } from "../components/SystemModel.jsx";
import { newTask } from "../components/TasksBoard.jsx";
import { normalizeGoals } from "../lib/goals.js";

/* «Загрузить» из выгрузки читает документ ЦЕЛИКОМ.

   «Выгрузить» отдаёт весь документ, а «Загрузить» собирал его своим
   набором сеттеров и молча терял всё, что появилось в документе позже:
   цели, факторы, отчёты. Теперь путь один — тот же, что у сценария с
   диска (docFrom → restoreDoc). */

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
describe("«Загрузить» из выгрузки", () => {
  it("цели и задачи из JSON попадают в документ, недостающее остаётся", () => {
    exportTool();
    const before = exported();
    // Поля `space` в документе больше нет: пространство убрано.
    expect(before.space).toBeUndefined();
    load({ tasks: [{ ...TASK, id: "t1" }],
      goals: [{ ...before.goals[0], id: "g_new", qty: 99 }] });
    expect(screen.getByText("Загружено.")).toBeInTheDocument();
    const after = exported();
    expect(after.tasks.map((t) => t.title)).toEqual(["Сбор заявок"]);
    expect(after.goals.map((g) => g.id)).toEqual(["g_new"]);
    // Чего в JSON не было — осталось прежним, а не опустело.
    expect(after.entities).toEqual(before.entities);
    expect(after.kinds).toEqual(before.kinds);
    // Задача видна на доске.
    tab("Задачи");
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

  it("docFrom: цели, факторы и отчёты идут через свои достройки", () => {
    const cur = { entities: [{ id: "a", name: "А" }], traits: [], kinds: [{ id: "k" }], tasks: [],
      funcs: [], goals: [], factors: [], reports: [] };
    const g = { id: "g1", trait: "t", qty: 5, rate: "week", dueKind: "in", dueIn: 1, dueUnit: "мес" };
    // Чужое поле `space` из старой выгрузки просто не читается — и не ломает.
    const out = docFrom({ goals: [g], space: { notes: [{ id: "n1" }] }, kinds: [] }, cur);
    expect(out.goals).toEqual(normalizeGoals([g]));
    expect(out.space).toBeUndefined();
    expect(out.kinds).toBe(cur.kinds);         // пустые классификации не принимаются
    expect(out.entities.map((e) => e.id)).toEqual(["a"]);
    expect(docFrom(null, cur).goals).toEqual([]);
  });
});

describe("версии сценария на вкладке выгрузки (владелец, 2026-09-19)", () => {
  const openTools = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    if (!container.querySelector("textarea")) fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  };

  it("после выбора сценария — кнопка с числом версий; версия раскрывается двумя формами", async () => {
    openTools();
    // Сохраняем схему дважды: две версии, во второй — новый актив.
    fireEvent.change(screen.getByPlaceholderText("имя сценария"), { target: { value: "Моя схема" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText(/Сохранено/);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: "+ актив" }));
    openTools();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText(/Сохранено/);

    const btn = await screen.findByRole("button", { name: "версии сценария" });
    await waitFor(() => expect(btn.textContent).toMatch(/Версии \(2\)/));
    fireEvent.click(btn);
    fireEvent.click(await screen.findByRole("button", { name: "версия 2" }));
    /* Три формы: зелёная «+», жёлтая «±» между ними и красная «−»
       (владелец, 2026-09-20). */
    const plus = await screen.findByLabelText("добавлено");
    const both = screen.getByLabelText("заменено");
    const minus = screen.getByLabelText("убрано");
    expect(plus.querySelector("legend").textContent).toBe("+");
    expect(both.querySelector("legend").textContent).toBe("±");
    expect(minus.querySelector("legend").textContent).toBe("−");
    // eslint-disable-next-line no-bitwise
    expect(plus.compareDocumentPosition(both) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(both.compareDocumentPosition(minus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(plus.textContent).toMatch(/актив/));
  });
});
