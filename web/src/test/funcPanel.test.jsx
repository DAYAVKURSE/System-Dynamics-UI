import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Функциональные элементы: то, что преобразует ресурсы актива.

   Здесь проверяется не красота редактора, а то, из-за чего такие правки
   обычно и разваливаются: новый список должен пережить выгрузку и
   загрузку, отмену, удаление актива и удаление ресурса. Стоит забыть его
   в одном из шести мест, где перечислены части документа, — и элементы
   молча исчезнут при первом же сохранении. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
/* Кнопка «Выгрузка» переключает раздел: нажать её, когда он уже открыт,
   значит закрыть его — и поле пропадёт. Поэтому открываем по факту. */
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
const addFunc = () => {
  scheme();
  fireEvent.click(screen.getByRole("button", { name: "+ элемент" }));
};

describe("элемент заводится и живёт", () => {
  it("новый элемент принадлежит выбранному активу и виден в выгрузке", () => {
    expect(dump().funcs || []).toHaveLength(0);
    addFunc();
    const m = dump();
    expect(m.funcs).toHaveLength(1);
    expect(m.funcs[0].e).toBeTruthy();
    expect(m.entities.some((e) => e.id === m.funcs[0].e)).toBe(true);
  });

  it("рецепт задаётся: что берёт, что выдаёт и за какое время", () => {
    addFunc();
    // Первый ресурс актива — во вход, он же в выход: важно, что рецепт
    // вообще сохраняется, а не какие именно ресурсы выбраны.
    const takes = screen.getAllByRole("button", { name: /^\+ берёт/ });
    fireEvent.click(takes[0]);
    const gives = screen.getAllByRole("button", { name: /^\+ выдаёт/ });
    fireEvent.click(gives[0]);

    const m = dump();
    const f = m.funcs[0];
    expect(f.takes).toHaveLength(1);
    expect(f.gives).toHaveLength(1);
    expect(f.gives[0].dur).toBeGreaterThan(0);
    expect(f.gives[0].durUnit).toBeTruthy();
    // Функция — это выход, и у неё свои исполнители и проверяющие.
    expect(f.gives[0].owners).toEqual([]);
    expect(f.gives[0].reviewers).toEqual([]);
  });

  it("название правится и переживает выгрузку", () => {
    addFunc();
    fireEvent.change(screen.getByLabelText("название элемента"),
      { target: { value: "вёрстка страницы" } });
    expect(dump().funcs[0].name).toBe("вёрстка страницы");
  });
});

describe("элемент не переживает того, чего не должен", () => {
  it("удаление актива уносит его элементы", () => {
    addFunc();
    expect(dump().funcs).toHaveLength(1);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Удалить актив" }));
    expect(dump().funcs).toHaveLength(0);
  });

  it("удалённый ресурс исчезает из входов и выходов, а не остаётся ссылкой в никуда", () => {
    addFunc();
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ берёт/ })[0]);
    expect(dump().funcs[0].takes).toHaveLength(1);

    scheme();
    const used = dump().funcs[0].takes[0].trait;
    const label = dump().traits.find((t) => t.id === used).l;
    // Выбираем тот самый ресурс в списке актива и удаляем его.
    const row = [...container.querySelectorAll("span")].find((s) => s.textContent === label);
    fireEvent.click(row.closest("div").parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Удалить ресурс" }));

    expect(dump().funcs[0].takes).toHaveLength(0);
  });
});

describe("элемент переживает то, что должен", () => {
  it("отмена возвращает удалённый элемент", () => {
    addFunc();
    expect(dump().funcs).toHaveLength(1);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "удалить" }));
    expect(dump().funcs).toHaveLength(0);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: /отменить/ }));
    expect(dump().funcs).toHaveLength(1);
  });

  it("загрузка JSON без поля funcs не выбрасывает элементы — таких сценариев большинство", () => {
    addFunc();
    fireEvent.change(screen.getByLabelText("название элемента"),
      { target: { value: "вёрстка" } });
    const m = dump();
    delete m.funcs;

    const area = openExport();
    fireEvent.change(area, { target: { value: JSON.stringify(m) } });
    const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
    fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
    expect(screen.getByText("Загружено.")).toBeInTheDocument();

    // Элемент на месте: в присланном документе его не было, а выбрасывать
    // то, о чём документ молчит, значило бы молча удалить работу.
    scheme();
    expect(screen.getByLabelText("название элемента").value).toBe("вёрстка");
  });

  it("сохранённый и загруженный сценарий приносит элементы обратно", async () => {
    // Тот самый случай, ради которого новый список проводили через все
    // шесть мест: забудь его в загрузке сценария — и элементы исчезают на
    // первом же «Загрузить», молча и без следа.
    addFunc();
    fireEvent.change(screen.getByLabelText("название элемента"),
      { target: { value: "вёрстка" } });

    openExport();
    const nameBox = container.querySelector('input[placeholder="имя сценария"]');
    fireEvent.change(nameBox, { target: { value: "с элементом" } });
    fireEvent.blur(nameBox);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(container.textContent).toMatch(/Сохранено/));

    // Стираем элемент и грузим сценарий обратно.
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "удалить" }));
    expect(screen.queryByLabelText("название элемента")).toBeNull();

    openExport();
    const load = [...container.querySelectorAll("button")]
      .filter((b) => b.textContent === "Загрузить").pop();
    fireEvent.click(load);
    await waitFor(() => expect(container.textContent).toMatch(/Загружено:/));

    scheme();
    expect(screen.getByLabelText("название элемента").value).toBe("вёрстка");
  });
});
