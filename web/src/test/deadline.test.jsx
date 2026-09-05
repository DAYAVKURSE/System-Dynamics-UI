import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import TasksBoard, { STATUSES, defaultEnd, isSet, newTask, nowLocal, taskGaps }
  from "../components/TasksBoard.jsx";
import { Workers } from "../components/AssetPanel.jsx";
import PersonStats from "../components/PersonStats.jsx";

/* Задача живёт во времени: её ставят, ей назначают срок, её сдают — вовремя
   или нет. Здесь проверяется эта часть: откуда берётся срок, почему задача
   начинается с «ожидает постановки» и как всё это возвращается человеку в
   виде его истории. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
/* Ресурса на входе вдоволь: иначе задача ждёт его, и проверялось бы не то,
   что задумано, — см. отдельный блок «задача ждёт ресурсов». */
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  every: 0, everyUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" },
  { id: "3", name: "Пётр" }];

function Board({ tasks: t0 }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    people={PEOPLE} canAssign nameOf={(id) => id} />);
}

afterEach(() => vi.useRealTimers());

describe("срок задачи", () => {
  it("по умолчанию — верхняя граница одного выполнения от начала", () => {
    // Обещать по нижней границе значит заранее назначить срыв.
    const start = "2026-03-01T09:00";
    expect(defaultEnd(FUNCS[0], start)).toBe("2026-03-01T11:00");
  });

  it("расписание тоже занимает время: час раз в неделю — это неделя", () => {
    const f = { dur: 1, durUnit: "ч", every: 1, everyUnit: "нед" };
    const end = new Date(defaultEnd(f, "2026-03-01T00:00")).getTime();
    expect(end - new Date("2026-03-01T00:00").getTime()).toBe(7 * 24 * 3600000);
  });

  it("функции нет — и срока нет: выдумывать его не из чего", () => {
    expect(defaultEnd(null, "2026-03-01T09:00")).toBeNull();
  });

  it("сдвинули начало — срок едет следом, пока его не трогали руками", () => {
    render(<Board tasks={[newTask({ funcId: "f1", title: "Задача A" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.change(screen.getByLabelText("начать"),
      { target: { value: "2026-03-01T09:00" } });
    expect(screen.getByLabelText("закончить").value).toBe("2026-03-01T11:00");
  });

  it("а поставленный руками срок начало уже не двигает", () => {
    // Иначе исправление начала молча стирало бы обещание, данное человеку.
    render(<Board tasks={[newTask({ funcId: "f1", title: "Задача A" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.change(screen.getByLabelText("закончить"),
      { target: { value: "2026-04-01T18:00" } });
    fireEvent.change(screen.getByLabelText("начать"),
      { target: { value: "2026-03-01T09:00" } });
    expect(screen.getByLabelText("закончить").value).toBe("2026-04-01T18:00");
  });

  it("посчитанный срок едет за началом, даже если он уже проставлен", () => {
    // Задача заводится сразу со сроком «от сейчас». Считать это назначением
    // руками нельзя: тогда первое же указание начала оставляло бы срок
    // позади старта — обещание, просроченное в момент постановки.
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }),
      end: defaultEnd(FUNCS[0], null) };
    render(<Board tasks={[t]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.change(screen.getByLabelText("начать"),
      { target: { value: "2026-03-01T09:00" } });
    expect(screen.getByLabelText("закончить").value).toBe("2026-03-01T11:00");
  });

  it("просроченное на доске названо просроченным", () => {
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }),
      status: "progress", end: "2020-01-01T10:00" };
    render(<Board tasks={[t]} />);
    expect(screen.getByText(/просрочено/)).toBeInTheDocument();
  });
});

describe("«ожидает постановки» и «дедлайн»", () => {
  it("новая задача начинается с ожидания постановки", () => {
    // Пока нет людей, срока и содержимого — это ещё не задача, а намерение.
    expect(newTask({ funcId: "f1" }).status).toBe("wait");
  });

  it("«дедлайн» стоит перед бэклогом — сперва видно, что горит", () => {
    expect(STATUSES.map((s) => s.id))
      .toEqual(["wait", "deadline", "backlog", "progress", "review", "done"]);
  });

  it("непоставленную задачу дальше не двинуть, и сказано, чего не хватает", () => {
    render(<Board tasks={[newTask({ funcId: "f1", title: "Задача A" })]} />);
    const card = screen.getByText("Задача A").parentElement;
    expect(within(card).getByRole("button", { name: "›" })).toBeDisabled();
    expect(screen.getByText(/не хватает: постановщик, исполнитель, проверяющий, содержимое, срок/))
      .toBeInTheDocument();
  });

  it("срок — такое же обязательное поле постановки, как роли и содержимое", () => {
    const full = { ...newTask({ funcId: "f1" }), setter: "1", assignee: "2",
      reviewer: "3", body: "что делать", end: "2026-03-01T11:00" };
    expect(isSet(full)).toBe(true);
    expect(taskGaps({ ...full, end: null })).toEqual(["срок"]);
  });

  it("поставленную — двинуть можно", () => {
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }), setter: "1",
      assignee: "2", reviewer: "3", body: "что делать", end: "2030-03-01T11:00" };
    render(<Board tasks={[t]} />);
    const card = screen.getByText("Задача A").parentElement;
    fireEvent.click(within(card).getByRole("button", { name: "›" }));
    const col = screen.getByText("Дедлайн").parentElement.parentElement;
    expect(within(col).getByText("Задача A")).toBeInTheDocument();
  });
});

describe("задача ждёт ресурсов", () => {
  /* Количество ресурсов меняется само по себе. Поэтому задачу можно описать
     заранее — и она подождёт, пока ресурсов станет достаточно. А при
     попытке её поставить видно, какого ресурса не хватает и сколько. */
  const set = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
    setter: "1", assignee: "2", reviewer: "3", body: "что делать",
    end: "2030-03-01T11:00", ...over });
  const poor = TRAITS.map((t) => (t.id === "t1" ? { ...t, have: 1 } : t));

  const Poor = ({ tasks: t0 }) => {
    const [tasks, setTasks] = React.useState(t0);
    const [openId, setOpenId] = React.useState(null);
    return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={poor}
      tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
      people={PEOPLE} canAssign nameOf={(id) => id} />);
  };

  it("описать можно, а поставить — нет: и сказано, чего не хватает", () => {
    render(<Poor tasks={[set({})]} />);
    // «Сбор заявок» берёт до 4 «спроса», а его всего 1.
    expect(screen.getByText(/ждёт ресурсов: спрос \(есть 1 из 4\)/)).toBeInTheDocument();
    const card = screen.getByText("Задача A").parentElement;
    const next = within(card).getByRole("button", { name: "›" });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute("title", expect.stringContaining("спрос"));
  });

  it("ресурса хватило — задача идёт дальше", () => {
    render(<Board tasks={[set({})]} />);
    expect(screen.queryByText(/ждёт ресурсов/)).toBeNull();
    const card = screen.getByText("Задача A").parentElement;
    expect(within(card).getByRole("button", { name: "›" })).not.toBeDisabled();
  });

  it("незаполненной задаче сперва называют незаполненное, а не ресурсы", () => {
    // Пока задача не описана, разговор о ресурсах преждевременный.
    render(<Poor tasks={[newTask({ funcId: "f1", title: "Задача A" })]} />);
    const card = screen.getByText("Задача A").parentElement;
    expect(within(card).getByRole("button", { name: "›" }))
      .toHaveAttribute("title", expect.stringContaining("Не хватает: постановщик"));
  });
});

