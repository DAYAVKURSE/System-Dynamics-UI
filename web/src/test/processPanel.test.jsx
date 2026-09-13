import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { activeFuncs } from "../lib/funcs.js";
import { forecast } from "../lib/plan.js";

/* РАЗДЕЛ «ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС» ПОД СХЕМОЙ.

   Владелец: «в поле ввода должно вводиться так: актив, должность
   воркера, из какого актива, что берёт, и/или что выдаёт, в какой актив,
   что выдаёт, перевод строки; для каждого выбора — подсказка слева и
   выпадающий список; никакого ручного ввода двоеточий и стрелок; новое
   имя — кнопка OK под полем; новое в списках первым; список появляется
   до начала ввода; название процессу — по нажатию справа от слова
   «процесс»». Здесь проверяется ровно это — и то, что из этого следует:
   принятое гипотетически считается только с галочкой, «не принято»
   уносит гипотезы, удалённое на схеме не даёт принять, пока не выбрана
   замена. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
/* Процессы — первыми на «Управлении», под спойлером: открывается нажатием. */
const openProc = () => {
  scheme();
  fireEvent.click(screen.getByRole("button", { name: "Управление" }));
  const toggle = screen.getByRole("button", { name: "технологические процессы" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
};
const addProc = () => {
  openProc();
  fireEvent.click(screen.getByRole("button", { name: "+ процесс" }));
};
/* Выбранное стоит кнопкой с именем и «▾» рядом; поле со списком — по «▾». */
const field = (label) => {
  const edit = screen.queryByLabelText(`${label}: изменить`);
  if (edit) fireEvent.click(edit);
  return screen.getByLabelText(label);
};
const chosen = (label) => screen.getByLabelText(`${label}: открыть`).textContent;
const tap = (name) => {
  const g = container.querySelector(`[data-entity="${name}"]`);
  fireEvent.pointerDown(g, { clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: 51, clientY: 50, pointerId: 1 });
};
const listOf = (label) => screen.getByRole("listbox", { name: `${label}: список` });
/* Выбор из списка: фокус открывает список ДО набора, нажатие на пункт
   ставит его. */
const pick = (label, name) => {
  fireEvent.focus(field(label));
  fireEvent.click(within(listOf(label)).getByRole("option", { name }));
};
/* Новое имя: набор, под списком — «OK». */
const create = (label, word, name) => {
  fireEvent.focus(field(label));
  fireEvent.change(field(label), { target: { value: name } });
  fireEvent.mouseDown(screen.getByRole("button", { name: `OK: новый ${word} «${name}»` }));
};
const status = (name) => screen.getByRole("button", { name });
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
/* Один собранный шаг: Пользователи берут спрос с Рынка услуг и отдают
   заявки Пользователям. */
const fillStep = () => {
  pick("строка 1: актив", "Пользователи");
  fireEvent.click(screen.getByRole("button", { name: "строка 1: + берёт" }));
  pick("берёт 1: актив", "Рынок услуг");
  pick("берёт 1: ресурс", "спрос");
  fireEvent.click(screen.getByRole("button", { name: "строка 1: + отдаёт" }));
  pick("отдаёт 1: актив", "Пользователи");
  pick("отдаёт 1: ресурс", "заявки");
};
const buildStep = () => { addProc(); fillStep(); };

describe("шаг собирается выборами", () => {
  it("список открывается до набора; у каждого выбора подсказка слева; ресурс — после актива", () => {
    addProc();
    // Подсказки слева от выборов — словами владельца.
    const row = field("строка 1: актив").closest("div");
    expect(row.textContent).toMatch(/актив/);
    expect(row.textContent).toMatch(/должность/);
    fireEvent.focus(field("строка 1: актив"));
    const names = within(listOf("строка 1: актив")).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Рынок услуг", "Пользователи", "Виртуальный менеджер"]);
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + берёт" }));
    // Ресурс не выбрать, пока не назван актив, из которого берут.
    expect(field("берёт 1: ресурс")).toBeDisabled();
    pick("берёт 1: актив", "Рынок услуг");
    fireEvent.focus(field("берёт 1: ресурс"));
    expect(within(listOf("берёт 1: ресурс")).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["спрос"]);
    // Набранное сужает список, а не заменяет его.
    fireEvent.change(field("строка 1: актив"), { target: { value: "поль" } });
    fireEvent.focus(field("строка 1: актив"));
    fireEvent.change(field("строка 1: актив"), { target: { value: "поль" } });
    expect(within(listOf("строка 1: актив")).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Пользователи"]);
  });

  it("собранный шаг — словами в имени процесса; несобранный — причины под строками", () => {
    addProc();
    expect(screen.getByText("строка 1: не выбран актив")).toBeInTheDocument();
    expect(status("Принято")).toBeDisabled();
    fillStep();
    expect(screen.queryByText(/строка 1:/)).toBeNull();
    expect(status("Принято")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /назвать процесс «Пользователи: берёт спрос из Рынок услуг/ }))
      .toBeInTheDocument();
  });

  it("новое имя — кнопка OK: актив и ресурс заводятся гипотезой и стоят в списке первыми", () => {
    addProc();
    create("строка 1: актив", "актив", "Склад");
    expect(chosen("строка 1: актив")).toBe("Склад");
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + отдаёт" }));
    fireEvent.focus(field("отдаёт 1: актив"));
    const names = within(listOf("отдаёт 1: актив")).getAllByRole("option").map((o) => o.textContent);
    expect(names[0]).toBe("Склад · новое");
    pick("отдаёт 1: актив", "Склад · новое");
    create("отдаёт 1: ресурс", "ресурс", "коробки");
    expect(chosen("отдаёт 1: ресурс")).toBe("коробки");
    const m = dump();
    const wh = m.entities.find((e) => e.name === "Склад");
    expect(wh.hypo).toBe(true);
    const box = m.traits.find((t) => t.l === "коробки");
    expect(box).toMatchObject({ e: wh.id, hypo: true, accepted: false });
    expect(m.procs[0].hypo).toMatchObject({ entities: [wh.id], traits: [box.id] });
    expect(m.procs[0].text).toBe("Склад: берёт — → отдаёт коробки в Склад");
  });

  it("название — по нажатию справа от слова «процесс»", () => {
    addProc();
    fireEvent.click(screen.getByRole("button", { name: /назвать процесс/ }));
    const name = field("название процесса");
    fireEvent.change(name, { target: { value: "Продажи" } });
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.blur(name);
    expect(screen.getByRole("button", { name: "назвать процесс «Продажи»" })).toBeInTheDocument();
    expect(dump().procs[0].name).toBe("Продажи");
  });

  it("сколько угодно входов и выходов; «+ строка» — новая строка; ✕ убирает", () => {
    buildStep();
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + берёт" }));
    expect(field("берёт 2: актив")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "убрать: берёт 2" }));
    expect(screen.queryByLabelText("берёт 2: актив")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+ строка/ }));
    expect(field("строка 2: актив")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "убрать строку 2" }));
    expect(screen.queryByLabelText("строка 2: актив")).toBeNull();
  });
});

