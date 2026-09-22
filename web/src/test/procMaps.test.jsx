import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { procPlan, portText } from "../components/ProcMaps.jsx";
import { openTab } from "./openTab.js";

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
    openTab("Схема");
    fireEvent.click(screen.getByRole("button", { name: "Управление" }));
    const toggle = screen.getByRole("button", { name: "технологические процессы" });
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "+ процесс" }));
    const area = screen.getByLabelText("текст процесса");
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: "Задача: собрать\nСрок: 2 дн\nКто: Пользователи\nБерёт: заявки 5\nОтдаёт: активные пользователи 3" } });
    fireEvent.blur(area);
  });

  /* Окно карты — порталом в body, у обеих форм майнд-карты своя высота
     (владелец, 2026-09-22: «таймлайн не показывает линейку, майнд-карта не
     открывается»): внутри стеклянной карточки fixed считался от неё, а
     окно карты без высоты схлопывалось в ноль. */
  it("окно карты стоит прямо в body, а у форм майнд-карты есть высота", () => {
    fireEvent.click(screen.getByRole("button", { name: "таймлайн процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Таймлайн процесса" });
    expect(dlg.parentElement).toBe(document.body);
    expect(container.contains(dlg)).toBe(false);
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
    fireEvent.click(screen.getByRole("button", { name: "майнд-карта процесса" }));
    const mind = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    expect(mind.parentElement).toBe(document.body);
    // Окно во всю длину экрана, формы делят его 3:2, прокрутки у столбца нет.
    const card = mind.firstElementChild;
    expect(card.style.height).toBe("calc(100dvh - 2 * var(--space-8))");
    const column = mind.querySelector("[data-map='ресурсы']").parentElement;
    expect(column.style.overflowY).toBe("");
    const res = mind.querySelector("[data-map='ресурсы']");
    const crew = mind.querySelector("[data-map='люди']");
    expect(res.style.flexGrow).toBe("3");
    expect(crew.style.flexGrow).toBe("2");
    expect(res.style.minHeight).toBe("0");
    expect(within(res).getByLabelText("майнд-карта процесса")).toBeInTheDocument();
  });

  it("таймлайн открывается окном с задачей и шкалой; закрывается крестиком", () => {
    fireEvent.click(screen.getByRole("button", { name: "таймлайн процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Таймлайн процесса" });
    expect(within(dlg).getByLabelText("задача собрать")).toBeInTheDocument();
    expect(within(dlg).getByLabelText("таймлайн процесса")).toBeInTheDocument();   // окно, в котором двигаются
    expect(within(dlg).getAllByText(/2 дн/).length).toBeGreaterThan(0);
    /* Линии линейки — годным цветом (владелец, 2026-09-22: «полосы линейки
       так и не появились»): «${C.line}66» на переменной CSS браузер
       выбрасывал молча. */
    const rule = within(dlg).getByText("1 дн").parentElement;
    expect(rule.style.borderLeft).toMatch(/^1px solid color-mix\(in srgb, var\(--border-glass\) 40%, transparent\)$/);
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
    expect(screen.queryByRole("dialog", { name: "Таймлайн процесса" })).toBeNull();
  });

  it("задача на таймлайне раскрывается нажатием и показывает полный текст (владелец, 2026-09-18)", () => {
    const area = screen.getAllByLabelText("текст процесса").pop();
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: [
      "Задача: Первичная проверка заявки с посадочной страницы и из звонков",
      "Критерий: заявка проверена по базе",
      "Кто: Пользователи",
      "Берёт: заявки с посадочной страницы и телефонных звонков 5",
    ].join("\n") } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "таймлайн процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Таймлайн процесса" });
    const bar = within(dlg).getByRole("button", { name: /^задача Первичная/ });
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    expect(dlg.querySelector("[aria-label$='целиком']")).toBeNull();
    fireEvent.click(bar);
    const card = dlg.querySelector("[aria-label$='целиком']");
    expect(bar.getAttribute("aria-expanded")).toBe("true");
    // Полное имя и все строки — без обрезки, с переносом.
    expect(card.textContent).toContain("Первичная проверка заявки с посадочной страницы и из звонков");
    expect(card.textContent).toContain("берёт: заявки с посадочной страницы и телефонных звонков 5");
    expect(card.textContent).toContain("заявка проверена по базе");
    expect(card.textContent).not.toContain("…");
    expect(getComputedStyle(card).whiteSpace).toBe("normal");
    fireEvent.click(bar);
    expect(dlg.querySelector("[aria-label$='целиком']")).toBeNull();
  });

  it("у каждой связи майнд-карты есть наконечник своего цвета, к ближней стороне блока (владелец, 2026-09-18)", () => {
    const area = screen.getAllByLabelText("текст процесса").pop();
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: [
      "Задача: Приём", "Кто: Пользователи", "Берёт: заявки 5", "Отдаёт: лиды 4", "",
      "Задача: Проверка", "Кто: Пользователи", "Берёт: лиды 4", "Отдаёт: оплата 2", "",
      "Задача: Счёт", "Кто: Пользователи", "Берёт: оплата 2", "Отдаёт: заявки 1",
    ].join("\n") } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "майнд-карта процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const links = Array.from(dlg.querySelectorAll("path[marker-end]"));
    expect(links.length).toBe(3);                       // заявки, лиды, оплата
    links.forEach((l) => {
      const id = l.getAttribute("marker-end").replace(/^url\(#|\)$/g, "");
      const head = dlg.querySelector(`#${id} path`);
      expect(head).not.toBeNull();
      expect(head.getAttribute("fill")).toBe(l.getAttribute("stroke"));   // наконечник цветом линии
    });
    /* Линия к задаче в том же столбце идёт по вертикали, а не в левый край:
       путь начинается вертикальным отрезком от той же вертикали (владелец,
       2026-09-19: линии строго вертикальные и горизонтальные). */
    const back = links.find((l) => /^M([\d.]+),[\d.]+ L\1,/.test(l.getAttribute("d")));
    expect(back).toBeTruthy();
  });

  it("связь через посредника — штрих-пунктирная дуга внизу; линии ресурсов сплошные (владелец, 2026-09-18)", () => {
    const area = screen.getAllByLabelText("текст процесса").pop();
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: [
      "Задача: Приём", "Кто: Пользователи {wise oyster}", "Отдаёт: лиды 4", "Кому: Клиенты", "",
      "Задача: Разбор", "Кто: Клиенты", "Берёт: лиды 4", "Отдаёт: оплата 2", "Кому: Партнёры", "",
      "Задача: Счёт", "Кто: Партнёры", "Берёт: оплата 2",
    ].join("\n") } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "майнд-карта процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const links = Array.from(dlg.querySelectorAll("path[marker-end][fill='none']"))
      .filter((l) => l.getAttribute("stroke-width") === "1.6");
    // Линии ресурсов — сплошные, сколько бы людей ни участвовало.
    links.forEach((l) => expect(l.getAttribute("stroke-dasharray")).toBeNull());
    /* Взаимодействие сотрудников — СВОЯ форма под картой, и люди на ней
       стоят по кругу (владелец, 2026-09-20): передают напрямую — сплошная
       линия, через посредника — штрих-пунктир. */
    const near = Array.from(dlg.querySelectorAll("line[data-talk='напрямую']"));
    const far = Array.from(dlg.querySelectorAll("line[data-talk='через']"));
    expect(near.length).toBeGreaterThan(0);
    near.forEach((l) => expect(l.getAttribute("stroke-dasharray")).toBeNull());
    expect(far.length).toBe(1);                                          // wise oyster → Партнёры, через Клиентов
    expect(far[0].getAttribute("stroke-dasharray")).toBe("7 3 1.5 3");
    // Должность видна у человечка, хотя в строке задачи названа только рука.
    const doer = dlg.querySelector("g[aria-label='исполнитель wise oyster']");
    expect(Array.from(doer.querySelectorAll("text")).map((t) => t.textContent)).toEqual(["wise oyster", "Пользователи"]);
  });

  it("задачи лежат на полупрозрачной плашке своей функции (владелец, 2026-09-19)", () => {
    const area = screen.getAllByLabelText("текст процесса").pop();
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: [
      "Функция: Приём заявок", "Задача: Принять", "Кто: Пользователи", "Отдаёт: лиды 4", "",
      "Задача: Проверить", "Кто: Пользователи", "Берёт: лиды 4", "", "",
      "Функция: Продажа", "Задача: Позвонить", "Кто: Клиенты", "Берёт: лиды 4",
    ].join("\n") } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "майнд-карта процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const plates = Array.from(dlg.querySelectorAll("g[data-func]"));
    expect(plates.map((g) => g.getAttribute("aria-label"))).toEqual(["функция Приём заявок", "функция Продажа"]);
    // Плашка полупрозрачная и без тяжёлой рамки.
    const first = plates[0].querySelector("rect");
    expect(Number(first.getAttribute("fill-opacity"))).toBeLessThan(0.2);
    expect(Number(first.getAttribute("stroke-opacity"))).toBeLessThan(0.5);
    // Задача лежит внутри плашки своей функции.
    const box = (r) => ({ x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")) });
    const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const plate = box(first);
    ["задача Принять", "задача Проверить"].forEach((name) => {
      expect(inside(box(within(dlg).getByLabelText(name).querySelector("rect")), plate)).toBe(true);
    });
    const other = box(plates[1].querySelector("rect"));
    expect(inside(box(within(dlg).getByLabelText("задача Позвонить").querySelector("rect")), other)).toBe(true);
    expect(inside(box(within(dlg).getByLabelText("задача Позвонить").querySelector("rect")), plate)).toBe(false);
  });

  it("майнд-карта показывает задачу с тем, что она берёт и отдаёт", () => {
    fireEvent.click(screen.getByRole("button", { name: "майнд-карта процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const node = within(dlg).getByLabelText("задача собрать");
    expect(node.textContent).toContain("берёт: заявки");
    expect(node.textContent).toContain("отдаёт: активные пользователи");
    // Двигать карту можно: у окна есть слой перетаскивания.
    expect(document.querySelector("[data-pannable]")).not.toBeNull();
  });

  it("блок тянется один: карта под ним стоит на месте (владелец, 2026-09-18)", () => {
    fireEvent.click(screen.getByRole("button", { name: "майнд-карта процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const node = within(dlg).getByLabelText("задача собрать");
    const box = node.querySelector("rect");
    const handle = node.querySelector("[data-drag-handle]");
    const pane = dlg.querySelector("[data-pannable]");
    const sheet = pane.firstChild;                       // слой, который двигает карту
    const was = { x: box.getAttribute("x"), y: box.getAttribute("y") };
    const paneWas = { left: sheet.style.left, top: sheet.style.top };

    fireEvent.touchStart(handle, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientX: 160, clientY: 140 }] });
    fireEvent.touchEnd(handle, {});

    const moved = node.querySelector("rect");
    expect(Number(moved.getAttribute("x"))).toBe(Number(was.x) + 60);
    expect(Number(moved.getAttribute("y"))).toBe(Number(was.y) + 40);
    expect(sheet.style.left).toBe(paneWas.left);          // карта не уехала следом
    expect(sheet.style.top).toBe(paneWas.top);
  });

  it("длинный текст в блоке переносится, а не обрезается (владелец, 2026-09-18)", () => {
    const area = screen.getAllByLabelText("текст процесса").pop();
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: [
      "Задача: Передача лида отделу продаж после первичной проверки",
      "Кто: Пользователи",
      "Берёт: заявки с посадочной страницы и из телефонных звонков 5",
    ].join("\n") } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "майнд-карта процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const node = within(dlg).getByLabelText(/задача Передача лида/);
    expect(node.textContent).not.toContain("…");                    // ничего не срезано
    const name = "Передача лида отделу продаж после первичной проверки";
    const shown = Array.from(node.querySelectorAll("text")).map((t) => t.textContent);
    expect(shown.filter((s) => name.includes(s)).join(" ")).toBe(name);   // имя целиком, строками
    expect(shown.join(" ")).toContain("посадочной страницы");
    const box = node.querySelector("rect");
    expect(Number(box.getAttribute("height"))).toBeGreaterThan(72);       // блок вырос под текст
  });

  it("раскладка и масштаб майнд-карты помнятся между открытиями (владелец, 2026-09-18)", () => {
    const open = () => {
      fireEvent.click(screen.getAllByRole("button", { name: "майнд-карта процесса" }).pop());
      return screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    };
    let dlg = open();
    let node = within(dlg).getByLabelText("задача собрать");
    const was = Number(node.querySelector("rect").getAttribute("x"));
    fireEvent.touchStart(node.querySelector("[data-drag-handle]"), { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(node.querySelector("[data-drag-handle]"), { touches: [{ clientX: 170, clientY: 130 }] });
    fireEvent.touchEnd(node.querySelector("[data-drag-handle]"), {});
    fireEvent.click(within(dlg).getByRole("button", { name: "крупнее" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));

    dlg = open();                                        // открыли заново
    node = within(dlg).getByLabelText("задача собрать");
    expect(Number(node.querySelector("rect").getAttribute("x"))).toBe(was + 70);
    const sheet = dlg.querySelector("[data-pannable]").firstChild;
    expect(sheet.style.transform).toContain("scale(1.2)");

    fireEvent.click(within(dlg).getByRole("button", { name: "в начало" }));   // «сброс» возвращает на места
    expect(Number(node.querySelector("rect").getAttribute("x"))).toBe(was);
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
    dlg = open();
    node = within(dlg).getByLabelText("задача собрать");
    expect(Number(node.querySelector("rect").getAttribute("x"))).toBe(was);
    expect(dlg.querySelector("[data-pannable]").firstChild.style.transform).toContain("scale(1)");
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
  });

  it("таймлайн водится по одной оси, а щипок двумя пальцами меняет масштаб (владелец, 2026-09-18)", () => {
    fireEvent.click(screen.getAllByRole("button", { name: "таймлайн процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Таймлайн процесса" });
    const pane = dlg.querySelector("[data-pannable]");
    const sheet = pane.firstChild;
    // Вдоль шкалы: движение почти горизонтальное — вертикаль не трогаем.
    fireEvent.touchStart(pane, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(pane, { touches: [{ clientX: 160, clientY: 130 }] });
    fireEvent.touchEnd(pane, { touches: [] });
    expect(sheet.style.left).toBe("60px");
    expect(sheet.style.top).toBe("0px");
    // Поперёк: движение почти вертикальное — горизонталь стоит.
    fireEvent.touchStart(pane, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(pane, { touches: [{ clientX: 130, clientY: 200 }] });
    fireEvent.touchEnd(pane, { touches: [] });
    expect(sheet.style.left).toBe("60px");
    expect(sheet.style.top).toBe("100px");
    // Щипок: пальцы разошлись вдвое — масштаб вырос (до потолка 2).
    fireEvent.touchStart(pane, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(pane, { touches: [{ clientX: 60, clientY: 100 }, { clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(pane, { touches: [] });
    expect(sheet.style.transform).toContain("scale(1.8)");
    expect(sheet.style.top).toBe("100px");        // щипок на таймлайне не уводит лист по вертикали
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
  });

  it("на майнд-карте щипок тоже меняет масштаб, а блок при этом не едет", () => {
    fireEvent.click(screen.getAllByRole("button", { name: "майнд-карта процесса" }).pop());
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const pane = dlg.querySelector("[data-pannable]");
    const sheet = pane.firstChild;
    const node = within(dlg).getByLabelText("задача собрать");
    const handle = node.querySelector("[data-drag-handle]");
    const was = node.querySelector("rect").getAttribute("x");
    fireEvent.touchStart(handle, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchStart(pane, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientX: 60, clientY: 100 }, { clientX: 240, clientY: 100 }] });
    fireEvent.touchMove(pane, { touches: [{ clientX: 60, clientY: 100 }, { clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(pane, { touches: [] });
    expect(sheet.style.transform).toContain("scale(1.8)");
    expect(node.querySelector("rect").getAttribute("x")).toBe(was);   // блок остался на месте
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть карту" }));
  });

  it("карта двигается, если тянуть мимо блока", () => {
    fireEvent.click(screen.getByRole("button", { name: "майнд-карта процесса" }));
    const dlg = screen.getByRole("dialog", { name: "Майнд-карта процесса" });
    const pane = dlg.querySelector("[data-pannable]");
    const sheet = pane.firstChild;
    fireEvent.touchStart(pane, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(pane, { touches: [{ clientX: 130, clientY: 120 }] });
    fireEvent.touchEnd(pane, {});
    expect(sheet.style.left).toBe("30px");
    expect(sheet.style.top).toBe("20px");
  });
});
