import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import TasksBoard, { TaskSetup, newTask, runsOfFunc, runTitle, twinNo } from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";
import { scheduleOf } from "../lib/plan.js";
import React from "react";

/* Правила работы с задачами: задача — это выполнение функции; в «Готово»
   только через приём отчёта; возврат — в бэклог с текстом доработки;
   исполнителю видно только своё; поля задачи в порядке постановки;
   «Инструменты» с внутренними вкладками. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
/* Ресурса на входе вдоволь: иначе задача ждала бы его, и проверялось бы
   не то, что задумано, — про нехватку есть свой блок в deadline.test.jsx. */
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];

function Board({ tasks: t0 }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={(id) => id} />);
}

/* Результат работы прикладывается файлом по каждому выданному ресурсу.
   Без сервера файл ложится инлайном — поэтому дожидаемся, а не считаем
   запись мгновенной. */
const attachResult = async (label, name = "результат.txt") => {
  const input = screen.getByLabelText(label);
  const f = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByText(new RegExp(name))).toBeTruthy());
};

/* Постановка — во вкладке «Проверка»: её делает не исполнитель. */
function Setup({ task: t0, people = PEOPLE, canAssign = true }) {
  const [tasks, setTasks] = React.useState([t0]);
  return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS} entities={ENTITIES}
    traits={TRAITS} setTasks={setTasks} people={people} canAssign={canAssign}
    nameOf={(id) => id} />);
}

/* ОДНА ФУНКЦИЯ, ЧЕТЫРЕ ВЫПОЛНЕНИЯ — ЧЕТЫРЕ РАЗНЫЕ ЗАДАЧИ.

   Одно имя функции на все четыре превращало их в неразличимые близнецы: на
   доске не понять, какую берёшь, в отчёте они сливались, а бот слал четыре
   одинаковых напоминания подряд — он шлёт заголовок задачи как есть. */
describe("как называется одно выполнение", () => {
  it("выполнения одной функции различимы по номеру", () => {
    const rows = scheduleOf([{ func: "f1", name: "Сбор заявок", runs: 4,
      startHours: 0, calendarHours: 4 }]);
    expect(rows.map(runTitle)).toEqual([
      "Сбор заявок №1 из 4", "Сбор заявок №2 из 4",
      "Сбор заявок №3 из 4", "Сбор заявок №4 из 4"]);
    // Ни одного повтора — иначе в чате они снова слипнутся.
    expect(new Set(rows.map(runTitle)).size).toBe(4);
  });

  it("единственное выполнение остаётся без номера: «№1 из 1» — это шум", () => {
    expect(runTitle({ name: "Сбор заявок", no: 1, of: 1 })).toBe("Сбор заявок");
  });

  it("функция без имени всё равно называется, а не остаётся пустой строкой", () => {
    expect(runTitle({ name: "", no: 1, of: 1 })).toBe("выполнение функции");
    expect(runTitle({})).toBe("выполнение функции");
  });
});

/* КАК РАЗЛИЧИТЬ ОДИНАКОВО НАЗВАННЫЕ.

   Задачи, заведённые до нумерации выполнений, носят одно имя функции.
   Сохранённые названия при этом НЕ ПРАВЯТСЯ: название — слова человека, и
   переписывать их за него приложение не должно, даже с добрым намерением.
   Номер считается на месте, для показа, и никуда не сохраняется. */
describe("номер у одинаково названных — только для показа", () => {
  const t = (id, over) => ({ ...newTask({ funcId: "f1", title: "Сбор заявок" }),
    id, ...over });

  it("близнецы получают номера в порядке начала", () => {
    const list = [t("c", { start: "2026-03-03T10:00" }),
      t("a", { start: "2026-03-01T10:00" }),
      t("b", { start: "2026-03-02T10:00" })];
    expect(twinNo(list)).toEqual({
      a: { no: 1, of: 3 }, b: { no: 2, of: 3 }, c: { no: 3, of: 3 } });
  });

  it("сохранённые названия не трогаются вовсе", () => {
    const list = [t("a", { start: "2026-03-01T10:00" }),
      t("b", { start: "2026-03-02T10:00" })];
    const before = list.map((x) => x.title);
    twinNo(list);
    expect(list.map((x) => x.title)).toEqual(before);
  });

  it("одиночку и собственное название человека не нумерует", () => {
    expect(twinNo([t("a", { title: "Разобрать заявку Петрова" }),
      t("b", { title: "Сбор заявок" })])).toEqual({});
  });

  it("близнецы считаются внутри своей функции, а не по всей доске", () => {
    expect(twinNo([t("a"), t("b", { funcId: "f2" })])).toEqual({});
  });

  it("задача без начала не уезжает вперёд остальных", () => {
    // Пустая дата — это НЕ полночь 1970 года: иначе бессрочная встала бы первой.
    const out = twinNo([t("a", { start: null, end: null }),
      t("b", { start: "2026-03-01T10:00" })]);
    expect(out.b.no).toBe(1);
    expect(out.a.no).toBe(2);
  });
});

