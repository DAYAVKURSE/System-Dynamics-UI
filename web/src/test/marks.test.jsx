import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { WHY_ASSET, WHY_FUNC, WHY_TRAIT } from "../lib/funcs.js";

/* Подписи под названиями: «актив», «ресурс», «функция».
   Белая — строение сходится, красная — нет, и рядом «?» с объяснением.
   Проверяем не цвет ради цвета, а то, ради чего это делалось: человек
   должен видеть, что именно не так, и получать определение словами. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
const dialog = () => screen.queryByRole("dialog");
/* Новый актив ни с чем не связан — значит заведомо не сходится. Проверять
   подписи на стартовой модели нельзя: там все активы годные, и проверка
   молча ничего бы не проверяла. */
const addAsset = () => { scheme(); fireEvent.click(screen.getByRole("button", { name: "+ актив" })); };
const asks = () => [...container.querySelectorAll("svg text")].filter((t) => t.textContent === "?");

describe("подпись на схеме", () => {
  it("у каждого актива под названием написано, что это актив", () => {
    scheme();
    const svg = container.querySelector("svg");
    const marks = [...svg.querySelectorAll("text")].filter((t) => t.textContent === "актив");
    expect(marks.length).toBeGreaterThan(0);
  });

  const reds = () => [...container.querySelectorAll("svg text")]
    .filter((t) => t.textContent === "актив" && t.getAttribute("fill") !== "#E6EDF7").length;

  it("«?» стоит ровно у красных подписей, и красные в модели есть", () => {
    scheme();
    // Второе условие важнее первого: без него сравнение «ноль равен нулю»
    // проходило бы и тогда, когда подписи вообще перестали краснеть.
    expect(reds()).toBeGreaterThan(0);
    expect(asks().length).toBe(reds());
  });

  it("новый актив краснеет сразу: он ничего не берёт и ничего не отдаёт", () => {
    scheme();
    const wasRed = reds();
    fireEvent.click(screen.getByRole("button", { name: "+ актив" }));
    expect(reds()).toBe(wasRed + 1);
    expect(asks().length).toBe(wasRed + 1);
  });

  it("«?» объясняет словами владельца и закрывается", () => {
    addAsset();
    const ask = asks()[0];
    fireEvent.click(ask.parentElement);
    expect(dialog()).toBeTruthy();
    expect(within(dialog()).getByText(WHY_ASSET)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeNull();
  });

  /* Блок актива на схеме — группа с прямоугольником в ширину блока (208).
     Имя выбранного актива — единственное поле ввода с жирным начертанием. */
  const blocks = () => [...container.querySelectorAll("svg > g")]
    .filter((g) => g.querySelector('rect[width="208"]'));
  const nameBox = () => [...container.querySelectorAll("input")]
    .find((i) => i.style.fontWeight === "700");

  it("тап по блоку выбирает актив — иначе проверка ниже ничего не стоит", () => {
    scheme();
    const other = blocks().find((g) => g.querySelector("text").textContent !== nameBox().value);
    fireEvent.pointerDown(other, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });
    expect(nameBox().value).toBe(other.querySelector("text").textContent);
  });

  it("тап по «?» открывает объяснение и НЕ перескакивает выбор на чужой блок", () => {
    scheme();
    const mine = nameBox().value;
    // «?» чужого блока: у своего выбор не изменился бы и без защиты.
    const ask = asks().map((t) => t.parentElement)
      .find((g) => g.parentElement.querySelector("text").textContent !== mine);
    expect(ask).toBeTruthy();

    fireEvent.pointerDown(ask, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    fireEvent.click(ask);

    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByLabelText("закрыть"));
    expect(nameBox().value).toBe(mine);
  });
});

describe("подпись у ресурса", () => {
  it("под каждым ресурсом написано «ресурс»", () => {
    scheme();
    expect(screen.getAllByText("ресурс").length).toBeGreaterThan(0);
  });

  it("красная подпись объясняется определением ресурса", () => {
    // Заводим ресурс в новом активе: он ни с чем не связан, значит красный.
    addAsset();
    const box = container.querySelector('input[placeholder="текст нового ресурса"]');
    fireEvent.change(box, { target: { value: "новый ресурс" } });
    fireEvent.blur(box);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ / })
      .find((b) => /рост|затрат|ресурс/i.test(b.textContent)));

    const ask = screen.getAllByRole("button", { name: /почему «ресурс»/ })[0];
    expect(ask).toBeTruthy();
    fireEvent.click(ask);
    expect(within(dialog()).getByText(WHY_TRAIT)).toBeInTheDocument();
  });
});

describe("подпись у функции", () => {
  it("только что заведённая функция красная — ей нечего преобразовывать", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
    expect(screen.getByText("функция")).toBeInTheDocument();
    const ask = screen.getByRole("button", { name: /почему «функция»/ });
    fireEvent.click(ask);
    expect(within(dialog()).getByText(WHY_FUNC)).toBeInTheDocument();
  });

  it("функция с входом и выходом внутри актива становится белой", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ берёт/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ выдаёт/ })[1]);
    // Красной подписи больше нет — значит и «?» рядом с ней исчез.
    expect(screen.queryByRole("button", { name: /почему «функция»/ })).toBeNull();
  });

  it("функция без времени выполнения красная — она не говорит, когда будет готово", () => {
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ берёт/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ выдаёт/ })[1]);
    fireEvent.change(screen.getByLabelText("время одного выполнения"),
      { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /почему «функция»/ })).toBeInTheDocument();
  });
});
