import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { groupsOf, groupCount, newPort, normalizeFunc } from "../lib/funcs.js";
import { pickAlt, runSide, solve, takesOf } from "../lib/plan.js";

/* «И» между требованиями функции, «ИЛИ» внутри требования.

   Плоский список умеет только «и»: «нужен А и Б». Сказать «нужен А и Б, но
   вместо Б годится В» им нельзя. Поэтому у входа есть группа: входы одной
   группы — варианты одного требования, разные группы соединены «и». А
   количество у каждого варианта и есть курс обмена: «2 А» рядом с «3 В»
   значит, что три В заменяют два А. */

const F = (takes) => normalizeFunc({ id: "f1", e: "A", dur: 1, durUnit: "мес",
  takes, gives: [{ trait: "out", lo: 1, hi: 1 }] });

describe("запись", () => {
  it("новый вход заводится в своей группе — то есть прежним «и»", () => {
    const a = newPort("t1");
    const b = newPort("t2");
    expect(a.group).toBe(a.id);
    expect(groupCount([a, b])).toBe(2);
  });

  it("общая группа делает входы вариантами одного требования", () => {
    const a = newPort("t1");
    const b = newPort("t2", 1, 1, a.group);
    expect(groupCount([a, b])).toBe(1);
    expect(groupsOf([a, b])[0]).toHaveLength(2);
  });

  it("чужая запись без групп читается как чистое «и»", () => {
    // Все модели, собранные до этого, — сплошное «и», и такими остаются.
    const f = normalizeFunc({ takes: [{ trait: "t1" }, { trait: "t2" }] });
    expect(groupCount(f.takes)).toBe(2);
  });

  it("у выхода группы нет: «выдаст А или Б» — это монетка, а не модель", () => {
    const f = normalizeFunc({ gives: [{ trait: "t1", group: "g" },
      { trait: "t2", group: "g" }] });
    expect(groupCount(f.gives)).toBe(2);
  });
});

describe("какой вариант идёт в дело", () => {
  const A = newPort("a", 50, 50);
  const B = newPort("b", 1, 1, A.group);
  const opts = (have) => ({ have: (id) => have[id] || 0, side: "hi", runs: [] });

  it("тот, которого хватает на дольше, а не тот, которого больше в штуках", () => {
    /* Сто единиц при нужде в пятьдесят — это два выполнения, десять при
       нужде в одну — десять. Второе богаче, хотя в штуках выглядит беднее. */
    expect(pickAlt([A, B], opts({ a: 100, b: 10 })).trait).toBe("b");
    // А когда первого хватает на дольше — берётся он.
    expect(pickAlt([A, B], opts({ a: 100, b: 1 })).trait).toBe("a");
  });

  it("ничего нет вовсе — первый по списку: это предпочтение человека", () => {
    expect(pickAlt([A, B], opts({})).trait).toBe("a");
  });

  it("одиночная группа — это просто вход, без всякого выбора", () => {
    expect(pickAlt([A], opts({})).trait).toBe("a");
  });

  it("из каждой группы берётся по одному — столько же, сколько требований", () => {
    const C = newPort("c", 1, 1);
    const f = { takes: [A, B, C] };
    expect(takesOf(f, opts({ a: 1000, c: 10 })).map((p) => p.trait)).toEqual(["a", "c"]);
  });
});

describe("прогноз считает по выбранному варианту", () => {
  const model = (takes) => ({
    traits: [{ id: "a", e: "A", have: 0 }, { id: "b", e: "A", have: 12 },
      { id: "out", e: "A", have: 0 }],
    funcs: [F(takes)],
  });

  it("нет первого ресурса — работа идёт на втором, а не встаёт", () => {
    // Ради этого «или» и заводят: чтобы работа не останавливалась.
    const A = newPort("a", 2, 2);
    const B = newPort("b", 3, 3, A.group);
    const out = runSide(model([A, B]), { span: 1, side: "hi" });
    expect(out.out[1]).toBeGreaterThan(0);
    expect(out.b[1]).toBeLessThan(12);
    expect(out.a[1]).toBe(0);
  });

  it("без «или» та же функция стоит: брать нечего", () => {
    const out = runSide(model([newPort("a", 2, 2)]), { span: 1, side: "hi" });
    expect(out.out[1]).toBe(0);
  });

  it("тратится только выбранный вариант, а не оба сразу", () => {
    const A = newPort("a", 2, 2);
    const B = newPort("b", 3, 3, A.group);
    const m = model([A, B]);
    m.traits[0].have = 1000;               // первого вдоволь
    const out = runSide(m, { span: 1, side: "hi" });
    expect(out.b[1]).toBe(12);             // второй не тронут
    expect(out.a[1]).toBeLessThan(1000);
  });
});

describe("план под цель считает так же", () => {
  it("недостающий вариант не делает цель недостижимой", () => {
    const A = newPort("a", 2, 2);
    const B = newPort("b", 3, 3, A.group);
    const m = {
      traits: [{ id: "a", e: "A", have: 0 }, { id: "b", e: "A", have: 100 },
        { id: "out", e: "A", have: 0 }],
      funcs: [F([A, B])],
    };
    const plan = solve(m, { trait: "out", want: 5 });
    expect(plan.ok).toBe(true);
    expect(plan.spent.b).toBeGreaterThan(0);
    expect(plan.spent.a ?? 0).toBe(0);
  });
});

describe("в форме", () => {
  let container;
  beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });
  const openFunc = () => {
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: /^Функции/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
  };
  const dump = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    return JSON.parse(container.querySelector("textarea").value);
  };

  it("у каждого требования есть поле «или вместо этого…»", () => {
    openFunc();
    expect(screen.getAllByLabelText(/^или вместо /).length).toBeGreaterThan(0);
  });

  it("добавленный вариант встаёт в ту же группу и подписан «или»", () => {
    openFunc();
    const alt = screen.getAllByLabelText(/^или вместо /)[0];
    fireEvent.change(alt, { target: { value: [...alt.options][1].value } });

    expect(screen.getByText("или")).toBeInTheDocument();
    const f = dump().funcs.find((x) => x.id === "f_req");
    expect(f.takes).toHaveLength(2);
    expect(f.takes[0].group).toBe(f.takes[1].group);
  });

  it("а «+ берёт ресурс» заводит новое требование — это «и»", () => {
    openFunc();
    const add = screen.getByLabelText("взять ресурс");
    fireEvent.change(add, { target: { value: [...add.options][1].value } });

    expect(screen.getByText("и")).toBeInTheDocument();
    const f = dump().funcs.find((x) => x.id === "f_req");
    expect(f.takes[0].group).not.toBe(f.takes[1].group);
  });

  it("у выхода поля «или» нет", () => {
    openFunc();
    const labels = screen.getAllByLabelText(/^или вместо /);
    // Все поля «или» относятся ко входам: у выходов их нет вовсе.
    expect(labels.length).toBe(1);
  });
});

describe("свёрнутая строка функции", () => {
  it("показывает «или» внутри требования, а не одну сплошную запятую", () => {
    /* «спрос, пользователи» читается как «и то, и другое» — прямо
       противоположно тому, что задано группой. */
    localStorage.clear();
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: /^Функции/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
    const alt = screen.getAllByLabelText(/^или вместо /)[0];
    fireEvent.change(alt, { target: { value: [...alt.options][1].value } });
    expect(screen.getByText(/спрос или /)).toBeInTheDocument();
  });
});
