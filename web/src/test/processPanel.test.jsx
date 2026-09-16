import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { activeFuncs } from "../lib/funcs.js";
import { forecast } from "../lib/plan.js";

/* РАЗДЕЛ «ТЕХНОЛОГИЧЕСКИЕ ПРОЦЕССЫ» НА «УПРАВЛЕНИИ».

   Владелец: «я буквально должен вводить текст, а он должен выдавать
   подсказки»; «как она была полем ввода, так должна и остаться; подсказки
   — только всплывающим окном; имя сущности человек должен иметь
   возможность ввести сам или выбрать из списка». Порядок слов в строке —
   его: актив, должность, берёт: откуда, что; отдаёт: куда, что. Здесь
   проверяется ровно это — и то, что из этого следует: принятое
   гипотетически считается только с галочкой, «не принято» уносит
   гипотезы, удалённое на схеме не даёт принять, пока не поставлена
   замена, найденное открывается карточкой. */

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
  return screen.getByLabelText("текст процесса");
};
const type = (el, v) => {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: v, selectionStart: v.length } });
};
// Поле отдаёт текст по расфокусу: без blur разбор смотрел бы на прежнее.
const write = (el, v) => { type(el, v); fireEvent.blur(el); };
const popup = () => screen.getByRole("dialog", { name: "подсказка процесса" });
const options = () => within(popup()).getAllByRole("option").map((o) => o.textContent);
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
const LINE = "Пользователи, берёт: Рынок услуг, спрос, отдаёт: Пользователи, заявки";
const tap = (name) => {
  const g = container.querySelector(`[data-entity="${name}"]`);
  fireEvent.pointerDown(g, { clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: 51, clientY: 50, pointerId: 1 });
};
/* Заводит процесс со складом, которого на схеме нет, и принимает обе
   гипотезы — актив и его ресурс. */
const acceptWarehouse = () => {
  const area = addProc();
  write(area, "Пользователи, берёт: Рынок услуг, спрос, отдаёт: Склад, коробки 2");
  fireEvent.click(screen.getByRole("button", { name: "неизвестный актив «Склад»" }));
  fireEvent.click(screen.getByRole("button", { name: "принять актив «Склад»" }));
  fireEvent.click(screen.getByRole("button", { name: "неизвестный ресурс «коробки»" }));
  fireEvent.click(screen.getByRole("button", { name: "принять ресурс «коробки»" }));
};

describe("текст с всплывающими подсказками", () => {
  it("окно у поля говорит, что ожидается, и предлагает имена по месту: актив, должность или метка, откуда, что", async () => {
    const area = addProc();
    type(area, "");
    expect(popup()).toHaveTextContent("ожидается: актив");
    expect(options()).toEqual(["актив Рынок услуг", "актив Пользователи", "актив Виртуальный менеджер"]);
    type(area, "Поль");
    expect(options()).toEqual(["актив Пользователи"]);
    type(area, "Пользователи, ");
    expect(popup()).toHaveTextContent("должность");
    expect(options()).toEqual(["метка берёт:", "метка отдаёт:"]);
    type(area, "Пользователи, берёт: Рынок услуг, ");
    expect(popup()).toHaveTextContent("ожидается: что (ресурс) из «Рынок услуг» · после имени через пробел — сколько");
    expect(options()).toEqual(["ресурс спрос"]);
    // Выбор подставляет имя и ПРОБЕЛ — и окно сразу ждёт «сколько».
    fireEvent.mouseDown(within(popup()).getByRole("option"));
    expect(area).toHaveValue("Пользователи, берёт: Рынок услуг, спрос ");
    // Окно переставляется после возврата фокуса в поле (следующий тик).
    await waitFor(() => expect(popup()).toHaveTextContent("ожидается: сколько"));
    expect(options()).toContain("дальше → — запятая — к следующему ресурсу");
    // Число набрано — «дальше →» ставит запятую к следующему ресурсу.
    type(area, "Пользователи, берёт: Рынок услуг, спрос 2");
    fireEvent.mouseDown(within(popup()).getByRole("option", { name: /дальше/ }));
    expect(area).toHaveValue("Пользователи, берёт: Рынок услуг, спрос 2, ");
    await waitFor(() => expect(popup()).toHaveTextContent("откуда берёт"));
    // Без числа «дальше →» тоже работает: пробел перед запятой убирается.
    type(area, "Пользователи, берёт: Рынок услуг, спрос ");
    fireEvent.mouseDown(within(popup()).getByRole("option", { name: /дальше/ }));
    expect(area).toHaveValue("Пользователи, берёт: Рынок услуг, спрос, ");
  });

  it("своё имя вводится как есть: подсказка молчит, разбор показывает его пунктиром", () => {
    const area = addProc();
    type(area, "Скл");
    expect(popup()).toHaveTextContent("«Скл» — новое имя");
    fireEvent.blur(area);
    write(area, "Склад, берёт: Пользователи, заявки");
    expect(screen.getByRole("button", { name: "неизвестный актив «Склад»" })).toBeInTheDocument();
    expect(screen.getByText(/сначала примите или отклоните: Склад/)).toBeInTheDocument();
  });

  it("ошибка строки — словами под полем", () => {
    const area = addProc();
    write(area, "Пользователи, менеджер, спрос");
    expect(screen.getAllByText(/ждут «берёт:» или «отдаёт:»/).length).toBeGreaterThan(0);
    expect(status("Принято")).toBeDisabled();
  });
});

