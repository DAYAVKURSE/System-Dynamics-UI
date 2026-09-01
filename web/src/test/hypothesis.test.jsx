import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import {
  hypoGaps, hypoToEdge, hypoSentence, newHypo,
} from "../components/HypothesisBuilder.jsx";

/* Гипотеза формулируется целиком одной формой и раскладывается в стрелку. */

const TRAITS = [
  { id: "t1", e: "a", k: "res", l: "рабочее время", unit: "ч", per: "мес", flow: true },
  { id: "t2", e: "b", k: "res", l: "заявки", unit: "шт", per: "мес", flow: true },
];
const ENTS = [{ id: "a", name: "Я" }, { id: "b", name: "Клиенты" }];

describe("разбор гипотезы", () => {
  const ok = () => ({ ...newHypo("a"), fromTrait: "t1", to: "b", toTrait: "t2",
    gives: 3, per: "нед" });

  it("готовая гипотеза не жалуется", () => {
    expect(hypoGaps(ok(), TRAITS)).toEqual([]);
  });

  it("без приёмника, без количества и с чужим ресурсом — не раскладывается", () => {
    expect(hypoGaps({ ...ok(), toTrait: "" }, TRAITS).length).toBeGreaterThan(0);
    expect(hypoGaps({ ...ok(), gives: 0 }, TRAITS).length).toBeGreaterThan(0);
    // Ресурс t1 принадлежит активу «a», а приёмником выбран «b».
    expect(hypoGaps({ ...ok(), toTrait: "t1" }, TRAITS).join(" "))
      .toMatch(/не из выбранного актива/);
  });

  it("ресурс не может течь сам в себя", () => {
    const h = { ...ok(), from: "b", fromTrait: "t2" };
    expect(hypoGaps(h, TRAITS).join(" ")).toMatch(/сам в себя/);
  });

  it("источник не обязателен — величина может приходить извне модели", () => {
    expect(hypoGaps({ ...ok(), fromTrait: "" }, TRAITS)).toEqual([]);
  });

  it("раскладывается ровно в поля стрелки", () => {
    const ed = hypoToEdge(ok());
    expect(ed.from).toBe("a");        // актив-источник
    expect(ed.fromTrait).toBe("t1");  // его ресурс — он и тратится
    expect(ed.to).toBe("t2");         // приёмник — это ресурс, не актив
    expect(ed.gives).toBe(3);
    expect(ed.per).toBe("нед");
    expect(ed.sign).toBe(1);
    expect(ed.basis).toBe("hypo");
    expect(ed.conds).toEqual([]);
  });

  it("«купирует» становится отрицательным знаком, а не отрицательным числом", () => {
    const ed = hypoToEdge({ ...ok(), sign: -1, gives: -3 });
    expect(ed.sign).toBe(-1);
    expect(ed.gives).toBe(3);
  });

  it("фраза называет оба актива, оба ресурса, число и период", () => {
    const s = hypoSentence(ok(), TRAITS, ENTS);
    expect(s).toMatch(/Я/); expect(s).toMatch(/Клиенты/);
    expect(s).toMatch(/рабочее время/); expect(s).toMatch(/заявки/);
    expect(s).toMatch(/3/); expect(s).toMatch(/нед/);
  });

  it("без источника фраза честно говорит, что ничего не тратится", () => {
    expect(hypoSentence({ ...ok(), fromTrait: "" }, TRAITS, ENTS))
      .toMatch(/ничего не тратит/);
  });
});

describe("конструктор в модели", () => {
  let container;
  beforeEach(() => { ({ container } = render(<SystemModel />)); });

  const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  const dump = () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[1]);
    return JSON.parse(container.querySelector("textarea").value);
  };
  // Форма конструктора — карточка вокруг кнопки «Разложить в движение»;
  // ищем поля внутри неё, а не по номеру среди всех select страницы.
  const form = () => screen.getByRole("button", { name: "Разложить в движение" })
    .closest("div").parentElement;
  const pick = (i, value) =>
    fireEvent.change(form().querySelectorAll("select")[i], { target: { value } });
  const build = () => {
    const model = dump();
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "+ составить гипотезу" }));
    const [src, dst] = [model.entities[0], model.entities[1]];
    const dstTrait = model.traits.find((t) => t.e === dst.id);
    const srcTrait = model.traits.find((t) => t.e === src.id);
    pick(0, src.id);
    pick(1, srcTrait.id);
    pick(2, dst.id);
    pick(3, dstTrait.id);
    const amount = form().querySelector('input[inputmode="decimal"]');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "7" } });
    fireEvent.blur(amount);
    return { src, dst, srcTrait, dstTrait };
  };

  it("незаполненная гипотеза не раскладывается — кнопка недоступна", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "+ составить гипотезу" }));
    expect(screen.getByRole("button", { name: "Разложить в движение" }).disabled)
      .toBe(true);
    expect(screen.getByText(/не хватает:/)).toBeTruthy();
  });

  it("заполненная — раскладывается в стрелку со всеми полями", () => {
    const before = dump().edges.length;
    // Форма живёт на своей вкладке: уход на «Выгрузить» её закрывает, поэтому
    // сначала снимок модели, потом составление.
    const { src, srcTrait, dstTrait } = build();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движение" }));

    const edges = dump().edges;
    expect(edges.length).toBe(before + 1);
    const ed = edges[edges.length - 1];
    expect(ed.from).toBe(src.id);
    expect(ed.fromTrait).toBe(srcTrait.id);
    expect(ed.to).toBe(dstTrait.id);
    expect(ed.gives).toBe(7);
  });

  it("новая стрелка сразу влияет на прогноз — она в модели, а не в черновике", () => {
    build();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движение" }));
    const m = dump();
    const ed = m.edges[m.edges.length - 1];
    // Стрелка попала в edges (то, что считает движок), а не в hypos.
    expect(m.hypos || []).toHaveLength(0);
    expect(m.edges.some((e) => e.id === ed.id)).toBe(true);
  });

  it("отложенная гипотеза хранится в сценарии и на расчёт не влияет", () => {
    const before = dump().edges.length;
    build();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));

    const m = dump();
    expect(m.edges.length).toBe(before);   // модель не тронута
    expect(m.hypos).toHaveLength(1);       // но гипотеза не потеряна
    expect(m.hypos[0].gives).toBe(7);
  });

  it("отложенную можно разложить позже — она уходит из черновиков в модель", () => {
    const before = dump().edges.length;
    build();
    fireEvent.click(screen.getByRole("button", { name: "Отложить черновиком" }));
    fireEvent.click(screen.getByRole("button", { name: "Разложить" }));

    const m = dump();
    expect(m.edges.length).toBe(before + 1);
    expect(m.hypos).toHaveLength(0);
  });

  it("отмена возвращает разложенную гипотезу обратно", () => {
    build();
    fireEvent.click(screen.getByRole("button", { name: "Разложить в движение" }));
    const after = dump().edges.length;
    fireEvent.click(screen.getByRole("button", { name: "↶ отменить" }));
    expect(dump().edges.length).toBe(after - 1);
  });
});
