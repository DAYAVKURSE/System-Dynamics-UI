import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* «МАТЕРИАЛЫ» НА ВКЛАДКЕ ОТЧЁТОВ.

   Все активы разом: актив раскрывается в ресурсы, ресурс — в «сколько
   есть» и кнопки, «Посмотреть» — в сами единицы с историей каждой: откуда
   и когда, что написали при сдаче, что отдано взамен и какая функция
   руководила; из материалов — так и сказано. Загрузка — окном: количество
   и по полю на каждую единицу. ЧЕМ подтверждается единица, окно не
   спрашивает: это свойство РЕСУРСА, и задаётся оно на вкладке «Схема» —
   один раз, когда ресурс заводят. Отсюда же считается, сколько его есть. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const reports = () => tab("Отчёты");
const openAsset = (name) => fireEvent.click(screen.getByRole("button", { name: `актив ${name}` }));
const pickTrait = (name) => fireEvent.click(screen.getByRole("button", { name: `ресурс ${name}` }));
const view = () => fireEvent.click(screen.getByRole("button", { name: "Посмотреть" }));
const openUpload = () => fireEvent.click(screen.getByRole("button", { name: "Загрузить единицу ресурса" }));
const dialog = () => screen.getByRole("dialog");
const materialsCard = () => screen.getByText("материалы — единицы ресурсов").closest("div").parentElement;
const dump = () => {
  tab("Инструменты");
  if (!container.querySelector("textarea")) tab("Выгрузка");
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  return JSON.parse(container.querySelector("textarea").value);
};
/* Вид единицы — у ресурса, на вкладке «Схема»: окно загрузки его больше
   не спрашивает. `i` — который по счёту ресурс актива. */
