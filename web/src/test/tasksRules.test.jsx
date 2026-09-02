import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import TasksBoard, { TaskEditor, newTask } from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";
import React from "react";

/* Правила работы с задачами: в «Готово» только через приём отчёта; возврат —
   в бэклог с текстом доработки; исполнителю видно только своё; поля задачи
   в порядке постановки; «Инструменты» с внутренними вкладками. */

const GOALS = [{ id: "u9", e: "usr", l: "активные пользователи", unit: "чел.", want: 10, by: 6 }];
const EDGES = [{ id: "e1", from: "mkt", to: "u9", carrier: "приток", gives: 1, per: "мес",
  sign: 1, conds: [], basis: "hypo" }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];

function Board({ tasks: t0, people = PEOPLE, canAssign = true, onDraft = null }) {
  const [tasks, setTasks] = React.useState(t0);
  const [okrs, setOkrs] = React.useState([]);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard goals={GOALS} okrs={okrs} setOkrs={setOkrs} edges={EDGES}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    okrValue={() => 5} entityName={() => "Актив"} people={people} canAssign={canAssign}
    onDraft={onDraft} />);
}

describe("«Готово» — только через приём отчёта", () => {
  it("стрелка › на доске не переводит дальше «Проверки»", () => {
    const t = newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" });
    const { container } = render(<Board tasks={[{ ...t, status: "review" }]} />);
    const card = screen.getByText("Задача A").closest("div").parentElement.parentElement;
    const next = within(card).getByRole("button", { name: "›" });
    expect(next).toBeDisabled();
    // Заголовок колонки «Готово» на доске есть, но задача туда не уехала.
    expect(container.textContent).toContain("Готово");
  });

  it("из «В работе» стрелка ведёт на «Проверку», а не дальше", () => {
    const t = newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" });
    render(<Board tasks={[{ ...t, status: "progress" }]} />);
    const card = screen.getByText("Задача A").closest("div").parentElement.parentElement;
    fireEvent.click(within(card).getByRole("button", { name: "›" }));
    const moved = screen.getByText("Задача A").closest("div").parentElement.parentElement;
    expect(within(moved).getByRole("button", { name: "›" })).toBeDisabled();
  });

  it("в редакторе статус «Готово» руками не выбрать", () => {
    const t = newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" });
    render(<Board tasks={[t]} />);
    fireEvent.click(screen.getByText("Задача A"));
    const opt = [...document.querySelectorAll("option")].find((o) => o.textContent === "Готово");
    expect(opt.disabled).toBe(true);
    expect(screen.getByText(/«Готово» ставит проверяющий/)).toBeTruthy();
  });
});

describe("возврат с проверки", () => {
  const task = { ...newTask({ goalId: "u9", edgeId: "e1", title: "На проверке" }),
    status: "review", assignee: "2", reviewer: "3",
    submissions: [{ id: "s1", at: new Date().toISOString(), amount: 3, text: "" }] };

  it("«Вернуть» недоступен без текста доработки", () => {
    const onReturn = vi.fn();
    render(<ReviewBoard tasks={[task]} traits={[]} entities={[]} edges={EDGES} goals={GOALS}
      meId="3" isOwner={false} onAccept={() => {}} onReturn={onReturn} nameOf={(x) => x} />);
    fireEvent.click(screen.getByText("На проверке"));
    const back = screen.getByRole("button", { name: "Вернуть в бэклог" });
    expect(back).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/что доработать/), { target: { value: "цифр нет" } });
    expect(back).not.toBeDisabled();
    fireEvent.click(back);
    expect(onReturn).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), "цифр нет");
  });

  it("проверяющий видит только своё, чужое не показывается", () => {
    const alien = { ...task, id: "alien", title: "Чужая", reviewer: "9" };
    render(<ReviewBoard tasks={[task, alien]} traits={[]} entities={[]} edges={EDGES}
      goals={GOALS} meId="3" isOwner={false} onAccept={() => {}} onReturn={() => {}} />);
    expect(screen.getByText("На проверке")).toBeTruthy();
    expect(screen.queryByText("Чужая")).toBeNull();
  });
});

describe("поля задачи в порядке постановки", () => {
  it("исполнитель и проверяющий сразу после названия, содержимое — последним", () => {
    const t = newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" });
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
    const t = { ...newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" }),
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
    const t = { ...newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" }), assignee: "2" };
    render(<Board tasks={[t]} onDraft={onDraft} />);
    fireEvent.click(screen.getByText("Задача A"));
    await new Promise((r) => setTimeout(r, 50));
    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /черновик от Claude/ })).toBeDisabled();
  });

  it("без моста кнопки черновика нет вовсе — не обещаем того, чего нет", () => {
    const t = { ...newTask({ goalId: "u9", edgeId: "e1", title: "Задача A" }),
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
