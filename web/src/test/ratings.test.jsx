import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import TasksBoard, { TaskSetup, canSeeComment, newSubmission, newTask }
  from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";

/* Оценки без имени и скрытые комментарии — в интерфейсе.

   Сдача: отчёт словами сверху, вещи — кнопками «Загрузить <ресурс>»;
   когда отчёт написан и обязательные вещи приложены, на месте кнопок
   появляется оценка постановки (можно не ставить) с ОДНИМ переключателем
   «скрыто/публично» на отметку и слова (умолчание — публично) и «Сдать».
   Комментарий в задаче — с адресатом, и скрытый видят только автор и
   адресат. Проверяющий делает решение скрытым тем же переключателем. Себе
   оценку постановки не ставят. */

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
/* Ресурс сдаётся своей формой: её раскрывают, потом раскрывают единицу
   (владелец, 2026-09-20). */
const openUnitForm = (trait = "заявки") => {
  const box = screen.queryByRole("button", { name: `ресурс: ${trait}` });
  if (box && box.getAttribute("aria-expanded") !== "true") fireEvent.click(box);
  const one = screen.queryByRole("button", { name: `единица 1: ${trait}` });
  if (one && one.getAttribute("aria-expanded") !== "true") fireEvent.click(one);
};
const attachResult = async (label, name = "результат.txt") => {
  openUnitForm();
  const input = screen.getByLabelText(label);
  const f = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getAllByText(new RegExp(name)).length).toBeGreaterThan(0));
};
const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
/* Форма сдачи, доведённая до оценки: вещь приложена, отчёт написан. */
const openHanding = async () => {
  fireEvent.click(screen.getByText("Задача A"));
  fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
  await attachResult("результат 1: заявки");
  commit(screen.getByLabelText("отчёт о работе"), "сделал");
};
// Их две: одна в форме сдачи, другая на карточке в колонке.
const hand = () => fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);

describe("форма сдачи: отчёт словами, вещи кнопками, потом оценка", () => {
  const open = () => {
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
  };

  it("сверху — отчёт словами; кнопки «Загрузить отчёт» нет, есть «Загрузить <ресурс>»", () => {
    render(<Board tasks={[task()]} />);
    open();
    expect(screen.getByLabelText("отчёт о работе")).toBeInTheDocument();
    expect(screen.queryByText("Загрузить отчёт")).toBeNull();
    expect(screen.queryByLabelText("отчёт о работе файлом")).toBeNull();
    /* Ресурс сдаётся своей формой; кнопка загрузки — внутри единицы
       (владелец, 2026-09-20). */
    openUnitForm();
    expect(screen.getByText("Загрузить файл")).toBeInTheDocument();
    expect(screen.getByText(/Задача не выполнена, пока не приложено: заявки/)).toBeInTheDocument();
  });

  it("пока отчёт не написан и вещь не приложена — ни оценки, ни «Сдать», а слова о том, чего нет", async () => {
    render(<Board tasks={[task()]} />);
    open();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
    // Единственная «Сдать» — на карточке в колонке; в форме её нет.
    expect(screen.getAllByRole("button", { name: "Сдать" })).toHaveLength(1);
    expect(screen.getByText(/Напишите отчёт словами/)).toBeInTheDocument();
    expect(screen.getByText(/Задача не выполнена, пока не приложено: заявки/)).toBeInTheDocument();
    // Вещь приложена, отчёта нет — всё ещё не готово, и сказано, что не так.
    await attachResult("результат 1: заявки");
    expect(screen.queryByText(/Задача не выполнена/)).toBeNull();
    expect(screen.getByText(/Напишите отчёт словами/)).toBeInTheDocument();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
  });

  it("написано и приложено — на месте кнопок загрузки оценка постановки и «Сдать»", async () => {
    render(<Board tasks={[task()]} />);
    open();
    await attachResult("результат 1: заявки");
    commit(screen.getByLabelText("отчёт о работе"), "сделал");
    expect(screen.getByText(/оценка постановки задачи/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Сдать" })).toHaveLength(2);
    expect(screen.queryByText(/Заменить файл/)).toBeNull();
    // Что приложено — видно; к вещам можно вернуться и снова уйти к оценке.
    expect(screen.getByText(/приложено: заявки — результат.txt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "изменить вещи" }));
    openUnitForm();
    expect(screen.getByText("Заменить файл")).toBeInTheDocument();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "К оценке и сдаче" }));
    expect(screen.getByText(/оценка постановки задачи/)).toBeInTheDocument();
  });

  it("необязательная вещь — тоже кнопкой, но сдачу не держит", () => {
    const FREE = [{ ...FUNCS[0], gives: [
      { id: "p2", trait: "t2", lo: 1, hi: 1, to: "" },
      { id: "p3", trait: "t1", lo: 0, hi: 1, to: "" }] }];
    const Free = () => {
      const [tasks, setTasks] = React.useState([task()]);
      const [openId, setOpenId] = React.useState(null);
      return (<TasksBoard funcs={FREE} entities={ENTITIES} traits={TRAITS}
        tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
        nameOf={nameOf} meId="2" />);
    };
    render(<Free />);
    open();
    openUnitForm("спрос");
    expect(screen.getByText("Загрузить файл")).toBeInTheDocument();
    // Держит только обязательная: «спрос» в списке недостающего нет.
    expect(screen.getByText(/пока не приложено: заявки\./)).toBeInTheDocument();
  });
});

