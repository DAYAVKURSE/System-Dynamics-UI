import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import ReviewBoard from "../components/ReviewBoard.jsx";
import { newTask } from "../components/TasksBoard.jsx";
import { messageTaskRemote, seeChatRemote } from "../identity.js";

/* ОБСУЖДЕНИЕ ЗАДАЧИ на «Проверке» (владелец, 2026-09-20).

   Кнопка «Обсуждение» стоит на самой плашке задачи — чтобы увидеть
   непрочитанное, задачу не надо раскрывать. Красный кружок справа от
   названия кнопки говорит, сколько сообщений этот человек ещё не видел.
   Кнопка работает, пока идёт работа: до постановки и после сдачи она
   неактивна. */

const ENTITIES = [{ id: "usr", name: "Бюро", setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [], gives: [], setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const PEOPLE = [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];
const nameOf = (id) => PEOPLE.find((p) => p.id === String(id))?.name || String(id);

const CHAT = [
  { id: "m1", text: "когда начнёшь?", at: "2026-01-01T10:00:00Z", by: "1" },
  { id: "m2", text: "завтра", at: "2026-01-01T11:00:00Z", by: "2" },
];
const task = (over = {}) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  setter: "1", assignee: "2", reviewer: "3", status: "progress", chat: CHAT, ...over });

function Review({ tasks: t0, meId = "3", onSay, onSeen }) {
  const [tasks, setTasks] = React.useState(t0);
  return (<ReviewBoard tasks={tasks} setTasks={setTasks} funcs={FUNCS} traits={TRAITS}
    entities={ENTITIES} people={PEOPLE} meId={meId} isOwner nameOf={nameOf}
    onAccept={() => {}} onReturn={() => {}} onSay={onSay} onSeen={onSeen} />);
}
const button = () => screen.getByRole("button", { name: "обсуждение: Задача A" });

describe("обсуждение на «Проверке»", () => {
  it("кнопка — на плашке, и раскрывать задачу для неё не нужно", () => {
    render(<Review tasks={[task()]} />);
    expect(button()).toBeInTheDocument();
    // Задача закрыта: полей её не видно, а кнопка уже есть.
    expect(screen.queryByLabelText("поля задачи")).toBeNull();
  });

  it("красный кружок считает непрочитанное, открытие его снимает", () => {
    const seen = [];
    const t = task();
    render(<Review tasks={[t]} onSeen={(x) => seen.push(x.id)} />);
    // Пётр не читал ни одного из двух сообщений.
    expect(screen.getByLabelText("непрочитанных сообщений: 2")).toBeInTheDocument();
    fireEvent.click(button());
    expect(seen).toEqual([t.id]);
    expect(screen.queryByLabelText(/непрочитанных сообщений/)).toBeNull();
  });

  it("окно — разговор с датой, ролью и именем автора", () => {
    render(<Review tasks={[task()]} />);
    fireEvent.click(button());
    const talk = screen.getByLabelText("обсуждение");
    expect(within(talk).getByText("когда начнёшь?")).toBeInTheDocument();
    expect(within(talk).getByText(/Владелец · постановщик/)).toBeInTheDocument();
    expect(within(talk).getByText(/Иван · исполнитель/)).toBeInTheDocument();
  });

  it("сказанное уходит наружу и остаётся в разговоре", () => {
    const said = [];
    render(<Review tasks={[task()]} onSay={(t, text) => said.push(text)} />);
    fireEvent.click(button());
    const field = screen.getByLabelText("сообщение");
    fireEvent.change(field, { target: { value: "жду" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(said).toEqual(["жду"]);
    expect(within(screen.getByLabelText("обсуждение")).getByText("жду")).toBeInTheDocument();
  });

  /* ЧИТАТЬ МОЖНО ВСЕГДА, ПИСАТЬ — ПОКА РАБОТУ НЕ ПРИНЯЛИ (владелец,
     2026-09-20): «в обсуждения готовых задач должно быть можно зайти, но
     нельзя добавить сообщение»; на «Проверке» писать можно. */
  it("до постановки кнопка неактивна", () => {
    render(<Review tasks={[task({ status: "wait" })]} />);
    expect(button()).toBeDisabled();
  });

  it("готовая задача открывается, но писать в ней нечем", () => {
    render(<Review tasks={[task({ status: "done" })]} />);
    expect(button()).not.toBeDisabled();
    fireEvent.click(button());
    expect(within(screen.getByLabelText("обсуждение")).getByText("когда начнёшь?"))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("сообщение")).toBeNull();
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });

  it("сданная, но не принятая — писать можно", () => {
    render(<Review tasks={[task({ status: "review" })]} />);
    fireEvent.click(button());
    expect(screen.getByLabelText("сообщение")).toBeInTheDocument();
  });

  it("у готовой задачи полоски срока нет", () => {
    render(<Review tasks={[task({ status: "done", end: "2030-01-01T10:00" })]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.queryByText(/до конца срока/)).toBeNull();
  });
});

/* Своя операция на сервере: модель целиком пишет владелец, а сказать в
   задаче должен уметь любой, кому она видна. */
describe("маршруты обсуждения", () => {
  afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

  it("сообщение — POST …/chat, отметка прочтения — POST …/chat/seen", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method, body: JSON.parse(opts.body || "{}") });
      return { ok: true, status: 201, json: async () => ({}) };
    });
    await messageTaskRemote("tk1", "слово");
    await seeChatRemote("tk1");
    expect(calls[0]).toMatchObject({ url: "/api/workspace/tasks/tk1/chat", method: "POST",
      body: { text: "слово" } });
    expect(calls[1]).toMatchObject({ url: "/api/workspace/tasks/tk1/chat/seen",
      method: "POST" });
  });
});