describe("«Готово» — только через приём отчёта", () => {
  const task = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }), ...over });

  it("на проверке исполнителю нажимать нечего — дело за проверяющим", () => {
    render(<Board tasks={[task({ status: "review" })]} />);
    const card = screen.getByText("Задача A").parentElement;
    // Кнопка работы — ни одной; «Удалить» — не работа, а право владельца.
    expect(within(card).queryAllByRole("button")
      .filter((b) => !/^удалить/i.test(b.textContent))).toEqual([]);
    expect(within(card).getByText("ждёт проверяющего")).toBeInTheDocument();
  });

  it("«Готово» не нажимается ниоткуда: его ставит приём отчёта", () => {
    render(<Board tasks={[task({ status: "review" })]} />);
    expect(screen.queryByRole("button", { name: "›" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Готово" })).toBeNull();
  });

  it("статуса руками нет вовсе: его двигают работой, а не выпадающим списком", () => {
    /* Прежде в форме задачи стоял список статусов, и «Готово» в нём
       приходилось запрещать отдельно. Теперь статус — следствие работы:
       взяли, сдали, приняли. Запрещать нечего. */
    render(<Board tasks={[task({ status: "review" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByDisplayValue("Проверка")).toBeNull();
  });
});

describe("сдача записывает факт выполнения", () => {
  const task = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }), ...over });

  it("сдача — это часы и сколько чего взяли и выдали; после неё задача на проверке",
    async () => {
      render(<Board tasks={[task({ status: "progress" })]} />);
      fireEvent.click(screen.getByText("Задача A"));
      fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));

      // Поля предзаполнены планом — переписать одно число проще, чем набирать все.
      const hours = screen.getByDisplayValue("2");
      fireEvent.change(hours, { target: { value: "5" } });
      fireEvent.blur(hours);
      // Функция обещала выдать «заявки» — без самой заявки работа не сдана.
      await attachResult("результат: заявки");
      // Их две: одна в форме сдачи, другая на карточке в колонке.
      fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);

      expect(screen.getByText(/5 ч/)).toBeInTheDocument();
      expect(screen.getByText(/взято: спрос/)).toBeInTheDocument();
    });

  /* ─── результат — часть выполнения, а не приложение к нему ───

     Функция выдаёт не число, а вещь: заявку, макет, договор. Пока её не
     приложили, задача не выполнена — сколько бы часов на неё ни ушло.
     Исключение одно и оно записано в самой функции: минимум в вилке равен
     нулю, то есть выдать могло и ничего. */
  it("без обязательного результата задача не сдаётся", async () => {
    render(<Board tasks={[task({ status: "progress" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));

    expect(screen.getByText(/Задача не выполнена, пока не приложено/))
      .toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    // Сдачи не появилось: числа записаны, а результата нет.
    expect(screen.queryByText(/взято: спрос/)).toBeNull();

    await attachResult("результат: заявки");
    expect(screen.queryByText(/Задача не выполнена, пока не приложено/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    expect(screen.getByText(/взято: спрос/)).toBeInTheDocument();
  });

  it("минимум ноль — сдать можно и без результата: выдать могло и ничего",
    async () => {
      const FREE = [{ ...FUNCS[0], id: "f9",
        gives: [{ id: "p9", trait: "t2", lo: 0, hi: 1, to: "" }] }];
      const Free = () => {
        const [tasks, setTasks] = React.useState([
          { ...newTask({ funcId: "f9", title: "Задача B" }), status: "progress" }]);
        const [openId, setOpenId] = React.useState(null);
        return (<TasksBoard funcs={FREE} entities={ENTITIES} traits={TRAITS}
          tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
          nameOf={(id) => id} />);
      };
      render(<Free />);
      fireEvent.click(screen.getByText("Задача B"));
      fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));

      expect(screen.queryByText(/Задача не выполнена, пока не приложено/)).toBeNull();
      expect(screen.getByText(/минимум по этому ресурсу — 0/)).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
      expect(screen.getByText(/взято: спрос/)).toBeInTheDocument();
    });

  it("выполнения считаются только по принятым задачам", () => {
    // Непринятая сдача — заявление исполнителя, а не измерение.
    const sb = { id: "s1", at: "2026-01-01T00:00:00Z", hours: 3,
      takes: { t1: 2 }, gives: { t2: 1 } };
    const one = (status) => runsOfFunc([{ funcId: "f1", status, submissions: [sb] }], "f1");
    expect(one("review")).toHaveLength(0);
    expect(one("done")).toHaveLength(1);
    expect(one("done")[0]).toMatchObject({ hours: 3, takes: { t1: 2 }, gives: { t2: 1 } });
  });
});

describe("назначения берутся из воркеров актива", () => {
  it("у каждой роли свой список — из воркеров этого актива", () => {
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    const names = (label) => [...screen.getByLabelText(label).options]
      .map((o) => o.textContent);
    // Владелец — постановщик функции, и он приходит в задачу словом, а не
    // выбором: назначен на схеме, здесь не меняется. Иван — исполнитель,
    // Пётр — проверяющий; рядом с именем — краткая статистика: постановщик
    // выбирает не вслепую, а видя, как человек работает.
    expect(screen.getByLabelText("постановщик").textContent).toBe("1");
    expect(screen.queryByRole("combobox", { name: "постановщик" })).toBeNull();
    expect(names("исполнитель")).toEqual(["— не назначен —", "Иван · без оценок · 0 работ"]);
    expect(names("проверяющий")).toEqual(["— не назначен —", "Пётр · без оценок · 0 работ"]);
  });

  it("все три роли обязательны — сказано, чего не хватает", () => {
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    // Постановщик подставился из ролей функции; двух остальных ещё нет.
    expect(screen.getByText(/не хватает исполнитель, проверяющий/))
      .toBeInTheDocument();
  });

  it("без постановщика у функции задачу не поставить — и сказано, где его назначить", () => {
    const [f] = FUNCS;
    const Host = () => {
      const [tasks, setTasks] = React.useState([newTask({ funcId: "f1", title: "Задача A" })]);
      return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={[{ ...f, setters: [] }]}
        entities={ENTITIES} traits={TRAITS} setTasks={setTasks} people={PEOPLE} canAssign
        nameOf={(id) => id} />);
    };
    render(<Host />);
    expect(screen.getByLabelText("постановщик").textContent).toBe("не назначен");
    expect(screen.getByText(/назначьте постановщика в ролях функции на схеме/))
      .toBeInTheDocument();
    expect(screen.getByText(/не хватает постановщик, исполнитель, проверяющий/))
      .toBeInTheDocument();
  });

  it("описание функции видно в задаче — и постановщику, и исполнителю", () => {
    /* Что это за работа, живёт у функции и едет в каждую её задачу:
       переписывать его в каждое выполнение значило бы просить одно и то
       же дважды. */
    const funcs = [{ ...FUNCS[0], about: "разбираем заявку и пишем ТЗ" }];
    const Board = () => {
      const [tasks, setTasks] = React.useState([{ ...newTask({ funcId: "f1",
        title: "Задача A" }), status: "progress", body: "" }]);
      const [openId, setOpenId] = React.useState(null);
      return (<TasksBoard funcs={funcs} entities={ENTITIES} traits={TRAITS}
        tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
        nameOf={(id) => id} />);
    };
    render(<Board />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByText("разбираем заявку и пишем ТЗ")).toBeInTheDocument();
    // И пустое содержимое не выдаётся за поломку: добавлять было нечего.
    expect(screen.queryByText(/Постановщик ещё не написал/)).toBeNull();
  });

  it("содержимое не обязательно: задача ставится и без него", () => {
    /* Что это за работа, уже сказано описанием функции. Требовать
       переписывать его в каждую задачу значило бы спрашивать второй раз
       то, что уже есть. */
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }), setter: "1",
      assignee: "2", reviewer: "3", body: "", end: "2030-03-01T11:00" };
    render(<Setup task={t} />);
    expect(screen.getByRole("button", { name: "Поставить" })).not.toBeDisabled();
  });

  it("содержимое пишет постановщик, а не машина", () => {
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    expect(screen.getByText(/Пишет постановщик/)).toBeInTheDocument();
  });
});

