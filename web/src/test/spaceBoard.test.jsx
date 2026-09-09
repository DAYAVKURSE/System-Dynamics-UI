import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import SpaceBoard from "../components/SpaceBoard.jsx";
import { sameDoc, useHistory } from "../lib/history.js";
import { CELL, addArrow, emptySpace, normalizeSpace, placeNew } from "../lib/space.js";

/* Пространство держит запись у родителя (в документе модели). Здесь
   родитель — обёртка с состоянием; последняя запись видна через `last`,
   чтобы проверять не только экран, но и то, что ляжет в документ. */
const TASKS = [{ id: "t1", title: "Сбор заявок", status: "progress", assignee: "2", body: "обзвонить" }];
const FILES = [{ id: "f1", name: "макет.pdf", type: "application/pdf", url: "/api/reports/u/f1",
  from: "task", taskId: "t1" }];
const MEMORY = [{ id: "m1", title: "Регламент", text: "Как мы сдаём работу и когда" }];
const NAMES = { 2: "Иван" };

function Host({ space: s0, ask, onOpenTask, tasks = TASKS, files = FILES, memory = MEMORY, last }) {
  const [space, setSpace] = React.useState(() => normalizeSpace(s0));
  if (last) last.current = space;
  return <SpaceBoard space={space} setSpace={setSpace} tasks={tasks} files={files} memory={memory}
    ask={ask} nameOf={(id) => NAMES[id] || id} onOpenTask={onOpenTask} />;
}
const mount = (props = {}) => {
  const last = { current: null };
  const utils = render(<Host {...props} last={last} />);
  return { ...utils, last };
};
/* Два блока на известных местах: задача в первой клетке, память во второй. */
const placed = () => placeNew(emptySpace(), ["task:t1", "file:f1", "memory:m1"]);
const blockOf = (text) => screen.getByText(text).closest("[data-block]");
const tap = (el, x, y) => {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1, button: 0 });
};

afterEach(() => vi.restoreAllMocks());

describe("блоки по типам", () => {
  it("задача, файл и память появляются сами и подписаны своим словом", () => {
    const { last } = mount();
    const task = blockOf("Сбор заявок");
    expect(within(task).getByText("задача")).toBeInTheDocument();
    expect(within(task).getByText("В работе")).toBeInTheDocument();
    expect(within(task).getByText("исполнитель: Иван")).toBeInTheDocument();
    const file = blockOf("макет.pdf");
    expect(within(file).getByText("файл")).toBeInTheDocument();
    expect(within(file).getByText("скачать")).toHaveAttribute("href", "/api/reports/u/f1");
    const mem = blockOf("Регламент");
    expect(within(mem).getByText("память помощника")).toBeInTheDocument();
    expect(within(mem).getByText("Как мы сдаём работу и когда")).toBeInTheDocument();
    // Место дано сеткой — для показа: три блока — три разные клетки…
    expect(task.style.left).toBe("0px");
    expect(file.style.left).toBe(`${CELL.w}px`);
    expect(mem.style.left).toBe(`${2 * CELL.w}px`);
    // …а в запись само по себе не попадает: открыть пространство — не правка.
    expect(last.current.pos).toEqual({});
  });

  it("непоставленная задача на пространство не попадает, пустота названа словами", () => {
    mount({ tasks: [{ id: "w", title: "Ждёт", status: "wait" }], files: [], memory: [] });
    expect(screen.queryByText("Ждёт")).toBeNull();
    expect(screen.getByText(/пусто: заметок нет/)).toBeInTheDocument();
  });

  it("название задачи открывает её", () => {
    const onOpenTask = vi.fn();
    mount({ onOpenTask });
    fireEvent.click(screen.getByText("Сбор заявок"));
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });
});

describe("заметка", () => {
  it("добавляется пустой; у названия нет подсказки, под ним пустое место", () => {
    const { last } = mount({ tasks: [], files: [], memory: [] });
    fireEvent.click(screen.getByRole("button", { name: "+ заметка" }));
    const title = screen.getByLabelText("название заметки");
    expect(title).not.toHaveAttribute("placeholder");
    expect(title.value).toBe("");
    expect(title.style.minHeight).toBe("28px");
    expect(title.style.borderBottom).toContain("1px solid");
    expect(screen.getByLabelText("описание заметки")).toBeInTheDocument();
    expect(screen.getByLabelText("файл заметки")).toBeInTheDocument();
    expect(last.current.notes).toHaveLength(1);
    expect(last.current.notes[0].title).toBe("");
    // Название записывается по расфокусу.
    fireEvent.change(title, { target: { value: "Идея" } });
    fireEvent.blur(title);
    expect(last.current.notes[0].title).toBe("Идея");
  });
});