describe("неизвестные имена", () => {
  it("найденное — чип, ненайденное — пунктир; «Принять» заводит актив и ресурс в нём с пометкой «гипотеза»", () => {
    acceptWarehouse();
    const m = dump();
    const wh = m.entities.find((e) => e.name === "Склад");
    expect(wh.hypo).toBe(true);
    const box = m.traits.find((t) => t.l === "коробки");
    expect(box).toMatchObject({ e: wh.id, hypo: true, accepted: false });
    expect(m.procs[0].hypo).toMatchObject({ entities: [wh.id], traits: [box.id] });
    openProc();
    expect(screen.getAllByText("· гипотеза").length).toBe(2);
    expect(screen.queryByText(/сначала примите/)).toBeNull();
    expect(status("Принято")).not.toBeDisabled();
  });

  it("ресурс нельзя принять раньше актива; «Отклонить» красит имя и не даёт принять процесс, «Вернуть» снимает", () => {
    const area = addProc();
    write(area, "Пользователи, берёт: Рынок услуг, спрос, отдаёт: Склад, коробки");
    fireEvent.click(screen.getByRole("button", { name: "неизвестный ресурс «коробки»" }));
    expect(screen.getByRole("button", { name: "принять ресурс «коробки»" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "неизвестный актив «Склад»" }));
    fireEvent.click(screen.getByRole("button", { name: "отклонить актив «Склад»" }));
    expect(screen.getByRole("button", { name: "отклонённый актив «Склад»" })).toBeInTheDocument();
    expect(screen.getByText(/отклонено — исправьте или удалите строку: Склад/)).toBeInTheDocument();
    expect(status("Принято гипотетически")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "отклонённый актив «Склад»" }));
    fireEvent.click(screen.getByRole("button", { name: "вернуть актив «Склад»" }));
    expect(screen.getByRole("button", { name: "неизвестный актив «Склад»" })).toBeInTheDocument();
  });
});

describe("три состояния процесса", () => {
  it("«принято гипотетически» собирает функцию в активе строки; «не принято» убирает её и гипотезы", () => {
    acceptWarehouse();
    fireEvent.click(status("Принято гипотетически"));
    let m = dump();
    const f = m.funcs.find((x) => x.proc);
    expect(f).toMatchObject({ e: "usr", accepted: true });
    expect(f.takes.map((p) => [p.trait, p.lo, p.hi])).toEqual([["dem", 1, 1]]);
    const box = m.traits.find((t) => t.l === "коробки");
    expect(f.gives.map((p) => [p.trait, p.lo, p.hi])).toEqual([[box.id, 2, 2]]);
    openProc();
    fireEvent.click(status("Не принято"));
    m = dump();
    expect(m.funcs.some((x) => x.proc)).toBe(false);
    expect(m.entities.some((e) => e.name === "Склад")).toBe(false);
    expect(m.traits.some((t) => t.l === "коробки")).toBe(false);
  });

  it("правка текста принятого процесса пересобирает функцию", () => {
    const area = addProc();
    write(area, LINE);
    fireEvent.click(status("Принято"));
    write(screen.getByLabelText("текст процесса"), LINE.replace("спрос,", "спрос 3,"));
    const f = dump().funcs.find((x) => x.proc);
    expect(f.takes[0]).toMatchObject({ trait: "dem", lo: 3, hi: 3 });
  });

  it("гипотеза считается только с галочкой «включить гипотезы»", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
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
  });
});