/* ПОСТАНОВКА ЖИВЁТ ВО ВКЛАДКЕ «ПРОВЕРКА».

   Постановка и приём — работа одного и того же человека: не того, кто
   делает. Поэтому они рядом, а на доске исполнителя постановки нет. */
describe("очередь постановки", () => {
  const waiting = { ...newTask({ funcId: "f1", title: "Задача из цели" }),
    goalId: "g1", end: "2030-01-01T10:00" };
  const Review = ({ tasks: t0, meId = "1", isOwner = true }) => {
    const [tasks, setTasks] = React.useState(t0);
    return (<ReviewBoard tasks={tasks} setTasks={setTasks} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} people={PEOPLE} meId={meId} isOwner={isOwner}
      nameOf={(id) => id} onAccept={() => {}} onReturn={() => {}} />);
  };

  it("непоставленные задачи ждут здесь, и сказано, чего им не хватает", () => {
    render(<Review tasks={[waiting]} />);
    expect(screen.getByText("ждут постановки")).toBeInTheDocument();
    expect(screen.getByText("Задача из цели")).toBeInTheDocument();
    expect(screen.getAllByText(/Не хватает: постановщик/).length).toBeGreaterThan(0);
  });

  it("форма постановки открывается здесь же, и задача уходит в бэклог", () => {
    render(<Review tasks={[{ ...waiting, setter: "1", assignee: "2", reviewer: "3",
      body: "собрать заявки" }]} />);
    fireEvent.click(screen.getByText("Задача из цели"));
    expect(screen.getByText("постановка задачи")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Поставить" }));
    // Поставленная уходит из очереди: она теперь на доске исполнителя, а
    // здесь остаётся только тем, что этот человек проверяет.
    expect(screen.getByText(/Ничего не ждёт постановки/)).toBeInTheDocument();
    expect(screen.queryByText("постановка задачи")).toBeNull();
  });

  it("форма раскрывается ПОД своей задачей, а не общим блоком внизу", () => {
    /* Внизу страницы она отвечала бы на вопрос «какую задачу мы сейчас
       ставим» тем, что человек должен вспомнить сам, — а он только что на
       неё нажал. */
    const second = { ...waiting, id: "tk2", title: "Вторая задача" };
    const { container } = render(<Review tasks={[waiting, second]} />);
    fireEvent.click(screen.getByText("Задача из цели"));
    const order = [...container.querySelectorAll("div")]
      .map((d) => d.textContent);
    const at = (t) => order.findIndex((x) => x.trim().startsWith(t));
    // Форма стоит между своей задачей и следующей, а не после обеих.
    expect(at("постановка задачи")).toBeGreaterThan(at("Задача из цели"));
    expect(at("постановка задачи")).toBeLessThan(at("Вторая задача"));
  });

  it("постановщику видно своё, а не чужое", () => {
    // Владельцу — всё: в задаче из цели постановщик ещё не назван.
    render(<Review tasks={[waiting, { ...waiting, id: "tk2", title: "Чужая",
      setter: "9" }]} meId="1" isOwner={false} />);
    expect(screen.queryByText("Чужая")).toBeNull();
  });

  it("ничего не ждёт — сказано, откуда задачи вообще берутся", () => {
    render(<Review tasks={[]} />);
    expect(screen.getByText(/Задачи появляются здесь, когда цель применена/))
      .toBeInTheDocument();
  });
});