describe("вопрос помощнику", () => {
  it("«?» → вопрос → ответ ложится в блок; пока ждём — «думаю…»", async () => {
    let resolve;
    const ask = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { last } = mount({ ask });
    const task = blockOf("Сбор заявок");
    fireEvent.click(within(task).getByLabelText("спросить помощника"));
    fireEvent.change(within(task).getByLabelText("вопрос помощнику"), { target: { value: "с чего начать?" } });
    fireEvent.click(within(task).getByRole("button", { name: "Спросить" }));
    expect(within(task).getByText("думаю…")).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toBe("с чего начать?");
    // Контекст — что это за блок: название, статус, исполнитель, содержимое.
    expect(ask.mock.calls[0][1]).toMatch(/Сбор заявок/);
    expect(ask.mock.calls[0][1]).toMatch(/В работе/);
    expect(ask.mock.calls[0][1]).toMatch(/Иван/);
    expect(ask.mock.calls[0][1]).toMatch(/обзвонить/);
    await act(async () => { resolve("Со списка."); });
    await waitFor(() => expect(within(task).getByText("Со списка.")).toBeInTheDocument());
    expect(within(task).getByText("? с чего начать?")).toBeInTheDocument();
    expect(within(task).queryByText("думаю…")).toBeNull();
    expect(last.current.qa["task:t1"]).toHaveLength(1);
    expect(last.current.qa["task:t1"][0]).toMatchObject({ q: "с чего начать?", a: "Со списка." });
    expect(last.current.qa["task:t1"][0].at).toBeTruthy();
  });

  it("ошибка называется словами и в блок не записывается", async () => {
    const ask = vi.fn(() => Promise.reject(new Error("ключ не задан")));
    const { last } = mount({ ask });
    const task = blockOf("Сбор заявок");
    fireEvent.click(within(task).getByLabelText("спросить помощника"));
    fireEvent.change(within(task).getByLabelText("вопрос помощнику"), { target: { value: "а?" } });
    fireEvent.click(within(task).getByRole("button", { name: "Спросить" }));
    await waitFor(() => expect(within(task).getByText("не удалось спросить: ключ не задан")).toBeInTheDocument());
    expect(last.current.qa["task:t1"]).toBeUndefined();
  });

  it("без помощника — так и сказано", () => {
    mount({ ask: undefined });
    const task = blockOf("Сбор заявок");
    fireEvent.click(within(task).getByLabelText("спросить помощника"));
    fireEvent.change(within(task).getByLabelText("вопрос помощнику"), { target: { value: "а?" } });
    fireEvent.click(within(task).getByRole("button", { name: "Спросить" }));
    expect(within(task).getByText("помощник не подключён")).toBeInTheDocument();
  });
});

describe("корзина", () => {
  it("производный блок: предупреждение говорит, что задача останется, и убирает только блок", () => {
    let s = placed();
    s = addArrow(s, "task:t1", "file:f1", { x: CELL.w + 10, y: 10 });
    const { last } = mount({ space: s });
    const task = blockOf("Сбор заявок");
    fireEvent.click(within(task).getByLabelText("убрать блок"));
    expect(within(task).getByText(/Задача останется в модели/)).toBeInTheDocument();
    // Передумали — блок на месте.
    fireEvent.click(within(task).getByRole("button", { name: "Оставить" }));
    expect(within(task).queryByText(/останется в модели/)).toBeNull();
    fireEvent.click(within(task).getByLabelText("убрать блок"));
    fireEvent.click(within(task).getByRole("button", { name: "Убрать" }));
    expect(screen.queryByText("Сбор заявок")).toBeNull();
    expect(last.current.hidden).toEqual(["task:t1"]);
    expect(last.current.arrows).toEqual([]);
    // Модель не тронута: задача осталась в пропсах, а блок не вернулся.
    expect(screen.getByText("макет.pdf")).toBeInTheDocument();
  });

  it("заметка: предупреждение про стрелки, удаляется совсем", () => {
    const { last } = mount({ tasks: [], files: [], memory: [] });
    fireEvent.click(screen.getByRole("button", { name: "+ заметка" }));
    fireEvent.click(screen.getByLabelText("убрать блок"));
    expect(screen.getByText(/Удалить заметку\? Она пропадёт вместе со своими стрелками/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));
    expect(screen.queryByLabelText("название заметки")).toBeNull();
    expect(last.current.notes).toEqual([]);
  });
});

