import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { activeFuncs } from "../lib/funcs.js";
import { forecast } from "../lib/plan.js";

/* РАЗДЕЛ «ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС» ПОД СХЕМОЙ.

   Владелец: «я буквально должен вводить текст, а он должен выдавать
   подсказки; если каких-то активов нет — они оборачиваются в рамку с
   пунктирной линией, и при нажатии появляются кнопки принять или
   отклонить». Здесь проверяется ровно это — и то, что из этого следует:
   принятое гипотетически считается только с галочкой, «не принято»
   уносит гипотезы, а удалённое на схеме не даёт принять, пока не
   поставлена замена. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
const openProc = () => {
  scheme();
  fireEvent.click(screen.getByRole("button", { name: "Технологический процесс" }));
};
const addProc = () => {
  openProc();
  fireEvent.click(screen.getByRole("button", { name: "+ процесс" }));
  return screen.getByLabelText("текст процесса");
};
const type = (el, v) => fireEvent.change(el, { target: { value: v } });
// Поле отдаёт текст по расфокусу: без blur разбор смотрел бы на прежнее.
const write = (el, v) => { type(el, v); fireEvent.blur(el); };
/* Как в assetPanel.test: на вкладке инструментов схемы нет, и единственное
   текстовое поле — поле выгрузки. */
const openExport = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  if (!container.querySelector("textarea")) {
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  }
  return container.querySelector("textarea");
};
const dump = () => {
  openExport();
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  const m = JSON.parse(container.querySelector("textarea").value);
  scheme();
  return m;
};
const loadJson = (m) => {
  const area = openExport();
  fireEvent.change(area, { target: { value: JSON.stringify(m) } });
  fireEvent.blur(area);
  const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
  fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
  scheme();
};
const status = (name) => screen.getByRole("button", { name });
/* Заводит процесс со складом, которого на схеме нет, и принимает обе
   гипотезы — актив и его ресурс. */
const acceptWarehouse = () => {
  const area = addProc();
  write(area, "Склад: берёт спрос 1 → отдаёт коробки 2");
  fireEvent.click(screen.getByRole("button", { name: "неизвестный актив «Склад»" }));
  fireEvent.click(screen.getByRole("button", { name: "принять актив «Склад»" }));
  fireEvent.click(screen.getByRole("button", { name: "неизвестный ресурс «коробки»" }));
  fireEvent.click(screen.getByRole("button", { name: "принять ресурс «коробки»" }));
};

describe("текст с подсказками", () => {
  it("в начале строки подсказывает активы, после «берёт» — ресурсы, и вставляет имя", () => {
    const area = addProc();
    type(area, "Поль");
    const list = screen.getByRole("listbox", { name: "подсказки процесса" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["актив Пользователи"]);
    fireEvent.mouseDown(within(list).getByRole("option"));
    expect(area.value).toBe("Пользователи: берёт ");
    expect(screen.queryByRole("listbox")).toBeNull();

    type(area, "Пользователи: берёт за");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ресурс заявки"]);
    fireEvent.keyDown(area, { key: "Enter" });
    expect(area.value).toBe("Пользователи: берёт заявки ");
    // После числа подсказывать нечего.
    type(area, "Пользователи: берёт заявки 2");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ошибка строки — словами под полем", () => {
    const area = addProc();
    write(area, "Склад берёт спрос 1");
    // И у строки, и в списке причин под кнопками — это одно и то же.
    expect(screen.getAllByText(/нет двоеточия после актива/).length).toBeGreaterThan(0);
    expect(status("Принято")).toBeDisabled();
  });
});

describe("неизвестные имена", () => {
  it("найденное — чип, ненайденное — пунктир; «Принять» заводит актив и ресурс с пометкой гипотезы", () => {
    const area = addProc();
    write(area, "Склад: берёт спрос 1 → отдаёт коробки 2");
    const chip = screen.getByRole("button", { name: "неизвестный актив «Склад»" });
    expect(chip.style.border).toMatch(/dashed/);
    // «спрос» есть на схеме — он не кнопка, а просто чип.
    expect(screen.queryByRole("button", { name: /«спрос»/ })).toBeNull();

    // Ресурс раньше актива принять нельзя: ему негде быть.
    fireEvent.click(screen.getByRole("button", { name: "неизвестный ресурс «коробки»" }));
    expect(screen.getByRole("button", { name: "принять ресурс «коробки»" })).toBeDisabled();

    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("button", { name: "принять актив «Склад»" }));
    let m = dump();
    const wh = m.entities.find((e) => e.name === "Склад");
    expect(wh).toMatchObject({ hypo: true });
    expect(m.procs[0].hypo.entities).toEqual([wh.id]);
    expect(screen.queryByRole("button", { name: "неизвестный актив «Склад»" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "неизвестный ресурс «коробки»" }));
    fireEvent.click(screen.getByRole("button", { name: "принять ресурс «коробки»" }));
    m = dump();
    const box = m.traits.find((t) => t.l === "коробки");
    expect(box).toMatchObject({ e: wh.id, hypo: true, accepted: false });
    expect(m.procs[0].hypo.traits).toEqual([box.id]);
  });

  it("«Отклонить» красит имя и не даёт принять процесс, пока строку не исправят", () => {
    const area = addProc();
    write(area, "Склад: берёт спрос 1 → отдаёт заявки 2");
    fireEvent.click(screen.getByRole("button", { name: "неизвестный актив «Склад»" }));
    fireEvent.click(screen.getByRole("button", { name: "отклонить актив «Склад»" }));
    expect(screen.getByRole("button", { name: "отклонённый актив «Склад»" })).toBeInTheDocument();
    expect(status("Принято")).toBeDisabled();
    expect(status("Принято гипотетически")).toBeDisabled();
    expect(status("Принято").title).toMatch(/отклонено/);
    expect(dump().procs[0].missing.rejected).toEqual(["Склад"]);

    write(screen.getByLabelText("текст процесса"), "Пользователи: берёт спрос 1 → отдаёт заявки 2");
    expect(status("Принято")).toBeEnabled();
  });
});

