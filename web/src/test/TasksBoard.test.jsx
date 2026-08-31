import { describe, expect, it } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import TasksBoard, { newTask } from "../components/TasksBoard.jsx";
import SystemModel from "../components/SystemModel.jsx";

const GOALS = [
  { id: "u9", e: "usr", l: "активные пользователи", unit: "чел./мес", want: 10, by: 6 },
  { id: "m2", e: "mkt", l: "способ заработка", unit: "₽/мес", want: 50000, by: 12 },
];

// Обёртка держит состояние задач и KR, как это делает SystemModel.
function Harness({ tasks: t0 = [], okrs: o0 = [], goals = GOALS, okrValue = () => 5 }) {
  const [tasks, setTasks] = React.useState(t0);
  const [okrs, setOkrs] = React.useState(o0);
  return (
    <TasksBoard
      goals={goals} okrs={okrs} setOkrs={setOkrs}
      tasks={tasks} setTasks={setTasks}
      okrValue={okrValue} entityName={() => "Актив"}
    />
  );
}

const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

const openEditorFor = (title) => fireEvent.click(screen.getByText(title));

describe("доска задач", () => {
  it("задача создаётся и попадает в колонку «Бэклог»", () => {
    render(<Harness />);
    commit(screen.getByPlaceholderText("название новой задачи"), "Позвонить рефералам");
    fireEvent.click(screen.getAllByRole("button", { name: "+ задача" })[0]);

    expect(screen.getByDisplayValue("Позвонить рефералам")).toBeInTheDocument();
    // Задача обязана принадлежать цели — по умолчанию первой.
    expect(screen.getByDisplayValue("активные пользователи")).toBeInTheDocument();
  });

  it("без единой цели задачу создать нельзя", () => {
    render(<Harness goals={[]} />);
    expect(screen.getByRole("button", { name: "+ задача" })).toBeDisabled();
    expect(screen.getByText(/Целей пока нет/)).toBeInTheDocument();
  });

  it("карточка переезжает между колонками кнопками ‹ ›", () => {
    const { container } = render(<Harness tasks={[newTask({ goalId: "u9", title: "Задача A" })]} />);
    const columns = () => [...container.querySelectorAll("div")].filter((d) =>
      d.style.minWidth === "240px");

    const colOf = (title) => columns().findIndex((c) => within(c).queryByText(title));
    expect(colOf("Задача A")).toBe(0); // Бэклог

    fireEvent.click(screen.getByRole("button", { name: "›" }));
    expect(colOf("Задача A")).toBe(1); // В работе

    fireEvent.click(screen.getByRole("button", { name: "‹" }));
    expect(colOf("Задача A")).toBe(0);
  });

  it("фильтр по цели прячет чужие задачи", () => {
    render(<Harness tasks={[
      newTask({ goalId: "u9", title: "Задача цели 1" }),
      newTask({ goalId: "m2", title: "Задача цели 2" }),
    ]} />);
    expect(screen.getByText("Задача цели 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "активные пользователи" }));
    expect(screen.getByText("Задача цели 1")).toBeInTheDocument();
    expect(screen.queryByText("Задача цели 2")).toBeNull();
  });
});

describe("параметры задачи", () => {
  const renderOpen = () => {
    const view = render(<Harness tasks={[newTask({ goalId: "u9", title: "Задача A" })]} />);
    openEditorFor("Задача A");
    return view;
  };

  it("«Сейчас» подставляет текущие дату и время в поле начала", () => {
    const { container } = renderOpen();
    const start = container.querySelectorAll('input[type="datetime-local"]')[0];
    commit(start, "");
    expect(start.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Сейчас" }));

    // Формат datetime-local: YYYY-MM-DDTHH:mm
    expect(container.querySelectorAll('input[type="datetime-local"]')[0].value)
      .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("есть отдельные поля начала и конца", () => {
    const { container } = renderOpen();
    const dt = container.querySelectorAll('input[type="datetime-local"]');
    expect(dt).toHaveLength(2);

    fireEvent.change(dt[1], { target: { value: "2026-09-15T18:30" } });
    expect(container.querySelectorAll('input[type="datetime-local"]')[1].value)
      .toBe("2026-09-15T18:30");
  });

  it("дни повтора появляются только для «в определённые дни»", () => {
    const { container } = renderOpen();
    expect(screen.queryByRole("button", { name: "Пн" })).toBeNull();

    fireEvent.change(screen.getByDisplayValue("один раз"), { target: { value: "daily" } });
    expect(screen.queryByRole("button", { name: "Пн" })).toBeNull(); // ежедневно — дни не нужны

    fireEvent.change(screen.getByDisplayValue("повторять ежедневно"),
      { target: { value: "weekly" } });
    expect(screen.getByRole("button", { name: "Пн" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вс" })).toBeInTheDocument();

    // День включается и выключается.
    fireEvent.click(screen.getByRole("button", { name: "Ср" }));
    expect(container.querySelector('input[type="time"]')).toBeTruthy();
  });

  it("время повтора появляется только у повторяющейся задачи", () => {
    const { container } = renderOpen();
    expect(container.querySelector('input[type="time"]')).toBeNull();

    fireEvent.change(screen.getByDisplayValue("один раз"), { target: { value: "daily" } });
    expect(container.querySelector('input[type="time"]')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("повторять ежедневно"),
      { target: { value: "once" } });
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });

  it("статус, название и содержимое меняются", () => {
    renderOpen();
    commit(screen.getByDisplayValue("Задача A"), "Задача Б");
    commit(screen.getByPlaceholderText("что именно нужно сделать"), "Детали работы");
    fireEvent.change(screen.getByDisplayValue("Бэклог"), { target: { value: "review" } });

    expect(screen.getByDisplayValue("Задача Б")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Детали работы")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Проверка")).toBeInTheDocument();
  });

  it("цель задачи можно сменить", () => {
    renderOpen();
    fireEvent.change(screen.getByDisplayValue("активные пользователи"),
      { target: { value: "m2" } });
    expect(screen.getByDisplayValue("способ заработка")).toBeInTheDocument();
  });

  it("«Предупредить» выбирается и запоминается", () => {
    renderOpen();
    // По умолчанию — за 10 минут.
    expect(screen.getByDisplayValue("за 10 минут")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("за 10 минут"), { target: { value: "50" } });
    expect(screen.getByDisplayValue("за 50 минут")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("за 50 минут"), { target: { value: "" } });
    expect(screen.getByDisplayValue("не предупреждать")).toBeInTheDocument();
  });

  it("комментарии добавляются и удаляются", () => {
    renderOpen();
    expect(screen.getByText("Пока нет.")).toBeInTheDocument();

    commit(screen.getByPlaceholderText(/добавить комментарий/), "Созвонились, ждём ответа");
    expect(screen.getByText("Созвонились, ждём ответа")).toBeInTheDocument();

    const comment = screen.getByText("Созвонились, ждём ответа").parentElement;
    fireEvent.click(within(comment).getByRole("button", { name: "✕" }));
    expect(screen.queryByText("Созвонились, ждём ответа")).toBeNull();
  });
});

describe("OKR", () => {
  const KR = {
    id: "kr1", goalId: "u9", type: "seed", refId: "r5",
    label: "активные реферы", from: 0, to: 10, unit: "чел.",
  };

  it("прогресс считается по фактическому значению рычага в модели", () => {
    render(<Harness okrs={[KR]} okrValue={() => 5} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("достигнутый ключевой результат показывает 100%", () => {
    render(<Harness okrs={[KR]} okrValue={() => 12} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("удаление KR не удаляет уже сделанные по нему задачи", () => {
    render(<Harness okrs={[KR]}
      tasks={[{ ...newTask({ goalId: "u9", title: "Задача по KR" }), okrId: "kr1" }]} />);

    const krCard = screen.getByText("активные реферы").parentElement;
    fireEvent.click(within(krCard).getByRole("button", { name: "✕" }));

    expect(screen.queryByText(/0 → 10/)).toBeNull();
    expect(screen.getByText("Задача по KR")).toBeInTheDocument();
  });
});

describe("«Взять в работу» во вкладке «Цели»", () => {
  it("создаёт ключевой результат и задачу, привязанные к цели", () => {
    render(<SystemModel />);

    const take = screen.getAllByRole("button", { name: "Взять в работу" });
    const before = take.length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(take[0]);

    // Рычаг применён к модели, поэтому набор рекомендаций пересчитался:
    // взятую в работу больше не предлагают.
    expect(screen.queryAllByRole("button", { name: "Взять в работу" }).length)
      .toBeLessThan(before);

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.getAllByText("KR").length).toBeGreaterThan(0);
    // Задача появилась на доске и привязана к цели.
    expect(screen.getAllByText("активные пользователи").length).toBeGreaterThan(0);
  });

  it("применяет рекомендованное значение к модели — прогноз пересчитывается", () => {
    const { container } = render(<SystemModel />);

    // Снимок прогноза до принятия решения.
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    const before = JSON.parse(container.querySelector("textarea").value);

    fireEvent.click(screen.getByRole("button", { name: "Цели" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Взять в работу" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    const after = JSON.parse(container.querySelector("textarea").value);

    // Рычаг сдвинут: либо стартовое значение ресурса, либо интенсивность стрелки.
    const kr = after.okrs[0];
    const value = (m) => kr.type === "seed"
      ? m.traits.find((t) => t.id === kr.refId).have
      : m.edges.find((e) => e.id === kr.refId).gives;
    expect(value(after)).not.toBe(value(before));
    expect(value(after)).toBeCloseTo(kr.to, 2);
  });

  it("задачи и KR уезжают в JSON вместе с моделью", () => {
    const { container } = render(<SystemModel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Взять в работу" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));

    const dump = JSON.parse(container.querySelector("textarea").value);
    expect(dump.okrs).toHaveLength(1);
    expect(dump.tasks).toHaveLength(1);
    expect(dump.tasks[0].goalId).toBe(dump.okrs[0].goalId);
  });
});
