import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import TasksBoard, { newTask } from "../components/TasksBoard.jsx";

/* СКОЛЬКО ЕДИНИЦ СДАЮТ — СТОЛЬКО И ПРИКЛАДЫВАЮТ.

   Сдал десять договоров — десять файлов, по одному на договор. Прежде
   поле было одно на весь ресурс: оно принимало одну вещь, а число рядом
   говорило «десять». Одна вещь с десятью номерами — это не десять вещей.

   ЧЕМ подтверждается единица, решает РЕСУРС: файл, текст или уникальный
   код. Загружают только файл или текст; код создаёт программа, а вместо
   него прикладывают подтверждение — один файл на всю сдачу и сразу на
   все её единицы. */

const ENTITIES = [{ id: "usr", name: "Бюро", setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const trait = (kind) => ([{ id: "t1", e: "usr", l: "спрос", unit: "шт.", have: 100 },
  { id: "t2", e: "usr", l: "договоры", unit: "шт.", have: 0, kind }]);
const FUNCS = [{ id: "f1", e: "usr", name: "Договоры", dur: 2, durUnit: "ч",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, to: "" }],
  setters: ["1"], owners: ["2"], reviewers: ["3"] }];
const task = () => ({ ...newTask({ funcId: "f1", title: "Задача A" }),
  setter: "1", assignee: "2", reviewer: "3", status: "progress" });

function Board({ kind, onSubmit }) {
  const [tasks, setTasks] = React.useState([task()]);
  const [openId, setOpenId] = React.useState(null);
  return (<TasksBoard funcs={FUNCS} entities={ENTITIES} traits={trait(kind)}
    tasks={tasks} setTasks={setTasks} openId={openId} setOpenId={setOpenId}
    nameOf={(id) => String(id)} meId="2" onSubmit={onSubmit} />);
}

const open = () => {
  fireEvent.click(screen.getByText("Задача A"));
  fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
};
const setGiven = (n) => {
  const box = screen.getByLabelText("выдано: договоры");
  fireEvent.change(box, { target: { value: String(n) } });
  fireEvent.blur(box);
};
const attach = async (label, name) => {
  const input = screen.getByLabelText(label);
  const f = new File(["x"], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getAllByText(new RegExp(name.replace(".", "\\.")))
    .length).toBeGreaterThan(0));
};
const write = () => {
  const t = screen.getByLabelText("отчёт о работе");
  fireEvent.change(t, { target: { value: "сделал" } });
  fireEvent.blur(t);
};

describe("сдача: по вещи на каждую единицу", () => {
  it("десять единиц — десять полей загрузки, и сдать можно только заполнив все", async () => {
    const got = [];
    render(<Board kind="file" onSubmit={(t, sb) => got.push(sb)} />);
    open();
    setGiven(10);
    expect(screen.getByRole("list", { name: "файлы: договоры" })
      .querySelectorAll("input[type=file]")).toHaveLength(10);
    expect(screen.getByText(/готово 0 из 10/)).toBeInTheDocument();
    // Одна приложенная вещь из десяти — это не сданная работа.
    await attach("результат 1: договоры", "договор-1.pdf");
    expect(screen.getByText(/готово 1 из 10/)).toBeInTheDocument();
    expect(screen.getByText(/пока не приложено: договоры/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Сдать" })).toHaveLength(1);
    for (let i = 2; i <= 10; i += 1) {
      await attach(`результат ${i}: договоры`, `договор-${i}.pdf`);
    }
    expect(screen.getByText(/готово 10 из 10/)).toBeInTheDocument();
    // Отчёт словами — последним: с ним работа готова к сдаче.
    write();
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    expect(got).toHaveLength(1);
    expect(got[0].units.t2).toHaveLength(10);
    expect(got[0].units.t2.map((u) => u.file.name))
      .toEqual(Array.from({ length: 10 }, (_, i) => `договор-${i + 1}.pdf`));
  });

  it("ресурс-текст: у каждой единицы свой текст, а не файл", () => {
    const got = [];
    render(<Board kind="text" onSubmit={(t, sb) => got.push(sb)} />);
    open();
    setGiven(2);
    expect(screen.queryByLabelText(/^результат 1: договоры$/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "файлы: договоры" })).toBeNull();
    ["первый", "второй"].forEach((v, i) => {
      fireEvent.change(screen.getByLabelText(`результат ${i + 1}: договоры`),
        { target: { value: v } });
    });
    write();
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    expect(got[0].units.t2.map((u) => u.text)).toEqual(["первый", "второй"]);
  });

  it("ресурс-код: коды создаёт программа, а грузят подтверждение — одно на всех", async () => {
    const got = [];
    render(<Board kind="code" onSubmit={(t, sb) => got.push(sb)} />);
    open();
    setGiven(3);
    const codes = [...screen.getByRole("list", { name: "коды: договоры" })
      .querySelectorAll("input")].map((i) => i.value);
    expect(codes).toHaveLength(3);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z2-9]{8}$/));
    expect(new Set(codes).size).toBe(3);
    // Полей загрузки у кода нет вовсе — его не загружают.
    expect(screen.queryByRole("list", { name: "файлы: договоры" })).toBeNull();
    expect(screen.getByText(/нужно подтверждение/)).toBeInTheDocument();
    await attach("подтверждение выдачи", "акт.pdf");
    expect(screen.getByText(/подтверждение есть/)).toBeInTheDocument();
    write();
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    expect(got[0].units.t2.map((u) => u.code)).toEqual(codes);
    expect(got[0].proof.name).toBe("акт.pdf");
  });
});
