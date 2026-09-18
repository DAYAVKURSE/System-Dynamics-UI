import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* РАЗДЕЛ «ТЕХНОЛОГИЧЕСКИЕ ПРОЦЕССЫ» НА «УПРАВЛЕНИИ» — язык v2 (владелец,
   2026-09-18): строки с метками, подсказки окном над полем, роли значками
   и кнопками у выделенной должности, версии, выгрузка/загрузка. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
const openProc = () => {
  scheme();
  fireEvent.click(screen.getByRole("button", { name: "Управление" }));
  const toggle = screen.getByRole("button", { name: "технологические процессы" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
};
const addProc = () => {
  openProc();
  fireEvent.click(screen.getByRole("button", { name: "+ процесс" }));
  return screen.getByLabelText("текст процесса");
};
/* Правка включается двойным нажатием на текст (владелец, 2026-09-18). */
const edit = (el) => { fireEvent.doubleClick(el); fireEvent.focus(el); };
/* Просмотр: одинарное нажатие ставит курсор и открывает меню сущности. */
const view = (el) => fireEvent.focus(el);
const type = (el, v, at = v.length) => {
  edit(el);
  fireEvent.change(el, { target: { value: v, selectionStart: at } });
};
const write = (el, v) => { type(el, v); fireEvent.blur(el); };
const popup = () => screen.getByRole("dialog", { name: "подсказка процесса" });
const options = () => within(popup()).getAllByRole("option").map((o) => o.textContent);
const pick = (re) => fireEvent.click(within(popup()).getByRole("option", { name: re }));
const opList = () => screen.getByRole("listbox", { name: "операция: варианты" });
const pickOp = (re) => fireEvent.click(within(opList()).getByRole("option", { name: re }));
const openExport = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  if (!container.querySelector("textarea")) fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
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
};
const TEXT = "Задача: лид\nКто: Пользователи\nБерёт: заявки 2\nОтдаёт: заявки 50% A";

describe("просмотр и правка (владелец, 2026-09-18)", () => {
  it("одинарное нажатие: поле только для чтения, меню сущности есть, подсказок нет; двойное: правка, подсказки под полем, меню нет; нажатие вне поля — конец правки, Enter — новая строка", () => {
    const area = addProc();
    write(area, TEXT);
    expect(area).toHaveAttribute("readonly");
    view(area);
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("Пользователи") + 3 } });
    expect(container.querySelector("[data-role-buttons]")).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "подсказка процесса" })).toBeNull();
    expect(screen.getByText("двойное нажатие — правка")).toBeInTheDocument();
    // Плавающее меню — не в поле: position fixed, с шапкой для перетаскивания.
    const float = container.querySelector("[data-proc-menu]");
    expect(float.style.position).toBe("fixed");
    expect(within(float).getByLabelText("перетащить меню")).toBeInTheDocument();
    fireEvent.doubleClick(area);
    expect(area).not.toHaveAttribute("readonly");
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("Пользователи") + 3 } });
    expect(container.querySelector("[data-role-buttons]")).toBeNull();
    expect(screen.getByRole("dialog", { name: "подсказка процесса" })).toBeInTheDocument();
    // Enter — обычный перенос строки, правка продолжается, на новой строке — метки (владелец, 2026-09-18).
    fireEvent.click(area, { target: { selectionStart: TEXT.length } });
    const ev = fireEvent.keyDown(area, { key: "Enter" });
    expect(ev).toBe(true);   // не перехвачен — браузер переносит строку
    expect(area).not.toHaveAttribute("readonly");
    type(area, `${TEXT}\n`);
    expect(options()[0]).toMatch(/^метка /);
    // Одинарное нажатие и прокрутка внутри поля правку не прерывают (владелец, 2026-09-18).
    fireEvent.mouseDown(area, { detail: 1 });
    fireEvent.click(area, { target: { selectionStart: 3 } });
    fireEvent.scroll(area);
    expect(area).not.toHaveAttribute("readonly");
    expect(screen.getByRole("dialog", { name: "подсказка процесса" })).toBeInTheDocument();
    // Нажатие вне поля (потеря фокуса) — конец правки.
    fireEvent.blur(area);
    expect(area).toHaveAttribute("readonly");
    // Нажатие вне поля: меню остаётся, но неактивно (полупрозрачно); нажатие на нём — снова активно; крестик закрывает.
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("Пользователи") + 3 } });
    fireEvent.blur(area);
    const menu2 = container.querySelector("[data-proc-menu]");
    expect(menu2).not.toBeNull();
    expect(menu2.style.opacity).toBe("0.55");
    fireEvent.mouseDown(menu2);
    expect(menu2.style.opacity).toBe("1");
    fireEvent.click(within(menu2).getByRole("button", { name: "закрыть меню" }));
    expect(container.querySelector("[data-proc-menu]")).toBeNull();
    // Высота поля фиксированная: rows не зависит от текста.
    expect(area.getAttribute("rows")).toBe("12");
  });
});

