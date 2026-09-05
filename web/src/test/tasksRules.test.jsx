import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import TasksBoard, { TaskSetup, newTask, runsOfFunc } from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";
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

/* Постановка — во вкладке «Проверка»: её делает не исполнитель. */
function Setup({ task: t0, people = PEOPLE, canAssign = true }) {
  const [tasks, setTasks] = React.useState([t0]);
  return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS} entities={ENTITIES}
    traits={TRAITS} setTasks={setTasks} people={people} canAssign={canAssign}
    nameOf={(id) => id} />);
}

describe("«Готово» — только через приём отчёта", () => {
  const task = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }), ...over });

  it("на проверке исполнителю нажимать нечего — дело за проверяющим", () => {
    render(<Board tasks={[task({ status: "review" })]} />);
    const card = screen.getByText("Задача A").parentElement;
    expect(within(card).queryByRole("button")).toBeNull();
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

  it("сдача — это часы и сколько чего взяли и выдали; после неё задача на проверке", () => {
    render(<Board tasks={[task({ status: "progress" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));

    // Поля предзаполнены планом — переписать одно число проще, чем набирать все.
    const hours = screen.getByDisplayValue("2");
    fireEvent.change(hours, { target: { value: "5" } });
    fireEvent.blur(hours);
    // Их две: одна в форме сдачи, другая на карточке в колонке.
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);

    expect(screen.getByText(/5 ч/)).toBeInTheDocument();
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
    // Владелец — постановщик актива, Иван — исполнитель, Пётр — проверяющий.
    // Рядом с именем — краткая статистика: постановщик выбирает не
    // вслепую, а видя, как человек работает.
    expect(names("постановщик")).toEqual(["— не назначен —", "Владелец · без оценок · 0 работ"]);
    expect(names("исполнитель")).toEqual(["— не назначен —", "Иван · без оценок · 0 работ"]);
    expect(names("проверяющий")).toEqual(["— не назначен —", "Пётр · без оценок · 0 работ"]);
  });

  it("все три роли обязательны — сказано, чего не хватает", () => {
    render(<Setup task={newTask({ funcId: "f1", title: "Задача A" })} />);
    expect(screen.getByText(/не хватает постановщик, исполнитель, проверяющий/))
      .toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /черновик от Claude/ })).toBeNull();
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
        "содержимое задачи — необязательно", "комментарии"].includes(x));
    expect(labels.indexOf("название")).toBeLessThan(labels.indexOf("исполнитель"));
    expect(labels.indexOf("исполнитель")).toBeLessThan(labels.indexOf("начать"));
    expect(labels.indexOf("начать"))
      .toBeLessThan(labels.indexOf("содержимое задачи — необязательно"));
    // Комментарии — ровно один раз: две формы подряд спрашивали одно и то же.
    expect(labels.filter((x) => x === "комментарии")).toHaveLength(1);
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
    expect(screen.getByText(/Задачи заводятся из применённых целей/)).toBeInTheDocument();
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
