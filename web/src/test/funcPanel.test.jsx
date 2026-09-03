import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Функции актива: то, что преобразует его ресурсы.

   У функции ровно две формы — «берёт» и «выдаёт», — одно время выполнения
   и одни люди: исполнители и проверяющие. Передача в другой актив это не
   третья форма, а выход ресурсом чужого актива.

   Здесь проверяется не красота редактора, а то, из-за чего такие правки
   обычно и разваливаются: новый список должен пережить выгрузку и
   загрузку, отмену, удаление актива и удаление ресурса. Стоит забыть его
   в одном из шести мест, где перечислены части документа, — и функции
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
  fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
};

describe("функция заводится и живёт", () => {
  it("новая функция принадлежит выбранному активу и видна в выгрузке", () => {
    expect(dump().funcs || []).toHaveLength(0);
    addFunc();
    const m = dump();
    expect(m.funcs).toHaveLength(1);
    expect(m.funcs[0].e).toBeTruthy();
    expect(m.entities.some((e) => e.id === m.funcs[0].e)).toBe(true);
  });

  it("форм ровно две: «берёт» и «выдаёт», третьей — «передаёт другим» — нет", () => {
    addFunc();
    expect(screen.getByText("берёт")).toBeInTheDocument();
    expect(screen.getByText("выдаёт")).toBeInTheDocument();
    expect(screen.queryByText(/передаёт другим/)).toBeNull();
    expect(screen.queryByRole("button", { name: /стрелка от этого элемента/ })).toBeNull();
  });

  it("рецепт задаётся: что берёт, что выдаёт и за какое время", () => {
    addFunc();
    // Первый ресурс актива — во вход, второй в выход: важно, что рецепт
    // вообще сохраняется, а не какие именно ресурсы выбраны.
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ берёт/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ выдаёт/ })[1]);

    const f = dump().funcs[0];
    expect(f.takes).toHaveLength(1);
    expect(f.gives).toHaveLength(1);
    // Время — одно на функцию, а не по одному на каждый выход.
    expect(f.dur).toBeGreaterThan(0);
    expect(f.durUnit).toBeTruthy();
    expect(f.gives[0].dur).toBeUndefined();
  });

  it("сколько берёт и сколько выдаёт — диапазон, и он сохраняется", () => {
    addFunc();
    const add = screen.getAllByRole("button", { name: /^\+ берёт/ })[0];
    const name = add.textContent.replace(/^\+ берёт «|»$/g, "");
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText(`сколько минимум ${name}`), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(`сколько максимум ${name}`), { target: { value: "5" } });

    expect(screen.getByText("от 3 до 5")).toBeInTheDocument();
    expect(dump().funcs[0].takes[0]).toMatchObject({ lo: 3, hi: 5 });
  });

  it("исполнители и проверяющие — у функции целиком", () => {
    addFunc();
    expect(screen.getByText("исполнители")).toBeInTheDocument();
    expect(screen.getByText("проверяющие")).toBeInTheDocument();
    const f = dump().funcs[0];
    expect(f.owners).toEqual([]);
    expect(f.reviewers).toEqual([]);
  });

  it("название правится и переживает выгрузку", () => {
    addFunc();
    fireEvent.change(screen.getByLabelText("название функции"),
      { target: { value: "вёрстка страницы" } });
    expect(dump().funcs[0].name).toBe("вёрстка страницы");
  });
});

describe("передача ресурса в другой актив", () => {
  it("это выход ресурсом чужого актива, а не отдельная стрелка", () => {
    addFunc();
    const pick = screen.getByLabelText("передать ресурс в другой актив");
    const trait = pick.options[1].value;
    fireEvent.change(pick, { target: { value: trait } });

    const m = dump();
    expect(m.funcs[0].gives[0].trait).toBe(trait);
    // Ресурс и правда чужой: он принадлежит другому активу.
    expect(m.traits.find((t) => t.id === trait).e).not.toBe(m.funcs[0].e);
    expect(m.flows).toBeUndefined();
  });

  it("на схеме передача видна и подписана своим ресурсом", () => {
    addFunc();
    const pick = screen.getByLabelText("передать ресурс в другой актив");
    const label = pick.options[1].textContent.split(" · ").pop();
    fireEvent.change(pick, { target: { value: pick.options[1].value } });

    const texts = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts.some((t) => label.startsWith(t.replace("…", "")))).toBe(true);
  });

  it("в ресурсах стрелку по-прежнему не задать, и сказано, где она теперь", () => {
    const m = dump();
    const names = new Set(m.traits.map((t) => t.l));
    scheme();
    // Название ресурса в списке — растянутый на всю строку span.
    const span = [...container.querySelectorAll("span")]
      .find((x) => names.has(x.textContent) && x.style.flex === "1 1 0%");
    fireEvent.click(span.closest("div").parentElement);
    expect(screen.queryByRole("button", { name: /^от «/ })).toBeNull();
    expect(screen.getByText(/Новые стрелки заводятся у функции/)).toBeInTheDocument();
  });
});