describe("стрелки", () => {
  it("блок → пустое место → блок даёт стрелку с одной точкой; двойное нажатие снимает точку", () => {
    const { container, last } = mount({ space: placed() });
    const task = blockOf("Сбор заявок");
    const mem = blockOf("Регламент");
    fireEvent.click(within(task).getByLabelText("стрелка от блока"));
    expect(screen.getByText(/стрелка от «Сбор заявок»/)).toBeInTheDocument();
    // Пустое место — точка перегиба (вид по умолчанию: экран = пространство).
    tap(screen.getByLabelText("пространство"), 300, 400);
    expect(screen.getByText(/точек: 1/)).toBeInTheDocument();
    // Касание второго блока завершает стрелку в точке касания.
    fireEvent.pointerDown(mem, { clientX: 2 * CELL.w + 30, clientY: 40, pointerId: 1, button: 0 });
    expect(screen.queryByText(/стрелка от «Сбор заявок»/)).toBeNull();
    expect(last.current.arrows).toHaveLength(1);
    const a = last.current.arrows[0];
    expect(a).toMatchObject({ from: "task:t1", to: "memory:m1", points: [{ x: 300, y: 400 }],
      at: { dx: 30, dy: 40 } });
    // Нарисована со скруглённым углом на точке, и у точки есть ручка.
    const path = container.querySelector(`path[data-arrow="${a.id}"]`);
    expect(path.getAttribute("d")).toMatch(/Q 300 400/);
    const handle = screen.getByLabelText("точка перегиба 1");
    tap(handle, 300, 400);
    tap(handle, 300, 400);
    expect(last.current.arrows[0].points).toEqual([]);
    expect(screen.queryByLabelText("точка перегиба 1")).toBeNull();
    expect(container.querySelector(`path[data-arrow="${a.id}"]`).getAttribute("d")).not.toMatch(/Q/);
  });

  it("касание того же блока отменяет режим, стрелки нет", () => {
    const { last } = mount({ space: placed() });
    const task = blockOf("Сбор заявок");
    fireEvent.click(within(task).getByLabelText("стрелка от блока"));
    fireEvent.pointerDown(task, { clientX: 10, clientY: 60, pointerId: 1, button: 0 });
    expect(screen.queryByText(/стрелка от/)).toBeNull();
    expect(last.current.arrows).toEqual([]);
  });

  it("точка перетаскивается и записывается один раз — когда отпустили", () => {
    let s = placed();
    s = addArrow(s, "task:t1", "memory:m1", null, [{ x: 300, y: 400 }]);
    const { last } = mount({ space: s });
    const before = last.current;
    const handle = screen.getByLabelText("точка перегиба 1");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 320, clientY: 450, pointerId: 1 });
    expect(last.current).toBe(before);
    fireEvent.pointerUp(handle, { clientX: 320, clientY: 450, pointerId: 1, button: 0 });
    expect(last.current.arrows[0].points).toEqual([{ x: 320, y: 450 }]);
  });
});

/* Раскладка и история правок.

   Пространство живёт в документе, а история (lib/history.js) записывает
   каждое его изменение. Пока автораскладка новых блоков писалась в
   документ эффектом, одно открытие вкладки зажигало «отменить», а после
   отмены эффект тут же клал раскладку обратно — и отменить что-либо при
   открытом пространстве было нельзя. */