describe("возврат с проверки", () => {
  const reviewTask = { ...newTask({ funcId: "f1", title: "Задача A" }),
    status: "review", assignee: "2", reviewer: "3",
    submissions: [{ id: "s1", at: "2026-01-01T00:00:00Z", hours: 3,
      takes: {}, gives: {} }] };

  it("«Вернуть» недоступен без текста доработки", () => {
    render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false}
      onAccept={() => {}} onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    const back = screen.getByRole("button", { name: "Вернуть в бэклог" });
    expect(back).toBeDisabled();

    fireEvent.change(screen.getByLabelText("комментарий к оценке"),
      { target: { value: "переделать" } });
    expect(screen.getByRole("button", { name: "Вернуть в бэклог" })).not.toBeDisabled();
  });

  it("принять без оценки и без слов нельзя", () => {
    // Оценка без слов не говорит, что исправить; слова без оценки не
    // складываются в историю. Приём — это и то и другое сразу.
    const got = [];
    render(<ReviewBoard tasks={[reviewTask]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false}
      onAccept={(t, note, mark) => got.push([note, mark])} onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    const take = () => screen.getByRole("button", { name: "Принять" });
    expect(take()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("комментарий к оценке"),
      { target: { value: "сделано" } });
    expect(take()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "оценка 4" }));
    expect(take()).not.toBeDisabled();
    fireEvent.click(take());
    expect(got).toEqual([["сделано", 4]]);
  });

  it("сказано, сдана работа в срок или после него", () => {
    render(<ReviewBoard tasks={[{ ...reviewTask, end: "2025-12-31T00:00:00Z" }]}
      funcs={FUNCS} traits={TRAITS} entities={ENTITIES} meId="3" isOwner={false}
      onAccept={() => {}} onReturn={() => {}} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByText("сдано после срока")).toBeInTheDocument();
  });

  it("проверяющий видит только своё, чужое не показывается", () => {
    const alien = { ...reviewTask, id: "x", title: "Чужая", reviewer: "9" };
    render(<ReviewBoard tasks={[reviewTask, alien]} funcs={FUNCS} traits={TRAITS}
      entities={ENTITIES} meId="3" isOwner={false}
      onAccept={() => {}} onReturn={() => {}} />);
    expect(screen.getByText("Задача A")).toBeTruthy();
    expect(screen.queryByText("Чужая")).toBeNull();
  });
});