describe("оценка постановки при сдаче", () => {
  it("исполнитель оценивает постановку, и оценка уходит в сдачу", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    expect(screen.getByText(/оценка постановки задачи/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 4" }));
    commit(screen.getByLabelText("отзыв о постановке"), "срок был тесный");
    hand();
    expect(got).toHaveLength(1);
    expect(got[0].setterRating).toEqual({ mark: 4, comment: "срок был тесный", hidden: false });
    // Сама сдача при этом на месте — оценка её не подменяет; отчёт — словами,
    // файла «вообще» нет.
    expect(got[0].units.t2[0].file).toBeTruthy();
    expect(got[0].text).toBe("сделал");
    expect(got[0].file).toBeNull();
  });

  it("можно не ставить: без отметки и слов оценки нет — null, а не нули", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    hand();
    expect(got[0].setterRating).toBeNull();
  });

  it("публично — по умолчанию; «скрыто» — один переключатель на отметку и слова", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    expect(screen.getByRole("button", { name: "публично" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Публично: после публикации видят все/)).toBeInTheDocument();
    // Переключатель один: отдельного «скрыть отметку» / «скрыть слова» нет.
    expect(screen.getAllByRole("button", { name: "скрыто" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "публично" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "скрыто" }));
    // Сказано, что именно скрывается: и отметка, и слова — и кому видно.
    expect(screen.getByText(/отметку видите только вы .* слова — вы и постановщик/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 5" }));
    commit(screen.getByLabelText("отзыв о постановке"), "лично");
    hand();
    expect(got[0].setterRating).toEqual({ mark: 5, comment: "лично", hidden: true });
  });

  it("отметку можно снять повторным нажатием", async () => {
    const got = [];
    render(<Board tasks={[task()]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 5" }));
    fireEvent.click(screen.getByRole("button", { name: "оценка постановки 5" }));
    commit(screen.getByLabelText("отзыв о постановке"), "только слова");
    hand();
    expect(got[0].setterRating).toEqual({ mark: null, comment: "только слова", hidden: false });
  });

  it("себе постановку не оценивают: постановщик и исполнитель — один человек", async () => {
    const got = [];
    render(<Board tasks={[task({ setter: "2" })]} onSubmit={(t, sb) => got.push(sb)} />);
    await openHanding();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
    hand();
    expect(got[0].setterRating).toBeNull();
  });

  it("newSubmission: пустая оценка не хранится нулями, скрытость — одним признаком", () => {
    expect(newSubmission({ setterRating: { mark: null, comment: "  ", hidden: true } })
      .setterRating).toBeNull();
    expect(newSubmission({ setterRating: { mark: 3, comment: "", hidden: false } })
      .setterRating).toEqual({ mark: 3, comment: "", hidden: false });
    expect(newSubmission({ setterRating: { mark: 3, comment: "лично", hidden: true } })
      .setterRating).toEqual({ mark: 3, comment: "лично", hidden: true });
  });
});

describe("комментарии в задаче", () => {
  it("комментарий — всем участникам: ни адресата, ни скрытости у него нет", () => {
    /* Сказать что-то лично о человеке — это отзыв, а не комментарий: у
       отзыва своя скрытость. Поле «кому» превращало разговор в переписку
       через третьего. */
    const said = [];
    render(<Board tasks={[task()]} onComment={(t, c) => said.push(c)} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByLabelText("адресат комментария")).toBeNull();
    expect(screen.queryByRole("button", { name: /скрытый/ })).toBeNull();
    commit(screen.getByPlaceholderText(/написать комментарий/), "всем");
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(said).toEqual([{ text: "всем", to: null, hidden: false }]);
    // Пометка «скрытый · …» бывает только у прежних скрытых.
    expect(screen.queryByText(/скрытый ·/)).toBeNull();
  });

  const talked = () => task({ comments: [
    { id: "c1", text: "тайна", at: "2026-01-01T10:00:00Z", by: "3", to: "1", hidden: true },
    { id: "c2", text: "открыто", at: "2026-01-01T10:00:00Z", by: "3", to: null, hidden: false },
  ] });

  /* Прежние скрытые комментарии остаются скрытыми: их писали как личные,
     и рассекречивать их задним числом нельзя. */
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

  it("решение можно сделать скрытым — один переключатель на отметку и слова, признак уходит с решением", () => {
    const got = [];
    render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false} nameOf={nameOf}
      onAccept={(t, note, mark, hidden) => got.push([note, mark, hidden])}
      onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.change(screen.getByLabelText("отзыв к оценке"),
      { target: { value: "сделано" } });
    fireEvent.click(screen.getByRole("button", { name: "оценка 4" }));
    fireEvent.click(screen.getByRole("button", { name: "скрыто" }));
    expect(screen.getByText(/отметку видите только вы .* слова — вы и исполнитель/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    expect(got).toEqual([["сделано", 4, true]]);
  });

  it("публично — по умолчанию и у проверяющего", () => {
    const got = [];
    render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false} nameOf={nameOf}
      onAccept={(t, note, mark, hidden) => got.push([note, mark, hidden])}
      onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByRole("button", { name: "публично" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("отзыв к оценке"),
      { target: { value: "сделано" } });
    fireEvent.click(screen.getByRole("button", { name: "оценка 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    expect(got).toEqual([["сделано", 5, false]]);
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
    /* Людей на форме постановки не выбирают (владелец, 2026-09-19) — и
       рейтингов там больше нет: их смотрят в карточке человека. */
    ["постановщик", "исполнитель", "проверяющий"].forEach((role) => {
      expect(screen.queryByLabelText(role)).toBeNull();
    });
    expect(screen.queryByText(/в срок 100%/)).toBeNull();
  });
});