describe("подсказки ведут по строкам", () => {
  it("метка → «Кто:» → актив (новая строка) → «Берёт:» → ресурс → сколько → новая строка → «Кому:»", async () => {
    const area = addProc();
    type(area, "");
    // окно подсказок — под полем, в потоке (владелец, 2026-09-18)
    expect(area.compareDocumentPosition(popup()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(popup().style.position).not.toBe("absolute");
    expect(options().slice(0, 2)).toEqual(["метка Кто: — участник", "метка Задача: — новая задача"]);
    pick(/^метка Задача:/);
    expect(area).toHaveValue("Задача: ");
    type(area, "Задача: лид");
    pick(/^дальше ↵/);
    expect(area).toHaveValue("Задача: лид\nКто: ");
    await waitFor(() => expect(options()[1]).toBe("актив Пользователи — любой воркер"));
    pick(/^актив Пользователи/);
    expect(area).toHaveValue("Задача: лид\nКто: Пользователи\n");
    await waitFor(() => expect(options().slice(0, 2)).toEqual(["метка Берёт: — что берёт", "метка Отдаёт: — что отдаёт"]));
    pick(/^метка Берёт:/);
    await waitFor(() => expect(options()).toContain("ресурс заявки — Пользователи"));
    pick(/^ресурс заявки/);
    expect(area).toHaveValue("Задача: лид\nКто: Пользователи\nБерёт: заявки ");
    await waitFor(() => expect(popup()).toHaveTextContent("сколько"));
    type(area, "Задача: лид\nКто: Пользователи\nБерёт: заявки 2");
    pick(/^дальше ↵ — новая строка$/);
    expect(area).toHaveValue("Задача: лид\nКто: Пользователи\nБерёт: заявки 2\n");
    await waitFor(() => expect(options()[0]).toBe("метка От кого: — откуда"));
    pick(/^метка Отдаёт:/);
    await waitFor(() => expect(options()).toContain("ресурс заявки — Пользователи"));
    pick(/^ресурс заявки/);
    type(area, `${TEXT}`);
    pick(/новая строка: Кому:/);
    expect(area).toHaveValue(`${TEXT}\nКому: `);
    await waitFor(() => expect(options()).toContain("актив Рынок услуг"));
    pick(/^актив Рынок услуг/);
    expect(area).toHaveValue(`${TEXT}\nКому: Рынок услуг\n`);
  });

  it("поле рисует метки серым, задачу, актив, ресурсы плашками стороны в скобках; под полем — разбор с буквами", () => {
    const area = addProc();
    write(area, TEXT);
    const back = container.querySelector("[data-proc-backdrop]");
    expect(Array.from(back.querySelectorAll("[data-kind]")).map((e) => `${e.dataset.kind}:${e.textContent}`))
      .toEqual(["mark:Задача:", "task:лид", "mark:Кто:", "asset:Пользователи", "mark:Берёт:", "trait:заявки 2", "mark:Отдаёт:", "trait:заявки 50% A"]);
    expect(Array.from(back.querySelectorAll("[data-bracket]")).map((e) => e.dataset.bracket)).toEqual(["take", "give"]);
    expect(area.style.color).toBe("transparent");
    expect(screen.getByText(/задача 1:/)).toHaveTextContent("лид");
    expect(screen.getByLabelText("буква A: заявки")).toBeInTheDocument();
    expect(screen.getByLabelText("буква B: заявки")).toBeInTheDocument();
    expect(screen.getAllByLabelText("ресурс «заявки»: открыть")).toHaveLength(2);
  });
});

describe("роли, статусы, функции", () => {
  it("курсор в строке «Кто:» открывает меню столбиком: роли с названиями, «Закрепить сотрудника», «Выбрать сотрудника»", async () => {
    const area = addProc();
    write(area, TEXT);
    view(area);
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("Пользователи") + 3 } });
    const menu = container.querySelector("[data-role-buttons]");
    expect(menu).not.toBeNull();
    expect(menu.style.flexDirection).toBe("column");
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["✎постановщик", "⚙исполнитель", "✓проверяющий", "🔒Закрепить сотрудника", "👤Выбрать сотрудника"]);
    fireEvent.click(within(menu).getByRole("button", { name: "постановщик: Пользователи" }));
    expect(area).toHaveValue("Задача: лид\nКто: Пользователи ✎\nБерёт: заявки 2\nОтдаёт: заявки 50% A");
    await waitFor(() => expect(container.querySelector("[data-kind=roles]").textContent).toBe("✎"));
    // Фиксация — переменная из двух латинских слов в фигурных скобках; в поле видно только имя в плашке.
    fireEvent.click(within(menu).getByRole("button", { name: "закрепить сотрудника: Пользователи" }));
    const line = area.value.split("\n")[1];
    expect(line).toMatch(/^Кто: Пользователи ✎ \{[a-z]+ [a-z]+\}$/);
    const name = line.match(/\{([^}]+)\}/)[1];
    await waitFor(() => expect(container.querySelector("[data-kind=hand]")).not.toBeNull());
    const hand = container.querySelector("[data-kind=hand]");
    expect(hand.textContent).toBe(`{${name}}`);
    expect(hand.children[0].style.color).toBe("transparent");
    // Список сотрудников: «автоматически», переменные процесса, люди должности.
    fireEvent.click(within(menu).getByRole("button", { name: "выбрать сотрудника: Пользователи" }));
    const list = screen.getByRole("listbox", { name: "сотрудники: Пользователи" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["автоматически", name]);
    fireEvent.click(within(list).getByRole("option", { name: "автоматически" }));
    expect(area.value.split("\n")[1]).toBe("Кто: Пользователи ✎");
  });

  it("пропущенные значения помечены «?»: ресурс без количества, метка без значения (владелец, 2026-09-18)", () => {
    const area = addProc();
    write(area, "Задача: лид\nКто:\nБерёт: заявки\nОтдаёт: заявки 2");
    const marks = Array.from(container.querySelectorAll("[data-proc-backdrop] [data-missing]")).map((e) => e.dataset.missing);
    expect(marks).toEqual(["value", "qty"]);
    expect(container.querySelector("[data-proc-backdrop] [data-missing=qty]").closest("[data-kind=trait]").textContent).toBe("заявки?");
  });

  it("курсор на ресурсе открывает меню ресурса: поле операции, знак «=», просьба ввести число; в поле операция — значком (владелец, 2026-09-18)", async () => {
    const area = addProc();
    write(area, TEXT);
    view(area);
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("заявки 2") + 2 } });
    const menu = container.querySelector("[data-res-menu]");
    expect(menu).not.toBeNull();
    const op = screen.getByLabelText("операция: заявки");
    expect(op.value).toBe("2");
    const names = () => within(opList()).getAllByRole("option").map((o) => o.textContent);
    expect(names()).toContain("знак = — ровно");
    // Знак «=» — «ровно»: ставится из списка, без ручного ввода.
    pickOp(/^знак = — ровно$/);
    expect(area.value.split("\n")[2]).toBe("Берёт: заявки =2");
    // После знака — явная просьба: число или пункт из списка (буквы, @ресурс).
    fireEvent.focus(op);
    fireEvent.change(op, { target: { value: "=2 +" } });
    expect(area.value.split("\n")[2]).toBe("Берёт: заявки =2 +");
    expect(within(menu).getByText(/введите число или выберите из списка/)).toBeInTheDocument();
    expect(names().every((n) => /^буква|^знак [@(]/.test(n))).toBe(true);
    fireEvent.change(op, { target: { value: "50% A" } });
    fireEvent.blur(op);
    expect(area.value.split("\n")[2]).toBe("Берёт: заявки 50% A");
    // В поле операция другой строки — значком «ƒ» (текст прозрачный), на строке с курсором — целиком.
    await waitFor(() => expect(container.querySelector("[data-proc-backdrop] [data-op='50% A']")).not.toBeNull());
    const ops = Array.from(container.querySelectorAll("[data-proc-backdrop] [data-op]"));
    expect(ops).toHaveLength(1);
    expect(ops[0].closest("[data-kind=trait]").textContent).toBe("заявки 50% A");   // строка «Отдаёт:» без курсора
    expect(ops[0].children[0].style.color).toBe("transparent");
  });

  it("строка «Кому:» открывает то же меню без ролей: закрепить и выбрать сотрудника (владелец, 2026-09-18)", () => {
    const area = addProc();
    const T2 = `${TEXT}\nКому: Рынок услуг`;
    write(area, T2);
    view(area);
    fireEvent.click(area, { target: { selectionStart: T2.indexOf("Рынок услуг") + 2 } });
    const menu = container.querySelector("[data-role-buttons]");
    expect(menu).not.toBeNull();
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(["🔒Закрепить сотрудника", "👤Выбрать сотрудника"]);
    expect(container.querySelector("[data-proc-menu]").textContent).toContain("кому «Рынок услуг»");
    fireEvent.click(within(menu).getByRole("button", { name: "закрепить сотрудника: Рынок услуг" }));
    expect(area.value.split("\n")[4]).toMatch(/^Кому: Рынок услуг \{[a-z]+ [a-z]+\}$/);
    fireEvent.click(within(menu).getByRole("button", { name: "выбрать сотрудника: Рынок услуг" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "сотрудники: Рынок услуг" })).getByRole("option", { name: "автоматически" }));
    expect(area.value.split("\n")[4]).toBe("Кому: Рынок услуг");
  });

  it("«Закрепить ресурс» даёт переменную из одного слова; «Выбрать ресурс» ставит ссылку, и поле операции пропадает (владелец, 2026-09-18)", async () => {
    const area = addProc();
    write(area, TEXT);
    view(area);
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("заявки 50% A") + 2 } });
    const menu = () => container.querySelector("[data-res-menu]");
    expect(within(menu()).getAllByRole("button").map((b) => b.textContent).slice(0, 2)).toEqual(["📌Закрепить ресурс", "🔗Выбрать ресурс"]);
    fireEvent.click(within(menu()).getByRole("button", { name: "закрепить ресурс: заявки" }));
    const line = area.value.split("\n")[3];
    // Без слова «переменная» (владелец, 2026-09-18): имя в скобках.
    expect(line).toMatch(/^Отдаёт: заявки 50% A \([a-z]+\)$/);
    const name = line.match(/\(([a-z]+)\)/)[1];
    // Имя — плашкой цветом имени; скобки не видны (прозрачные).
    await waitFor(() => expect(container.querySelector(`[data-proc-backdrop] [data-var='${name}']`)).not.toBeNull());
    const plate = container.querySelector("[data-proc-backdrop] [data-kind=var]");
    expect(plate.textContent).toBe(`(${name})`);
    expect(plate.children[0].style.color).toBe("transparent");
    // Переименование — во всём тексте.
    fireEvent.click(within(menu()).getByRole("button", { name: `переименовать закреплённый ресурс ${name}` }));
    const inp = screen.getByLabelText("имя закреплённого ресурса");
    fireEvent.change(inp, { target: { value: "leads" } });
    fireEvent.blur(inp);
    expect(area.value.split("\n")[3]).toBe("Отдаёт: заявки 50% A (leads)");
    // В строке «Берёт:» — «Выбрать ресурс»: закреплённые ресурсы процесса; выбранный заменяет ресурс ссылкой.
    fireEvent.click(area, { target: { selectionStart: area.value.indexOf("заявки 2") + 1 } });
    fireEvent.click(within(menu()).getByRole("button", { name: "выбрать ресурс: заявки" }));
    const list = screen.getByRole("listbox", { name: "закреплённые ресурсы: заявки" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["leads"]);
    fireEvent.click(within(list).getByRole("option", { name: "leads" }));
    expect(area.value.split("\n")[2]).toBe("Берёт: (leads)");
    // Ссылка выбрана — операции нет: поля операции и списка «сколько» в меню нет.
    fireEvent.click(area, { target: { selectionStart: area.value.indexOf("(leads)") + 2 } });
    expect(menu()).not.toBeNull();
    expect(screen.queryByLabelText(/^операция: /)).toBeNull();
    expect(screen.queryByRole("listbox", { name: "операция: варианты" })).toBeNull();
    expect(within(menu()).getByRole("button", { name: "выбрать ресурс: (leads)" })).toHaveTextContent("leads");
    fireEvent.click(within(menu()).getByRole("button", { name: "снять выбор ресурса: leads" }));
    expect(area.value.split("\n")[2]).toBe("Берёт:");
  });

  it("«принято» собирает функцию с задачей в активе исполнителя; неизвестный ресурс принимается в актив «Кому»", () => {
    const area = addProc();
    write(area, `${TEXT}\nКому: Рынок услуг`);
    // «заявки» у «Рынка услуг» нет — принять нельзя, пока не принят ресурс.
    expect(screen.getByRole("button", { name: "Принято" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("неизвестный ресурс «заявки»"));
    fireEvent.click(screen.getByLabelText("принять ресурс «заявки»"));
    expect(screen.getByRole("button", { name: "Принято" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Принято" }));
    const m = dump();
    const f = m.funcs.find((x) => x.proc);
    expect(f).toMatchObject({ e: "usr", name: "лид", chain: { name: "процесс: лид", step: 1, of: 1 } });
    expect(f.steps.map((s) => s.kind)).toEqual(["take", "give"]);
    expect(f.takes[0]).toMatchObject({ lo: 2, hi: 2 });
    expect(f.gives[0]).toMatchObject({ lo: 1, hi: 1 });
    expect(m.traits.find((t) => t.e === "mkt" && t.l === "заявки")).toMatchObject({ hypo: true });
    // Принятие само сохранило версию.
    expect(screen.getByRole("button", { name: "прошлые версии" })).toHaveTextContent("(1)");
  });

  it("старый текст «Актив, Должность, берёт: …» переводится в новый язык при загрузке", async () => {
    addProc();
    const m = dump();
    m.procs = [{ id: "old1", name: "", text: "Пользователи, берёт: Рынок услуг, спрос 2, отдаёт: Пользователи, заявки", status: "off",
      steps: [], hypo: { entities: [], traits: [], roles: [] }, missing: { rejected: [] } }];
    loadJson(m);
    openProc();
    await waitFor(() => expect(screen.getByLabelText("текст процесса")).toHaveValue("Задача: Пользователи\nКто: Пользователи\nБерёт: спрос 2\nОт кого: Рынок услуг\nОтдаёт: заявки"));
  });
});

describe("версии, выгрузка и загрузка", () => {
  it("«Сохранить версию» с описанием; «Прошлые версии» на всю ширину; спойлер — изменения по задачам", () => {
    const area = addProc();
    write(area, TEXT);
    fireEvent.change(screen.getByLabelText("что изменилось"), { target: { value: "первая" } });
    fireEvent.click(screen.getByRole("button", { name: "сохранить версию" }));
    write(area, TEXT.replace("50% A", "40% A"));
    fireEvent.change(screen.getByLabelText("что изменилось"), { target: { value: "доля меньше" } });
    fireEvent.click(screen.getByRole("button", { name: "сохранить версию" }));
    const past = screen.getByRole("button", { name: "прошлые версии" });
    expect(past.style.width).toBe("100%");
    expect(past).toHaveTextContent("(2)");
    fireEvent.click(past);
    const rows = screen.getAllByRole("button", { name: /^версия / });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("доля меньше");   // новейшая — первой
    fireEvent.click(rows[0]);
    expect(within(screen.getByLabelText("добавлено или изменено")).getByText("лид")).toBeInTheDocument();
    expect(screen.getByLabelText("добавлено или изменено")).toHaveTextContent("40% A");
    expect(screen.getByLabelText("убрано или заменено")).toHaveTextContent("50% A");
  });

  it("выгрузка — роли словами; загрузка из окна — значками", () => {
    const area = addProc();
    write(area, "Задача: лид\nКто: Пользователи ✎ ⚙\nОтдаёт: заявки");
    fireEvent.click(screen.getByRole("button", { name: "выгрузить техпроцесс" }));
    expect(screen.getByLabelText("текст: выгрузка техпроцесса")).toHaveValue("Задача: лид\nКто: Пользователи (постановщик, исполнитель)\nОтдаёт: заявки");
    fireEvent.click(screen.getByRole("button", { name: "закрыть окно" }));
    fireEvent.click(screen.getByRole("button", { name: "загрузить техпроцесс" }));
    fireEvent.change(screen.getByLabelText("текст: загрузка техпроцесса"), { target: { value: "Задача: x\nКто: Пользователи (проверяющий)\nОтдаёт: заявки" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));
    expect(screen.getByLabelText("текст процесса")).toHaveValue("Задача: x\nКто: Пользователи ✓\nОтдаёт: заявки");
  });
});
