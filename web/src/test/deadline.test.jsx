import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import TasksBoard, { BOARD, STATUSES, TaskSetup, autoFlow, autoStatus, defaultEnd,
  isSet, newTask, nowLocal, taskGaps } from "../components/TasksBoard.jsx";
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
    nameOf={(id) => id} />);
}

/* Постановка живёт во вкладке «Проверка»: её делает не исполнитель.
   Форма та же, поэтому здесь она поднимается отдельно. */
/* Порядок списка воркеров здесь ВЫКЛЮЧЕН (`pickByOrder: false`): с ним
   пустые роли заполнялись бы сами при открытии формы, а эти проверки —
   про то, что говорят о незаполненной задаче (про подстановку —
   pickOrder.test.jsx). */
const ALPHA = ENTITIES.map((e) => ({ ...e, pickByOrder: false }));
function Setup({ task: t0, traits = TRAITS, entities = ALPHA }) {
  const [tasks, setTasks] = React.useState([t0]);
  const t = tasks[0];
  return (<TaskSetup task={t} tasks={tasks} funcs={FUNCS} entities={entities}
    traits={traits} setTasks={setTasks} people={PEOPLE} canAssign nameOf={(id) => id} />);
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
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    fireEvent.change(screen.getByLabelText("начать"),
      { target: { value: "2026-03-01T09:00" } });
    expect(screen.getByLabelText("закончить").value).toBe("2026-03-01T11:00");
  });

  it("а поставленный руками срок начало уже не двигает", () => {
    // Иначе исправление начала молча стирало бы обещание, данное человеку.
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
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
    render(<Setup task={t} />);
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

describe("постановка задачи и доска исполнителя", () => {
  it("новая задача начинается с ожидания постановки", () => {
    // Пока нет людей, срока и содержимого — это ещё не задача, а намерение.
    expect(newTask({ funcId: "f1" }).status).toBe("wait");
  });

  it("на доске исполнителя непоставленных задач нет вовсе", () => {
    /* Постановка — работа постановщика, и она живёт во вкладке «Проверка».
       Показывать её колонкой здесь значило бы предлагать исполнителю
       поставить задачу самому себе. */
    expect(BOARD.map((s) => s.id))
      .toEqual(["backlog", "deadline", "progress", "review"]);
    render(<Board tasks={[newTask({ funcId: "f1", title: "Задача A" })]} />);
    expect(screen.queryByText("Задача A")).toBeNull();
    expect(screen.queryByText("Ожидает постановки")).toBeNull();
  });

  it("«дедлайн» — после бэклога: сперва очередь, потом то, что горит", () => {
    /* У бэклога два состояния, и они идут подряд: «ожидает» — время ещё не
       пришло, «отложено» — уже позвали, а работа не началась. */
    expect(STATUSES.map((s) => s.id))
      .toEqual(["wait", "backlog", "deferred", "deadline", "progress", "review", "done"]);
    /* Колонка при этом одна: отложенное не уносят на отдельную полку.
       Готовых на доске нет вовсе: доска отвечает на «что мне делать», а
       сделанное живёт там, где его принимали, — на «Проверке». */
    expect(BOARD.map((c) => c.name))
      .toEqual(["Бэклог", "Дедлайн", "В работе", "Проверка"]);
    expect(BOARD[0].states).toEqual(["backlog", "deferred"]);
  });

  it("непоставленную задачу не поставить, и сказано, чего не хватает", async () => {
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    const put = screen.getByRole("button", { name: "Поставить" });
    expect(put).toBeDisabled();
    /* Постановщик приходит из ролей функции, исполнитель и проверяющий
       подставляются сами (выбирать их на форме негде) — остаётся срок. */
    await waitFor(() => expect(put).toHaveAttribute("title",
      expect.stringContaining("Не хватает: срок")));
    expect(screen.getByText(/не хватает срок/)).toBeInTheDocument();
  });

  it("срок — такое же обязательное поле постановки, как роли", () => {
    const full = { ...newTask({ funcId: "f1" }), setter: "1", assignee: "2",
      reviewer: "3", body: "что делать", end: "2026-03-01T11:00" };
    expect(isSet(full)).toBe(true);
    expect(taskGaps({ ...full, end: null })).toEqual(["срок"]);
  });

  it("поставленная уходит в бэклог — исполнителю", () => {
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }), setter: "1",
      assignee: "2", reviewer: "3", body: "что делать", end: "2030-03-01T11:00" };
    render(<Setup task={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Поставить" }));
    expect(screen.getByText(/сейчас она в колонке «Бэклог»/)).toBeInTheDocument();
  });

  it("в «Дедлайн» задача попадает сама — по сроку, а не нажатием", () => {
    /* Колонку не выбирают: срок прошёл, а работа не сдана — вот и весь
       повод. Переложить туда задачу нечем, стрелок на доске нет. */
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }), status: "backlog",
      setter: "1", assignee: "2", reviewer: "3", body: "что делать",
      end: new Date(Date.now() - 864e5).toISOString().slice(0, 16) };
    // Развод по статусам делает autoFlow — одно правило на всё приложение,
    // а не отдельная логика доски.
    render(<Board tasks={autoFlow([t], { funcs: FUNCS, traits: TRAITS })} />);
    expect(screen.queryByRole("button", { name: "›" })).toBeNull();
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

  it("описать можно, а поставить — нет: и сказано, чего не хватает", () => {
    render(<Setup task={set({})} traits={poor} />);
    // «Сбор заявок» берёт до 4 «спроса», а его всего 1.
    const put = screen.getByRole("button", { name: "Поставить" });
    expect(put).toBeDisabled();
    expect(screen.getByText(/спрос — есть 1, нужно 4/)).toBeInTheDocument();
  });

  it("ресурса хватило — задачу можно поставить", () => {
    render(<Setup task={set({})} />);
    expect(screen.queryByText(/Не хватает ресурсов/)).toBeNull();
    expect(screen.getByRole("button", { name: "Поставить" })).not.toBeDisabled();
  });

  it("незаполненной задаче сперва называют незаполненное, а не ресурсы", async () => {
    // Пока задача не описана, разговор о ресурсах преждевременный.
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} traits={poor} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Поставить" }))
      .toHaveAttribute("title", expect.stringContaining("Не хватает: срок")));
  });
});

