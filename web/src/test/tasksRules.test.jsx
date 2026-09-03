import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import TasksBoard, { newTask, runsOfFunc } from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";
import React from "react";

/* Правила работы с задачами: задача — это выполнение функции; в «Готово»
   только через приём отчёта; возврат — в бэклог с текстом доработки;
   исполнителю видно только своё; поля задачи в порядке постановки;
   «Инструменты» с внутренними вкладками. */

const ENTITIES = [{ id: "usr", name: "Пользователи",
  owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт." },
  { id: "t2", e: "usr", l: "заявки", unit: "шт." }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];

function Board({ tasks: t0, people = PEOPLE, canAssign = true, onDraft = null }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    people={people} canAssign={canAssign} onDraft={onDraft} />);
}

describe("«Готово» — только через приём отчёта", () => {
  const task = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }), ...over });

  it("стрелка › на доске не переводит дальше «Проверки»", () => {
    render(<Board tasks={[task({ status: "review" })]} />);
    // Название лежит внутри карточки — стрелки её соседи.
    const card = screen.getByText("Задача A").parentElement;
    expect(within(card).getByRole("button", { name: "›" })).toBeDisabled();
  });

  it("из «В работе» стрелка ведёт на «Проверку», а не дальше", () => {
    render(<Board tasks={[task({ status: "progress" })]} />);
    const card = screen.getByText("Задача A").parentElement;
    fireEvent.click(within(card).getByRole("button", { name: "›" }));
    // Карточка переехала в колонку «Проверка», и дальше её не двинуть.
    const moved = screen.getByText("Задача A").parentElement;
    expect(within(moved).getByRole("button", { name: "›" })).toBeDisabled();
  });

  it("в редакторе статус «Готово» руками не выбрать", () => {
    render(<Board tasks={[task({ status: "review" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const done = [...screen.getByDisplayValue("Проверка").options]
      .find((o) => o.textContent === "Готово");
    expect(done.disabled).toBe(true);
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
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));

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
  it("в списке исполнителей только исполнители этого актива", () => {
    render(<Board tasks={[newTask({ funcId: "f1", title: "Задача A" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const box = screen.getAllByRole("combobox")[0];
    const names = [...box.options].map((o) => o.textContent);
    // Иван — исполнитель актива, Пётр — только проверяющий, Владелец не воркер.
    expect(names).toContain("Иван");
    expect(names).not.toContain("Пётр");
    expect(names).not.toContain("Владелец");
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

    fireEvent.change(screen.getByPlaceholderText(/что доработать/),
      { target: { value: "переделать" } });
    expect(screen.getByRole("button", { name: "Вернуть в бэклог" })).not.toBeDisabled();
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
  it("исполнитель и проверяющий сразу после названия, содержимое — последним", () => {
    const t = newTask({ funcId: "f1", title: "Задача A" });
    const { container } = render(<Board tasks={[t]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const labels = [...container.querySelectorAll("div")]
      .map((d) => d.textContent)
      .filter((x) => ["название", "исполнитель", "проверяющий", "содержимое задачи",
        "статус", "сдача"].includes(x));
    expect(labels.indexOf("название")).toBeLessThan(labels.indexOf("исполнитель"));
    expect(labels.indexOf("исполнитель")).toBeLessThan(labels.indexOf("статус"));
    expect(labels.indexOf("содержимое задачи")).toBe(labels.length - 1);
  });

  it("черновик от Claude просится сам, когда назначены оба, и текст правится", async () => {
    const onDraft = vi.fn(async () => "Сделать то-то. Считать готовым тогда-то.");
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }),
      assignee: "2", reviewer: "3" };
    render(<Board tasks={[t]} onDraft={onDraft} />);
    fireEvent.click(screen.getByText("Задача A"));
    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByDisplayValue(/Сделать то-то/)).toBeTruthy());
    expect(screen.getByText(/черновик от Claude — правьте/)).toBeTruthy();
    // Уже написанное не переписывается заново само.
    expect(onDraft).toHaveBeenCalledTimes(1);
  });

  it("без назначенных обоих черновик не просится", async () => {
    const onDraft = vi.fn(async () => "текст");
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }), assignee: "2" };
    render(<Board tasks={[t]} onDraft={onDraft} />);
    fireEvent.click(screen.getByText("Задача A"));
    await new Promise((r) => setTimeout(r, 50));
    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /черновик от Claude/ })).toBeDisabled();
  });

  it("без моста кнопки черновика нет вовсе — не обещаем того, чего нет", () => {
    const t = { ...newTask({ funcId: "f1", title: "Задача A" }),
      assignee: "2", reviewer: "3" };
    render(<Board tasks={[t]} onDraft={null} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByRole("button", { name: /черновик от Claude/ })).toBeNull();
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
    server({ id: "2", isOwner: false, known: true, role: { id: "executor", name: "исполнитель" },
      tabs: ["tasks", "tools"] }, { ownerId: "1", roles: [], users: [] });
    const { container } = await fresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "Задачи" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    const area = container.querySelector("textarea");
    fireEvent.change(area, { target: { value: JSON.stringify({
      entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }],
      traits: [{ id: "t1", e: "a", k: "growth", l: "ресурс", unit: "шт", have: 0, want: 10, by: 6 }],
      edges: [{ id: "ed1", from: "a", to: "t1", gives: 1, per: "мес", sign: 1, conds: [], basis: "fact" }],
      kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
      okrs: [], hypos: [],
      tasks: [
        { id: "mine", goalId: "t1", edgeId: "ed1", title: "Моя работа", status: "backlog",
          assignee: "2", reviewer: "3", submissions: [], comments: [] },
        { id: "review", goalId: "t1", edgeId: "ed1", title: "Я проверяю", status: "review",
          assignee: "3", reviewer: "2", submissions: [], comments: [] }],
    }) } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.getByText("Моя работа")).toBeTruthy();
    expect(screen.queryByText("Я проверяю")).toBeNull();
  });
});
