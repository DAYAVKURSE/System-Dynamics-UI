import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import SystemModel from "../components/SystemModel.jsx";
import TasksBoard, { TaskSetup, autoFlow, autoStatus, floorStatus, newTask,
  selfReview, selfSet } from "../components/TasksBoard.jsx";
import { saveDraft } from "../lib/draft.js";

/* КОГДА ЧЕЛОВЕК В ЗАДАЧЕ ОДИН.

   Постановка и проверка — передача работы от одного человека другому.
   Совпали по обе стороны — передавать нечего, и нажатие остаётся ритуалом:
   человек нажимает кнопку, чтобы сообщить самому себе то, что и так знает.

   Что при этом НЕ отменяется: задача всё равно должна быть описана, и
   ресурсов на неё всё равно должно хватать. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1", "2"], owners: ["1", "2"], reviewers: ["1", "2"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 0 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [], gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1 }],
  setters: ["1", "2"], owners: ["1", "2"], reviewers: ["1", "2"] }];
const HUNGRY = [{ ...FUNCS[0], id: "f2",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }] }];
const PEOPLE = [{ id: "1", name: "Иван" }, { id: "2", name: "Пётр" }];
const opts = { funcs: [...FUNCS, ...HUNGRY], traits: TRAITS };

/* Срок — в будущем: просроченная задача сама уходит в «Дедлайн», и на
   таком сроке проверялось бы не то, что задумано. Прошедший срок берётся
   отдельно, там, где дедлайн и проверяется. */
const soon = () => new Date(Date.now() + 864e5).toISOString().slice(0, 16);
const past = () => new Date(Date.now() - 864e5).toISOString().slice(0, 16);
const task = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  body: "что сделать", end: soon(), ...over });
const solo = (over) => task({ setter: "1", assignee: "1", reviewer: "1", ...over });

/* Функция обещала выдать «заявки» (минимум в вилке 1) — без самой заявки
   работа не сдаётся. Прикладываем её так же, как это делает человек. */
const attachResult = async (label, name = "результат.txt") => {
  const input = screen.getByLabelText(label);
  const f = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByText(new RegExp(name))).toBeTruthy());
};
/* Отчёт — словами: без него «Сдать» не появляется (v1.2). */
const writeReport = (text = "готово") => {
  const el = screen.getByLabelText("отчёт о работе");
  fireEvent.change(el, { target: { value: text } });
  fireEvent.blur(el);
};

describe("кто с кем совпал", () => {
  it("совпадение считается только когда назначены оба", () => {
    expect(selfSet(task({ setter: "1", assignee: "1" }))).toBe(true);
    expect(selfSet(task({ setter: "1", assignee: "2" }))).toBe(false);
    // Двое неназначенных — это не «один и тот же человек», а пустота.
    expect(selfSet(task({ setter: null, assignee: null }))).toBe(false);
    expect(selfReview(task({ assignee: "2", reviewer: "2" }))).toBe(true);
    expect(selfReview(task({ assignee: null, reviewer: null }))).toBe(false);
  });

  it("число и строка — один и тот же человек", () => {
    // Идентификаторы приходят и из Telegram, и из формы: где-то число, где-то строка.
    expect(selfSet(task({ setter: 7, assignee: "7" }))).toBe(true);
  });
});

describe("что происходит само", () => {
  it("постановщик и исполнитель — один: задача сразу в бэклоге", () => {
    expect(autoStatus(task({ setter: "1", assignee: "1", reviewer: "2",
      status: "wait" }), opts)).toBe("backlog");
    // И обратно: срок передвинули — задача из «Дедлайна» вернулась в бэклог.
    expect(autoStatus(task({ setter: "1", assignee: "1", reviewer: "2",
      status: "deadline" }), opts)).toBe("backlog");
  });

  it("содержимое не обязательно: что за работа, сказано описанием функции", () => {
    const empty = task({ setter: "1", assignee: "1", reviewer: "2",
      status: "wait", body: "" });
    expect(autoStatus(empty, opts)).toBe("backlog");
    // А вот без срока задача не поставлена: нечему сорваться и нечего успеть.
    const noEnd = task({ setter: "1", assignee: "1", reviewer: "2",
      status: "wait", end: null });
    expect(autoStatus(noEnd, opts)).toBe("wait");
    // Проверяющего нет — задача не поставлена, и ставить её нечего.
    expect(autoStatus(task({ setter: "1", assignee: "1", status: "wait",
      reviewer: null }), opts)).toBe("wait");
  });

  it("срок прошёл — задача сама уходит в «Дедлайн», и взятая, и лежащая", () => {
    /* «Дедлайн» — не полка, куда работу перекладывают, а то, что с ней
       случилось. Поэтому туда попадают сами и лежащая в бэклоге, и уже
       взятая в работу. */
    expect(autoStatus(solo({ status: "backlog", end: past() }), opts)).toBe("deadline");
    expect(autoStatus(solo({ status: "progress", end: past() }), opts)).toBe("deadline");
    // Сданное уже не срывается: работа сделана, дело за проверяющим.
    expect(autoStatus(task({ assignee: "1", reviewer: "2", status: "review",
      end: past() }), opts)).toBe("review");
  });

  it("и только когда ресурсов хватает: они меняются сами по себе", () => {
    const hungry = task({ funcId: "f2", setter: "1", assignee: "1", reviewer: "2",
      status: "wait" });
    expect(autoStatus(hungry, opts)).toBe("wait");
    const rich = { funcs: opts.funcs, traits: [{ ...TRAITS[0], have: 10 }, TRAITS[1]] };
    expect(autoStatus(hungry, rich)).toBe("backlog");
  });

  it("исполнитель и проверяющий — один: сдача принята, задача готова", () => {
    expect(autoStatus(task({ assignee: "2", reviewer: "2", status: "review" }), opts))
      .toBe("done");
    // А когда проверяет другой — ничего само не происходит.
    expect(autoStatus(task({ assignee: "2", reviewer: "1", status: "review" }), opts))
      .toBe("review");
  });

  it("работа сама не делается: в «В работе» и «Готово» ничего не двигается", () => {
    expect(autoStatus(solo({ status: "backlog" }), opts)).toBe("backlog");
    expect(autoStatus(solo({ status: "progress" }), opts)).toBe("progress");
    expect(autoStatus(solo({ status: "done" }), opts)).toBe("done");
  });

  it("ниже бэклога задача с автоматической постановкой не опускается", () => {
    expect(floorStatus(solo({ status: "backlog" }), opts)).toBe("backlog");
    expect(floorStatus(task({ setter: "1", assignee: "2" }), opts)).toBe("wait");
  });

  it("двигать нечего — возвращается тот же массив, а не его копия", () => {
    // Иначе состояние менялось бы на каждой перерисовке, и приложение
    // крутилось бы вхолостую.
    const list = [task({ setter: "1", assignee: "2", status: "wait" })];
    expect(autoFlow(list, opts)).toBe(list);
    const moving = [solo({ status: "wait" })];
    expect(autoFlow(moving, opts)).not.toBe(moving);
    expect(autoFlow(moving, opts)[0].status).toBe("backlog");
  });
});

