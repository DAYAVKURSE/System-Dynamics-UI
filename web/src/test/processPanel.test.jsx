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
const type = (el, v, at = v.length) => {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: v, selectionStart: at } });
};
const write = (el, v) => { type(el, v); fireEvent.blur(el); };
const popup = () => screen.getByRole("dialog", { name: "подсказка процесса" });
const options = () => within(popup()).getAllByRole("option").map((o) => o.textContent);
const pick = (re) => fireEvent.mouseDown(within(popup()).getByRole("option", { name: re }));
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

describe("подсказки ведут по строкам", () => {
  it("метка → «Кто:» → актив (новая строка) → «Берёт:» → ресурс → сколько → новая строка → «Кому:»", async () => {
    const area = addProc();
    type(area, "");
    expect(popup().style.bottom).toBe("100%");   // окно над полем
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
  it("курсор в строке «Кто:» показывает кнопки ролей; нажатие ставит значок в текст", async () => {
    const area = addProc();
    write(area, TEXT);
    fireEvent.focus(area);
    fireEvent.click(area, { target: { selectionStart: TEXT.indexOf("Пользователи") + 3 } });
    const btns = container.querySelector("[data-role-buttons]");
    expect(btns).not.toBeNull();
    expect(within(btns).getAllByRole("button")).toHaveLength(3);
    fireEvent.click(within(btns).getByRole("button", { name: "постановщик: Пользователи" }));
    expect(area).toHaveValue("Задача: лид\nКто: Пользователи ✎\nБерёт: заявки 2\nОтдаёт: заявки 50% A");
    await waitFor(() => expect(container.querySelector("[data-kind=roles]").textContent).toBe("✎"));
    expect(screen.getByLabelText("постановщик: Пользователи", { selector: "span" })).toBeInTheDocument();
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
    expect(f).toMatchObject({ e: "usr", name: "процесс: лид" });
    expect(f.tasks).toHaveLength(1);
    expect(f.tasks[0].branches[0].steps.map((s) => s.kind)).toEqual(["take", "give"]);
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