describe("удалённое на схеме", () => {
  it("строка просит замену, и без неё принять нельзя; замена — правка текста", () => {
    const area = addProc();
    write(area, LINE);
    const m = dump();
    // «спрос» удалён; у «Рынка услуг» остаётся другой ресурс — он и предлагается заменой.
    loadJson({ ...m, traits: [...m.traits.filter((t) => t.id !== "dem"),
      { id: "req2", e: "mkt", k: "res", l: "заявки", unit: "шт." }] });
    openProc();
    expect(screen.getByText(/спрос — удалён — выберите замену/)).toBeInTheDocument();
    expect(status("Принято")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("замена для «спрос»"), { target: { value: "req2" } });
    expect(screen.getByLabelText("текст процесса"))
      .toHaveValue("Пользователи, берёт: Рынок услуг, заявки, отдаёт: Пользователи, заявки");
    expect(status("Принято")).not.toBeDisabled();
  });
});

describe("процессы живут на «Управлении»", () => {
  it("своей вкладки нет; форма — первой, под спойлером; название — по нажатию справа от «процесс»", () => {
    scheme();
    expect(screen.queryByRole("button", { name: "Технологический процесс" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "технологические процессы" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "+ процесс" })).toBeNull();
    const card = screen.getByLabelText("название актива");
    // eslint-disable-next-line no-bitwise
    expect(toggle.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    addProc();
    fireEvent.click(screen.getByRole("button", { name: /назвать процесс/ }));
    const name = screen.getByLabelText("название процесса");
    fireEvent.change(name, { target: { value: "Продажи" } });
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.blur(name);
    expect(screen.getByRole("button", { name: "назвать процесс «Продажи»" })).toBeInTheDocument();
    expect(dump().procs[0].name).toBe("Продажи");
  });

  it("выбранный на схеме актив подсвечивает процессы, где он занят", () => {
    write(addProc(), LINE);   // Пользователи берут у Рынка услуг
    tap("vm");
    expect(screen.queryByText(/задействует выбранный актив/)).toBeNull();
    tap("mkt");
    expect(screen.getByText("задействует выбранный актив «Рынок услуг»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "технологические процессы" }).textContent)
      .toMatch(/с активом «Рынок услуг»: 1/);
  });

  it("нажатие на найденное в строке открывает его карточку под формой", () => {
    write(addProc(), LINE);
    fireEvent.click(screen.getByLabelText("ресурс «спрос»: открыть"));
    expect(screen.getByDisplayValue("Рынок услуг")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("спрос").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByLabelText("актив «Пользователи»: открыть")[0]);
    expect(screen.getByDisplayValue("Пользователи")).toBeInTheDocument();
  });

  it("нажатие на актив на схеме с «Прогноза» возвращает на «Управление»", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Прогноз" }));
    expect(screen.queryByLabelText("название актива")).toBeNull();
    tap("mkt");
    expect(screen.getByDisplayValue("Рынок услуг")).toBeInTheDocument();
  });
});

describe("красные метки в поле", () => {
  it("ненайденное имя подсвечено красным прямо под текстом; пропущенное — меткой у края строки", () => {
    const area = addProc();
    write(area, "Пользователи, берёт: Рынок услуг, спрос, отдаёт: Склад, коробки\nСклад, берёт: Пользователи");
    const back = document.querySelector("[data-proc-backdrop]");
    const marks = Array.from(back.querySelectorAll("[data-mark=unknown]")).map((m) => m.textContent);
    expect(marks).toEqual(["Склад", "коробки", "Склад"]);
    expect(back.querySelector("[data-mark=error]").textContent).toMatch(/не назван ресурс/);
    // Поле лежит над подложкой с прозрачным фоном: подсветка видна сквозь него.
    expect(area.style.background).toBe("transparent");
  });
});

describe("операции — прямо в поле, с подсказками (владелец, 2026-09-15)", () => {
  it("после имени ресурса подсказка ждёт «сколько»: буквы ресурсов строки и знаки; Tab подставляет букву; отдельной формы нет", () => {
    const area = addProc();
    const head = "Пользователи, берёт: Рынок услуг, спрос 1000, отдаёт: Пользователи, заявки 50% ";
    type(area, head);
    expect(popup()).toHaveTextContent("ожидается: сколько");
    expect(popup()).toHaveTextContent("для «заявки»");
    expect(options()[0]).toBe("буква A — спрос (Рынок услуг)");
    expect(options()).toContain("знак % — процент");
    fireEvent.keyDown(area, { key: "Tab" });
    expect(area).toHaveValue(`${head}A`);
    fireEvent.blur(area);
    // Разбор под полем: буквы у ресурсов, количество посчитано по «A».
    expect(screen.getByLabelText("буква A: спрос")).toBeInTheDocument();
    expect(screen.getByLabelText("буква B: заявки")).toBeInTheDocument();
    expect(screen.getByLabelText("ресурс «заявки»: открыть")).toHaveTextContent("заявки 500");
    expect(screen.queryByLabelText(/^операции с ресурсами/)).toBeNull();
  });

  it("новые имена: после «оплата » окно ждёт «сколько» и предлагает знаки; после второго ресурса — букву «A»", () => {
    const area = addProc();
    type(area, "Партнёр, берёт: Заказчик, оплата ");
    expect(popup()).toHaveTextContent("ожидается: сколько");
    expect(popup()).toHaveTextContent("для «оплата»");
    expect(options()).toContain("знак % — процент");
    const head = "Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата 50% ";
    type(area, head);
    expect(options()[0]).toBe("буква A — оплата (Заказчик)");
    fireEvent.keyDown(area, { key: "Tab" });
    expect(area).toHaveValue(`${head}A`);
  });

  it("диапазон «45-55% A» показывается как от–до и уходит в функцию вилкой", () => {
    const area = addProc();
    write(area, "Пользователи, берёт: Рынок услуг, спрос 1000, отдаёт: Пользователи, заявки 45-55% A");
    expect(screen.getByLabelText("ресурс «заявки»: открыть")).toHaveTextContent("заявки 450–550");
    fireEvent.click(screen.getByRole("button", { name: "Принято" }));
    const f = dump().funcs.find((x) => x.proc);
    expect(f.gives[0]).toMatchObject({ lo: 450, hi: 550 });
    expect(f.gives[0].expr).toMatch(/^45-55% #\{/);
  });
});

describe("строки по смыслу и раскраска поля (владелец, 2026-09-16)", () => {
  it("метка из подсказки встаёт с новой строки; поле рисует плашки по виду и круглые скобки сторон", async () => {
    const area = addProc();
    type(area, "Пользователи, ");
    fireEvent.mouseDown(within(popup()).getByRole("option", { name: /^метка берёт:/ }));
    expect(area).toHaveValue("Пользователи\nберёт: ");
    await waitFor(() => expect(popup()).toHaveTextContent("откуда берёт"));
    // Подстановка актива после метки не съедает пробел за ней.
    fireEvent.mouseDown(within(popup()).getByRole("option", { name: /^актив Рынок услуг/ }));
    expect(area).toHaveValue("Пользователи\nберёт: Рынок услуг, ");
    write(area, "Пользователи, менеджер\nберёт: Рынок услуг, спрос 1000\nотдаёт: Пользователи, заявки 45-55% A\nСклад, берёт: Пользователи, заявки 2");
    const back = container.querySelector("[data-proc-backdrop]");
    const kinds = Array.from(back.querySelectorAll("[data-kind]")).map((e) => `${e.dataset.kind}:${e.textContent}`);
    expect(kinds).toEqual(["asset:Пользователи", "role:менеджер", "mark:берёт:", "asset:Рынок услуг", "trait:спрос 1000",
      "mark:отдаёт:", "asset:Пользователи", "trait:заявки 45-55% A", "asset:Склад", "mark:берёт:", "asset:Пользователи", "trait:заявки 2"]);
    expect(Array.from(back.querySelectorAll("[data-bracket]")).map((e) => `${e.dataset.bracket}:${e.textContent}`))
      .toEqual(["take:Рынок услуг, спрос 1000", "give:Пользователи, заявки 45-55% A", "take:Пользователи, заявки 2"]);
    // Не найденное — красной плашкой; текст поля прозрачный, курсор — нет.
    expect(Array.from(back.querySelectorAll("[data-mark=unknown]")).map((e) => e.textContent)).toContain("Склад");
    expect(area.style.color).toBe("transparent");
    expect(area.style.caretColor).not.toBe("transparent");
    // Один шаг из трёх строк — одна функция.
    fireEvent.click(screen.getByRole("button", { name: "неизвестный актив «Склад»" }));
    expect(screen.getAllByText(/^1\./).length).toBeGreaterThan(0);
  });
});
