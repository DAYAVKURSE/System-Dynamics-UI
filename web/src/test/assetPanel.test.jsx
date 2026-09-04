import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Карточка актива: воркеры, функции, ресурсы — три равноправные части,
   устроенные одинаково.

   Здесь проверяется не красота редактора, а то, из-за чего такие правки
   обычно и разваливаются: новые списки должны пережить выгрузку и загрузку,
   отмену, удаление актива и удаление ресурса. Стоит забыть один из них в
   одном из мест, где перечислены части документа, — и работа молча исчезнет
   при первом же сохранении. */

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
/* Три части актива живут во вкладках: чтобы дотянуться до ресурсов или
   воркеров, надо сначала переключиться на них. */
const assetTab = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^${name}`) }));
const addFunc = () => {
  scheme();
  assetTab("Функции");
  fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
};
const loadJson = (m) => {
  const area = openExport();
  fireEvent.change(area, { target: { value: JSON.stringify(m) } });
  // Поле отдаёт значение по расфокусу: без blur «Загрузить» взял бы прежний
  // текст, и проверка ничего бы не проверяла.
  fireEvent.blur(area);
  const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
  fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
};

describe("актив состоит из трёх частей", () => {
  it("воркеры, функции и ресурсы — три вкладки одного вида", () => {
    scheme();
    ["Воркеры", "Функции", "Ресурсы"].forEach((name) => {
      expect(screen.getByRole("button", { name: new RegExp(`^${name} \\d`) }))
        .toBeInTheDocument();
    });
    // Открыта одна за раз: части равноправны, и ни одна не «та, до которой
    // надо долистать».
    assetTab("Воркеры");
    expect(screen.getByText("воркеры актива")).toBeInTheDocument();
    expect(screen.queryByText("ресурсы актива")).toBeNull();
    assetTab("Ресурсы");
    expect(screen.getByText("ресурсы актива")).toBeInTheDocument();
    expect(screen.queryByText("функции актива")).toBeNull();
  });

  it("на вкладке видно, сколько в ней всего", () => {
    scheme();
    expect(screen.getByRole("button", { name: /^Ресурсы 2$/ })).toBeInTheDocument();
  });

  it("у функции ровно две формы: «берёт» и «выдаёт»", () => {
    addFunc();
    expect(screen.getByText("берёт")).toBeInTheDocument();
    expect(screen.getByText("выдаёт")).toBeInTheDocument();
    expect(screen.queryByText(/передаёт другим/)).toBeNull();
    expect(screen.queryByRole("button", { name: /стрелка от этого элемента/ })).toBeNull();
  });
});

describe("функция заводится и живёт", () => {
  it("новая функция принадлежит выбранному активу и видна в выгрузке", () => {
    const before = dump().funcs.length;
    addFunc();
    const m = dump();
    expect(m.funcs).toHaveLength(before + 1);
    expect(m.entities.some((e) => e.id === m.funcs[before].e)).toBe(true);
  });

  it("рецепт задаётся: что берёт, что выдаёт и за какое время", () => {
    addFunc();
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ берёт/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ выдаёт/ })[1]);

    const f = dump().funcs.pop();
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

    expect(screen.getAllByText("от 3 до 5").length).toBeGreaterThan(0);
    expect(dump().funcs.pop().takes[0]).toMatchObject({ lo: 3, hi: 5 });
  });

  it("название правится и переживает выгрузку", () => {
    addFunc();
    const box = screen.getAllByLabelText("название функции").pop();
    fireEvent.change(box, { target: { value: "вёрстка страницы" } });
    fireEvent.blur(box);
    expect(dump().funcs.pop().name).toBe("вёрстка страницы");
  });
});

describe("передача в другой актив", () => {
  it("это получатель у выхода, а не отдельная стрелка", () => {
    addFunc();
    const add = screen.getAllByRole("button", { name: /^\+ выдаёт/ })[0];
    const name = add.textContent.replace(/^\+ выдаёт «|»$/g, "");
    fireEvent.click(add);

    const to = screen.getByLabelText(`кому передаётся ${name}`);
    fireEvent.change(to, { target: { value: to.options[1].value } });

    const m = dump();
    const f = m.funcs.pop();
    expect(f.gives[0].to).toBe(to.options[1].value);
    // Получатель — другой актив, а не тот, которому функция принадлежит.
    expect(f.gives[0].to).not.toBe(f.e);
    expect(m.flows).toBeUndefined();
  });

  it("на схеме передача видна и подписана своим ресурсом", () => {
    scheme();
    // Стартовая модель уже передаёт заявки в «Виртуальный менеджер».
    const texts = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts.some((t) => t.startsWith("заявки:"))).toBe(true);
  });
});

describe("воркеры принадлежат активу", () => {
  it("без людей раздел честно говорит, что их ещё нет", () => {
    scheme();
    assetTab("Воркеры");
    expect(screen.getByText(/Людей ещё нет/)).toBeInTheDocument();
  });

  it("в функции люди берутся из воркеров актива — все три роли", () => {
    addFunc();
    ["постановщики", "исполнители", "проверяющие"].forEach((many) => {
      expect(screen.getByText(new RegExp(`в активе ещё нет ${many}`))).toBeInTheDocument();
    });
  });
});

describe("ресурс — такая же карточка", () => {
  it("правится значением, единицей и целью", () => {
    scheme();
    assetTab("Ресурсы");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[0]);
    const want = screen.getByPlaceholderText("без цели");
    fireEvent.change(want, { target: { value: "42" } });
    fireEvent.blur(want);
    expect(dump().traits.some((t) => Number(t.want) === 42)).toBe(true);
  });

  it("удалённый ресурс исчезает из входов и выходов функций", () => {
    scheme();
    const before = dump().funcs.filter((f) => f.takes.length || f.gives.length).length;
    expect(before).toBeGreaterThan(0);

    scheme();
    assetTab("Ресурсы");
    // «заявки» — ресурс «Пользователей», его берёт функция другого актива.
    const card = screen.getByDisplayValue("заявки").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));

    const m = dump();
    expect(m.traits.some((t) => t.l === "заявки")).toBe(false);
    expect(m.funcs.some((f) => [...f.takes, ...f.gives]
      .some((p) => p.trait === "req"))).toBe(false);
  });
});

describe("модель не переживает того, чего не должна", () => {
  it("удаление актива уносит его функции и его задачи", () => {
    scheme();
    const was = dump().funcs.length;
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Удалить актив" }));
    expect(dump().funcs.length).toBeLessThan(was);
  });
});

describe("модель переживает то, что должна", () => {
  it("отмена возвращает удалённую функцию", () => {
    scheme();
    const was = dump().funcs.length;
    scheme();
    assetTab("Функции");
    const card = screen.getByDisplayValue("Сбор заявок").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));
    expect(dump().funcs.length).toBe(was - 1);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: /↶ отменить/ }));
    expect(dump().funcs.length).toBe(was);
  });

  it("загрузка JSON без поля funcs не выбрасывает функции", () => {
    const m = dump();
    const was = m.funcs.length;
    delete m.funcs;
    loadJson(m);
    expect(screen.getByText("Загружено.")).toBeInTheDocument();
    expect(dump().funcs).toHaveLength(was);
  });

  it("прежняя запись открывается, но её числа не переносятся", () => {
    // Модели, собранные под прежний расчёт, работать не должны: перенос дал
    // бы модель, которую никто не собирал. Но и падать приложение не должно —
    // пустые поля и красная подпись честнее белого экрана.
    const m = dump();
    m.entities = [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }];
    m.traits = [{ id: "t1", e: "a", k: "res", l: "сырьё", unit: "шт.", have: 0 },
      { id: "t2", e: "a", k: "res", l: "изделие", unit: "шт.", have: 0 }];
    m.funcs = [{
      id: "f1", e: "a", name: "старая",
      takes: [{ trait: "t1", qty: 3 }],
      gives: [{ id: "g1", trait: "t2", qty: 5, dur: 2, durUnit: "дн", owners: ["p1"] }],
    }];
    m.flows = [{ id: "w1", from: "f1", to: "f2", trait: "t2", lo: 3, hi: 5 }];
    m.tasks = [];
    loadJson(m);

    scheme();
    const out = dump();
    const f = out.funcs[0];
    expect(f.takes[0]).toMatchObject({ lo: 0, hi: 0 });
    expect(f.dur).toBe(0);
    expect(f.owners).toEqual([]);
    expect(out.entities[0].owners).toEqual([]);
    // И прежние стрелки между элементами никуда не вливаются.
    expect(f.gives).toHaveLength(1);
    expect(out.flows).toBeUndefined();
  });

  it("сохранённый и загруженный сценарий приносит функции обратно", async () => {
    addFunc();
    const box = screen.getAllByLabelText("название функции").pop();
    fireEvent.change(box, { target: { value: "вёрстка" } });
    fireEvent.blur(box);

    openExport();
    const nameBox = container.querySelector('input[placeholder="имя сценария"]');
    fireEvent.change(nameBox, { target: { value: "с функцией" } });
    fireEvent.blur(nameBox);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(container.textContent).toMatch(/Сохранено/));

    // Стираем функцию и грузим сценарий обратно.
    scheme();
    assetTab("Функции");
    const card = screen.getByDisplayValue("вёрстка").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));
    expect(screen.queryByDisplayValue("вёрстка")).toBeNull();

    openExport();
    const load = [...container.querySelectorAll("button")]
      .filter((b) => b.textContent === "Загрузить").pop();
    fireEvent.click(load);
    await waitFor(() => expect(container.textContent).toMatch(/Загружено:/));

    scheme();
    assetTab("Функции");
    expect(screen.getByDisplayValue("вёрстка")).toBeInTheDocument();
  });
});