describe("список воркеров: кого ставить", () => {
  const done = (id, person, mark) => ({ id, funcId: "f1", assignee: person,
    status: "done", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: "2026-01-01T09:00:00Z", hours: 2, takes: {}, gives: {} }],
    reviews: [{ accept: true, mark, comment: `за ${mark}` }] });
  const TASKS = [done("a", "2", 5), done("b", "3", 3)];
  const W = { setters: [], owners: ["3", "2"], reviewers: [] };

  const mount = (over = {}) => {
    const props = { workers: W, people: PEOPLE, nameOf: (id) =>
      PEOPLE.find((p) => p.id === id)?.name || id, tasks: TASKS, funcs: FUNCS,
    onToggle: () => {}, onOrder: () => {}, onOpenPerson: () => {}, ...over };
    return render(<Workers {...props} />);
  };
  // Два списка на форме: сперва люди актива без ролей, потом роли.
  const crewCard = () => screen.getByText("люди актива").parentElement;
  const roleBlock = (name) => screen.getByText(name).parentElement;
  const namesIn = (el) => [...el.querySelectorAll("button")]
    .map((b) => b.textContent).filter((t) => t.startsWith("Иван") || t.startsWith("Пётр"));

  it("рядом с каждым — краткая статистика, а не одно имя", () => {
    mount();
    expect(screen.getAllByText(/5 · в срок 100% · 1 работа/).length).toBeGreaterThan(0);
  });

  it("люди актива — одним списком, без деления на роли", () => {
    // Один человек может быть и постановщиком, и исполнителем: в списке
    // людей он один раз, потому что вопрос здесь — «кто это вообще».
    mount({ workers: { setters: ["2"], owners: ["3", "2"], reviewers: ["2"] } });
    expect(namesIn(crewCard())).toHaveLength(2);
  });

  it("порядок людей — тот, что записан, и его можно менять", () => {
    const moves = [];
    mount({ onOrder: (p, d) => moves.push([p, d]) });
    expect(namesIn(crewCard())[0]).toMatch(/^Пётр/);
    fireEvent.click(screen.getByRole("button", { name: "ниже: Пётр" }));
    expect(moves).toEqual([["3", 1]]);
  });

  it("заданный порядок сильнее порядка ролей", () => {
    mount({ workers: { ...W, crew: ["2", "3"] } });
    expect(namesIn(crewCard())[0]).toMatch(/^Иван/);
  });

  it("в ролях всегда сверху лучшие — и переключателя вида больше нет", () => {
    /* В ролях вопрос другой: кому поручить. Первым должен стоять тот, кто
       лучше справлялся, и выбор вида тут только сбивал бы. */
    mount();
    expect(namesIn(roleBlock("исполнители"))[0]).toMatch(/^Иван/);
    expect(screen.queryByRole("button", { name: "по рейтингу" })).toBeNull();
    expect(screen.queryByRole("button", { name: "свой порядок" })).toBeNull();
  });

  it("стрелки — только в списке людей: рейтинг ими не двигают", () => {
    mount();
    expect(within(roleBlock("исполнители"))
      .queryByRole("button", { name: /^выше: / })).toBeNull();
  });

  it("нажатие на человека открывает его страницу", () => {
    const opened = [];
    mount({ onOpenPerson: (id) => opened.push(id) });
    fireEvent.click(within(crewCard()).getByText("Иван").closest("button"));
    expect(opened).toEqual(["2"]);
  });
});

