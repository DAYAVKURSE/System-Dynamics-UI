import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import TasksBoard, { TaskSetup, canSeeComment, newSubmission, newTask }
  from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";

/* Оценки без имени и скрытые комментарии — в интерфейсе.

   Исполнитель при сдаче оценивает постановку (можно не ставить), слова к
   оценке — скрытые или публичные. Комментарий в задаче — с адресатом, и
   скрытый видят только автор и адресат. Проверяющий делает свои слова
   скрытыми тем же переключателем. Себе оценку постановки не ставят. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];
const nameOf = (id) => PEOPLE.find((p) => p.id === String(id))?.name || String(id);

// Задача Ивана: поставил Владелец, проверяет Пётр.
const task = (over = {}) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  setter: "1", assignee: "2", reviewer: "3", status: "progress", ...over });

function Board({ tasks: t0, meId = "2", onSubmit, onComment }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={nameOf} meId={meId} onSubmit={onSubmit} onComment={onComment} />);
}

/* Результат работы прикладывается файлом: без него сдачи нет. */
const attachResult = async (label, name = "результат.txt") => {
  const input = screen.getByLabelText(label);
  const f = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByText(new RegExp(name))).toBeTruthy());
};
const openHanding = async () => {
  fireEvent.click(screen.getByText("Задача A"));
  fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
  await attachResult("результат: заявки");
};
const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
// Их две: одна в форме сдачи, другая на карточке в колонке.
const hand = () => fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);

