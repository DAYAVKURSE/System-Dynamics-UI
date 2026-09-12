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
    units: { t2: [{ kind: "code", code: "ABCD2345" }] },
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
  it("показывает единицы входа со ссылками «скачать», а израсходованную — нет", () => {
    render(<Board tasks={[collected(), contracted(),
      task({ id: "c", status: "progress", taken: true })]} />);
    fireEvent.click(screen.getByText("Задача C"));
    const list = screen.getByRole("list", { name: "материалы на входе: заявки" });
    // Заявка №1 ушла в договор — на входе её больше нет.
    expect(within(list).queryByText("№1")).toBeNull();
    expect(within(list).getByText("№2")).toBeInTheDocument();
    const link = within(list).getByRole("link", { name: "скачать заявки №2" });
    expect(link).toHaveAttribute("href", "data:text/plain,2");
    expect(link).toHaveAttribute("download", "заявка-2.pdf");
  });

  it("единиц нет — так и сказано, и блок виден без нажатия «Сдать»", () => {
    render(<Board tasks={[task({ id: "c", status: "backlog" })]} />);
    fireEvent.click(screen.getByText("Задача C"));
    expect(screen.getByText("материалы на входе")).toBeInTheDocument();
    expect(screen.getByText("единиц пока нет")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "материалы на входе: заявки" })).toBeNull();
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
  it("взятое — по номерам, выданный код — с кодом и ссылкой на подтверждение", () => {
    render(<Review tasks={[collected(), contracted("review")]} />);
    fireEvent.click(screen.getByText("Задача B"));
    const took = screen.getByRole("list", { name: "взято: заявки" });
    expect(within(took).getByText("№1")).toBeInTheDocument();
    expect(within(took).getByText("Задача A")).toBeInTheDocument();
    expect(within(took).getByRole("link", { name: "скачать заявки №1" }))
      .toHaveAttribute("href", "data:text/plain,1");
    const given = screen.getByRole("list", { name: "выдано: договоры" });
    expect(within(given).getByText("ABCD2345")).toBeInTheDocument();
    const proof = within(given).getByRole("link", { name: "скачать договоры №1" });
    expect(proof).toHaveTextContent("скачать подтверждение");
    expect(proof).toHaveAttribute("href", "data:text/plain,proof");
    expect(proof).toHaveAttribute("download", "выдача.pdf");
  });

  it("взятое не названо — сказано словами, с количеством по ресурсу", () => {
    const t = contracted("review");
    t.submissions[0].took = {};
    render(<Review tasks={[collected(), t]} />);
    fireEvent.click(screen.getByText("Задача B"));
    expect(screen.getByText("какие именно — не названо, взято: заявки 1")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "взято: заявки" })).toBeNull();
  });

  it("прежняя сдача с общим полем files читается и скачивается", () => {
    const old = task({ id: "a", title: "Задача A", funcId: "f0", status: "review",
      taken: true, submissions: [{ id: "s1", at: "2026-01-01T10:00:00Z", hours: 1,
        takes: {}, gives: { t1: 1 },
        files: { t1: { name: "старая.pdf", data: "data:text/plain,old" } } }] });
    render(<Review tasks={[old]} />);
    fireEvent.click(screen.getByText("Задача A"));
    expect(screen.getByText("ничего не взято")).toBeInTheDocument();
    const given = screen.getByRole("list", { name: "выдано: заявки" });
    const link = within(given).getByRole("link", { name: "скачать заявки №1" });
    expect(link).toHaveAttribute("href", "data:text/plain,old");
    expect(link).toHaveAttribute("download", "старая.pdf");
  });
});