describe("карточка человека", () => {
  const rows = [{ id: "a", funcId: "f1", assignee: "2", status: "done",
    title: "Сбор заявок", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: "2026-01-01T09:00:00Z", hours: 3,
      takes: { t1: 2 }, gives: { t2: 1 }, text: "собрал" }],
    reviews: [{ accept: true, mark: 4, comment: "мало заявок" }] },
  { id: "b", funcId: "f1", assignee: "2", status: "backlog",
    title: "Сбор заявок", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: "2026-01-05T09:00:00Z", hours: 1, takes: {}, gives: {} }],
    reviews: [{ accept: false, comment: "переделать" }] }];

  const show = () => render(<PersonStats tasks={rows} funcs={FUNCS} personId="2"
    traitName={(id) => TRAITS.find((t) => t.id === id)?.l || id} />);

  it("сводка: средняя оценка, доля в срок, объём", () => {
    show();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("каждая оценка со своим комментарием — иначе непонятно, что исправлять", () => {
    show();
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText(/мало заявок/)).toBeInTheDocument();
  });

  it("возвращённая сдача видна отдельно и в средние не идёт", () => {
    show();
    expect(screen.getByText("вернули")).toBeInTheDocument();
    expect(screen.getByText(/не принята/)).toBeInTheDocument();
  });

  it("ресурсы выполнения названы по-человечески, а не идентификаторами", () => {
    show();
    expect(screen.getByText(/−2 спрос · \+1 заявки/)).toBeInTheDocument();
  });

  it("ничего не сдавал — так и сказано: это «неизвестно», а не «плохо»", () => {
    render(<PersonStats tasks={[]} funcs={FUNCS} personId="9" />);
    expect(screen.getByText(/ещё ничего не сдавал/)).toBeInTheDocument();
  });
});
