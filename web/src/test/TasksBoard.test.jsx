import { describe, expect, it } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import TasksBoard, { GoalWork, newTask } from "../components/TasksBoard.jsx";
import SystemModel from "../components/SystemModel.jsx";

// Карточки прогноза свёрнуты: имя и график. Рычаги, гипотезы и задачи
// разворачиваются нажатием на заголовок, поэтому тесты сначала раскрывают всё.
const expandCards = (container) => {
  [...container.querySelectorAll("span")]
    .filter((s) => s.textContent === "\u25b8")
    .forEach((s) => fireEvent.click(s.parentElement));
};


const GOALS = [
  { id: "u9", e: "usr", l: "активные пользователи", unit: "чел./мес", want: 10, by: 6 },
  { id: "m2", e: "mkt", l: "способ заработка", unit: "₽/мес", want: 50000, by: 12 },
];

// Обёртка держит состояние задач и KR, как это делает SystemModel.
// Задача заводится только под движением цели, поэтому у обёртки есть и
// движение, ведущее в первую цель.
const EDGES = [{ id: "e1", from: "mkt", to: "u9", carrier: "приток", gives: 1, per: "мес",
  sign: 1, conds: [], basis: "hypo" }];
function Harness({ tasks: t0 = [], okrs: o0 = [], goals = GOALS, okrValue = () => 5,
  edges = EDGES }) {
  const [tasks, setTasks] = React.useState(t0);
  const [okrs, setOkrs] = React.useState(o0);
  const [openId, setOpenId] = React.useState(null);
  return (
    <TasksBoard
      goals={goals} okrs={okrs} setOkrs={setOkrs} edges={edges}
      tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
      okrValue={okrValue} entityName={() => "Актив"}
    />
  );
}

// Работа по цели (KR + задачи цели) переехала во вкладку «Прогноз» — рендерим
// её тем же способом, каким это делает SystemModel.
function GoalHarness({ tasks: t0 = [], okrs: o0 = [], goals = GOALS, okrValue = () => 5 }) {
  const [tasks, setTasks] = React.useState(t0);
  const [okrs, setOkrs] = React.useState(o0);
  const [openId, setOpenId] = React.useState(null);
  return (<>
    {goals.map((g) => (
      <GoalWork key={g.id} g={g} okrs={okrs} setOkrs={setOkrs}
        tasks={tasks} setTasks={setTasks} okrValue={okrValue}
        entityName={() => "Актив"} openId={openId} setOpenId={setOpenId} />
    ))}
  </>);
}

const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

const openEditorFor = (title) => fireEvent.click(screen.getByText(title));

describe("доска задач", () => {
  it("задачи без движения не бывает — форма предлагает только движения целей", () => {
    render(<Harness />);
    expect(screen.queryByPlaceholderText(/без движения/)).toBeNull();
    expect(screen.queryByRole("button", { name: /без движения/ })).toBeNull();
    // Зато у каждого движения, ведущего к цели, своя кнопка.
    expect(screen.getAllByRole("button", { name: /^\+ задача/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Задача — это гипотеза, взятая в работу/)).toBeInTheDocument();
  });

  it("без единой цели заводить нечего — так и сказано", () => {
    render(<Harness goals={[]} />);
    expect(screen.queryByRole("button", { name: /^\+ задача/ })).toBeNull();
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

  it("дат и периодичности в задаче нет — они у движения", () => {
    // Одно и то же расписание не должно жить в двух местах: когда движение
    // происходит, сказано на стрелке, а задача его только исполняет.
    const { container } = renderOpen();
    expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(0);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(screen.queryByDisplayValue("один раз")).toBeNull();
  });

  it("цель показана целиком, вместе с гипотезой, а не одним ресурсом", () => {
    renderOpen();
    expect(screen.getByText(/цель и гипотеза, на которой она построена/))
      .toBeTruthy();
    expect(screen.getAllByText(/активные пользователи/).length).toBeGreaterThan(0);
    // Движения нет — так и сказано, а не подставлено молча.
    expect(screen.getByText(/на чём стоит цель, не сказано/)).toBeTruthy();
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

  it("в задаче нет выбора, что она пополняет и тратит", () => {
    // Это свойства движения: выбирать их ещё и в задаче значило бы дать им
    // разойтись.
    renderOpen();
    expect(screen.queryByRole("button", { name: "+ тратит" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ приносит" })).toBeNull();
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
    render(<GoalHarness okrs={[KR]} okrValue={() => 5} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("достигнутый ключевой результат показывает 100%", () => {
    render(<GoalHarness okrs={[KR]} okrValue={() => 12} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("удаление KR не удаляет уже сделанные по нему задачи", () => {
    render(<GoalHarness okrs={[KR]}
      tasks={[{ ...newTask({ goalId: "u9", title: "Задача по KR" }), okrId: "kr1" }]} />);

    const krCard = screen.getByText("активные реферы").parentElement;
    fireEvent.click(within(krCard).getByRole("button", { name: "✕" }));

    expect(screen.queryByText(/0 → 10/)).toBeNull();
    expect(screen.getByText("Задача по KR")).toBeInTheDocument();
  });
});

describe("«Взять в работу» во вкладке «Прогноз»", () => {
  it("создаёт ключевой результат и задачу, привязанные к цели", () => {
    const { container } = render(<SystemModel />);
    // Рекомендации живут на «Прогнозе», а стартовая вкладка — «Задачи».
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    expandCards(container);

    const take = screen.getAllByRole("button", { name: "Взять в работу" });
    const before = take.length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(take[0]);

    // Рычаг применён к модели, поэтому набор рекомендаций пересчитался:
    // взятую в работу больше не предлагают.
    expect(screen.queryAllByRole("button", { name: "Взять в работу" }).length)
      .toBeLessThan(before);

    // Ключевой результат и задача появились прямо под целью, на этой же
    // вкладке — работа по цели больше не за переключением вкладки.
    expect(screen.getAllByText("KR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("активные пользователи").length).toBeGreaterThan(0);
    // И на доске задач они тоже есть.
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.getAllByText("активные пользователи").length).toBeGreaterThan(0);
  });

  it("применяет рекомендованное значение к модели — прогноз пересчитывается", () => {
    const { container } = render(<SystemModel />);

    // Снимок прогноза до принятия решения.
    // Вкладка и кнопка внутри неё называются одинаково: первая — вкладка.
    const dump = () => {
      fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
      fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
      fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
      return JSON.parse(container.querySelector("textarea").value);
    };
    const before = dump();

    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    expandCards(container);
    fireEvent.click(screen.getAllByRole("button", { name: "Взять в работу" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    expandCards(container);
    fireEvent.click(screen.getAllByRole("button", { name: "Взять в работу" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));

    const dump = JSON.parse(container.querySelector("textarea").value);
    expect(dump.okrs).toHaveLength(1);
    expect(dump.tasks).toHaveLength(1);
    expect(dump.tasks[0].goalId).toBe(dump.okrs[0].goalId);
  });
});
