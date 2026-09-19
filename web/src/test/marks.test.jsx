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
/* Три части актива живут во вкладках: до ресурсов и воркеров надо сначала
   переключиться. */
const assetTab = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^${name}`) }));
const asks = () => [...container.querySelectorAll("svg text")].filter((t) => t.textContent === "?");

describe("подпись на схеме", () => {
  it("у каждого актива под названием написано, что это актив", () => {
    scheme();
    const svg = container.querySelector("[data-scheme-box] svg");
    const marks = [...svg.querySelectorAll("text")].filter((t) => t.textContent === "актив");
    expect(marks.length).toBeGreaterThan(0);
  });

  const reds = () => [...container.querySelectorAll("svg text")]
    .filter((t) => t.textContent === "актив" && t.getAttribute("fill") !== "#E6EDF7").length;

  it("«?» стоит ровно у красных подписей, и красные в модели есть", () => {
    // Стартовая модель собрана верно, красных в ней нет — заводим свой
    // актив: он ничего не берёт и ничего не отдаёт. Второе условие важнее
    // первого: без него сравнение «ноль равен нулю» проходило бы и тогда,
    // когда подписи вообще перестали краснеть.
    addAsset();
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
  /* Имя выбранного актива — надпись, а не поле: правится двойным
     нажатием (владелец, 2026-09-19). */
  const nameBox = () => screen.getByLabelText("название актива");

  it("тап по блоку выбирает актив — иначе проверка ниже ничего не стоит", () => {
    scheme();
    const other = blocks().find((g) => g.querySelector("text").textContent !== nameBox().textContent);
    fireEvent.pointerDown(other, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });
    expect(nameBox().textContent).toBe(other.querySelector("text").textContent);
  });

  it("тап по «?» открывает объяснение и НЕ перескакивает выбор на чужой блок", () => {
    // Красный блок нужен чужой: у своего выбор не изменился бы и без защиты.
    addAsset();
    const other = blocks().find((g) => g.querySelector("text").textContent !== "Новый актив");
    fireEvent.pointerDown(other, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });
    const mine = nameBox().textContent;
    // «?» чужого блока: у своего выбор не изменился бы и без защиты.
    const ask = asks().map((t) => t.parentElement)
      .find((g) => g.parentElement.querySelector("text").textContent !== mine);
    expect(ask).toBeTruthy();

    fireEvent.pointerDown(ask, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    fireEvent.click(ask);

    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByLabelText("закрыть"));
    expect(nameBox().textContent).toBe(mine);
  });
});

describe("подпись у ресурса", () => {
  it("красная подпись объясняется определением ресурса", () => {
    // Заводим ресурс в новом активе: его никто не выдаёт и никто не берёт,
    // значит он красный.
    addAsset();
    assetTab("Ресурсы");
    const box = screen.getByPlaceholderText("текст нового ресурса");
    fireEvent.change(box, { target: { value: "новый ресурс" } });
    fireEvent.blur(box);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ ◆ ресурс$/ })[0]);

    const ask = screen.getByRole("button", { name: /почему «ресурс»/ });
    fireEvent.click(ask);
    expect(within(dialog()).getByText(WHY_TRAIT)).toBeInTheDocument();
  });

  it("ресурс, который одна функция выдаёт, а другая берёт, — белый", () => {
    // Стартовая модель замкнута: «Рынок услуг» выдаёт спрос, а «Сбор заявок»
    // его берёт, значит у спроса красной подписи быть не должно.
    scheme();
    const mkt = [...container.querySelectorAll("svg g")]
      .find((g) => [...g.querySelectorAll("text")]
        .some((t) => t.textContent === "Рынок услуг"));
    fireEvent.pointerDown(mkt, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });
    assetTab("Ресурсы");
    expect(screen.getByText("спрос")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /почему «ресурс»/ })).toBeNull();
  });
});

describe("подпись у функции", () => {
  /* Функцию заводим в новом активе: там она одна, и проверка не путается
     между карточками стартовой модели. */
  const freshFunc = () => {
    addAsset();
    assetTab("Функции");
    fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
  };
  // Ресурсы заводятся на своей вкладке, функция настраивается на своей.
  const addTraits = (...names) => {
    assetTab("Ресурсы");
    const box = screen.getByPlaceholderText("текст нового ресурса");
    names.forEach((name) => {
      fireEvent.change(box, { target: { value: name } });
      fireEvent.blur(box);
      fireEvent.click(screen.getAllByRole("button", { name: /^\+ ◆ ресурс$/ })[0]);
    });
    assetTab("Функции");
  };
  /* Вход и выход добавляются одним полем: в нём все ресурсы схемы — свои и
     чужие. Двух списков больше нет, и «свой или чужой» перестал быть
     вопросом при добавлении. */
  const addPort = (kind, name) => {
    const sel = screen.getByLabelText(kind === "takes" ? "взять ресурс" : "выдать ресурс");
    const opt = [...sel.options].find((o) => o.textContent === name);
    fireEvent.change(sel, { target: { value: opt.value } });
  };

  it("только что заведённая функция красная — ей нечего преобразовывать", () => {
    freshFunc();
    const ask = screen.getByRole("button", { name: /почему «функция»/ });
    fireEvent.click(ask);
    /* Ищем по первой фразе, а не по всему тексту: объяснение — определение
       и список условий под ним, и привязывать тест к каждому пункту значит
       ломать его при любой правке формулировки. */
    expect(within(dialog()).getByText(/Функция обменивает одни ресурсы на другие/))
      .toBeInTheDocument();
  });

  it("функция с входом и выходом внутри актива становится белой", () => {
    freshFunc();
    // Два ресурса в новом активе: один во вход, другой в выход.
    addTraits("сырьё", "изделие");
    addPort("takes", "сырьё");
    addPort("gives", "изделие");

    expect(screen.queryByRole("button", { name: /почему «функция»/ })).toBeNull();
  });

  it("функция без времени выполнения красная — она не говорит, когда будет готово", () => {
    freshFunc();
    addTraits("сырьё", "изделие");
    addPort("takes", "сырьё");
    addPort("gives", "изделие");
    fireEvent.change(screen.getByLabelText("время одного выполнения"),
      { target: { value: "0" } });

    expect(screen.getByRole("button", { name: /почему «функция»/ })).toBeInTheDocument();
  });
});
