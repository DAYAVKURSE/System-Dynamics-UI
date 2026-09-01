import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Гипотеза набирается в одном поле из палитры под ним. */

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
const field = () => screen.getByRole("group", { name: "выражение гипотезы" });
const chipIn = (starts) => [...field().querySelectorAll("span")]
  .find((s) => s.textContent.startsWith(starts));
const palette = (name) => screen.getByRole("button", { name });
const put = (name) => fireEvent.click(palette(name));

describe("палитра и поле", () => {
  it("пустое поле так и говорит, а разложить нечего", () => {
    openBuilder();
    expect(screen.getByText(/пусто — возьми элемент из палитры/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Разложить в движения" }).disabled)
      .toBe(true);
  });

  it("палитра предлагает ресурсы, стрелку, операторы и сравнения", () => {
    openBuilder();
    expect(screen.getByRole("button", { name: "→ стрелка" })).toBeTruthy();
    ["если", "иначе", "пока", "повторить"].forEach((o) =>
      expect(screen.getAllByRole("button", { name: o }).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: ">" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "123 число" })).toBeTruthy();
  });

  it("нажатие на элемент палитры кладёт его в поле", () => {
    openBuilder();
    put("→ стрелка");
    // Элемент появился в выражении — его видно во фразе под полем.
    expect(screen.getAllByText(/→/).length).toBeGreaterThan(0);
  });

  it("вставленный элемент сразу открывает свои параметры", () => {
    openBuilder();
    put("→ стрелка");
    expect(screen.getByText(/за какое время это движение должно быть произведено/))
      .toBeTruthy();
    expect(screen.getByText(/следующий элемент получает отчёт от предыдущего/))
      .toBeTruthy();
    expect(screen.getByText(/в сколько потоков/)).toBeTruthy();
  });

  it("у стрелки настраиваются срок, окно дат, отчёт, повтор и потоки", () => {
    openBuilder();
    put("→ стрелка");
    // Даты — два поля datetime-local, обе стороны окна.
    expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(2);
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
    // Повтор: один раз / сразу / после утверждения отчёта / раз в период.
    const opts = [...container.querySelectorAll("option")].map((o) => o.textContent);
    ["один раз", "сразу, без ожидания", "после утверждения отчёта", "раз в период"]
      .forEach((n) => expect(opts).toContain(n));
    // Потоки: переключатель и число.
    expect(screen.getByRole("button", { name: "в несколько" })).toBeTruthy();
  });

  it("щелчок по элементу в поле открывает его параметры повторно", () => {
    openBuilder();
    put("→ стрелка");
    // Свернуть параметры щелчком по самому элементу...
    const chip = chipIn("→");
    fireEvent.click(chip);
    expect(screen.queryByText(/в сколько потоков/)).toBeNull();
    // ...и открыть снова.
    fireEvent.click(chipIn("→"));
    expect(screen.getByText(/в сколько потоков/)).toBeTruthy();
  });
});

describe("курсор решает, куда встанет элемент", () => {
  const words = () => field().parentElement.parentElement
    .textContent;

  it("следующий элемент встаёт после предыдущего, а не в конец наугад", () => {
    openBuilder();
    put("если");
    put(">");
    // Курсор идёт за вставленным: «если >», а не «> если».
    expect(screen.getByText(/^если >$/)).toBeTruthy();
  });

  it("щель в поле переносит курсор, и элемент встаёт именно туда", () => {
    openBuilder();
    put("если");
    put(">");
    // Щели — пустые вставки между элементами; первая стоит перед всем.
    const gaps = field().querySelectorAll('span[title="сюда встанет следующий элемент"]');
    expect(gaps.length).toBe(3);          // до, между, после
    fireEvent.click(gaps[1]);             // курсор между «если» и «>»
    put("<");
    expect(screen.getByText(/^если < >$/)).toBeTruthy();
    // Курсор поехал за вставленным, а не прыгнул в конец: следующий элемент
    // встаёт рядом с предыдущим, и вставлять по одному не приходится заново.
    put("≥");
    expect(screen.getByText(/^если < ≥ >$/)).toBeTruthy();
  });

  it("«убрать из выражения» удаляет именно выбранный элемент", () => {
    openBuilder();
    put("если");
    put(">");
    fireEvent.click(chipIn("если"));
    fireEvent.click(screen.getByRole("button", { name: "Убрать из выражения" }));
    // «если» ушло, «>» осталось. Сравнение — набираемый текст, поэтому
    // живёт полем ввода, а не фишкой.
    expect(chipIn("если")).toBeUndefined();
    expect([...field().querySelectorAll("input")].map((i) => i.value)).toEqual([">"]);
  });
});

describe("раскладка выражения в движения", () => {
  // Кладём «[ресурс] → [ресурс]» и заполняем количество.
  const buildMove = () => {
    const model = dump();
    openBuilder();
    const [a, b] = [model.traits[0], model.traits.find((t) => t.e !== model.traits[0].e)];
    const nameOf = (t) => new RegExp(t.l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    fireEvent.click(screen.getAllByRole("button", { name: nameOf(a) })[0]);
    put("→ стрелка");
    fireEvent.click(screen.getAllByRole("button", { name: nameOf(b) })[0]);
    // Курсор после стрелки — вернём выделение на неё и впишем количество.
    fireEvent.click(chipIn("→"));
    const amount = screen.getByText(/за раз переносит/).parentElement
      .querySelector('input[inputmode="decimal"]');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "7" } });
    fireEvent.blur(amount);
    return { a, b };
  };

  it("две соседние карточки ресурсов и стрелка дают стрелку модели", () => {
    const before = dump().edges.length;
    const { a, b } = buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движения" }));

    const edges = dump().edges;
    expect(edges.length).toBe(before + 1);
    const ed = edges[edges.length - 1];
    expect(ed.fromTrait).toBe(a.id);
    expect(ed.to).toBe(b.id);
    expect(ed.gives).toBe(7);
  });

  it("отложенная гипотеза хранится выражением и на расчёт не влияет", () => {
    const before = dump().edges.length;
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));

    const m = dump();
    expect(m.edges.length).toBe(before);
    expect(m.hypos).toHaveLength(1);
    // Хранится именно выражение — элементы, а не готовая стрелка.
    expect(Array.isArray(m.hypos[0].tokens)).toBe(true);
    expect(m.hypos[0].tokens.some((t) => t.kind === "arrow")).toBe(true);
  });

  it("отложенную можно разложить позже", () => {
    const before = dump().edges.length;
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));
    tab("Схема");
    fireEvent.click(screen.getByRole("button", { name: "Разложить" }));

    const m = dump();
    expect(m.edges.length).toBe(before + 1);
    expect(m.hypos).toHaveLength(0);
  });

  it("отложенную можно вернуть в поле кнопкой «Править»", () => {
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));
    tab("Схема");
    fireEvent.click(screen.getByRole("button", { name: "Править" }));
    // Выражение снова в поле, и черновиков не осталось.
    expect(screen.getByRole("button", { name: "Разложить в движения" }).disabled)
      .toBe(false);
    expect(dump().hypos).toHaveLength(0);
  });

  it("отмена возвращает разложенное обратно", () => {
    buildMove();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движения" }));
    const after = dump().edges.length;
    fireEvent.click(screen.getByRole("button", { name: "↶ отменить" }));
    expect(dump().edges.length).toBe(after - 1);
  });
});
