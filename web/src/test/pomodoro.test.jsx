import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import Pomodoro, { clockText, keyOf, leftNow, readState } from "../components/Pomodoro.jsx";

/* ТОМАТ (владелец, 2026-09-20).

   Слева минуты работы и перерыва, посередине часы, справа плей и пауза.
   Дошло до нуля — часы встают, бьют один раз и зеленеют; следующий плей
   начинает противоположный отрезок. Отсчёт идёт по часам, а не по тикам,
   поэтому закрытая форма и перезапуск приложения его не сбивают. */

const rang = vi.fn();
beforeEach(() => {
  localStorage.clear();
  rang.mockClear();
  vi.useFakeTimers();
  // Колокольчик — через WebAudio; в jsdom его нет, поэтому считаем удары.
  const osc = () => ({ type: "", frequency: { setValueAtTime() {} },
    connect() {}, start() {}, stop() {} });
  const gain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {} });
  window.AudioContext = function Ctx() {
    rang();
    return { currentTime: 0, destination: {}, createOscillator: osc, createGain: gain,
      close() {} };
  };
});
afterEach(() => { vi.useRealTimers(); delete window.AudioContext; });

const clock = () => screen.getByLabelText("часы томата");
const play = () => screen.getByRole("button", { name: "запустить" });
const pause = () => screen.getByRole("button", { name: "пауза" });

describe("часы томата", () => {
  it("по умолчанию 25 минут работы и 5 перерыва", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    expect(screen.getByLabelText("Работа: минут")).toHaveValue(25);
    expect(screen.getByLabelText("Перерыв: минут")).toHaveValue(5);
    expect(clock().textContent).toBe("25:00");
  });

  it("плей считает вниз, пауза останавливает", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(clock().textContent).toBe("23:55");
    fireEvent.click(pause());
    act(() => { vi.advanceTimersByTime(30_000); });
    // Часы стоят: пауза — это пауза, а не «медленнее».
    expect(clock().textContent).toBe("23:55");
  });

  it("на нуле встаёт, бьёт один раз и зеленеет", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.change(screen.getByLabelText("Работа: минут"), { target: { value: "1" } });
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(clock().textContent).toBe("00:00");
    expect(rang).toHaveBeenCalledTimes(1);
    expect(clock()).toHaveAttribute("data-done");
    // Дальше сам не идёт: ждёт нажатия.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(clock().textContent).toBe("00:00");
    expect(rang).toHaveBeenCalledTimes(1);
  });

  it("после работы следующий плей начинает перерыв, и наоборот", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.change(screen.getByLabelText("Работа: минут"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Перерыв: минут"), { target: { value: "2" } });
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText("работа")).toBeInTheDocument();

    fireEvent.click(play());
    expect(screen.getByText("перерыв")).toBeInTheDocument();
    expect(clock().textContent).toBe("02:00");
    act(() => { vi.advanceTimersByTime(121_000); });
    expect(clock().textContent).toBe("00:00");
    // Перерыв кончился — следующий отрезок снова работа.
    fireEvent.click(play());
    expect(screen.getByText("работа")).toBeInTheDocument();
    expect(clock().textContent).toBe("01:00");
  });

  it("отсчёт переживает закрытую форму: считается время, а не тики", () => {
    const { unmount } = render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(10_000); });
    unmount();
    // Форму закрыли на минуту — и вернулись.
    act(() => { vi.advanceTimersByTime(60_000); });
    render(<Pomodoro taskId="t1" meId="7" />);
    expect(clock().textContent).toBe("23:50");
  });

  it("у каждой задачи свои часы", () => {
    const { unmount } = render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.change(screen.getByLabelText("Работа: минут"), { target: { value: "40" } });
    unmount();
    render(<Pomodoro taskId="t2" meId="7" />);
    expect(clock().textContent).toBe("25:00");
    expect(readState(keyOf("7", "t1")).work).toBe(40);
  });

  it("минуты правятся, но не отнимают время у идущего отрезка", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(60_000); });
    fireEvent.change(screen.getByLabelText("Работа: минут"), { target: { value: "30" } });
    // Часы идут прежним отрезком; новое время возьмёт следующий.
    expect(clock().textContent).toBe("24:00");
  });
});