describe("поля задачи в порядке постановки", () => {
  it("сперва название и люди, потом сроки, содержимое — перед «Поставить»", () => {
    const { container } = render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    const labels = [...container.querySelectorAll("div")]
      .map((d) => d.textContent)
      .filter((x) => ["название", "исполнитель", "проверяющий", "начать",
        "содержимое задачи — необязательно", "что сказали в задаче"].includes(x));
    expect(labels.indexOf("название")).toBeLessThan(labels.indexOf("исполнитель"));
    expect(labels.indexOf("исполнитель")).toBeLessThan(labels.indexOf("начать"));
    expect(labels.indexOf("начать"))
      .toBeLessThan(labels.indexOf("содержимое задачи — необязательно"));
    // Сказанное в задаче — ровно один раз, и только чтение: слова к
    // постановке пишет исполнитель при сдаче, а не постановщик.
    expect(labels.filter((x) => x === "что сказали в задаче")).toHaveLength(1);
    expect(screen.queryByPlaceholderText("написать комментарий")).toBeNull();
  });

  it("у исполнителя формы постановки нет — только содержимое, сдача и комментарии", () => {
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }), status: "backlog",
      setter: "1", assignee: "2", reviewer: "3", body: "собрать заявки",
      end: "2030-01-01T10:00" };
    render(<Board tasks={[t]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByText("собрать заявки")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "СДАТЬ" })).toBeInTheDocument();
    expect(screen.queryByLabelText("исполнитель")).toBeNull();
    expect(screen.queryByLabelText("начать")).toBeNull();
  });

  it("заводить задачи руками нельзя: они берутся из целей", () => {
    render(<Board tasks={[]} />);
    expect(screen.queryByRole("button", { name: "+ выполнение" })).toBeNull();
    /* Вводной карточки больше нет: на её месте переключатель «Доска» /
       «Пространство» (TasksTab). Объяснение читалось один раз, а место
       занимало при каждом заходе. */
    expect(screen.queryByText(/Задачи заводятся из применённых целей/)).toBeNull();
    expect(screen.queryByText(/задачи — то, что поручено/)).toBeNull();
  });
});