describe("три состояния процесса", () => {
  it("«принято гипотетически» собирает функцию в активе строки; «не принято» убирает её и гипотезы", () => {
    addProc();
    pick("строка 1: актив", "Пользователи");
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + берёт" }));
    pick("берёт 1: актив", "Рынок услуг");
    pick("берёт 1: ресурс", "спрос");
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + отдаёт" }));
    create("отдаёт 1: актив", "актив", "Склад");
    create("отдаёт 1: ресурс", "ресурс", "коробки");
    fireEvent.change(field("отдаёт 1: сколько"), { target: { value: "2" } });
    fireEvent.blur(field("отдаёт 1: сколько"));
    fireEvent.click(status("Принято гипотетически"));
    let m = dump();
    const f = m.funcs.find((x) => x.proc);
    expect(f).toMatchObject({ e: "usr", accepted: true });
    expect(f.takes.map((p) => [p.trait, p.lo, p.hi])).toEqual([["dem", 1, 1]]);
    const box = m.traits.find((t) => t.l === "коробки");
    expect(f.gives.map((p) => [p.trait, p.lo, p.hi])).toEqual([[box.id, 2, 2]]);
    fireEvent.click(status("Не принято"));
    m = dump();
    expect(m.funcs.some((x) => x.proc)).toBe(false);
    expect(m.entities.some((e) => e.name === "Склад")).toBe(false);
    expect(m.traits.some((t) => t.l === "коробки")).toBe(false);
  });

  it("правка шага принятого процесса пересобирает функцию", () => {
    buildStep();
    fireEvent.click(status("Принято"));
    fireEvent.change(field("берёт 1: сколько"), { target: { value: "3" } });
    fireEvent.blur(field("берёт 1: сколько"));
    const f = dump().funcs.find((x) => x.proc);
    expect(f.takes[0]).toMatchObject({ trait: "dem", lo: 3, hi: 3 });
  });

  it("гипотеза считается только с галочкой «включить гипотезы»", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    // Гипотез нет — и галочки нет: включать нечего.
    expect(screen.queryByLabelText("включить гипотезы")).toBeNull();

    addProc();
    pick("строка 1: актив", "Пользователи");
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + берёт" }));
    pick("берёт 1: актив", "Рынок услуг");
    pick("берёт 1: ресурс", "спрос");
    fireEvent.click(screen.getByRole("button", { name: "строка 1: + отдаёт" }));
    create("отдаёт 1: актив", "актив", "Склад");
    create("отдаёт 1: ресурс", "ресурс", "коробки");
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
  });
});

