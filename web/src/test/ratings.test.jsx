import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import TasksBoard, { TaskSetup, newSubmission, newTask }
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

function Board({ tasks: t0, meId = "2", onSubmit, onSay, onRate, funcs = FUNCS }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={funcs} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={nameOf} meId={meId} onSubmit={onSubmit} onSay={onSay} onRate={onRate} />);
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
const hand = () => fireEvent.click(screen.getAllByRole("button", { name: "Сдать" }).at(-1));

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
    expect(screen.getByText(/Не приложено: заявки/)).toBeInTheDocument();
  });

  it("пока отчёт не написан и вещь не приложена — ни оценки, ни «Сдать», а слова о том, чего нет", async () => {
    render(<Board tasks={[task()]} />);
    open();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
    // Единственная «Сдать» — на карточке в колонке; в форме её нет.
    expect(screen.getAllByRole("button", { name: "Сдать" })).toHaveLength(1);
    expect(screen.getByText(/Отчёт не написан/)).toBeInTheDocument();
    expect(screen.getByText(/Не приложено: заявки/)).toBeInTheDocument();
    // Вещь приложена, отчёта нет — всё ещё не готово, и сказано, что не так.
    await attachResult("результат 1: заявки");
    expect(screen.queryByText(/Не приложено:/)).toBeNull();
    expect(screen.getByText(/Отчёт не написан/)).toBeInTheDocument();
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
  });

  /* ПОСЛЕ СДАЧИ ФОРМА ЗАКРЫТА (владелец, 2026-09-20): ни «Сдать», ни
     комментария — работа ушла проверяющему. */
  it("сдана — «Сдать» на форме нет и комментарий не написать", () => {
    const handed = task({ status: "review",
      submissions: [newSubmission({ hours: 2, text: "сделал" })] });
    render(<Board tasks={[handed]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByRole("button", { name: "СДАТЬ" })).toBeNull();
    // Обсуждение сданной задачи открыто: её ещё не приняли.
    expect(screen.getByRole("button", { name: "обсуждение: Задача A" })).not.toBeDisabled();
  });

  it("в работе — «Сдать» на месте", () => {
    render(<Board tasks={[task()]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByRole("button", { name: "СДАТЬ" })).toBeInTheDocument();
  });

  /* ПЛАШКА ЗАДАЧИ НА ФОРМЕ ЗАДАЧИ (владелец, 2026-09-20): выход подписан
     «ожидается», над ним «Описание задачи», ниже — критерии проверки, а
     ожидаемого результата в ней нет: он у функции. */
  it("плашка называется «выполняемая задача»: критерии в ней, результата нет", () => {
    const f = [{ ...FUNCS[0], checks: ["есть ссылка"],
      chain: { id: "c1", name: "Ц", step: 1, of: 1, result: "лид передан" } }];
    render(<Board tasks={[task()]} funcs={f} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByText("выполняемая задача")).toBeInTheDocument();
    expect(screen.queryByText("выполняемая функция")).toBeNull();
    const plate = [...document.querySelectorAll("div")]
      .find((d) => d.textContent.startsWith("Сбор заявок"));
    expect(plate.textContent).not.toMatch(/Ожидаемый результат/);
    expect(plate.textContent).toMatch(/Критерии проверки:/);
    expect(within(plate).getByText("есть ссылка")).toBeInTheDocument();
  });


  it("в плашке задачи описание стоит над «ожидается», и «выдаёт» там нет", () => {
    render(<Board tasks={[task({ body: "собрать заявки за неделю" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const plate = [...document.querySelectorAll("div")]
      .find((d) => d.textContent.startsWith("Сбор заявок"));
    expect(plate.textContent).toMatch(/Описание задачи: собрать заявки за неделю/);
    expect(plate.textContent).toMatch(/ожидается:/);
    expect(plate.textContent).not.toMatch(/выдаёт:/);
    const at = (w) => plate.textContent.indexOf(w);
    expect(at("Описание задачи:")).toBeLessThan(at("ожидается:"));
  });

  it("описания у задачи нет — так и сказано", () => {
    render(<Board tasks={[task()]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const plate = [...document.querySelectorAll("div")]
      .find((d) => d.textContent.startsWith("Сбор заявок"));
    expect(plate.textContent).toMatch(/Описание задачи: не назначено/);
  });

  it("написано и приложено — ниже форм ресурсов «Сдать»", async () => {
    render(<Board tasks={[task()]} />);
    open();
    await attachResult("результат 1: заявки");
    commit(screen.getByLabelText("отчёт о работе"), "сделал");
    /* Оценки постановки в форме сдачи больше нет: оценка человеку — своя
       кнопка «Поставить оценку» (владелец, 2026-09-20). */
    expect(screen.queryByText(/оценка постановки задачи/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Сдать" })).toHaveLength(2);
    /* Формы ресурсов остаются на месте до самой сдачи (владелец,
       2026-09-20): прежде они подменялись строкой «приложено: … изменить
       вещи», и поле пропадало из-под руки прямо во время набора. */
    expect(screen.queryByText(/приложено:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "изменить вещи" })).toBeNull();
    expect(screen.getByText("сдаваемые ресурсы")).toBeInTheDocument();
    openUnitForm();
    expect(screen.getByText("Заменить файл")).toBeInTheDocument();
    // И «Сдать» никуда не делась.
    expect(screen.getAllByRole("button", { name: "Сдать" })).toHaveLength(2);
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
    expect(screen.getByText(/Не приложено: заявки\./)).toBeInTheDocument();
  });
});

/* ОЦЕНКА — ПРО ЧЕЛОВЕКА, А НЕ ПРО ЗАДАЧУ (владелец, 2026-09-20): пять
   звёзд, отзыв и одно решение — публичный он или приватный. Исполнитель
   оценивает постановщика, проверяющий — исполнителя; себе не ставят. */
describe("оценка человеку", () => {
  const openRate = () => {
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "поставить оценку: Задача A" }));
  };

  it("звёзды загораются до нажатой, отзыв и видимость уходят наружу", () => {
    const got = [];
    render(<Board tasks={[task()]} onRate={(t, m) => got.push(m)} />);
    openRate();
    // Пока звезду не нажали, отправлять нечего.
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "оценка 4" }));
    const stars = screen.getAllByRole("radio");
    expect(stars.slice(0, 4).every((b) => b.getAttribute("aria-checked") === "false"
      || b.getAttribute("aria-label") === "оценка 4")).toBe(true);
    commit(screen.getByLabelText("отзыв"), "ставил понятно");
    fireEvent.click(screen.getByLabelText("Приватный"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    // Исполнитель (meId 2) оценивает постановщика (1).
    expect(got).toEqual([{ to: "1", mark: 4, text: "ставил понятно", pub: false }]);
  });

  it("публичный — по умолчанию", () => {
    const got = [];
    render(<Board tasks={[task()]} onRate={(t, m) => got.push(m)} />);
    openRate();
    fireEvent.click(screen.getByRole("radio", { name: "оценка 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(got[0]).toMatchObject({ mark: 5, pub: true });
  });

  it("себе оценку не ставят — кнопка не нажимается", () => {
    render(<Board tasks={[task({ setter: "2" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByRole("button", { name: "поставить оценку: Задача A" }))
      .toBeDisabled();
  });

  it("оценка проверяющего — исполнителю, тем же окном", () => {
    const got = [];
    render(<ReviewBoard tasks={[task({ status: "review" })]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false} nameOf={nameOf}
      setTasks={() => {}} onAccept={() => {}} onReturn={() => {}}
      onRate={(t, m) => got.push(m)} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "поставить оценку: Задача A" }));
    fireEvent.click(screen.getByRole("radio", { name: "оценка 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(got).toEqual([{ to: "2", mark: 3, text: "", pub: true }]);
  });
});

describe("обсуждение задачи", () => {
  const talked = () => task({ chat: [
    { id: "m1", text: "когда начнёшь?", at: "2026-01-01T10:00:00Z", by: "1" },
    { id: "m2", text: "завтра", at: "2026-01-01T11:00:00Z", by: "2" },
  ] });

  it("кнопка вместо комментариев; окно — с датой, ролью и именем автора", () => {
    render(<Board tasks={[talked()]} />);
    fireEvent.click(screen.getByText("Задача A"));
    // Прежних комментариев нет ни следа.
    expect(screen.queryByPlaceholderText(/написать комментарий/)).toBeNull();
    expect(screen.queryByText("комментарии")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "обсуждение: Задача A" }));
    const talk = screen.getByLabelText("обсуждение");
    expect(within(talk).getByText("когда начнёшь?")).toBeInTheDocument();
    expect(within(talk).getByText(/Владелец · постановщик/)).toBeInTheDocument();
    expect(within(talk).getByText(/Иван · исполнитель/)).toBeInTheDocument();
    expect(within(talk).getAllByText(/01\.01\.26/).length).toBe(2);
  });

  it("написанное уходит наружу и ложится в разговор", () => {
    const said = [];
    render(<Board tasks={[talked()]} onSay={(t, text) => said.push(text)} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "обсуждение: Задача A" }));
    commit(screen.getByLabelText("сообщение"), "уже делаю");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(said).toEqual(["уже делаю"]);
    expect(within(screen.getByLabelText("обсуждение")).getByText("уже делаю"))
      .toBeInTheDocument();
  });

  it("непрочитанные — красным кружком, и открытие обсуждения их снимает", () => {
    render(<Board tasks={[talked()]} />);
    fireEvent.click(screen.getByText("Задача A"));
    // Иван (meId 2) не читал сообщение постановщика.
    expect(screen.getByLabelText("непрочитанных сообщений: 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "обсуждение: Задача A" }));
    expect(screen.queryByLabelText(/непрочитанных сообщений/)).toBeNull();
  });

  /* ЧИТАТЬ МОЖНО ВСЕГДА, ПИСАТЬ — ПОКА РАБОТУ НЕ ПРИНЯЛИ (владелец,
     2026-09-20). Готовых задач на доске исполнителя нет вовсе — они на
     «Проверке» (`discussion.test.jsx`). */
  it("сданная задача открывается, и писать в ней можно", () => {
    render(<Board tasks={[task({ status: "review",
      submissions: [newSubmission({ hours: 1, text: "сдал" })] })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const button = screen.getByRole("button", { name: "обсуждение: Задача A" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(screen.getByLabelText("сообщение")).toBeInTheDocument();
  });

  it("в работе кнопка активна", () => {
    render(<Board tasks={[task()]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByRole("button", { name: "обсуждение: Задача A" })).not.toBeDisabled();
  });
});

describe("решение проверяющего", () => {
  const reviewTask = task({ status: "review",
    submissions: [{ id: "s1", at: "2026-01-01T00:00:00Z", hours: 3, takes: {}, gives: {} }] });
  const board = (got) => render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
    entities={ENTITIES} meId="3" isOwner={false} nameOf={nameOf} setTasks={() => {}}
    onAccept={(t, note) => got.push(["accept", note])}
    onReturn={(t, note) => got.push(["return", note])} />);

  /* ПРИНЯТЬ МОЖНО МОЛЧА (владелец, 2026-09-20): оценка человеку — своя
     кнопка, и держать ею приём работы больше не надо. */
  it("принять можно без оценки и без слов", () => {
    const got = [];
    board(got);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByLabelText("отзыв к оценке")).toBeNull();
    expect(screen.queryByRole("button", { name: "оценка 4" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    expect(got).toEqual([["accept", ""]]);
  });

  it("вернуть — только с текстом доработки", () => {
    const got = [];
    board(got);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByRole("button", { name: "Вернуть в бэклог" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("что доработать"),
      { target: { value: "нет цифр" } });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть в бэклог" }));
    expect(got).toEqual([["return", "нет цифр"]]);
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