const setKind = (i, kindName) => {
  tab("Схема");
  fireEvent.click(screen.getByRole("button", { name: /^Ресурсы/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[i]);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${kindName}: `) }));
  fireEvent.click(screen.getByRole("button", { name: "свернуть ресурса" }));
};

const loadJson = (m) => {
  tab("Инструменты");
  if (!container.querySelector("textarea")) tab("Выгрузка");
  const area = container.querySelector("textarea");
  fireEvent.change(area, { target: { value: JSON.stringify(m) } });
  fireEvent.blur(area);
  const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
  fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
};

describe("форма «Материалы»", () => {
  it("стоит перед проектами и показывает все активы; актив → ресурсы с «есть», ресурс → единицы", () => {
    reports();
    const card = materialsCard();
    const projects = screen.getByText("отчёты");
    // Материалы — выше отчётов: отчёт начинается с единицы.
    expect(card.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Все активы сразу — по ним и ходят.
    ["Рынок услуг", "Пользователи", "Виртуальный менеджер"].forEach((n) => {
      expect(within(card).getByRole("button", { name: `актив ${n}` })).toBeInTheDocument();
    });
    expect(within(card).queryByRole("button", { name: "ресурс спрос" })).toBeNull();
    openAsset("Рынок услуг");
    const res = within(card).getByRole("button", { name: "ресурс спрос" });
    expect(res.textContent).toMatch(/есть 3.?000 обращ\./);
    // Единицы — только по «Посмотреть», иначе форма была бы километровой.
    pickTrait("спрос");
    expect(within(card).queryByText("№1")).toBeNull();
    view();
    expect(within(card).getByText("№1")).toBeInTheDocument();
    expect(within(card).getByText(/^×3.?000$/)).toBeInTheDocument();
    expect(within(card).getByText(/добавлен на вкладке «Материалы»/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "скачать обращ. №1" })).toBeInTheDocument();
  });

  it("текст: вид взят у ресурса, загрузка → строки, «есть» выросло, записи в модели", () => {
    setKind(1, "текст");
    reports();
    openAsset("Пользователи");
    pickTrait("заявки");
    view();
    expect(screen.getByText(/Единиц пока нет/)).toBeInTheDocument();
    openUpload();
    const d = dialog();
    expect(d).toHaveAccessibleName("Добавить: заявки");
    // Окно живёт прямо в body: внутри прокрученной формы fixed уезжал за экран.
    expect(d.parentElement.parentElement).toBe(document.body);
    expect(within(d).getByLabelText("количество")).toBeInTheDocument();
    // Вида окно не спрашивает: он у ресурса, и спрашивать дважды — значит
    // разрешить сегодня класть договор файлом, завтра текстом.
    expect(within(d).queryAllByRole("radio")).toHaveLength(0);
    expect(within(d).getByText(/Вид задан у ресурса/)).toBeInTheDocument();
    // Единица — что-то одно: под видом ресурса ровно одно поле.
    expect(within(d).queryByLabelText(/файл единицы/)).toBeNull();
    expect(within(d).queryByLabelText(/уникальный код/)).toBeNull();
    // Без текста грузить нечего.
    expect(within(d).getByRole("button", { name: "Загрузить" })).toBeDisabled();
    // «Количество 2» — два поля: у каждой единицы свой текст.
    fireEvent.change(within(d).getByLabelText("количество"), { target: { value: "2" } });
    expect(within(d).getByRole("list", { name: "тексты единиц" }).querySelectorAll("textarea")).toHaveLength(2);
    fireEvent.change(within(d).getByLabelText("текст единицы 1"), { target: { value: "заявка от Иванова" } });
    // Одной заполненной мало — нужна каждая.
    expect(within(d).getByRole("button", { name: "Загрузить" })).toBeDisabled();
    expect(within(d).getByText(/заполнено 1 из 2/)).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText("текст единицы 2"), { target: { value: "заявка от Петрова" } });
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const card = materialsCard();
    // Две единицы — две строки с номерами, у каждой свой текст.
    expect(within(card).getByText("№1")).toBeInTheDocument();
    expect(within(card).getByText("№2")).toBeInTheDocument();
    expect(within(card).getByText("заявка от Иванова")).toBeInTheDocument();
    expect(within(card).getByText("заявка от Петрова")).toBeInTheDocument();
    expect(within(card).getAllByText(/добавлен на вкладке «Материалы»/)).toHaveLength(2);
    expect(within(card).getByRole("button", { name: "ресурс заявки" }).textContent).toMatch(/есть 2 шт\./);
    const ms = dump().materials.filter((x) => x.trait === "req");
    expect(ms.map((m) => m.text)).toEqual(["заявка от Иванова", "заявка от Петрова"]);
    ms.forEach((m) => expect(m).toMatchObject({ kind: "text", qty: 1, file: null, code: "" }));

    // У ресурса «есть сейчас» — это число, и руками оно не вводится.
    tab("Схема");
    fireEvent.click(screen.getByRole("button", { name: /^Ресурсы/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[1]);
    expect(screen.getByLabelText("есть сейчас").textContent).toMatch(/^2 шт\./);
  });

  it("уникальный код: создаётся программой, а вместо него грузят подтверждение", async () => {
    setKind(1, "уникальный код");
    reports();
    openAsset("Пользователи");
    pickTrait("заявки");
    openUpload();
    const d = dialog();
    fireEvent.change(within(d).getByLabelText("количество"), { target: { value: "2" } });
    const codes = [within(d).getByLabelText("уникальный код 1").value,
      within(d).getByLabelText("уникальный код 2").value];
    expect(codes[0]).toMatch(/^[A-Z2-9]{8}$/);
    expect(codes[0]).not.toBe(codes[1]);
    /* Код показать нечем — значит грузят бумагу о выдаче. Она одна на всю
       загрузку и ложится сразу всем её единицам. */
    expect(within(d).getByRole("button", { name: "Загрузить" })).toBeDisabled();
    const input = within(d).getByLabelText("подтверждение выдачи");
    const f = new File(["x"], "акт-выдачи.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    fireEvent.change(input);
    await waitFor(() =>
      expect(within(d).getByRole("button", { name: "Загрузить" })).not.toBeDisabled());
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));

    // Загрузили — единицы уже видно: «Посмотреть» второй раз не нажимают.
    const card = materialsCard();
    expect(within(card).getByText(codes[0])).toBeInTheDocument();
    expect(within(card).getByText(codes[1])).toBeInTheDocument();
    expect(within(card).getByText("№2")).toBeInTheDocument();
    // Выгрузка — последней: она уводит со вкладки.
    const rows = dump().materials.filter((x) => x.trait === "req");
    expect(rows.map((x) => x.code)).toEqual(codes);
    // Подтверждение — одно, и лежит у каждой единицы.
    expect(rows.map((x) => x.file?.name)).toEqual(["акт-выдачи.pdf", "акт-выдачи.pdf"]);
  });

  it("тысяча кодов не уводит кнопку «Загрузить» вниз: список прокручивается сам", async () => {
    setKind(1, "уникальный код");
    reports();
    openAsset("Пользователи");
    pickTrait("заявки");
    openUpload();
    const d = dialog();
    fireEvent.change(within(d).getByLabelText("количество"), { target: { value: "1000" } });
    const list = within(d).getByRole("list", { name: "уникальные коды" });
    expect(list.querySelectorAll("input")).toHaveLength(1000);
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.maxHeight).toBe("180px");
    // Кнопки — вне прокручиваемого списка.
    expect(list.contains(within(d).getByRole("button", { name: "Загрузить" }))).toBe(false);
    // Подтверждение — одно на тысячу единиц, а не тысяча бумаг.
    const input = within(d).getByLabelText("подтверждение выдачи");
    Object.defineProperty(input, "files",
      { value: [new File(["x"], "акт.pdf", { type: "application/pdf" })], configurable: true });
    fireEvent.change(input);
    await waitFor(() =>
      expect(within(d).getByRole("button", { name: "Загрузить" })).not.toBeDisabled());
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));
    const rows = dump().materials.filter((x) => x.trait === "req");
    expect(rows).toHaveLength(1000);
    expect(new Set(rows.map((r) => r.file?.name))).toEqual(new Set(["акт.pdf"]));
  });

  it("файл: без сервера ложится внутрь сценария, и скачать его можно из списка", async () => {
    reports();
    openAsset("Пользователи");
    pickTrait("заявки");
    openUpload();
    const d = dialog();
    // «Количество 2» — два поля файла, и у каждой единицы свой.
    fireEvent.change(within(d).getByLabelText("количество"), { target: { value: "2" } });
    const attach = async (i, name) => {
      const input = within(d).getByLabelText(`файл единицы ${i}`);
      const f = new File(["x"], name, { type: "application/pdf" });
      Object.defineProperty(input, "files", { value: [f], configurable: true });
      fireEvent.change(input);
      await waitFor(() => expect(within(d).getByText(new RegExp(name.replace(".", "\\.")))).toBeInTheDocument());
    };
    await attach(1, "договор.pdf");
    expect(within(d).getByRole("button", { name: "Загрузить" })).toBeDisabled();
    await attach(2, "акт.pdf");
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));

    const card = materialsCard();
    const link = within(card).getByRole("link", { name: "скачать шт. №1" });
    expect(link.getAttribute("href")).toMatch(/^data:/);
    expect(link.getAttribute("download")).toBe("договор.pdf");
    expect(within(card).getByRole("link", { name: "скачать шт. №2" }).getAttribute("download")).toBe("акт.pdf");
    expect(dump().materials.filter((x) => x.trait === "req").map((x) => x.file.name)).toEqual(["договор.pdf", "акт.pdf"]);
  });

  it("единица из задачи рассказывает: какая функция, что написали при сдаче, что отдано взамен", () => {
    const m = dump();
    loadJson({
      ...m,
      entities: [{ id: "a", name: "Бюро", color: "#fff", x: 0, y: 0 }],
      traits: [{ id: "t1", e: "a", l: "заявка", unit: "шт." }, { id: "t2", e: "a", l: "макет", unit: "шт." }],
      funcs: [{ id: "f1", e: "a", name: "Собрать макет", dur: 1, durHi: 1, durUnit: "дн",
        takes: [{ id: "p1", trait: "t1", lo: 1, hi: 1 }], gives: [{ id: "g1", trait: "t2", lo: 1, hi: 1 }] }],
      materials: [{ id: "m1", trait: "t1", kind: "text", qty: 1, text: "заявка с сайта", at: "2026-02-01T09:00:00Z" }],
      tasks: [{ id: "tk1", funcId: "f1", title: "Макет главной", status: "done", assignee: null,
        submissions: [{ id: "s1", at: "2026-02-03T10:00:00Z", hours: 4, takes: { t1: 1 }, gives: { t2: 1 },
          took: { t1: ["m1"] }, text: "сделал в две итерации" }], reviews: [], comments: [] }],
      goals: [], factors: [], reports: [],
    });
    reports();
    openAsset("Бюро");
    // Где чего и сколько — видно без раскрытия единиц.
    expect(screen.getByRole("button", { name: "ресурс заявка" }).textContent).toMatch(/есть 0 шт\./);
    expect(screen.getByRole("button", { name: "ресурс макет" }).textContent).toMatch(/есть 1 шт\./);
    pickTrait("макет");
    view();
    const card = materialsCard();
    expect(within(card).getByText(/из задачи «Макет главной»/)).toBeInTheDocument();
    expect(within(card).getByText(/функция «Собрать макет»/)).toBeInTheDocument();
    expect(within(card).getByText("сделал в две итерации")).toBeInTheDocument();
    expect(within(card).getByText(/отдано взамен: заявка 1 \(№1\)/)).toBeInTheDocument();
    // А взятая заявка помечена израсходованной.
    pickTrait("заявка");
    view();
    expect(within(card).getByText("израсходована")).toBeInTheDocument();
    expect(within(card).getByText(/добавлен на вкладке «Материалы»/)).toBeInTheDocument();
  });

  it("материалы переживают выгрузку и загрузку", () => {
    const m = dump();
    loadJson({ ...m, materials: [{ id: "mx", trait: "req", kind: "code", qty: 1, code: "LOADED22" }] });
    reports();
    openAsset("Пользователи");
    pickTrait("заявки");
    view();
    expect(within(materialsCard()).getByText("LOADED22")).toBeInTheDocument();
    // Записанное у ресурса число не читается: «есть» — по материалам.
    openAsset("Рынок услуг");
    expect(screen.getByRole("button", { name: "ресурс спрос" }).textContent).toMatch(/есть 0 обращ\./);
  });
});
