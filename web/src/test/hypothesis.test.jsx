import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Гипотеза набирается строками: каждая начинается с оператора, элементы
   кладутся из палитры под программой. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const openBuilder = () => {
  tab("Схема");
  fireEvent.click(screen.getByRole("button", { name: "+ составить гипотезу" }));
};
const dump = () => {
  fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[1]);
  return JSON.parse(container.querySelector("textarea").value);
};
const program = () => screen.getByRole("group", { name: "строки гипотезы" });
const lineRow = (op) => screen.getByRole("group", { name: `строка ${op}` });
// Кнопки-операторы стоят и в палитре строк, и в самих строках: палитра идёт
// после программы, поэтому берём последнюю.
const addLine = (op) => {
  const all = screen.getAllByRole("button", { name: op });
  fireEvent.click(all[all.length - 1]);
};
const put = (name) => {
  const all = screen.getAllByRole("button", { name });
  fireEvent.click(all[all.length - 1]);
};
const openAsset = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^[▸▾] ${name}`) }));

describe("палитра и программа", () => {
  it("пустая программа так и говорит, а разложить нечего", () => {
    openBuilder();
    expect(screen.getByText(/Пусто\. Начните строкой/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Разложить в движения" }).disabled)
      .toBe(true);
  });

  it("операторы — все восемь, каждый заводит свою строку", () => {
    openBuilder();
    ["если", "то", "иначе", "пока", "повторять", "для", "break", "continue"]
      .forEach((o) => expect(screen.getAllByRole("button", { name: o }).length)
        .toBeGreaterThan(0));
  });

  it("строка начинается с оператора — он часть строки, а не её содержимого", () => {
    openBuilder();
    addLine("если");
    const row = lineRow("если");
    expect(within(row).getByRole("button", { name: "если" })).toBeTruthy();
  });

  it("оператор строки меняется нажатием на него", () => {
    openBuilder();
    addLine("если");
    fireEvent.click(within(lineRow("если")).getByRole("button", { name: "если" }));
    expect(screen.getByRole("group", { name: "строка то" })).toBeTruthy();
  });

  it("строка удаляется и переставляется своими кнопками", () => {
    openBuilder();
    addLine("если");
    addLine("то");
    expect(program().querySelectorAll('[role="group"]')).toHaveLength(2);
    fireEvent.click(within(lineRow("то")).getByRole("button", { name: "удалить строку" }));
    expect(program().querySelectorAll('[role="group"]')).toHaveLength(1);
  });
});

describe("ресурсы под спойлером актива", () => {
  it("свёрнуты, пока актив не раскрыт", () => {
    openBuilder();
    const model = dump();
    openBuilder();
    const trait = model.traits[0];
    const ent = model.entities.find((e) => e.id === trait.e);
    // Заголовок актива есть, ресурсов под ним не видно.
    expect(screen.getByRole("button", { name: new RegExp(`^▸ ${ent.name}`) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(trait.l) })).toBeNull();

    openAsset(ent.name);
    expect(screen.getAllByRole("button", { name: new RegExp(trait.l) }).length)
      .toBeGreaterThan(0);
  });

  it("в заголовке видно, сколько ресурсов внутри", () => {
    openBuilder();
    const model = dump();
    openBuilder();
    const ent = model.entities[0];
    const n = model.traits.filter((t) => t.e === ent.id).length;
    expect(screen.getByRole("button", { name: new RegExp(`${ent.name}\\s*·\\s*${n}`) }))
      .toBeTruthy();
  });

  it("раскрытый актив даёт и сам актив — для строки «для»", () => {
    openBuilder();
    const model = dump();
    openBuilder();
    const ent = model.entities[0];
    openAsset(ent.name);
    expect(screen.getByRole("button", { name: `«${ent.name}»` })).toBeTruthy();
  });
});

describe("раскладка программы в движения", () => {
  // «то [ресурс A] → [ресурс B]» с заполненным количеством.
  const buildMove = () => {
    const model = dump();
    openBuilder();
    const a = model.traits[0];
    const b = model.traits.find((t) => t.e !== a.e);
    const entA = model.entities.find((e) => e.id === a.e);
    const entB = model.entities.find((e) => e.id === b.e);
    addLine("то");
    openAsset(entA.name);
    put(new RegExp(a.l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    put("→ стрелка");
    openAsset(entB.name);
    put(new RegExp(b.l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    // Количество — в параметрах стрелки: возвращаем выделение на неё.
    const chipArrow = [...lineRow("то").querySelectorAll("span")]
      .find((s) => s.textContent.startsWith("→"));
    fireEvent.click(chipArrow);
    const amount = screen.getByText(/за раз переносит/).parentElement
      .querySelector('input[inputmode="decimal"]');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "7" } });
    fireEvent.blur(amount);
    return { a, b };
  };

  it("строка «то» с двумя ресурсами и стрелкой даёт стрелку модели", () => {
    const before = dump().edges.length;
    const { a, b } = buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движения" }));

    const edges = dump().edges;
    expect(edges.length).toBe(before + 1);
    const ed = edges[edges.length - 1];
    expect(ed.fromTrait).toBe(a.id);
    expect(ed.to).toBe(b.id);
    expect(ed.gives).toBe(7);
    expect(ed.conds).toEqual([]);        // «то» без «если» — без условий
  });

  it("отложенная гипотеза хранится строками и на расчёт не влияет", () => {
    const before = dump().edges.length;
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));

    const m = dump();
    expect(m.edges.length).toBe(before);
    expect(m.hypos).toHaveLength(1);
    expect(Array.isArray(m.hypos[0].lines)).toBe(true);
    expect(m.hypos[0].lines[0].op).toBe("then");
  });

  it("отложенную можно разложить позже", () => {
    const before = dump().edges.length;
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));
    tab("Схема");
    fireEvent.click(screen.getByRole("button", { name: "Разложить" }));
    expect(dump().edges.length).toBe(before + 1);
  });

  it("отмена возвращает разложенное обратно", () => {
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движения" }));
    const after = dump().edges.length;
    fireEvent.click(screen.getByRole("button", { name: "↶ отменить" }));
    expect(dump().edges.length).toBe(after - 1);
  });

  it("«если» над «то» доезжает до стрелки условием", () => {
    const model = dump();
    openBuilder();
    const a = model.traits[0];
    const b = model.traits.find((t) => t.e !== a.e);
    const entA = model.entities.find((e) => e.id === a.e);
    const entB = model.entities.find((e) => e.id === b.e);
    const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    // Сначала условие, потом действие — строки идут сверху вниз.
    addLine("если");
    openAsset(entA.name);
    put(rx(a.l));
    put(">");
    // Число — отдельный элемент: иначе «1» ушло бы в то же поле, где «>».
    put("123 число");
    const num = [...lineRow("если").querySelectorAll("input")].pop();
    fireEvent.focus(num);
    fireEvent.change(num, { target: { value: "1" } });
    fireEvent.blur(num);

    addLine("то");
    put(rx(a.l));
    put("→ стрелка");
    openAsset(entB.name);
    put(rx(b.l));
    const chipArrow = [...lineRow("то").querySelectorAll("span")]
      .find((s) => s.textContent.startsWith("→"));
    fireEvent.click(chipArrow);
    const amount = screen.getByText(/за раз переносит/).parentElement
      .querySelector('input[inputmode="decimal"]');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "4" } });
    fireEvent.blur(amount);

    fireEvent.click(screen.getByRole("button", { name: "Разложить в движения" }));
    const edges = dump().edges;
    const ed = edges[edges.length - 1];
    expect(ed.gives).toBe(4);
    // Условие доехало и ссылается на ресурс по id, а не по имени.
    expect(ed.conds).toHaveLength(1);
    expect(ed.conds[0].expr).toBe(`{${a.id}} > 1`);
  });
});