describe("«Инструменты» и роли", () => {
  const server = (me, org) => {
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: true, org: true, calls: true }) };
      }
      if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
      if (u.includes("/api/org/roles/") && opts.method === "DELETE") {
        org.roles = org.roles.filter((r) => !u.endsWith(encodeURIComponent(r.id)));
        return { ok: true, status: 204, json: async () => null };
      }
      if (u.includes("/api/org")) return { ok: true, json: async () => org };
      if (u.includes("/api/calls")) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ savedAt: null }) };
    });
  };
  const fresh = async () => {
    vi.resetModules(); resetIdentity();
    const { default: SystemModel } = await import("../components/SystemModel.jsx");
    return render(<SystemModel />);
  };
  beforeEach(() => { localStorage.clear(); resetIdentity(); });
  afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

  it("«Звонки» и «Выгрузка» — внутри «Инструментов», не в главном ряду", async () => {
    server({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] },
    { ownerId: "1", roles: [{ id: "executor", name: "исполнитель", tabs: ["tasks"], builtin: true }],
      users: [{ id: "1", name: "Владелец" }] });
    await fresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "Инструменты" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Звонки" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    expect(screen.getByRole("button", { name: "Люди и роли" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Звонки" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Выгрузка" })).toBeTruthy();
  });

  it("у роли есть кнопка «Удалить роль», а последнюю удалить нельзя", async () => {
    const org = { ownerId: "1", roles: [
      { id: "executor", name: "исполнитель", tabs: ["tasks"], builtin: true },
      { id: "custom", name: "Дизайнер", tabs: ["tasks"], builtin: false }],
    users: [{ id: "1", name: "Владелец" }] };
    server({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] }, org);
    await fresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "Инструменты" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Удалить роль" })).toHaveLength(2));
    // Встроенная тоже удаляется.
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить роль" })[0]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Удалить роль" })).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Удалить роль" })).toBeDisabled();
  });

  it("исполнителю на «Задачах» видно только назначенное ему, а не то, что он проверяет", async () => {
    /* Схема у не-владельца одна — та, где его назначил владелец: она
       приезжает с сервера, а сценариев на диске у него нет вовсе. */
    const model = {
      entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0,
        setters: ["1"], owners: ["2"], reviewers: ["3"] }],
      traits: [{ id: "t1", e: "a", k: "growth", l: "ресурс", unit: "шт", have: 0 }],
      kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
      funcs: [{ id: "fn1", e: "a", name: "Работа", dur: 1, durUnit: "ч",
        takes: [], gives: [], setters: ["1"], owners: ["2"], reviewers: ["3"] }],
      tasks: [
        { id: "mine", funcId: "fn1", title: "Моя работа", status: "backlog",
          setter: "1", assignee: "2", reviewer: "3", submissions: [], comments: [] },
        { id: "review", funcId: "fn1", title: "Я проверяю", status: "review",
          setter: "1", assignee: "3", reviewer: "2", submissions: [], comments: [] }],
    };
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: true, org: true }) };
      }
      if (u.includes("/api/org/me")) {
        return { ok: true, json: async () => ({ id: "2", isOwner: false, known: true,
          role: { id: "executor", name: "исполнитель" }, tabs: ["tasks", "tools"] }) };
      }
      if (u.includes("/api/workspace")) return { ok: true, json: async () => model };
      return { ok: true, json: async () => ({ savedAt: null }) };
    });
    await fresh();
    await waitFor(() => expect(screen.getByText("Моя работа")).toBeTruthy());
    expect(screen.queryByText("Я проверяю")).toBeNull();
  });

  it("у не-владельца нет сохранённых схем — только та, где его назначили", async () => {
    server({ id: "2", isOwner: false, known: true, role: { id: "executor", name: "исполнитель" },
      tabs: ["tasks", "tools"] }, { ownerId: "1", roles: [], users: [] });
    await fresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "Инструменты" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    expect(screen.queryByRole("button", { name: "Выгрузка" })).toBeNull();
  });
});
