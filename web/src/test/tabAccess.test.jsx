import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import PeoplePanel from "../components/PeoplePanel.jsx";
import TasksBoard, { newTask } from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";
import { ALL_TABS, mayEdit, tabShown } from "../identity.js";

/* ВКЛАДКИ РОЛИ И ПРАВО НА НИХ (владелец, 2026-09-20).

   Роль открывает ЛЮБУЮ вкладку приложения — и верхнюю, и внутреннюю. У
   каждой два права: «r» — только смотреть, «rw» — ещё и править. Нажатия
   идут по кругу: закрыта → жёлтая «r» → зелёная «rw» → снова закрыта. */

const ORG = {
  ownerId: "1",
  roles: [{ id: "executor", name: "исполнитель", tabs: ["tasks"],
    access: { tasks: "rw" } }],
  users: [{ id: "1", name: "Владелец", roles: [] }],
  forms: [],
};

const ownerServer = () => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (opts.method && opts.method !== "GET") {
      calls.push({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ORG };
  }));
  return calls;
};

afterEach(() => vi.restoreAllMocks());

describe("список вкладок роли", () => {
  it("в списке ВСЕ вкладки приложения, и внутренние тоже", () => {
    expect(ALL_TABS).toContain("market");
    expect(ALL_TABS).toContain("me");
    ["scheme:edit", "scheme:time", "scheme:sim",
      "tools:people", "tools:assistant", "tools:reminders",
      "tools:calls", "tools:export"].forEach((t) => expect(ALL_TABS).toContain(t));
  });

  it("кнопка есть у каждой вкладки, и на ней написано право", async () => {
    ownerServer();
    render(<PeoplePanel />);
    await screen.findByLabelText("вкладка Задачи: rw");
    expect(screen.getByLabelText("вкладка Звонки: закрыта")).toBeInTheDocument();
    expect(screen.getByLabelText("вкладка Деятельность: закрыта")).toBeInTheDocument();
    expect(screen.getByLabelText("вкладка Задачи: rw").textContent).toBe("Задачи rw");
  });

  it("первое нажатие даёт «r», второе — «rw», третье закрывает", async () => {
    const calls = ownerServer();
    render(<PeoplePanel />);
    const tab = () => screen.getByLabelText(/^вкладка Звонки/);
    fireEvent.click(await screen.findByLabelText("вкладка Звонки: закрыта"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/roles/executor/tabs", method: "PUT" });
    expect(calls[0].body.tabs).toEqual({ tasks: "rw", "tools:calls": "r" });
    await waitFor(() => expect(tab()).toHaveAttribute("aria-label", "вкладка Звонки: закрыта"));

    // Право на кнопке — от роли: список перечитывается с сервера, поэтому
    // круг проверяем на роли, у которой право уже стоит.
    ORG.roles[0].access = { tasks: "rw", "tools:calls": "r" };
    ORG.roles[0].tabs = ["tasks", "tools:calls", "tools"];
    render(<PeoplePanel />);
    const second = (await screen.findAllByLabelText("вкладка Звонки: r")).at(-1);
    fireEvent.click(second);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.tabs["tools:calls"]).toBe("rw");

    ORG.roles[0].access = { tasks: "rw", "tools:calls": "rw" };
    render(<PeoplePanel />);
    fireEvent.click((await screen.findAllByLabelText("вкладка Звонки: rw")).at(-1));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].body.tabs["tools:calls"]).toBeUndefined();
    ORG.roles[0].access = { tasks: "rw" };
    ORG.roles[0].tabs = ["tasks"];
  });
});

describe("«r» запрещает правку сразу", () => {
  it("на вкладке с «r» править нельзя, на «rw» — можно", () => {
    const me = { isOwner: false, solo: false, tabs: ["tasks", "review"],
      access: { tasks: "r", review: "rw" } };
    expect(mayEdit(me, "tasks")).toBe(false);
    expect(mayEdit(me, "review")).toBe(true);
    // Владельцу и одиночке — всё: модель их.
    expect(mayEdit({ isOwner: true, access: { tasks: "r" } }, "tasks")).toBe(true);
    expect(mayEdit({ solo: true, access: { tasks: "r" } }, "tasks")).toBe(true);
  });

  it("роль, назвавшая внутренние вкладки, открывает ровно их", () => {
    const me = { isOwner: false, solo: false, tabs: ["tools", "tools:calls"] };
    expect(tabShown(me, "tools", "calls")).toBe(true);
    expect(tabShown(me, "tools", "export")).toBe(false);
    // Роль, назвавшая только верхнюю, открывает её целиком: вчерашняя
    // запись не должна сегодня терять разделы.
    const old = { isOwner: false, solo: false, tabs: ["tools"] };
    expect(tabShown(old, "tools", "calls")).toBe(true);
    expect(tabShown(old, "tools", "export")).toBe(true);
  });
});

/* ─── и то же самое на досках: с «r» кнопок работы нет вовсе ─── */
const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [], gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const mkTask = (over = {}) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  setter: "1", assignee: "2", reviewer: "3", end: "2030-01-01T10:00", ...over });

function Board({ tasks: t0, ro }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={(id) => id} meId="2" canAssign ro={ro} />);
}

describe("доски с правом «только смотреть»", () => {
  it("на «Задачах» с «r» нет ни «Взять в работу», ни «Сдать»", () => {
    const tasks = [mkTask({ id: "a", status: "backlog" }),
      mkTask({ id: "b", status: "progress", taken: true })];
    const { unmount } = render(<Board tasks={tasks} ro />);
    expect(screen.queryByRole("button", { name: "Взять в работу" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Сдать" })).toBeNull();
    unmount();
    render(<Board tasks={tasks} />);
    expect(screen.getByRole("button", { name: "Взять в работу" })).toBeInTheDocument();
  });

  it("на «Проверке» с «r» нет ни «Принять», ни «Вернуть в бэклог»", () => {
    const tasks = [mkTask({ id: "c", status: "review",
      submissions: [{ id: "s1", at: "2030-01-01T09:00", hours: 1, text: "готово",
        units: {}, files: {} }] })];
    const view = (ro) => (<ReviewBoard tasks={tasks} setTasks={() => {}} funcs={FUNCS}
      traits={TRAITS} entities={ENTITIES} people={[]} meId="3" canAssign
      nameOf={(id) => id} onAccept={() => {}} onReturn={() => {}} ro={ro} />);
    const { unmount } = render(view(true));
    fireEvent.click(screen.getAllByText("Задача A")[0]);
    expect(screen.queryByRole("button", { name: "Принять" })).toBeNull();
    unmount();
    render(view(false));
    fireEvent.click(screen.getAllByText("Задача A")[0]);
    expect(screen.getByRole("button", { name: "Принять" })).toBeInTheDocument();
  });
});
