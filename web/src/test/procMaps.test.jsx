import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { procPlan } from "../components/ProcMaps.jsx";

/* КАРТЫ ТЕХПРОЦЕССА (владелец, 2026-09-18): две кнопки справа под полем —
   таймлайн («когда») и майнд-карта («что куда»), обе модальным окном, в
   котором можно двигаться. */

const model = {
  entities: [{ id: "a", name: "Первый", posts: ["r1"] }, { id: "b", name: "Второй", posts: ["r2"] }],
  positions: [{ id: "r1", name: "Сборщик" }, { id: "r2", name: "Обработчик" }],
  traits: [{ id: "t1", l: "заявки", e: "a" }, { id: "t2", l: "лиды", e: "a" }, { id: "t3", l: "отчёт", e: "b" }],
};
const TEXT = [
  "Задача: собрать", "Срок: 2 дн", "Попытка: через 1 дн", "Критерий: есть ссылка",
  "Кто: Сборщик", "Берёт: заявки 5", "Отдаёт: лиды 3 (leads)", "Кому: Второй", "",
  "Задача: обработать", "Срок: 4 ч", "Кто: Обработчик", "Берёт: (leads)", "Отдаёт: отчёт 1",
].join("\n");

describe("план процесса", () => {
  it("задачи по порядку со сроком, паузой и ресурсами", () => {
    const plan = procPlan(TEXT, model, {});
    expect(plan.map((t) => t.name)).toEqual(["собрать", "обработать"]);
    expect(plan[0]).toMatchObject({ lo: 48, hi: 48, gap: 24, gapHi: 24 });
    expect(plan[0].checks).toEqual(["есть ссылка"]);
    expect(plan[0].gives.map((p) => p.name)).toEqual(["лиды"]);
    expect(plan[0].gives[0].varName).toBe("leads");
    expect(plan[1]).toMatchObject({ lo: 4, hi: 4 });
    expect(plan[1].takes.map((p) => p.name)).toEqual(["(leads)"]);
  });
});

describe("кнопки под полем", () => {
  let container;
  beforeEach(() => {
    localStorage.clear();
    ({ container } = render(<SystemModel />));
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: "Управление" }));
    const toggle = screen.getByRole("button", { name: "технологические процессы" });
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "+ процесс" }));
    const area = screen.getByLabelText("текст процесса");
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: "Задача: собрать\nСрок: 2 дн\nКто: Пользователи\nБерёт: заявки 5\nОтдаёт: активные пользователи 3" } });
    fireEvent.blur(area);
  });

  it("таймлайн открывается окном с задачей и шкалой; закрывается крестиком", () => {
    fireEvent.click(screen.getByRole("button", { name: "таймлайн процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Таймлайн процесса" });
    expect(within(dlg).getByLabelText("задача собрать")).toBeInTheDocument();
    expect(within(dlg).getByLabelText("таймлайн процесса")).toBeInTheDocument();   // окно, в котором двигаются
    expect(within(dlg).getAllByText(/2 дн/).length).toBeGreaterThan(0);
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
    expect(screen.queryByRole("dialog", { name: "Таймлайн процесса" })).toBeNull();
  });

  it("майнд-карта показывает задачу с тем, что она берёт и отдаёт", () => {
    fireEvent.click(screen.getByRole("button", { name: "майнд-карта процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const node = within(dlg).getByLabelText("задача собрать");
    expect(node.textContent).toContain("берёт: заявки");
    expect(node.textContent).toContain("отдаёт: активные пользователи");
    // Двигать карту можно: у окна есть слой перетаскивания.
    expect(container.querySelector("[data-pannable]")).not.toBeNull();
  });
});