describe("раскладка и история правок", () => {
  function HistHost({ tasks = TASKS, files = FILES, memory = MEMORY, last }) {
    const [space, setSpace] = React.useState(() => emptySpace());
    const [name, setName] = React.useState("Клиенты");
    const doc = React.useMemo(() => ({ name, space }), [name, space]);
    const restore = React.useCallback((d) => { setName(d.name); setSpace(d.space); }, []);
    const hist = useHistory(doc, restore);
    if (last) last.current = doc;
    return (
      <div>
        <button onClick={() => setName("Покупатели")}>переименовать</button>
        <button onClick={hist.undo} disabled={!hist.canUndo}>отменить</button>
        <button onClick={hist.redo} disabled={!hist.canRedo}>вернуть</button>
        <span data-testid="depth">{hist.depth}</span>
        <span data-testid="name">{name}</span>
        <SpaceBoard space={space} setSpace={setSpace} tasks={tasks} files={files} memory={memory}
          nameOf={(id) => NAMES[id] || id} />
      </div>);
  }

  it("открытие пространства документ не меняет, и «отменить» после чужой правки работает", () => {
    const last = { current: null };
    render(<HistHost last={last} />);
    const opened = last.current;
    expect(screen.getByText("Сбор заявок")).toBeInTheDocument();
    expect(screen.getByTestId("depth").textContent).toBe("0");
    expect(sameDoc(opened, { name: "Клиенты", space: emptySpace() })).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "переименовать" }));
    expect(screen.getByTestId("depth").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "отменить" }));
    expect(screen.getByTestId("name").textContent).toBe("Клиенты");
    expect(screen.getByTestId("depth").textContent).toBe("0");
    // Возврат жив: раскладка не легла новым шагом поверх отменённого.
    expect(screen.getByRole("button", { name: "вернуть" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "отменить" })).toBeDisabled();
    expect(last.current.space.pos).toEqual({});
    // Блоки на месте, хоть их положение и не записано.
    expect(blockOf("Сбор заявок").style.left).toBe("0px");
  });

  it("первое действие человека записывает раскладку целиком — соседи не прыгают", () => {
    const { last } = mount();
    const head = within(blockOf("Сбор заявок")).getByText("задача").parentElement;
    fireEvent.pointerDown(head, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(head, { clientX: 60, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(head, { clientX: 60, clientY: 90, pointerId: 1, button: 0 });
    expect(last.current.pos["task:t1"]).toEqual({ x: 50, y: 80 });
    // Файл и память записаны там, где человек их видел, а не пересчитаны
    // заново в освободившуюся клетку.
    expect(last.current.pos["file:f1"]).toEqual({ x: CELL.w, y: 0 });
    expect(last.current.pos["memory:m1"]).toEqual({ x: 2 * CELL.w, y: 0 });
    expect(blockOf("макет.pdf").style.left).toBe(`${CELL.w}px`);
  });

  it("стрелка к ещё не записанному блоку входит туда, куда ткнули", () => {
    const { last } = mount();
    fireEvent.click(within(blockOf("Сбор заявок")).getByLabelText("стрелка от блока"));
    fireEvent.pointerDown(blockOf("Регламент"),
      { clientX: 2 * CELL.w + 30, clientY: 40, pointerId: 1, button: 0 });
    expect(last.current.arrows[0]).toMatchObject({ from: "task:t1", to: "memory:m1", at: { dx: 30, dy: 40 } });
    expect(last.current.pos["memory:m1"]).toEqual({ x: 2 * CELL.w, y: 0 });
  });
});

describe("блоки двигаются, холст тянется и масштабируется", () => {
  it("блок тянется за заголовок и записывается по отпусканию", () => {
    const { last } = mount({ space: placed() });
    const head = within(blockOf("Сбор заявок")).getByText("задача").parentElement;
    fireEvent.pointerDown(head, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(head, { clientX: 60, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(head, { clientX: 60, clientY: 90, pointerId: 1, button: 0 });
    expect(last.current.pos["task:t1"]).toEqual({ x: 50, y: 80 });
  });

  it("перетаскивание фона сдвигает вид, колесо и кнопки меняют масштаб", async () => {
    vi.useFakeTimers();
    const { container, last } = mount({ space: placed() });
    const canvas = screen.getByLabelText("пространство");
    const layer = () => canvas.firstElementChild.style.transform;
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 130, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 130, clientY: 150, pointerId: 1, button: 0 });
    expect(layer()).toBe("translate(30px, 50px) scale(1)");
    fireEvent.click(screen.getByLabelText("крупнее"));
    expect(layer()).toMatch(/scale\(1\.25\)/);
    fireEvent.wheel(canvas, { deltaY: 500, clientX: 0, clientY: 0 });
    expect(layer()).not.toMatch(/scale\(1\.25\)/);
    fireEvent.click(screen.getByRole("button", { name: "по размеру" }));
    // Вид попадает в запись с задержкой, а не на каждое событие.
    expect(last.current.view).toEqual({ x: 0, y: 0, zoom: 1 });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(last.current.view.zoom).toBeLessThanOrEqual(1);
    expect(container.querySelector("svg")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