/* ─── СПИСОК ВОРКЕРОВ АКТИВА ───

   Один список, и только он: «кто здесь вообще работает». Прежде тут же
   стояли три списка ролей — постановщики, исполнители, проверяющие
   актива, — и они отвечали на вопрос, которого никто не задавал: роль
   человек исполняет НЕ В АКТИВЕ ВООБЩЕ, а в конкретной работе. Роли
   выставляются у каждой функции отдельно. */
/* ─────── ДВА СОСТОЯНИЯ БЭКЛОГА ───────

   Бэклог отвечает на «что лежит и ждёт», но лежат там задачи по двум
   разным причинам: у одной время ещё не пришло, у другой — уже пришло, а
   работа не началась. Одним словом «бэклог» на обеих написано, что задача
   просто лежит, и отложенная терялась среди тех, чьё время не наступило. */
describe("бэклог: ожидает и отложено", () => {
  const soon = (h) => new Date(Date.now() + h * 3600e3).toISOString().slice(0, 16);
  const t = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
    setter: "1", assignee: "2", reviewer: "3", body: "что делать",
    status: "backlog", end: soon(48), ...over });

  it("время не пришло — «ожидает»; пришло, а работы нет — «отложено»", () => {
    expect(autoStatus(t({ start: soon(5) }))).toBe("backlog");
    expect(autoStatus(t({ start: soon(-1) }))).toBe("deferred");
  });

  it("нажали «Отложить» — отложена, даже если время ещё не пришло", () => {
    /* Это решение человека, а не следствие часов: он сказал «не сейчас», и
       доска обязана это показать. */
    expect(autoStatus(t({ start: soon(5), deferredAt: new Date().toISOString() })))
      .toBe("deferred");
  });

  it("взялись — задача уходит в работу, отложенности больше нет", () => {
    expect(autoStatus(t({ start: soon(-1), taken: true }))).toBe("progress");
  });

  it("срок прошёл — «Дедлайн» сильнее обоих: его отложенностью не отменить", () => {
    expect(autoStatus(t({ start: soon(-50), end: soon(-1) }))).toBe("deadline");
    expect(autoStatus(t({ start: soon(-50), end: soon(-1),
      deferredAt: new Date().toISOString() }))).toBe("deadline");
  });

  it("обе живут в одной колонке: отложенное не уносят на отдельную полку", () => {
    const list = [t({ id: "a", start: soon(5) }), t({ id: "b", start: soon(-1) })];
    render(<Board tasks={autoFlow(list, { funcs: FUNCS, traits: TRAITS })} />);
    const col = screen.getByText("Бэклог").closest("div").parentElement;
    expect(within(col).getAllByText("Задача A")).toHaveLength(2);
    // И каждая карточка называет своё состояние словом.
    expect(within(col).getByText("Ожидает")).toBeInTheDocument();
    expect(within(col).getByText(/Отложено/)).toBeInTheDocument();
  });

  it("отложенную можно взять в работу прямо с доски", () => {
    render(<Board tasks={[t({ start: soon(-1), status: "deferred" })]} />);
    expect(screen.getByRole("button", { name: "Взять в работу" })).toBeTruthy();
  });
});