describe("три состояния процесса", () => {
  it("«принято гипотетически» собирает функции в активах строк, «не принято» уносит их с гипотезами", () => {
    acceptWarehouse();
    expect(status("Не принято")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(status("Принято гипотетически"));
    expect(status("Принято гипотетически")).toHaveAttribute("aria-pressed", "true");
    let m = dump();
    const wh = m.entities.find((e) => e.name === "Склад");
    const f = m.funcs.find((x) => x.proc === m.procs[0].id);
    expect(f).toMatchObject({ e: wh.id, accepted: true,
      name: "процесс: Склад: берёт спрос 1 → отдаёт коробки 2" });
    expect(f.takes[0]).toMatchObject({ trait: "dem", lo: 1, hi: 1 });
    expect(f.gives[0].lo).toBe(2);
    expect(m.procs[0].status).toBe("hypo");

    fireEvent.click(status("Не принято"));
    m = dump();
    expect(m.funcs.some((x) => x.proc)).toBe(false);
    expect(m.entities.some((e) => e.name === "Склад")).toBe(false);
    expect(m.traits.some((t) => t.l === "коробки")).toBe(false);
    expect(m.procs[0]).toMatchObject({ status: "off", hypo: { entities: [], traits: [] } });
  });

  it("правка текста принятого процесса пересобирает его функции", () => {
    const area = addProc();
    write(area, "Пользователи: берёт спрос 1 → отдаёт заявки 2");
    fireEvent.click(status("Принято"));
    expect(dump().funcs.find((x) => x.proc).gives[0].lo).toBe(2);
    write(screen.getByLabelText("текст процесса"), "Пользователи: берёт спрос 1 → отдаёт заявки 5");
    const fs = dump().funcs.filter((x) => x.proc);
    expect(fs).toHaveLength(1);
    expect(fs[0].gives[0].lo).toBe(5);
  });

  it("гипотеза считается только с галочкой «включить гипотезы»", () => {
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    // Гипотез нет — и галочки нет: включать нечего.
    expect(screen.queryByLabelText("включить гипотезы")).toBeNull();

    acceptWarehouse();
    fireEvent.click(status("Принято гипотетически"));
    const m = dump();
    expect(activeFuncs({ ...m, hypoOn: false }).some((f) => f.proc)).toBe(false);
    expect(activeFuncs({ ...m, hypoOn: true }).some((f) => f.proc)).toBe(true);
    const box = m.traits.find((t) => t.l === "коробки").id;
    const traits = m.traits.map((t) => ({ ...t, have: 100 }));
    expect(forecast({ ...m, traits, hypoOn: false }, { span: 3 }).hi[box][3]).toBe(100);
    expect(forecast({ ...m, traits, hypoOn: true }, { span: 3 }).hi[box][3]).toBeGreaterThan(100);

    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    const tick = screen.getByLabelText("включить гипотезы");
    expect(tick).not.toBeChecked();
    fireEvent.click(tick);
    expect(screen.getByLabelText("включить гипотезы")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Деятельность" }));
    expect(screen.getByLabelText("включить гипотезы")).toBeChecked();
  });
});

describe("удалённое на схеме", () => {
  it("строка просит замену, и без неё принять нельзя; замена правит текст", () => {
    acceptWarehouse();
    fireEvent.click(status("Принято гипотетически"));
    const m = dump();
    const wh = m.entities.find((e) => e.name === "Склад");
    // Склад удалили на схеме: ушёл он, его ресурс и его функции.
    loadJson({ ...m,
      entities: m.entities.filter((e) => e.id !== wh.id),
      traits: m.traits.filter((t) => t.e !== wh.id),
      funcs: m.funcs.filter((f) => f.e !== wh.id) });

    expect(screen.getByText(/Склад.*— удалён — выберите замену/)).toBeInTheDocument();
    expect(status("Принято")).toBeDisabled();
    expect(status("Принято гипотетически")).toBeDisabled();
    expect(status("Принято").title).toBe("сначала поставьте замену: Склад, коробки");

    fireEvent.change(screen.getByLabelText("замена для «Склад»"), { target: { value: "usr" } });
    expect(screen.getByLabelText("текст процесса").value)
      .toBe("Пользователи: берёт спрос 1 → отдаёт коробки 2");
    expect(status("Принято")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("замена для «коробки»"), { target: { value: "req" } });
    expect(screen.getByLabelText("текст процесса").value)
      .toBe("Пользователи: берёт спрос 1 → отдаёт заявки 2");
    expect(status("Принято")).toBeEnabled();
    fireEvent.click(status("Принято"));
    expect(dump().funcs.find((f) => f.proc)).toMatchObject({ e: "usr" });
  });
});