describe("функция не переживает того, чего не должна", () => {
  it("удаление актива уносит его функции", () => {
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

describe("функция переживает то, что должна", () => {
  it("отмена возвращает удалённую функцию", () => {
    addFunc();
    expect(dump().funcs).toHaveLength(1);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "удалить" }));
    expect(dump().funcs).toHaveLength(0);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: /отменить/ }));
    expect(dump().funcs).toHaveLength(1);
  });

  it("загрузка JSON без поля funcs не выбрасывает функции — таких сценариев большинство", () => {
    addFunc();
    fireEvent.change(screen.getByLabelText("название функции"),
      { target: { value: "вёрстка" } });
    const m = dump();
    delete m.funcs;

    const area = openExport();
    fireEvent.change(area, { target: { value: JSON.stringify(m) } });
    fireEvent.blur(area);
    const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
    fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
    expect(screen.getByText("Загружено.")).toBeInTheDocument();

    // Функция на месте: в присланном документе её не было, а выбрасывать
    // то, о чём документ молчит, значило бы молча удалить работу.
    scheme();
    expect(screen.getByLabelText("название функции").value).toBe("вёрстка");
  });

  it("прежняя запись открывается без потерь: qty становится вилкой, срок и люди — общими", () => {
    // Модели с прежним устройством уже сохранены: выходом там считалась
    // отдельная функция со своим сроком и своими людьми.
    const m = dump();
    const [t1, t2] = m.traits.filter((t) => t.e === m.entities[0].id);
    m.funcs = [{
      id: "f1", e: m.entities[0].id, name: "старая",
      takes: [{ trait: t1.id, qty: 3 }],
      gives: [{ id: "g1", trait: t2.id, qty: 5, dur: 2, durUnit: "дн", owners: ["p1"], reviewers: [] }],
    }];
    m.flows = [];

    const area = openExport();
    fireEvent.change(area, { target: { value: JSON.stringify(m) } });
    fireEvent.blur(area);
    const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
    fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));

    scheme();
    const f = dump().funcs[0];
    expect(f.takes[0]).toMatchObject({ lo: 3, hi: 3 });
    expect(f.gives[0]).toMatchObject({ lo: 5, hi: 5 });
    expect(f).toMatchObject({ dur: 2, durUnit: "дн", owners: ["p1"] });
  });

  it("прежняя стрелка между элементами становится выходом, а не пропадает", () => {
    const m = dump();
    const [t1, t2] = m.traits.filter((t) => t.e === m.entities[0].id);
    m.funcs = [
      { id: "f1", e: m.entities[0].id, name: "источник", takes: [{ trait: t1.id, qty: 1 }], gives: [] },
      { id: "f2", e: m.entities[0].id, name: "приёмник", takes: [], gives: [] },
    ];
    m.flows = [{ id: "w1", from: "f1", to: "f2", trait: t2.id, lo: 3, hi: 5 }];

    const area = openExport();
    fireEvent.change(area, { target: { value: JSON.stringify(m) } });
    fireEvent.blur(area);
    const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
    fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));

    scheme();
    const out = dump();
    expect(out.funcs[0].gives[0]).toMatchObject({ trait: t2.id, lo: 3, hi: 5 });
    // Списка стрелок больше нет: два места про одно и то же разошлись бы.
    expect(out.flows).toBeUndefined();
  });

  it("сохранённый и загруженный сценарий приносит функции обратно", async () => {
    // Тот самый случай, ради которого новый список проводили через все
    // шесть мест: забудь его в загрузке сценария — и функции исчезают на
    // первом же «Загрузить», молча и без следа.
    addFunc();
    fireEvent.change(screen.getByLabelText("название функции"),
      { target: { value: "вёрстка" } });

    openExport();
    const nameBox = container.querySelector('input[placeholder="имя сценария"]');
    fireEvent.change(nameBox, { target: { value: "с функцией" } });
    fireEvent.blur(nameBox);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(container.textContent).toMatch(/Сохранено/));

    // Стираем функцию и грузим сценарий обратно.
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "удалить" }));
    expect(screen.queryByLabelText("название функции")).toBeNull();

    openExport();
    const load = [...container.querySelectorAll("button")]
      .filter((b) => b.textContent === "Загрузить").pop();
    fireEvent.click(load);
    await waitFor(() => expect(container.textContent).toMatch(/Загружено:/));

    scheme();
    expect(screen.getByLabelText("название функции").value).toBe("вёрстка");
  });
});