describe("удалённое на схеме", () => {
  it("выбор краснеет и просит замену; без неё принять нельзя; замена — тем же списком", () => {
    buildStep();
    const m = dump();
    // Спрос с рынка удалили со схемы: вход остался с id, которого нет.
    loadJson({ ...m, traits: m.traits.filter((t) => t.id !== "dem") });
    openProc();
    expect(chosen("берёт 1: ресурс")).toBe("спрос");
    expect(screen.getByText("удалён — выберите замену")).toBeInTheDocument();
    expect(screen.getByText("строка 1: берёт: ресурс «спрос» удалён — выберите замену")).toBeInTheDocument();
    expect(status("Принято")).toBeDisabled();
    // Замена — другой ресурс того же актива.
    pick("берёт 1: актив", "Пользователи");
    pick("берёт 1: ресурс", "активные пользователи");
    expect(screen.queryByText("удалён — выберите замену")).toBeNull();
    expect(screen.queryByText(/строка 1: берёт: ресурс «спрос» удалён/)).toBeNull();
    expect(status("Принято")).not.toBeDisabled();
  });
});

describe("процессы живут на «Управлении»", () => {
  it("своей вкладки нет; форма — первой, под спойлером, и до нажатия процессов не видно", () => {
    scheme();
    expect(screen.queryByRole("button", { name: "Технологический процесс" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "технологические процессы" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "+ процесс" })).toBeNull();
    // Первой — выше карточки выбранного актива.
    const card = screen.getByLabelText("название актива");
    // eslint-disable-next-line no-bitwise
    expect(toggle.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "+ процесс" })).toBeInTheDocument();
  });

  it("выбранный на схеме актив подсвечивает процессы, где он занят", () => {
    buildStep();   // Пользователи берут у Рынка услуг
    tap("vm");
    expect(screen.queryByText(/задействует выбранный актив/)).toBeNull();
    tap("mkt");
    expect(screen.getByText("задействует выбранный актив «Рынок услуг»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "технологические процессы" }).textContent)
      .toMatch(/с активом «Рынок услуг»: 1/);
  });

  it("нажатие на сущность в шаге открывает её карточку под формой", () => {
    buildStep();
    // Ресурс «спрос» — во вкладке «Ресурсы» Рынка услуг.
    fireEvent.click(screen.getByLabelText("берёт 1: ресурс: открыть"));
    expect(screen.getByDisplayValue("Рынок услуг")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("спрос").length).toBeGreaterThan(0);
    // Актив шага — его карточка.
    fireEvent.click(screen.getByLabelText("строка 1: актив: открыть"));
    expect(screen.getByDisplayValue("Пользователи")).toBeInTheDocument();
    // Карточка стоит ПОД формой процессов.
    const toggle = screen.getByRole("button", { name: "технологические процессы" });
    // eslint-disable-next-line no-bitwise
    expect(toggle.compareDocumentPosition(screen.getByDisplayValue("Пользователи"))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("нажатие на актив на схеме с «Прогноза» или «Деятельности» возвращает на «Управление»", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    expect(screen.queryByLabelText("название актива")).toBeNull();
    tap("mkt");
    expect(screen.getByDisplayValue("Рынок услуг")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Деятельность" }));
    expect(screen.queryByLabelText("название актива")).toBeNull();
    tap("usr");
    expect(screen.getByDisplayValue("Пользователи")).toBeInTheDocument();
  });
});