describe("список воркеров: кого ставить", () => {
  const done = (id, person, mark) => ({ id, funcId: "f1", assignee: person,
    status: "done", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: "2026-01-01T09:00:00Z", hours: 2, takes: {}, gives: {} }],
    reviews: [{ accept: true, mark, comment: `за ${mark}`, by: "9" }] });
  const TASKS = [done("a", "2", 5), done("b", "3", 3)];
  const W = { crew: ["3", "2"] };
  /* Рейтинг — только из ОПУБЛИКОВАННЫХ оценок: реестр приходит из модели
     (публикует сервер), здесь он задан руками. */
  const PUBLISHED = ["a~work~9", "b~work~9"];

  const mount = (over = {}) => {
    const props = { workers: W, people: PEOPLE, nameOf: (id) =>
      PEOPLE.find((p) => p.id === id)?.name || id, tasks: TASKS, funcs: FUNCS,
    published: PUBLISHED,
    /* Имя роли — в строке человека (`roleName`), идентификатор — для
       ролей функции (`rolesOf`). Это разные вопросы. */
    rolesOf: (id) => (id === "2" ? ["p-des"] : ["p-an"]),
    roleName: (id) => ({ "p-des": "Дизайнер", "p-an": "Аналитик" })[id] || "",
    onOrder: () => {}, onOpenPerson: () => {}, ...over };
    return render(<Workers {...props} />);
  };
  const crewCard = () => screen.getByText("воркеры").parentElement;
  const namesIn = (el) => [...el.querySelectorAll("button")]
    .map((b) => b.textContent).filter((t) => /Иван|Пётр/.test(t));

  /* СВЁРНУТАЯ ФОРМА ВОРКЕРА — ТРИ ВЕЩИ (владелец, 2026-09-20): роль, имя
     и статус. Сроки, оценки и «сдано» ушли в «Рейтинг» внутри раскрытой. */
  it("в свёрнутой строке — роль, имя и статус, и больше ничего", () => {
    mount();
    const row = within(crewCard()).getByText("Иван").closest("button");
    expect(row.textContent).toMatch(/Дизайнер/);
    expect(row.textContent).not.toMatch(/в срок/);
    expect(row.textContent).not.toMatch(/рейтинг/);
    expect(row.textContent).not.toMatch(/сдано/);
  });

  it("чего нет — сказано словом, а не нулём", () => {
    mount({ tasks: [], rolesOf: () => [], roleName: () => "" });
    const row = within(crewCard()).getByText("Иван").closest("button");
    expect(row.textContent).toMatch(/без роли/);
  });

  /* РЕЙТИНГ — В РАСКРЫТОЙ ФОРМЕ: общая оценка, сколько сдано и публичные
     отзывы. Приватных тут нет — их видят только двое. */
  it("рейтинг раскрывается: оценка, сданные работы и публичные отзывы", () => {
    const rated = [{ id: "a", funcId: "f1", assignee: "2", status: "done",
      end: "2026-01-02T09:00:00Z",
      submissions: [{ at: "2026-01-01T09:00:00Z", hours: 2, takes: {}, gives: {} }],
      marks: [{ id: "m1", by: "9", to: "2", mark: 4, text: "быстро", pub: true },
        { id: "m2", by: "8", to: "2", mark: 2, text: "втайне", pub: false }] }];
    mount({ tasks: rated });
    fireEvent.click(screen.getByLabelText("развернуть воркера: Иван"));
    const box = screen.getByLabelText("рейтинг: Иван");
    expect(box.textContent).toMatch(/3 · оценок 2/);
    expect(box.textContent).toMatch(/сдано работ: 1/);
    expect(box.textContent).toMatch(/быстро/);
    expect(box.textContent).not.toMatch(/втайне/);
  });

  it("никого не оценили — так и сказано", () => {
    mount({ tasks: [] });
    fireEvent.click(screen.getByLabelText("развернуть воркера: Иван"));
    const box = screen.getByLabelText("рейтинг: Иван");
    expect(box.textContent).toMatch(/без оценок/);
    expect(box.textContent).toMatch(/отзывов нет/);
  });

  it("статус видно прямо в списке: можно ли поручить сейчас", () => {
    /* Узнавать это, открыв карточку, поздно — выбирают-то здесь. */
    mount({ people: PEOPLE.map((p) => (p.id === "2"
      ? { ...p, status: "off" } : p)) });
    const row = within(crewCard()).getByText("Иван").closest("button");
    expect(row.textContent).toMatch(/сегодня не работаю/);
  });

  it("воркеры — одним списком, и списков ролей у актива больше нет", () => {
    mount();
    expect(namesIn(crewCard())).toHaveLength(2);
    ["постановщики", "исполнители", "проверяющие"].forEach((t) => {
      expect(screen.queryByText(t)).toBeNull();
    });
  });

  it("в списке сразу все люди схемы: воркер — это выбор из них", () => {
    /* Обратный порядок — «стал воркером, потому что его куда-то
       назначили» — заставлял бы называть роль раньше человека. */
    mount({ workers: { crew: ["3"] } });
    expect(crewCard().querySelectorAll("input[type=checkbox]"))
      .toHaveLength(PEOPLE.length);
    expect(screen.getByLabelText("воркер актива: Пётр")).toBeChecked();
    expect(screen.getByLabelText("воркер актива: Иван")).not.toBeChecked();
  });

  /* ПОРЯДОК ЗАДАЮТ ПОЛОСКАМИ (владелец, 2026-09-20): кнопок «вверх» и
     «вниз» больше нет, человека ставят на место того, над кем отпустили. */
  it("порядок воркеров — тот, что записан, и меняется перетаскиванием", () => {
    const moves = [];
    mount({ onOrder: (pid, over) => moves.push([pid, over]) });
    expect(namesIn(crewCard())[0]).toMatch(/Пётр/);
    expect(screen.queryByRole("button", { name: "ниже: Пётр" })).toBeNull();
    expect(screen.queryByRole("button", { name: "выше: Иван" })).toBeNull();

    const grip = screen.getByLabelText("переставить Пётр");
    const row = screen.getByLabelText("переставить Иван").closest("[data-worker]");
    // Ведём Петра на место Ивана: сосед узнаётся по узлу под пальцем.
    document.elementFromPoint = () => row;
    fireEvent.pointerDown(grip, { clientY: 0 });
    fireEvent.pointerMove(grip, { clientY: 30 });
    expect(moves).toEqual([["3", "2"]]);
    fireEvent.pointerUp(grip, { clientY: 30 });
  });

  it("прежние роли актива читаются как членство: люди не пропадают", () => {
    /* У моделей, собранных раньше, людей записывали в три списка ролей.
       Выбросить их значило бы стереть воркеров у всех прежних активов. */
    mount({ workers: { setters: ["2"], owners: ["3"], reviewers: [] } });
    expect(screen.getByLabelText("воркер актива: Иван")).toBeChecked();
    expect(screen.getByLabelText("воркер актива: Пётр")).toBeChecked();
  });

  it("нажатие на человека открывает его карточку", () => {
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
    reviews: [{ accept: true, mark: 4, comment: "мало заявок", by: "9" }] },
  { id: "b", funcId: "f1", assignee: "2", status: "backlog",
    title: "Сбор заявок", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: "2026-01-05T09:00:00Z", hours: 1, takes: {}, gives: {} }],
    reviews: [{ accept: false, comment: "переделать", by: "9" }] }];

  /* Смотрит владелец (id 1) на Ивана (id 2); оценка опубликована —
     реестр из модели. */
  const show = (over = {}) => render(<PersonStats tasks={rows} funcs={FUNCS} personId="2"
    viewerId="1" published={["a~work~9"]}
    traitName={(id) => TRAITS.find((t) => t.id === id)?.l || id} {...over} />);

  it("сводка: средняя оценка, доля в срок, объём", () => {
    show();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("каждая оценка со своим комментарием — иначе непонятно, что исправлять", () => {
    show();
    expect(screen.getByText("4/10")).toBeInTheDocument();
    expect(screen.getByText(/мало заявок/)).toBeInTheDocument();
  });

  it("неопубликованная оценка так и подписана — это не «без оценки»", () => {
    show({ published: [] });
    expect(screen.queryByText("4/10")).toBeNull();
    expect(screen.getByText("оценка ещё не опубликована")).toBeInTheDocument();
    expect(screen.getByText(/ждёт публикации/)).toBeInTheDocument();
    // И слова до публикации не читаются: они выдали бы автора.
    expect(screen.queryByText(/мало заявок/)).toBeNull();
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
    expect(screen.getByText(/Ещё ничего не сдавал/)).toBeInTheDocument();
  });
});
