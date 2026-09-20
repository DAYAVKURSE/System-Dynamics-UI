import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import TasksBoard, { newTask } from "../components/TasksBoard.jsx";
import ReviewBoard from "../components/ReviewBoard.jsx";

/* МАТЕРИАЛЫ В ЗАДАЧЕ И НА ПРОВЕРКЕ.

   Исполнитель работает не с числом «заявок 4», а с определённой заявкой:
   её и надо увидеть и скачать, открыв задачу, — до сдачи, а не в момент
   её. Израсходованной единицы на входе нет: её больше нет ни у кого.

   Проверяющий принимает работу по тому, что вышло: видит, что взяли (по
   номерам, которые назвал исполнитель) и что выдали — каждую вещь со
   скачиванием; у кода — сам код и бумагу о выдаче. Прежняя сдача, где
   файлы лежали общим полем `files`, читается так же. */

const ENTITIES = [{ id: "usr", name: "Бюро", setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const TRAITS = [{ id: "t1", e: "usr", l: "заявки", unit: "шт.", have: 0 },
  { id: "t2", e: "usr", l: "договоры", unit: "шт.", have: 0, kind: "code" }];
const FUNCS = [
  { id: "f0", e: "usr", name: "Сбор заявок", dur: 1, durUnit: "ч", takes: [],
    gives: [{ id: "p0", trait: "t1", lo: 1, hi: 2, to: "" }],
    setters: ["1"], owners: ["2"], reviewers: ["3"] },
  { id: "f1", e: "usr", name: "Договоры", dur: 2, durUnit: "ч",
    takes: [{ id: "p1", trait: "t1", lo: 1, hi: 1 }],
    gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
    setters: ["1"], owners: ["2"], reviewers: ["3"] }];

const task = (over = {}) => ({ ...newTask({ funcId: "f1", title: "Задача C" }),
  setter: "1", assignee: "2", reviewer: "3", ...over });

/* Две заявки вышли из принятой сдачи «Сбор заявок» — №1 и №2. */
const collected = () => task({ id: "a", title: "Задача A", funcId: "f0", status: "done",
  taken: true, submissions: [{ id: "s1", at: "2026-01-01T10:00:00Z", hours: 1,
    takes: {}, gives: { t1: 2 },
    units: { t1: [{ kind: "file", file: { name: "заявка-1.pdf", data: "data:text/plain,1" } },
      { kind: "file", file: { name: "заявка-2.pdf", data: "data:text/plain,2" } }] } }] });
/* Договор сделан из заявки №1 — исполнитель так и отметил при сдаче. */
const contracted = (status = "done") => task({ id: "b", title: "Задача B", status,
  taken: true, submissions: [{ id: "s2", at: "2026-01-02T10:00:00Z", hours: 2,
    takes: { t1: 1 }, took: { t1: ["s1~t1"] }, gives: { t2: 1 },
    units: { t2: [{ kind: "code", code: "ABCD2345" }] }, text: "сделано",
    proof: { name: "выдача.pdf", data: "data:text/plain,proof" } }] });

function Board({ tasks: t0 }) {
  const [tasks, setTasks] = React.useState(t0);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={TRAITS}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={(id) => String(id)} meId="2" />);
}
function Review({ tasks: t0 }) {
  const [tasks, setTasks] = React.useState(t0);
  return (<ReviewBoard tasks={tasks} setTasks={setTasks} funcs={FUNCS} traits={TRAITS}
    entities={ENTITIES} meId="1" isOwner canAssign nameOf={(id) => String(id)}
    onAccept={() => {}} onReturn={() => {}} />);
}

describe("форма задачи: материалы на входе", () => {
  /* ОДНА СТРОКА — ОДНА ВЕЩЬ, И В НЕЙ ТОЛЬКО ЕЁ ИМЯ (владелец, 2026-09-20):
     ни номера, ни задачи, при которой вещь получена. */
  it("показывает вещи входа именем и скачиванием, а израсходованную — нет", () => {
    render(<Board tasks={[collected(), contracted(),
      task({ id: "c", status: "progress", taken: true })]} />);
    fireEvent.click(screen.getByText("Задача C"));
    const list = screen.getByLabelText("предоставляемый материал");
    // Заявка №1 ушла в договор — на входе её больше нет.
    expect(within(list).queryByText("заявка-1.pdf")).toBeNull();
    expect(within(list).getByText("заявка-2.pdf")).toBeInTheDocument();
    // Ни номера, ни названия задачи в строке нет.
    expect(list.textContent).not.toMatch(/№/);
    expect(list.textContent).not.toMatch(/Задача A/);
    const link = within(list).getByRole("link", { name: "скачать заявка-2.pdf" });
    expect(link).toHaveAttribute("href", "data:text/plain,2");
    expect(link).toHaveAttribute("download", "заявка-2.pdf");
  });

  it("вещей нет — так и сказано, и блок виден без нажатия «Сдать»", () => {
    render(<Board tasks={[task({ id: "c", status: "backlog" })]} />);
    fireEvent.click(screen.getByText("Задача C"));
    expect(screen.getByText("предоставляемый материал")).toBeInTheDocument();
    expect(within(screen.getByLabelText("предоставляемый материал")).getByText("нет"))
      .toBeInTheDocument();
  });

  it("карточка на доске называет только число единиц на входе", () => {
    render(<Board tasks={[collected(), contracted(),
      task({ id: "c", status: "backlog" })]} />);
    expect(screen.getByText("материалов на входе: 1")).toBeInTheDocument();
    // Ссылок на карточке нет — они в открытой задаче.
    expect(screen.queryByRole("link", { name: /скачать/ })).toBeNull();
  });
});

describe("«Проверка»: материалы сдачи", () => {
  /* ФОРМА СДАЧИ — БЕЗ ЛИШНЕГО (владелец, 2026-09-20): сколько ушло, когда
     сдано, отчёт и материалы. Материалы строками: в строке только имя
     вещи и «Скачать» справа — ни номера, ни задачи, при которой она
     получена, ни чисел «взято: заявки 2». */
  it("взятое и выданное — строками с именем и скачиванием", () => {
    render(<Review tasks={[collected(), contracted("review")]} />);
    fireEvent.click(screen.getByText("Задача B"));
    const took = screen.getByRole("list", { name: "взято" });
    expect(within(took).getByText("заявка-1.pdf")).toBeInTheDocument();
    expect(took.textContent).not.toMatch(/№/);
    expect(took.textContent).not.toMatch(/Задача A/);
    expect(within(took).getByRole("link", { name: "скачать заявка-1.pdf" }))
      .toHaveAttribute("href", "data:text/plain,1");

    const given = screen.getByRole("list", { name: "выдано" });
    expect(within(given).getByText("ABCD2345")).toBeInTheDocument();
    // У кода скачивается бумага о выдаче: сам код уже на экране.
    const proof = within(given).getByRole("link", { name: "скачать ABCD2345" });
    expect(proof).toHaveAttribute("href", "data:text/plain,proof");
    expect(proof).toHaveAttribute("download", "выдача.pdf");

    // Чисел сдачи в форме больше нет.
    expect(screen.queryByText(/взято: заявки 1/)).toBeNull();
    expect(screen.queryByText(/выдано: договоры/)).toBeNull();
  });

  it("взятого нет — так и сказано, без объяснений", () => {
    const t = contracted("review");
    t.submissions[0].took = {};
    render(<Review tasks={[collected(), t]} />);
    fireEvent.click(screen.getByText("Задача B"));
    expect(screen.queryByText(/какие именно — не названо/)).toBeNull();
    expect(screen.getByRole("list", { name: "выдано" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "взято" })).toBeNull();
  });

  it("отчёт стоит под своим заголовком, а время и дата — сверху", () => {
    render(<Review tasks={[collected(), contracted("review")]} />);
    fireEvent.click(screen.getByText("Задача B"));
    expect(screen.getByText("ушло 2 ч")).toBeInTheDocument();
    expect(screen.getByText("отчёт")).toBeInTheDocument();
    expect(screen.getByText("сделано")).toBeInTheDocument();
  });
});
