import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Доска сверху, форма добавления под ней; движение задаётся тем, под чем
   нажали «+ задача»; сдача уходит на проверку, а не сразу в «Готово». */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const dump = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  return JSON.parse(container.querySelector("textarea").value);
};
const addFromMove = () => {
  tab("Задачи");
  fireEvent.click(screen.getAllByRole("button", { name: /^\+ задача$/ })[0]);
};

describe("порядок на вкладке", () => {
  it("доска идёт раньше формы добавления", () => {
    tab("Задачи");
    const all = [...container.querySelectorAll("*")];
    const board = screen.getByText("доска задач");
    const form = screen.getByText("завести задачу");
    expect(all.indexOf(board)).toBeLessThan(all.indexOf(form));
    // Колонки — часть доски, значит тоже выше формы.
    const backlog = screen.getByText("Бэклог");
    expect(all.indexOf(backlog)).toBeLessThan(all.indexOf(form));
  });

  it("движения в форме сгруппированы по целям", () => {
    tab("Задачи");
    const form = screen.getByText("завести задачу").parentElement;
    // У цели своё имя и свои движения под ним.
    expect(within(form).getAllByRole("button", { name: /^\+ задача/ }).length)
      .toBeGreaterThan(0);
  });
});

describe("движение берётся из того, под чем нажали", () => {
  it("задача сразу привязана к движению, без выбора в самой задаче", () => {
    addFromMove();
    const t = dump().tasks[0];
    expect(t.edgeId).toBeTruthy();
    expect(t.goalId).toBeTruthy();
    tab("Задачи");
    // Селекта движения в редакторе нет — иначе задачу можно было бы увести
    // от цели, под которой она заведена.
    expect([...container.querySelectorAll("select")]
      .some((s) => s.textContent.includes("не привязана к движению"))).toBe(false);
    expect(screen.getByText(/Движение задано тем, под чем заведена задача/))
      .toBeTruthy();
  });

  it("движение задачи — то, что входит в её цель, а не первое попавшееся", () => {
    addFromMove();
    const m = dump();
    const t = m.tasks[0];
    const ed = m.edges.find((e) => e.id === t.edgeId);
    // Стрелка ведёт именно в ресурс цели.
    expect(ed.to).toBe(t.goalId);
  });

  it("задачи без движения не бывает — кнопки для неё нет", () => {
    tab("Задачи");
    expect(screen.queryByRole("button", { name: /без движения/ })).toBeNull();
    expect(screen.queryByPlaceholderText(/без движения/)).toBeNull();
  });
});

describe("сдача уходит на проверку", () => {
  const submit = () => {
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    const amount = screen.getByPlaceholderText("сколько");
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "3" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));
  };

  it("после сдачи задача в «Проверке», а не в «Готово»", () => {
    addFromMove();
    submit();
    expect(dump().tasks[0].status).toBe("review");
  });

  it("«Готово» ставится отдельно — это решение принимающего", () => {
    addFromMove();
    submit();
    tab("Задачи");
    const sel = [...container.querySelectorAll("select")]
      .find((s) => s.textContent.includes("Проверка"));
    fireEvent.change(sel, { target: { value: "done" } });
    expect(dump().tasks[0].status).toBe("done");
  });

  it("сдача записана — на проверку уходит уже с фактом", () => {
    addFromMove();
    submit();
    const t = dump().tasks[0];
    expect(t.submissions).toHaveLength(1);
    expect(t.submissions[0].amount).toBe(3);
  });
});