describe("счётчик", () => {
  it("минуты и секунды с ведущим нулём", () => {
    expect(clockText(0)).toBe("00:00");
    expect(clockText(65)).toBe("01:05");
    expect(clockText(1500)).toBe("25:00");
    expect(clockText(-5)).toBe("00:00");
  });

  it("остаток идущих часов считается по времени", () => {
    const st = { endsAt: 10_000, left: 999 };
    expect(leftNow(st, 4_000)).toBe(6);
    expect(leftNow(st, 20_000)).toBe(0);
    // Стоящие часы помнят остаток сами.
    expect(leftNow({ endsAt: null, left: 42 })).toBe(42);
  });
});

/* ─── где он стоит ───
   Только у взятой в работу задачи и только до сдачи; под ним — та же
   полоса срока, что на «Проверке». */
const ENTITIES = [{ id: "usr", name: "Пользователи",
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "заявки", unit: "шт.", have: 0 }];
const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", dur: 2, durUnit: "ч",
  takes: [], gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];

describe("томат в форме задачи", () => {
  let TasksBoard, newTask;
  beforeEach(async () => {
    ({ default: TasksBoard, newTask } = await import("../components/TasksBoard.jsx"));
  });
  const mk = (over) => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
    setter: "1", assignee: "2", reviewer: "3", end: "2030-01-01T10:00", ...over });
  const show = (task) => {
    function Board() {
      const [tasks, setTasks] = React.useState([task]);
      return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
        tasks={tasks} setTasks={setTasks} openId={task.id} setOpenId={() => {}}
        nameOf={(id) => id} meId="2" canAssign />);
    }
    return render(<Board />);
  };

  it("у взятой в работу — есть, и под ним полоса срока", () => {
    show(mk({ status: "progress", taken: true }));
    expect(screen.getByLabelText("томат")).toBeInTheDocument();
    expect(screen.getByLabelText(/до конца срока/)).toBeInTheDocument();
  });

  it("у лежащей в бэклоге — нет: её ещё не делают", () => {
    show(mk({ status: "backlog" }));
    expect(screen.queryByLabelText("томат")).toBeNull();
  });

  it("после сдачи пропадает", () => {
    show(mk({ status: "review", taken: true,
      submissions: [{ id: "s1", at: "2030-01-01T09:00", hours: 1, text: "готово",
        units: {}, files: {} }] }));
    expect(screen.queryByLabelText("томат")).toBeNull();
  });

  it("у принятой — тоже нет", () => {
    show(mk({ status: "done", taken: true }));
    expect(screen.queryByLabelText("томат")).toBeNull();
  });
});

/* ─── счётчик и сброс (владелец, 2026-09-20) ───
   Заголовок считает ПРОВЕДЁННЫЕ томаты по этой задаче, а «Сброс» бросает
   текущий отрезок и ставит противоположный. */
describe("томаты и сброс", () => {
  const reset = () => screen.getByRole("button", { name: "сброс" });

  it("заголовок — «Томатов: N», и вначале ноль", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    expect(screen.getByLabelText("томатов: 0").textContent).toBe("Томатов: 0");
  });

  it("доведённая до конца работа прибавляет томат, перерыв — нет", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.change(screen.getByLabelText("Работа: минут"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Перерыв: минут"), { target: { value: "1" } });
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByLabelText("томатов: 1")).toBeInTheDocument();
    // Перерыв до конца — счётчик не растёт: томат это работа.
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByLabelText("томатов: 1")).toBeInTheDocument();
  });

  it("счёт помнится у задачи и у каждой свой", () => {
    const { unmount } = render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.change(screen.getByLabelText("Работа: минут"), { target: { value: "1" } });
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(61_000); });
    unmount();
    render(<Pomodoro taskId="t2" meId="7" />);
    expect(screen.getByLabelText("томатов: 0")).toBeInTheDocument();
    expect(readState(keyOf("7", "t1")).done).toBe(1);
  });

  it("«Сброс» из работы ставит перерыв, из перерыва — работу", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    expect(screen.getByText("работа")).toBeInTheDocument();
    fireEvent.click(reset());
    expect(screen.getByText("перерыв")).toBeInTheDocument();
    expect(clock().textContent).toBe("05:00");
    fireEvent.click(reset());
    expect(screen.getByText("работа")).toBeInTheDocument();
    expect(clock().textContent).toBe("25:00");
  });

  it("сброшенная работа томатом не считается", () => {
    render(<Pomodoro taskId="t1" meId="7" />);
    fireEvent.click(play());
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(reset());
    expect(screen.getByLabelText("томатов: 0")).toBeInTheDocument();
    // И часы больше не идут: сброс останавливает отсчёт.
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(clock().textContent).toBe("05:00");
  });
});
