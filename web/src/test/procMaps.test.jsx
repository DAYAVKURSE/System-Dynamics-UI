import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { procPlan, portText } from "../components/ProcMaps.jsx";

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
    // Ссылка «(leads)» знает, на какой ресурс указывает.
    expect(plan[1].takes[0]).toMatchObject({ ref: true, varName: "leads", of: "лиды" });
  });
});

describe("карта читает процесс владельца (2026-09-18)", () => {
  const T = [
    "Функция: Передача лида",
    "Задача: Передать оффер", "Кто: Сборщик (исполнитель) {kind sparrow}", "Отдаёт: заявки =1 (saddle)", "Кому: Второй", "",
    "Задача: Принять оффер", "Кто: Обработчик", "Берёт: (saddle)", "Отдаёт: отчёт =1 (badger)", "Кому: Первый {wise oyster}",
    "Или: лиды =1 (lantern)", "Кому: Сборщик {kind sparrow}", "",
    "Если: badger > 0", "То:",
    "Задача: Уточнить", "Кто: Первый {wise oyster}", "Берёт: (badger)", "Отдаёт: лиды =2 (pebble)", "Кому: Второй",
  ].join("\n");

  it("задач ровно столько, сколько написано: «Если/То» перед задачами не заводит пустую", () => {
    const plan = procPlan(T, model, {});
    expect(plan.map((t) => t.name)).toEqual(["Передать оффер", "Принять оффер", "Уточнить"]);
    // Условие группы стоит на задачах после «То:».
    expect(plan[2].cond).toBe("badger > 0");
    expect(plan[0].cond).toBeNull();
  });

  it("у ресурса известны количество, закреплённое имя и вторая сторона; «Или:» помечен", () => {
    const plan = procPlan(T, model, {});
    const give = plan[0].gives[0];
    expect(give).toMatchObject({ name: "заявки", varName: "saddle", qty: 1 });
    expect(give.party.map((x) => x.name)).toEqual(["Второй"]);
    expect(portText(give)).toBe("заявки 1 · saddle");
    // Ссылка «(saddle)» знает, что это за ресурс.
    const take = plan[1].takes[0];
    expect(take).toMatchObject({ varName: "saddle", ref: true, of: "заявки" });
    expect(portText(take)).toBe("заявки 1 · saddle");
    // Иной исход отмечен, получатель у него свой.
    const alt = plan[1].gives.find((p) => p.or);
    expect(alt).toMatchObject({ name: "лиды", varName: "lantern" });
    expect(alt.party.map((x) => x.hand)).toContain("kind sparrow");
  });

  it("исполнитель задачи известен — по нему красится полоска и подписывается человечек", () => {
    const plan = procPlan(T, model, {});
    expect(plan[0].who[0]).toMatchObject({ name: "Сборщик", hand: "kind sparrow" });
    expect(plan[0].who[0].roles).toContain("doer");
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