describe("на доске", () => {
  function Board({ tasks: t0 }) {
    const [tasks, setTasks] = React.useState(t0);
    const [openId, setOpenId] = React.useState(null);
    return (<TasksBoard funcs={[...FUNCS, ...HUNGRY]} entities={ENTITIES} traits={TRAITS}
      tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
      people={PEOPLE} canAssign nameOf={(id) => id} />);
  }
  /* Колонку ищем при закрытой форме: в форме те же слова стоят в списке
     статусов, и «Готово» нашлось бы дважды. */
  const closeEditor = () => fireEvent.click(screen.getAllByRole("button", { name: "✕" })[0]);
  const column = (name) => screen.getByText(name).closest("div").parentElement;

  it("сдача уходит сразу в готовые, когда сдал и принял один человек", async () => {
    render(<Board tasks={[solo({ status: "progress" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    await attachResult("результат: заявки");
    writeReport();
    // Их две: одна в форме сдачи, другая на карточке в колонке.
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    closeEditor();
    expect(within(column("Готово")).getByText("Задача A")).toBeInTheDocument();
  });

  it("а когда проверяет другой — на проверку, как и было", async () => {
    render(<Board tasks={[solo({ status: "progress", reviewer: "2" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
    await attachResult("результат: заявки");
    writeReport();
    // Их две: одна в форме сдачи, другая на карточке в колонке.
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    closeEditor();
    expect(within(column("Проверка")).getByText("Задача A")).toBeInTheDocument();
  });

  it("двигать задачи по доске нечем: стрелок нет ни в одной колонке", () => {
    /* Колонка — это ответ на вопрос, что с задачей, а не полка. Стрелка
       «переложить» предлагала бы объявить работу сделанной, ничего не
       сделав. */
    render(<Board tasks={[solo({ status: "backlog" })]} />);
    expect(screen.queryByRole("button", { name: "‹" })).toBeNull();
    expect(screen.queryByRole("button", { name: "›" })).toBeNull();
  });

  it("в бэклоге — «Взять в работу», и задача уезжает в «В работе»", () => {
    render(<Board tasks={[solo({ status: "backlog" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Взять в работу" }));
    expect(within(column("В работе")).getByText("Задача A")).toBeInTheDocument();
    // Взятая задача предлагает уже другое действие — сдать.
    expect(screen.queryByRole("button", { name: "Взять в работу" })).toBeNull();
  });

  it("в «Дедлайне» кнопка та же — работа не отменяется тем, что срок прошёл", () => {
    render(<Board tasks={[solo({ status: "deadline", end: past() })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Взять в работу" }));
    // Задача остаётся в «Дедлайне»: срок прошёл, и от того, что за неё
    // взялись, он назад не отмотается.
    expect(within(column("Дедлайн")).getByText("Задача A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сдать" })).toBeInTheDocument();
  });

  it("в форме постановки сказано, почему статус двигается сам", () => {
    const List = () => {
      const [tasks, setTasks] = React.useState([solo({ status: "wait" })]);
      return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={[...FUNCS, ...HUNGRY]}
        entities={ENTITIES} traits={TRAITS} setTasks={setTasks} people={PEOPLE}
        canAssign nameOf={(id) => id} />);
    };
    render(<List />);
    expect(screen.getByText(/Один человек во всех ролях/)).toBeInTheDocument();
  });
});

describe("во всём приложении, а не только на открытой вкладке", () => {
  const DOC = {
    entities: [{ id: "usr", name: "Пользователи", color: "#fff", x: 0, y: 0,
      setters: ["1"], owners: ["1"], reviewers: ["1"] }],
    traits: [{ id: "t2", e: "usr", k: "growth", l: "заявки", unit: "шт.", have: 0 }],
    kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
    funcs: FUNCS,
    tasks: [solo({ status: "wait" })],
    goals: [],
    factors: [],
  };
  beforeEach(() => { localStorage.clear(); delete window.Telegram; });

  it("задача сама встаёт в бэклог, как только модель открыта", () => {
    saveDraft(DOC, { name: "Черновик" });
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: /Восстановить/ }));
    const backlog = screen.getByText("Бэклог").closest("div").parentElement;
    expect(within(backlog).getByText("Задача A")).toBeInTheDocument();
  });
});