describe("оценка постановки при сдаче", () => {
  it("исполнитель оценивает постановку, и оценка уходит в сдачу", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    expect(screen.getByText(/оценка постановки задачи/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 4" }));
    commit(screen.getByLabelText("комментарий к постановке"), "срок был тесный");
    fireEvent.click(screen.getByRole("button", { name: "публичный (видят все)" }));
    hand();
    expect(got).toHaveLength(1);
    expect(got[0].setterRating).toEqual({ mark: 4, comment: "срок был тесный", hidden: false });
    // Сама сдача при этом на месте — оценка её не подменяет.
    expect(got[0].files.t2).toBeTruthy();
  });

  it("можно не ставить: без отметки и слов оценки нет — null, а не нули", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    hand();
    expect(got[0].setterRating).toBeNull();
  });

  it("скрытый — по умолчанию, и отметку можно снять повторным нажатием", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 5" }));
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 5" }));
    commit(screen.getByLabelText("комментарий к постановке"), "лично");
    hand();
    expect(got[0].setterRating).toEqual({ mark: null, comment: "лично", hidden: true });
  });

  it("себе постановку не оценивают: постановщик и исполнитель — один человек", async () => {
    const got = [];
    render(<Board tasks={[task({ setter: "2" })]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
    hand();
    expect(got[0].setterRating).toBeNull();
  });

  it("newSubmission: пустая оценка не хранится нулями", () => {
    expect(newSubmission({ setterRating: { mark: null, comment: "  ", hidden: true } })
      .setterRating).toBeNull();
    expect(newSubmission({ setterRating: { mark: 3, comment: "", hidden: false } })
      .setterRating).toEqual({ mark: 3, comment: "", hidden: false });
  });
});

describe("комментарии в задаче", () => {
  it("скрытому нужен адресат; уходит с автором, адресатом и признаком", () => {
    const said = [];
    render(<Board tasks={[task()]} onComment={(t, c) => said.push(c)} />);
    fireEvent.click(screen.getByText("Задача A"));
    commit(screen.getByPlaceholderText("написать комментарий"), "между нами");
    fireEvent.click(screen.getByRole("button", { name: "скрытый (видит только адресат)" }));
    // «Скрытый никому» не бывает: без адресата не добавляется.
    expect(screen.getByRole("button", { name: "Добавить" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("адресат комментария"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(said).toEqual([{ text: "между нами", to: "1", hidden: true }]);
    expect(screen.getByText("между нами")).toBeInTheDocument();
    // Автору сказано, кому это видно.
    expect(screen.getByText(/скрытый · только Владелец/)).toBeInTheDocument();
  });

  it("публичный уходит всем и без пометки", () => {
    const said = [];
    render(<Board tasks={[task()]} onComment={(t, c) => said.push(c)} />);
    fireEvent.click(screen.getByText("Задача A"));
    commit(screen.getByPlaceholderText("написать комментарий"), "всем");
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(said).toEqual([{ text: "всем", to: null, hidden: false }]);
    // Пометка «скрытый · …» бывает только у скрытых.
    expect(screen.queryByText(/скрытый ·/)).toBeNull();
  });

  const talked = () => task({ comments: [
    { id: "c1", text: "тайна", at: "2026-01-01T10:00:00Z", by: "3", to: "1", hidden: true },
    { id: "c2", text: "открыто", at: "2026-01-01T10:00:00Z", by: "3", to: null, hidden: false },
  ] });

  it("чужой скрытый не виден, публичный — виден", () => {
    render(<Board tasks={[talked()]} meId="2" />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByText("тайна")).toBeNull();
    expect(screen.getByText("открыто")).toBeInTheDocument();
  });

  it("адресату скрытый виден с пометкой «только вам»", () => {
    render(<Board tasks={[talked()]} meId="1" />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByText("тайна")).toBeInTheDocument();
    expect(screen.getByText("скрытый · только вам")).toBeInTheDocument();
  });

  it("canSeeComment — одно правило: скрытое автору и адресату, остальное всем", () => {
    const c = { hidden: true, by: "3", to: "1" };
    expect(canSeeComment(c, "3")).toBe(true);
    expect(canSeeComment(c, "1")).toBe(true);
    expect(canSeeComment(c, "2")).toBe(false);
    expect(canSeeComment({ ...c, hidden: false }, "2")).toBe(true);
  });
});

describe("решение проверяющего", () => {
  const reviewTask = task({ status: "review",
    submissions: [{ id: "s1", at: "2026-01-01T00:00:00Z", hours: 3, takes: {}, gives: {},
      setterRating: { mark: 2, comment: "постановка была никакая", hidden: false } }] });

  it("слова к оценке можно сделать скрытыми — признак уходит с решением", () => {
    const got = [];
    render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false} nameOf={nameOf}
      onAccept={(t, note, mark, hidden) => got.push([note, mark, hidden])}
      onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.change(screen.getByLabelText("комментарий к оценке"),
      { target: { value: "сделано" } });
    fireEvent.click(screen.getByRole("button", { name: "оценка 4" }));
    fireEvent.click(screen.getByRole("button", { name: "скрытый (видит только исполнитель)" }));
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    expect(got).toEqual([["сделано", 4, true]]);
  });

  it("оценка постановки из сдачи проверяющему не показывается", () => {
    /* Она про постановщика и доходит до него по правилам публикации, а не
       через третьего. */
    render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false} nameOf={nameOf}
      onAccept={() => {}} onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByText(/постановка была никакая/)).toBeNull();
  });
});

describe("рядом с именем в постановке", () => {
  it("про себя — «свой рейтинг скрыт», про других — из опубликованного", () => {
    const done = { ...task({ id: "d", status: "done", end: "2026-01-02T09:00:00Z" }),
      submissions: [{ at: "2026-01-01T09:00:00Z", hours: 2, takes: {}, gives: {} }],
      reviews: [{ accept: true, mark: 5, comment: "ок", by: "3" }] };
    const fresh = newTask({ funcId: "f1", title: "Новая" });
    const Setup = () => {
      const [tasks, setTasks] = React.useState([fresh, done]);
      return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS} entities={ENTITIES}
        traits={TRAITS} setTasks={setTasks} people={PEOPLE} canAssign
        nameOf={nameOf} meId="1" published={["d~work~3"]} />);
    };
    render(<Setup />);
    const names = (label) => [...screen.getByLabelText(label).options].map((o) => o.textContent);
    // Постановщик — словом из ролей функции, без выбора и без рейтинга:
    // выбирать себя незачем, а свой рейтинг человеку и так не показывают.
    expect(screen.getByLabelText("постановщик").textContent).toBe("Владелец");
    expect(names("исполнитель")).toEqual(["— не назначен —", "Иван · 5 · в срок 100% · 1 работа"]);
  });
});
